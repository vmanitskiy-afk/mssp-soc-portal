"""
Log Source management service.

Handles CRUD operations for log sources and status synchronization
with RuSIEM via periodic checks.

Status logic:
- active:    last_event_at < 30 minutes ago
- degraded:  last_event_at between 30 min and 2 hours ago, or parsing errors
- no_logs:   last_event_at > 2 hours ago (or never received)
- error:     connection/parsing errors detected
- unknown:   newly added, not yet checked
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func, update, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import LogSource, Tenant

logger = logging.getLogger(__name__)

# ── Status thresholds ─────────────────────────────────────────────

NO_LOGS_THRESHOLD_MINUTES = 30
DEGRADED_THRESHOLD_MINUTES = 120  # 2 hours


class LogSourceServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class LogSourceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── List (client view) ────────────────────────────────────────

    async def list_for_tenant(
        self,
        tenant_id: str,
        status: str | None = None,
        search: str | None = None,
        source_type: str | None = None,
    ) -> list[dict]:
        """List log sources for a tenant with optional filters."""
        query = (
            select(LogSource)
            .where(LogSource.tenant_id == tenant_id, LogSource.is_active == True)  # noqa: E712
        )

        if status:
            query = query.where(LogSource.status == status)

        if source_type:
            query = query.where(LogSource.source_type == source_type)

        if search:
            pattern = f"%{search}%"
            query = query.where(
                or_(
                    LogSource.name.ilike(pattern),
                    LogSource.host.ilike(pattern),
                    LogSource.vendor.ilike(pattern),
                    LogSource.product.ilike(pattern),
                )
            )

        query = query.order_by(LogSource.name)
        result = await self.db.execute(query)
        sources = result.scalars().all()

        return [self._to_dict(s) for s in sources]

    # ── Stats (for dashboard widget) ──────────────────────────────

    async def get_stats(self, tenant_id: str) -> dict:
        """Source status statistics for a tenant."""
        query = (
            select(
                func.count().label("total"),
                func.count().filter(LogSource.status == "active").label("active"),
                func.count().filter(LogSource.status == "degraded").label("degraded"),
                func.count().filter(LogSource.status == "no_logs").label("no_logs"),
                func.count().filter(LogSource.status == "error").label("error"),
                func.count().filter(LogSource.status == "unknown").label("unknown"),
            )
            .where(LogSource.tenant_id == tenant_id, LogSource.is_active == True)  # noqa: E712
        )
        result = await self.db.execute(query)
        row = result.one()

        return {
            "total": row.total,
            "active": row.active,
            "degraded": row.degraded,
            "no_logs": row.no_logs,
            "error": row.error,
            "unknown": row.unknown,
        }

    # ── Get source types (for filter dropdown) ────────────────────

    async def get_source_types(self, tenant_id: str) -> list[str]:
        """Get distinct source types for a tenant."""
        result = await self.db.execute(
            select(LogSource.source_type)
            .where(LogSource.tenant_id == tenant_id, LogSource.is_active == True)  # noqa: E712
            .distinct()
            .order_by(LogSource.source_type)
        )
        return [row[0] for row in result.all()]

    # ── CRUD (SOC management) ─────────────────────────────────────

    async def create(
        self,
        tenant_id: str,
        name: str,
        source_type: str,
        host: str,
        vendor: str | None = None,
        product: str | None = None,
        rusiem_group_name: str | None = None,
    ) -> LogSource:
        """Create a new log source for a tenant."""
        # Verify tenant exists
        tenant = await self.db.get(Tenant, uuid.UUID(tenant_id))
        if not tenant:
            raise LogSourceServiceError(404, "Клиент не найден")

        # Check for duplicate host in the same tenant
        existing = await self.db.execute(
            select(LogSource).where(
                LogSource.tenant_id == tenant_id,
                LogSource.host == host,
                LogSource.is_active == True,  # noqa: E712
            )
        )
        if existing.scalar_one_or_none():
            raise LogSourceServiceError(409, f"Источник с хостом {host} уже существует для данного клиента")

        source = LogSource(
            tenant_id=uuid.UUID(tenant_id),
            name=name,
            source_type=source_type,
            host=host,
            vendor=vendor,
            product=product,
            rusiem_group_name=rusiem_group_name,
            status="unknown",
        )
        self.db.add(source)
        await self.db.flush()
        return source

    async def update_source(
        self,
        source_id: str,
        **fields,
    ) -> LogSource:
        """Update log source fields."""
        source = await self.db.get(LogSource, uuid.UUID(source_id))
        if not source:
            raise LogSourceServiceError(404, "Источник не найден")

        allowed = {"name", "source_type", "host", "vendor", "product", "rusiem_group_name"}
        for key, value in fields.items():
            if key in allowed and value is not None:
                setattr(source, key, value)

        await self.db.flush()
        return source

    async def delete_source(self, source_id: str) -> dict:
        """Soft-delete a log source."""
        source = await self.db.get(LogSource, uuid.UUID(source_id))
        if not source:
            raise LogSourceServiceError(404, "Источник не найден")

        source.is_active = False
        await self.db.flush()
        return {"ok": True, "id": str(source.id)}

    # ── List all (SOC cross-tenant view) ──────────────────────────

    async def list_all(
        self,
        tenant_id: str | None = None,
        status: str | None = None,
        search: str | None = None,
        page: int = 1,
        per_page: int = 50,
    ) -> dict:
        """List all sources across tenants (SOC view)."""
        query = select(LogSource).where(LogSource.is_active == True)  # noqa: E712

        if tenant_id:
            query = query.where(LogSource.tenant_id == tenant_id)
        if status:
            query = query.where(LogSource.status == status)
        if search:
            pattern = f"%{search}%"
            query = query.where(
                or_(
                    LogSource.name.ilike(pattern),
                    LogSource.host.ilike(pattern),
                )
            )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(LogSource.name).offset((page - 1) * per_page).limit(per_page)
        result = await self.db.execute(query)
        sources = result.scalars().all()

        return {
            "items": [self._to_dict(s, include_tenant=True) for s in sources],
            "total": total,
            "page": page,
            "pages": (total + per_page - 1) // per_page,
        }

    # ── Status sync logic ─────────────────────────────────────────

    async def update_statuses_for_tenant(
        self,
        tenant_id: str,
        source_events: dict[str, datetime | None],
    ) -> int:
        """Update source statuses based on last event timestamps.

        Args:
            tenant_id: Tenant UUID
            source_events: dict of {host: last_event_datetime_or_None}

        Returns:
            Number of sources updated
        """
        now = datetime.now(timezone.utc)
        updated = 0

        result = await self.db.execute(
            select(LogSource).where(
                LogSource.tenant_id == tenant_id,
                LogSource.is_active == True,  # noqa: E712
            )
        )
        sources = result.scalars().all()

        for source in sources:
            last_event = source_events.get(source.host)
            old_status = source.status

            if last_event is None:
                # No events found for this source
                if source.last_event_at:
                    # Had events before — check how long ago
                    new_status = self._compute_status(source.last_event_at, now)
                else:
                    new_status = "no_logs"
            else:
                source.last_event_at = last_event
                new_status = self._compute_status(last_event, now)

            if new_status != old_status:
                source.status = new_status
                updated += 1
                logger.info(
                    f"Source {source.name} ({source.host}): {old_status} → {new_status}"
                )

        await self.db.flush()
        return updated

    async def bulk_update_eps(
        self,
        tenant_id: str,
        source_eps: dict[str, float],
    ):
        """Update EPS values for sources."""
        result = await self.db.execute(
            select(LogSource).where(
                LogSource.tenant_id == tenant_id,
                LogSource.is_active == True,  # noqa: E712
            )
        )
        sources = result.scalars().all()

        for source in sources:
            eps = source_eps.get(source.host)
            if eps is not None:
                source.eps = eps

        await self.db.flush()

    # ── Private helpers ───────────────────────────────────────────

    @staticmethod
    def _compute_status(last_event_at: datetime, now: datetime) -> str:
        """Determine source status based on last event timestamp."""
        if last_event_at.tzinfo is None:
            last_event_at = last_event_at.replace(tzinfo=timezone.utc)

        delta = now - last_event_at
        minutes = delta.total_seconds() / 60

        if minutes <= NO_LOGS_THRESHOLD_MINUTES:
            return "active"
        elif minutes <= DEGRADED_THRESHOLD_MINUTES:
            return "degraded"
        else:
            return "no_logs"

    @staticmethod
    def _to_dict(source: LogSource, include_tenant: bool = False) -> dict:
        d = {
            "id": str(source.id),
            "name": source.name,
            "source_type": source.source_type,
            "host": source.host,
            "vendor": source.vendor,
            "product": source.product,
            "rusiem_group_name": source.rusiem_group_name,
            "status": source.status,
            "last_event_at": source.last_event_at.isoformat() if source.last_event_at else None,
            "eps": source.eps,
            "created_at": source.created_at.isoformat() if source.created_at else None,
        }
        if include_tenant:
            d["tenant_id"] = str(source.tenant_id)
        return d
