"""
Incident service.

Core business logic:
- Preview incident from RuSIEM (auto-fill fields)
- Publish incident to a client
- Add comments (SOC and client)
- Change status with transition validation
- List/filter incidents
"""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.integrations.rusiem.client import RuSIEMClient
from app.models.models import (
    PublishedIncident, IncidentComment, IncidentStatusChange,
    Notification, Tenant, AuditLog,
)

logger = logging.getLogger(__name__)


class IncidentServiceError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


# ── Status transition rules ───────────────────────────────────────

# Who can transition to which statuses
CLIENT_TRANSITIONS = {
    "new": ["in_progress"],
    "in_progress": ["awaiting_soc", "resolved"],
    "awaiting_customer": ["in_progress"],
    "resolved": ["closed"],
}

SOC_TRANSITIONS = {
    "new": ["in_progress", "awaiting_customer", "false_positive"],
    "in_progress": ["awaiting_customer", "resolved", "false_positive"],
    "awaiting_soc": ["in_progress", "awaiting_customer", "resolved"],
    "awaiting_customer": ["in_progress"],
    "resolved": ["closed", "in_progress"],  # Reopen if needed
}


class IncidentService:
    def __init__(self, db: AsyncSession, rusiem: RuSIEMClient | None = None):
        self.db = db
        self.rusiem = rusiem

    # ── Preview (auto-fill from RuSIEM) ───────────────────────────

    async def preview_from_rusiem(self, rusiem_incident_id: int) -> dict:
        """Fetch incident from RuSIEM and return mapped preview for publish form.

        Calls:
        - GET /api/v1/incidents/{id}
        - GET /api/v1/incidents/{id}/fullinfo
        """
        if not self.rusiem:
            raise IncidentServiceError("RuSIEM client not configured", 500)

        try:
            incident = await self.rusiem.get_incident(rusiem_incident_id)
            fullinfo = await self.rusiem.get_incident_fullinfo(rusiem_incident_id)
        except Exception as e:
            logger.error(f"Failed to fetch incident {rusiem_incident_id} from RuSIEM: {e}")
            raise IncidentServiceError(
                f"Failed to fetch incident #{rusiem_incident_id} from RuSIEM: {str(e)}", 502
            )

        return RuSIEMClient.map_incident_preview(incident, fullinfo)

    # ── Publish incident to client ────────────────────────────────

    async def publish_incident(
        self,
        rusiem_incident_id: int,
        tenant_id: str,
        recommendations: str,
        soc_actions: str | None,
        published_by_id: str,
    ) -> PublishedIncident:
        """Publish a RuSIEM incident to a specific client.

        1. Fetch incident data from RuSIEM (auto-fill)
        2. Create PublishedIncident record
        3. Create initial status change (-> new)
        4. Create notification for client
        """
        # Verify tenant exists
        tenant = await self.db.execute(
            select(Tenant).where(Tenant.id == tenant_id, Tenant.is_active == True)  # noqa: E712
        )
        tenant_obj = tenant.scalar_one_or_none()
        if not tenant_obj:
            raise IncidentServiceError(f"Tenant {tenant_id} not found", 404)

        # Check if already published to this tenant
        existing = await self.db.execute(
            select(PublishedIncident).where(
                PublishedIncident.rusiem_incident_id == rusiem_incident_id,
                PublishedIncident.tenant_id == tenant_id,
            )
        )
        if existing.scalar_one_or_none():
            raise IncidentServiceError(
                f"Incident #{rusiem_incident_id} is already published to {tenant_obj.name}", 409
            )

        # Fetch and map from RuSIEM
        preview = await self.preview_from_rusiem(rusiem_incident_id)

        # Create incident
        incident = PublishedIncident(
            tenant_id=uuid.UUID(tenant_id),
            rusiem_incident_id=rusiem_incident_id,
            title=preview["title"],
            description=preview.get("description"),
            priority=preview["priority"],
            priority_num=preview["priority_num"],
            category=preview.get("category"),
            mitre_id=preview.get("mitre_id"),
            source_ips=preview.get("source_ips", []),
            source_hostnames=preview.get("source_hostnames", []),
            event_source_ips=preview.get("event_source_ips", []),
            event_count=preview.get("event_count", 0),
            symptoms=preview.get("symptoms", []),
            rusiem_created_at=preview.get("created_at"),
            rusiem_raw_data=preview.get("rusiem_raw_data"),
            status="new",
            recommendations=recommendations,
            soc_actions=soc_actions,
            published_by=uuid.UUID(published_by_id),
        )
        self.db.add(incident)
        await self.db.flush()

        # Initial status change
        self.db.add(IncidentStatusChange(
            incident_id=incident.id,
            user_id=uuid.UUID(published_by_id),
            old_status="none",
            new_status="new",
            comment="Incident published to client",
        ))

        # Notification for client
        self.db.add(Notification(
            tenant_id=uuid.UUID(tenant_id),
            type="new_incident",
            title=f"New {preview['priority']} incident: {preview['title'][:100]}",
            message=f"SOC published incident #{rusiem_incident_id}. Please review recommendations.",
            extra_data={"incident_id": str(incident.id), "priority": preview["priority"]},
        ))

        # Audit
        self.db.add(AuditLog(
            tenant_id=uuid.UUID(tenant_id),
            user_id=uuid.UUID(published_by_id),
            action="incident_published",
            resource_type="incident",
            resource_id=str(incident.id),
            details={"rusiem_id": rusiem_incident_id, "priority": preview["priority"]},
        ))

        await self.db.flush()
        logger.info(
            f"Incident #{rusiem_incident_id} published to tenant {tenant_obj.short_name} "
            f"as {incident.id} ({preview['priority']})"
        )
        return incident

    # ── Update published incident (SOC) ───────────────────────────

    async def update_soc_fields(
        self,
        incident_id: str,
        recommendations: str | None = None,
        soc_actions: str | None = None,
        updated_by_id: str = "",
    ) -> PublishedIncident:
        incident = await self._get_incident(incident_id)

        if recommendations is not None:
            incident.recommendations = recommendations
        if soc_actions is not None:
            incident.soc_actions = soc_actions

        await self.db.flush()
        return incident

    # ── Add comment ───────────────────────────────────────────────

    async def add_comment(
        self,
        incident_id: str,
        user_id: str,
        text: str,
        is_soc: bool,
        tenant_id: str | None = None,
    ) -> IncidentComment:
        incident = await self._get_incident(incident_id)

        # Client can only comment on their own incidents
        if not is_soc and tenant_id and str(incident.tenant_id) != tenant_id:
            raise IncidentServiceError("Access denied", 403)

        comment = IncidentComment(
            tenant_id=incident.tenant_id,
            incident_id=incident.id,
            user_id=uuid.UUID(user_id),
            text=text,
            is_soc=is_soc,
        )
        self.db.add(comment)

        # Notify the other side
        notif_type = "soc_comment" if is_soc else "client_comment"
        self.db.add(Notification(
            tenant_id=incident.tenant_id,
            type=notif_type,
            title=f"New comment on incident: {incident.title[:80]}",
            message=text[:200],
            extra_data={"incident_id": str(incident.id)},
        ))

        await self.db.flush()
        return comment

    # ── Change status ─────────────────────────────────────────────

    async def change_status(
        self,
        incident_id: str,
        new_status: str,
        user_id: str,
        is_soc: bool,
        comment: str | None = None,
        tenant_id: str | None = None,
    ) -> PublishedIncident:
        incident = await self._get_incident(incident_id)

        # Client can only change status of their own incidents
        if not is_soc and tenant_id and str(incident.tenant_id) != tenant_id:
            raise IncidentServiceError("Access denied", 403)

        # Validate transition
        transitions = SOC_TRANSITIONS if is_soc else CLIENT_TRANSITIONS
        allowed = transitions.get(incident.status, [])
        if new_status not in allowed:
            raise IncidentServiceError(
                f"Cannot transition from '{incident.status}' to '{new_status}'. "
                f"Allowed: {allowed}"
            )

        old_status = incident.status
        incident.status = new_status

        # Handle closing
        if new_status == "closed":
            incident.closed_by = uuid.UUID(user_id)
            incident.closed_at = datetime.now(timezone.utc)

        # Status change record
        self.db.add(IncidentStatusChange(
            incident_id=incident.id,
            user_id=uuid.UUID(user_id),
            old_status=old_status,
            new_status=new_status,
            comment=comment,
        ))

        # Notification
        self.db.add(Notification(
            tenant_id=incident.tenant_id,
            type="status_change",
            title=f"Incident status changed: {old_status} → {new_status}",
            message=comment or f"Incident '{incident.title[:80]}' status updated.",
            extra_data={
                "incident_id": str(incident.id),
                "old_status": old_status,
                "new_status": new_status,
            },
        ))

        await self.db.flush()
        logger.info(f"Incident {incident_id}: {old_status} -> {new_status}")
        return incident

    # ── Update client response ────────────────────────────────────

    async def update_client_response(
        self, incident_id: str, client_response: str, tenant_id: str
    ) -> PublishedIncident:
        incident = await self._get_incident(incident_id)

        if str(incident.tenant_id) != tenant_id:
            raise IncidentServiceError("Access denied", 403)

        incident.client_response = client_response
        await self.db.flush()
        return incident

    # ── List incidents ────────────────────────────────────────────

    async def list_incidents(
        self,
        tenant_id: str | None = None,
        status: str | None = None,
        priority: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        page: int = 1,
        per_page: int = 25,
    ) -> dict:
        query = select(PublishedIncident)

        if tenant_id:
            query = query.where(PublishedIncident.tenant_id == tenant_id)
        if status:
            query = query.where(PublishedIncident.status == status)
        if priority:
            query = query.where(PublishedIncident.priority == priority)
        if date_from:
            query = query.where(PublishedIncident.published_at >= date_from)
        if date_to:
            query = query.where(PublishedIncident.published_at <= date_to)

        # Count
        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar() or 0

        # Fetch with comment count
        query = query.order_by(PublishedIncident.published_at.desc())
        query = query.offset((page - 1) * per_page).limit(per_page)
        result = await self.db.execute(query)
        incidents = result.scalars().all()

        items = []
        for inc in incidents:
            # Count comments
            cc = await self.db.execute(
                select(func.count()).where(IncidentComment.incident_id == inc.id)
            )
            items.append({
                "id": str(inc.id),
                "rusiem_incident_id": inc.rusiem_incident_id,
                "title": inc.title,
                "priority": inc.priority,
                "status": inc.status,
                "category": inc.category,
                "published_at": inc.published_at.isoformat() if inc.published_at else None,
                "updated_at": inc.updated_at.isoformat() if inc.updated_at else None,
                "comments_count": cc.scalar() or 0,
            })

        return {
            "items": items,
            "total": total,
            "page": page,
            "pages": (total + per_page - 1) // per_page,
        }

    # ── Get incident detail ───────────────────────────────────────

    async def get_incident_detail(
        self, incident_id: str, tenant_id: str | None = None
    ) -> dict:
        result = await self.db.execute(
            select(PublishedIncident)
            .options(
                selectinload(PublishedIncident.comments).selectinload(IncidentComment.user),
                selectinload(PublishedIncident.status_history).selectinload(IncidentStatusChange.user),
                selectinload(PublishedIncident.publisher),
                selectinload(PublishedIncident.closer),
            )
            .where(PublishedIncident.id == incident_id)
        )
        incident = result.scalar_one_or_none()
        if not incident:
            raise IncidentServiceError("Incident not found", 404)

        # Client can only view their own
        if tenant_id and str(incident.tenant_id) != tenant_id:
            raise IncidentServiceError("Access denied", 403)

        return {
            "id": str(incident.id),
            "rusiem_incident_id": incident.rusiem_incident_id,
            "title": incident.title,
            "description": incident.description,
            "priority": incident.priority,
            "category": incident.category,
            "mitre_id": incident.mitre_id,
            "source_ips": incident.source_ips or [],
            "source_hostnames": incident.source_hostnames or [],
            "event_source_ips": incident.event_source_ips or [],
            "event_count": incident.event_count,
            "symptoms": incident.symptoms or [],
            "rusiem_created_at": incident.rusiem_created_at.isoformat() if incident.rusiem_created_at else None,
            "status": incident.status,
            "recommendations": incident.recommendations,
            "soc_actions": incident.soc_actions,
            "client_response": incident.client_response,
            "published_by_name": incident.publisher.name if incident.publisher else "",
            "published_at": incident.published_at.isoformat() if incident.published_at else None,
            "closed_by_name": incident.closer.name if incident.closer else None,
            "closed_at": incident.closed_at.isoformat() if incident.closed_at else None,
            "comments": [
                {
                    "id": str(c.id),
                    "user_name": c.user.name if c.user else "Unknown",
                    "text": c.text,
                    "is_soc": c.is_soc,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                }
                for c in incident.comments
            ],
            "status_history": [
                {
                    "old_status": sh.old_status,
                    "new_status": sh.new_status,
                    "user_name": sh.user.name if sh.user else "Unknown",
                    "comment": sh.comment,
                    "created_at": sh.created_at.isoformat() if sh.created_at else None,
                }
                for sh in incident.status_history
            ],
        }

    # ── Helpers ───────────────────────────────────────────────────

    async def _get_incident(self, incident_id: str) -> PublishedIncident:
        result = await self.db.execute(
            select(PublishedIncident).where(PublishedIncident.id == incident_id)
        )
        incident = result.scalar_one_or_none()
        if not incident:
            raise IncidentServiceError("Incident not found", 404)
        return incident
