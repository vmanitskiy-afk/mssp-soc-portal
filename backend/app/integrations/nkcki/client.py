"""
НКЦКИ (ГосСОПКА) API Client

Async HTTP client for the GosSOPKA Personal Account API v2.
Handles notification creation, status retrieval, and company listing.

API docs: https://lk.cert.gov.ru/api/v2
Auth: x-token header
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30.0


class NKCKIClientError(Exception):
    """Base error for NKCKI API communication."""

    def __init__(self, message: str, status_code: int | None = None, detail: str | None = None):
        self.status_code = status_code
        self.detail = detail
        super().__init__(message)


class NKCKIClient:
    """
    Async HTTP client for the GosSOPKA NKCKI API.

    Usage:
        client = NKCKIClient(base_url="https://lk.cert.gov.ru/api/v2", token="xxx")
        result = await client.create_notification({...})
    """

    def __init__(self, base_url: str, token: str, verify_ssl: bool = True, timeout: float = DEFAULT_TIMEOUT):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.verify_ssl = verify_ssl
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "x-token": self.token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        """Execute HTTP request to NKCKI API."""
        url = f"{self.base_url}{path}"
        try:
            async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
                resp = await client.request(method, url, headers=self._headers(), **kwargs)

            if resp.status_code in (200, 201):
                data = resp.json()
                if isinstance(data, dict) and data.get("success") is False:
                    raise NKCKIClientError(
                        f"NKCKI API error: {data.get('message', 'Unknown')}",
                        status_code=resp.status_code,
                        detail=data.get("error"),
                    )
                return data

            # Error responses
            try:
                body = resp.json()
                msg = body.get("message", body.get("error", str(body)))
            except Exception:
                msg = resp.text[:500]

            raise NKCKIClientError(
                f"NKCKI API returned {resp.status_code}: {msg}",
                status_code=resp.status_code,
                detail=msg,
            )

        except httpx.RequestError as e:
            raise NKCKIClientError(f"Connection error to NKCKI: {e}") from e

    # ── Notifications ────────────────────────────────────────────────

    async def create_notification(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        POST /incidents — create a new КИ/КА notification.

        Returns: {"success": true, "data": [{"identifier": "...", "uuid": "...", "create_time": "..."}]}
        """
        logger.info(f"Creating NKCKI notification: category={payload.get('category')}, type={payload.get('type')}")
        result = await self._request("POST", "/incidents", json=payload)
        logger.info(f"NKCKI notification created: {result}")
        return result

    async def update_notification(self, uuid: str, payload: dict[str, Any]) -> dict[str, Any]:
        """
        POST /incidents — update existing notification (uuid in body).
        """
        payload["uuid"] = uuid
        logger.info(f"Updating NKCKI notification {uuid}")
        return await self._request("POST", "/incidents", json=payload)

    async def get_notifications(
        self,
        filters: list[dict] | None = None,
        fields: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
        sort: list[dict] | None = None,
    ) -> dict[str, Any]:
        """
        GET /incidents — retrieve notifications with filtering.
        """
        import json as json_mod

        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if filters:
            params["filter"] = json_mod.dumps(filters)
        if fields:
            params["fields"] = json_mod.dumps(fields)
        if sort:
            params["sort"] = json_mod.dumps(sort)

        return await self._request("GET", "/incidents", params=params)

    async def get_notification_by_uuid(self, uuid: str) -> dict[str, Any] | None:
        """Get single notification by UUID."""
        result = await self.get_notifications(
            filters=[{"property": "uuid", "operator": "eq", "value": uuid}],
            fields=["uuid", "reg_number", "status", "create_time", "updated", "category", "type",
                     "event_description", "activity_status", "company"],
        )
        data = result.get("data", {})
        results = data.get("result", []) if isinstance(data, dict) else []
        return results[0] if results else None

    # ── Comments ─────────────────────────────────────────────────────

    async def add_comment(self, incident_uuid: str, text: str) -> dict[str, Any]:
        """POST /comments — add comment to notification."""
        payload = {"incident.uuid": incident_uuid, "data": text}
        return await self._request("POST", "/comments", json=payload)

    async def get_comments(self, incident_uuid: str) -> list[dict]:
        """GET /incidents/{uuid}/comments."""
        result = await self._request("GET", f"/incidents/{incident_uuid}/comments")
        return result.get("data", [])

    # ── Companies ────────────────────────────────────────────────────

    async def get_companies(self, limit: int = 1000) -> list[dict[str, Any]]:
        """GET /companies — list organizations available to this GosSOPKA subject."""
        import json as json_mod

        params = {
            "limit": limit,
            "fields": json_mod.dumps([
                "uuid", "id", "settings_sname", "settings_name",
                "settings_inn_of_subject", "settings_notification_email",
            ]),
        }
        result = await self._request("GET", "/companies", params=params)
        return result.get("data", [])

    # ── Files ────────────────────────────────────────────────────────

    async def get_file_metadata(self, incident_uuid: str) -> list[dict]:
        """GET /incidents/{uuid}/files — file metadata."""
        result = await self._request("GET", f"/incidents/{incident_uuid}/files")
        return result.get("data", [])
