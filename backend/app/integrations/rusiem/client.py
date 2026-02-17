"""
RuSIEM API v1 Adapter

Async HTTP client for RuSIEM SIEM system.
Handles authentication, request caching, status mapping, and error handling.

Reference: RuSIEM API User Guide 2026
"""

import logging
from enum import Enum

import httpx
import redis.asyncio as redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


# ── Status mapping: RuSIEM → Portal ──────────────────────────────

class PortalIncidentStatus(str, Enum):
    NEW = "new"
    IN_PROGRESS = "in_progress"
    AWAITING_CUSTOMER = "awaiting_customer"
    RESOLVED = "resolved"
    CLOSED = "closed"
    FALSE_POSITIVE = "false_positive"


RUSIEM_STATUS_MAP: dict[str, PortalIncidentStatus] = {
    "assigned": PortalIncidentStatus.NEW,
    "in_work": PortalIncidentStatus.IN_PROGRESS,
    "escalated": PortalIncidentStatus.IN_PROGRESS,
    "suspended": PortalIncidentStatus.AWAITING_CUSTOMER,
    "resolved": PortalIncidentStatus.RESOLVED,
    "reopen": PortalIncidentStatus.IN_PROGRESS,
}

RUSIEM_PRIORITY_MAP: dict[int, str] = {
    1: "critical",
    2: "high",
    3: "medium",
    4: "low",
}


# ── RuSIEM Client ────────────────────────────────────────────────

