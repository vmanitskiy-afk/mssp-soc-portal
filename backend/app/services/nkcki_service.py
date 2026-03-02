"""
НКЦКИ Service — business logic for GosSOPKA notification management.

Handles:
- Sending incidents from portal to НКЦКИ
- Tracking notification statuses
- Auto-populating fields from portal incidents
- Syncing statuses from НКЦКИ API
"""

import logging
import uuid as uuid_mod
from datetime import datetime, timezone

from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.integrations.nkcki.client import NKCKIClient, NKCKIClientError
from app.models.models import NKCKINotification

logger = logging.getLogger(__name__)


class NKCKIServiceError(Exception):
    pass


class NKCKIService:
    """Service for managing НКЦКИ notifications."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Send notification ────────────────────────────────────────────

    async def send_notification(
        self,
        incident_id: str | None,
        tenant_id: str,
        sent_by: str,
        nkcki_url: str,
        nkcki_token: str,
        payload: dict,
    ) -> NKCKINotification:
        """
        Send an incident as a notification to НКЦКИ.

        1. Build the API payload from form data
        2. Call НКЦКИ API to create notification
        3. Save result to local DB
        """
        # Build the NKCKI API payload
        api_payload = self._build_api_payload(payload)

        # Call NKCKI API
        client = NKCKIClient(base_url=nkcki_url, token=nkcki_token, verify_ssl=False)
        try:
            result = await client.create_notification(api_payload)
        except NKCKIClientError as e:
            logger.error(f"Failed to send notification to NKCKI: {e}")
            raise NKCKIServiceError(f"Ошибка отправки в НКЦКИ: {e}") from e

        # Extract response data
        response_data_list = result.get("data", [])
        nkcki_uuid = None
        nkcki_identifier = None
        if response_data_list and isinstance(response_data_list, list):
            first = response_data_list[0]
            nkcki_uuid = first.get("uuid")
            nkcki_identifier = first.get("identifier")

        # Save to local DB
        notification = NKCKINotification(
            id=uuid_mod.uuid4(),
            incident_id=uuid_mod.UUID(incident_id) if incident_id else None,
            tenant_id=uuid_mod.UUID(tenant_id),
            nkcki_uuid=nkcki_uuid,
            nkcki_identifier=nkcki_identifier,
            category=payload["category"],
            type=payload["type"],
            company_name=payload["company"],
            owner_name=payload["owner_name"],
            tlp=payload["tlp"],
            event_description=payload["event_description"],
            detect_time=datetime.fromisoformat(payload["detect_time"].replace("Z", "+00:00")),
            end_time=datetime.fromisoformat(payload["end_time"].replace("Z", "+00:00")) if payload.get("end_time") else None,
            activity_status=payload["activity_status"],
            detection_tool=payload.get("detection_tool"),
            assistance=payload.get("assistance", False),
            affected_system_name=payload["affected_system_name"],
            affected_system_category=payload["affected_system_category"],
            affected_system_function=payload["affected_system_function"],
            affected_system_connection=payload.get("affected_system_connection", False),
            location=payload["location"],
            city=payload.get("city"),
            integrity_impact=payload.get("integrity_impact"),
            availability_impact=payload.get("availability_impact"),
            confidentiality_impact=payload.get("confidentiality_impact"),
            custom_impact=payload.get("custom_impact"),
            technical_data=payload.get("technical_data"),
            rkn_data=payload.get("rkn_data"),
            nkcki_status="Проверка НКЦКИ",
            sent_payload=api_payload,
            response_data=result,
            sent_by=uuid_mod.UUID(sent_by),
        )

        self.db.add(notification)
        await self.db.commit()
        await self.db.refresh(notification)

        logger.info(f"NKCKI notification saved: id={notification.id}, nkcki_uuid={nkcki_uuid}, identifier={nkcki_identifier}")
        return notification

    # ── List notifications ───────────────────────────────────────────

    async def list_notifications(
        self,
        page: int = 1,
        per_page: int = 20,
        tenant_id: str | None = None,
        status: str | None = None,
        category: str | None = None,
    ) -> dict:
        """List NKCKI notifications with pagination and filters."""
        query = select(NKCKINotification).options(
            joinedload(NKCKINotification.incident),
            joinedload(NKCKINotification.sender),
            joinedload(NKCKINotification.tenant),
        )

        if tenant_id:
            query = query.where(NKCKINotification.tenant_id == uuid_mod.UUID(tenant_id))
        if status:
            query = query.where(NKCKINotification.nkcki_status == status)
        if category:
            query = query.where(NKCKINotification.category == category)

        # Count
        count_q = select(func.count(NKCKINotification.id))
        if tenant_id:
            count_q = count_q.where(NKCKINotification.tenant_id == uuid_mod.UUID(tenant_id))
        if status:
            count_q = count_q.where(NKCKINotification.nkcki_status == status)
        if category:
            count_q = count_q.where(NKCKINotification.category == category)

        total = (await self.db.execute(count_q)).scalar() or 0

        # Paginate
        query = query.order_by(desc(NKCKINotification.sent_at))
        query = query.offset((page - 1) * per_page).limit(per_page)

        result = await self.db.execute(query)
        notifications = result.unique().scalars().all()

        return {
            "items": [self._serialize(n) for n in notifications],
            "total": total,
            "page": page,
            "pages": max(1, (total + per_page - 1) // per_page),
        }

    # ── Get single notification ──────────────────────────────────────

    async def get_notification(self, notification_id: str) -> dict | None:
        """Get single NKCKI notification by ID."""
        query = select(NKCKINotification).options(
            joinedload(NKCKINotification.incident),
            joinedload(NKCKINotification.sender),
            joinedload(NKCKINotification.tenant),
        ).where(NKCKINotification.id == uuid_mod.UUID(notification_id))

        result = await self.db.execute(query)
        notification = result.unique().scalar_one_or_none()
        if not notification:
            return None

        return self._serialize(notification)

    # ── Sync status ──────────────────────────────────────────────────

    async def sync_status(
        self, notification_id: str, nkcki_url: str, nkcki_token: str
    ) -> dict | None:
        """Sync notification status from NKCKI API."""
        query = select(NKCKINotification).where(
            NKCKINotification.id == uuid_mod.UUID(notification_id)
        )
        result = await self.db.execute(query)
        notification = result.scalar_one_or_none()
        if not notification or not notification.nkcki_uuid:
            return None

        client = NKCKIClient(base_url=nkcki_url, token=nkcki_token, verify_ssl=False)
        try:
            remote = await client.get_notification_by_uuid(notification.nkcki_uuid)
        except NKCKIClientError as e:
            logger.error(f"Failed to sync NKCKI status for {notification_id}: {e}")
            raise NKCKIServiceError(f"Ошибка синхронизации: {e}") from e

        if remote and "status" in remote:
            status_obj = remote["status"]
            new_status = status_obj.get("name", str(status_obj)) if isinstance(status_obj, dict) else str(status_obj)
            notification.nkcki_status = new_status
            notification.last_synced_at = datetime.now(timezone.utc)
            await self.db.commit()
            await self.db.refresh(notification)

        return self._serialize(notification)

    # ── Build API payload ────────────────────────────────────────────

    def _build_api_payload(self, data: dict) -> dict:
        """Build the payload for NKCKI POST /incidents."""
        payload = {
            "company": data["company"],
            "category": data["category"],
            "type": data["type"],
            "owner_name": data["owner_name"],
            "event_description": data["event_description"],
            "tlp": data["tlp"],
            "detect_time": data["detect_time"],
            "activity_status": data["activity_status"],
            "affected_system_name": data["affected_system_name"],
            "affected_system_category": data["affected_system_category"],
            "affected_system_function": data["affected_system_function"],
            "affected_system_connection": data.get("affected_system_connection", False),
            "location": data["location"],
        }

        # Optional fields
        for field in ["end_time", "detection_tool", "city", "assistance",
                      "integrity_impact", "availability_impact", "confidentiality_impact", "custom_impact"]:
            if data.get(field) is not None:
                payload[field] = data[field]

        # Technical data (observables, indicators)
        tech = data.get("technical_data", {})
        if tech and data.get("affected_system_connection"):
            for key in [
                "related_observables_ipv4", "related_observables_ipv6",
                "related_observables_domain", "related_observables_uri",
                "related_observables_email", "related_observables_service",
                "related_indicators_ipv4", "related_indicators_ipv6",
                "related_indicators_domain", "related_indicators_uri",
                "related_indicators_email", "malware_hash", "related_indicators_vuln",
            ]:
                if tech.get(key):
                    payload[key] = tech[key]

        # RKN data (personal data leak)
        rkn = data.get("rkn_data", {})
        if rkn and rkn.get("rkn_leak_pd"):
            for key in [
                "rkn_leak_pd", "rkn_full_name", "rkn_inn", "rkn_address",
                "rkn_email", "rkn_reasons", "rkn_pers_data", "rkn_damage",
                "rkn_measures", "rkn_add_info", "rkn_investigation",
            ]:
                if rkn.get(key) is not None:
                    payload[key] = rkn[key]

        return payload

    # ── Serialization ────────────────────────────────────────────────

    def _serialize(self, n: NKCKINotification) -> dict:
        return {
            "id": str(n.id),
            "incident_id": str(n.incident_id) if n.incident_id else None,
            "incident_title": n.incident.title if n.incident else None,
            "incident_rusiem_id": n.incident.rusiem_incident_id if n.incident else None,
            "tenant_id": str(n.tenant_id),
            "tenant_name": n.tenant.name if n.tenant else None,
            "nkcki_uuid": n.nkcki_uuid,
            "nkcki_identifier": n.nkcki_identifier,
            "category": n.category,
            "type": n.type,
            "company_name": n.company_name,
            "owner_name": n.owner_name,
            "tlp": n.tlp,
            "event_description": n.event_description,
            "detect_time": n.detect_time.isoformat() if n.detect_time else None,
            "end_time": n.end_time.isoformat() if n.end_time else None,
            "activity_status": n.activity_status,
            "detection_tool": n.detection_tool,
            "assistance": n.assistance,
            "affected_system_name": n.affected_system_name,
            "affected_system_category": n.affected_system_category,
            "affected_system_function": n.affected_system_function,
            "affected_system_connection": n.affected_system_connection,
            "location": n.location,
            "city": n.city,
            "integrity_impact": n.integrity_impact,
            "availability_impact": n.availability_impact,
            "confidentiality_impact": n.confidentiality_impact,
            "custom_impact": n.custom_impact,
            "nkcki_status": n.nkcki_status,
            "sent_by_name": n.sender.name if n.sender else None,
            "sent_at": n.sent_at.isoformat() if n.sent_at else None,
            "last_synced_at": n.last_synced_at.isoformat() if n.last_synced_at else None,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