class RuSIEMClient:
    """Async client for RuSIEM API v1.

    Each tenant has its own RuSIEM connection params (url, api_key, tenant_uuid).
    Results are cached in Redis to minimize load on SIEM.

    Usage:
        client = RuSIEMClient(
            base_url="https://10.1.21.4",
            api_key="uvQS3rSmSRikak7a...",
            tenant_uuid="abc-123",  # optional, for multitenancy
            redis_client=redis_instance,
        )
        incidents = await client.get_incidents(limit=25, status="in_work")
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        tenant_uuid: str | None = None,
        redis_client: redis.Redis | None = None,
        verify_ssl: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.tenant_uuid = tenant_uuid
        self.redis = redis_client
        self.http = httpx.AsyncClient(
            base_url=f"{self.base_url}/api/v1",
            verify=verify_ssl,
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    async def close(self):
        await self.http.aclose()

    # ── Internal helpers ─────────────────────────────────────────

    def _params(self, extra: dict | None = None) -> dict:
        """Build query params with API key and optional tenant_uuid."""
        params = {"_api_key": self.api_key}
        if self.tenant_uuid:
            params["tenant_uuid"] = self.tenant_uuid
        if extra:
            params.update({k: v for k, v in extra.items() if v is not None})
        return params

    async def _get(self, path: str, params: dict | None = None, cache_ttl: int = 0) -> dict | list:
        """Execute GET request with optional Redis caching."""
        full_params = self._params(params)

        # Check cache
        if self.redis and cache_ttl > 0:
            cache_key = f"rusiem:{self.tenant_uuid or 'default'}:{path}:{hash(str(sorted(full_params.items())))}"
            cached = await self.redis.get(cache_key)
            if cached:
                import json
                logger.debug(f"Cache hit: {path}")
                return json.loads(cached)

        # Make request
        try:
            response = await self.http.get(path, params=full_params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"RuSIEM API error {e.response.status_code}: {path}")
            raise RuSIEMAPIError(
                status_code=e.response.status_code,
                detail=f"RuSIEM API returned {e.response.status_code}",
            )
        except httpx.RequestError as e:
            logger.error(f"RuSIEM connection error: {e}")
            raise RuSIEMConnectionError(f"Cannot connect to RuSIEM: {e}")

        # Store in cache
        if self.redis and cache_ttl > 0:
            import json
            await self.redis.setex(cache_key, cache_ttl, json.dumps(data, default=str))

        return data

    async def _post(self, path: str, body: dict | None = None) -> dict:
        """Execute POST request."""
        try:
            response = await self.http.post(path, params=self._params(), json=body)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"RuSIEM API POST error {e.response.status_code}: {path}")
            raise RuSIEMAPIError(e.response.status_code, str(e))

    # ── Incidents ─────────────────────────────────────────────────

    async def get_incidents(
        self,
        limit: int = 25,
        offset: int = 0,
        status: str | None = None,
        query: str | None = None,
        created_from: str | None = None,
        created_to: str | None = None,
        order_by: str = "created_at",
        order_dir: str = "DESC",
    ) -> dict:
        """Get list of incidents with filtering and pagination.

        Returns dict with: recordsTotal, recordsFiltered, recordsCount, data[], currentDate
        """
        params = {
            "limit": str(limit),
            "offset": str(offset),
            "orderBy": order_by,
            "orderDir": order_dir,
        }
        if status:
            params["status"] = status
        if query:
            params["query"] = query
        if created_from:
            params["created_from"] = created_from
        if created_to:
            params["created_to"] = created_to

        return await self._get("/incidents/", params, cache_ttl=60)

    async def get_incident(self, incident_id: int) -> dict:
        """Get single incident by ID."""
        return await self._get(f"/incidents/{incident_id}", cache_ttl=30)

    async def get_incident_fullinfo(self, incident_id: int) -> dict:
        """Get full incident details with metadata."""
        return await self._get(f"/incidents/{incident_id}/fullinfo", cache_ttl=30)

    async def get_incident_history(self, incident_id: int) -> dict:
        """Get incident history for MTTA/MTTR calculation."""
        return await self._get(f"/incidents/{incident_id}/history", cache_ttl=60)

    async def get_incident_events(
        self, incident_id: int, limit: int = 25, offset: int = 0
    ) -> dict:
        """Get events associated with an incident."""
        return await self._get(
            f"/events/incident/{incident_id}",
            {"limit": str(limit), "offset": str(offset)},
            cache_ttl=30,
        )

    async def get_resolved_incidents(self, limit: int = 25, offset: int = 0) -> dict:
        """Get closed/resolved incidents."""
        return await self._get(
            "/incidents/resolved",
            {"limit": str(limit), "offset": str(offset)},
            cache_ttl=300,
        )

    async def close_incident(self, incident_id: int, is_wrong: bool = False) -> dict:
        """Fast-close an incident. Set is_wrong=True for false positive."""
        return await self._post(
            f"/incidents/{incident_id}/fastclose",
            {"is_wrong": is_wrong},
        )

    # ── Events ────────────────────────────────────────────────────

    async def search_events(
        self,
        query: str = "",
        filters: str = "",
        interval: str = "1d",
        fields: str = "",
        limit: int = 25,
    ) -> dict:
        """Search events with RuSIEM query syntax."""
        params = {
            "query": query,
            "filters": filters,
            "interval": interval,
            "limit": str(limit),
        }
        if fields:
            params["fields"] = fields
        return await self._get("/events/find", params, cache_ttl=15)

    # ── Correlation (use cases) ───────────────────────────────────

    async def get_correlation_rules(self, limit: int = 100) -> dict:
        """Get active correlation rules (use cases)."""
        return await self._get(
            "/correlation/rules",
            {"limit": str(limit)},
            cache_ttl=300,
        )

    # ── Assets ────────────────────────────────────────────────────

    async def get_assets(self, limit: int = 100, search: str = "") -> dict:
        """Get asset inventory."""
        params = {"length": str(limit)}
        if search:
            params["search"] = search
        return await self._get("/assets/table", params, cache_ttl=300)

    # ── System ────────────────────────────────────────────────────

    async def get_eps(self) -> int:
        """Get current Events Per Second value."""
        data = await self._get("/system/searchEps", cache_ttl=15)
        return int(data) if isinstance(data, (int, float, str)) else 0

    async def get_license_info(self) -> dict:
        """Get license expiration info."""
        return await self._get("/license/list_main", cache_ttl=3600)

    # ── Data transformation ───────────────────────────────────────

    @staticmethod
    def map_incident(raw: dict) -> dict:
        """Transform RuSIEM incident to portal format."""
        rusiem_status = raw.get("status", "assigned")
        portal_status = RUSIEM_STATUS_MAP.get(rusiem_status, PortalIncidentStatus.NEW)

        priority_num = raw.get("priority", 4)
        priority_label = RUSIEM_PRIORITY_MAP.get(priority_num, "low")

        return {
            "id": raw["id"],
            "name": raw.get("name", ""),
            "status": portal_status.value,
            "rusiem_status": rusiem_status,
            "priority": priority_label,
            "priority_num": priority_num,
            "description": raw.get("description"),
            "solution": raw.get("solution"),
            "group_name": raw.get("group_name", ""),
            "group_by": raw.get("group_by", ""),
            "group_by_value": raw.get("group_by_value", ""),
            "count_events": raw.get("count_events", 0),
            "mitre_technique": raw.get("mitre_technique"),
            "assigned_users": raw.get("assigned_users", []),
            "assigned_roles": raw.get("assigned_roles", []),
            "created_at": raw.get("created_at"),
            "updated_at": raw.get("updated_at"),
        }

    @staticmethod
    def map_incident_preview(incident: dict, fullinfo: dict) -> dict:
        """Build preview for publish form.

        Combines data from GET /incidents/{id} and GET /incidents/{id}/fullinfo.
        Maps RuSIEM fields to portal fields that auto-fill the publish form.

        Fields extracted from fullinfo meta_values:
        - IP источника событий → event_source_ips
        - Имя хоста-источника событий → source_hostnames
        - Исходный IP адрес → source_ips
        - Категория симптома → symptoms
        """
        priority_num = incident.get("priority", 4)
        meta = fullinfo.get("meta_values", {})

        # Extract lists from meta_values
        # RuSIEM returns: {"field_name": [{"value": "10.1.1.1", "count": 5}, ...]}
        def extract_values(field_data) -> list[str]:
            if isinstance(field_data, list):
                return [item.get("value", str(item)) if isinstance(item, dict) else str(item) for item in field_data]
            return []

        return {
            "rusiem_incident_id": incident["id"],
            "title": incident.get("name", ""),
            "description": incident.get("description", ""),
            "priority": RUSIEM_PRIORITY_MAP.get(priority_num, "low"),
            "priority_num": priority_num,
            "category": meta.get("symptom_category", [{}])[0].get("value") if meta.get("symptom_category") else None,
            "mitre_id": incident.get("mitre_technique"),
            "source_ips": extract_values(meta.get("src_ip", [])),
            "source_hostnames": extract_values(meta.get("event_source_hostname", [])),
            "event_source_ips": extract_values(meta.get("event_source_ip", [])),
            "event_count": incident.get("count_events", 0),
            "symptoms": extract_values(meta.get("symptom_name", [])),
            "rusiem_status": incident.get("status", "assigned"),
            "created_at": incident.get("created_at"),
            "rusiem_raw_data": {
                "incident": incident,
                "fullinfo": fullinfo,
            },
        }


# ── Exceptions ────────────────────────────────────────────────────

class RuSIEMAPIError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class RuSIEMConnectionError(Exception):
    pass
