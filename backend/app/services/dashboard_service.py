"""
Dashboard service.

Aggregates metrics for the client dashboard:
- Incident counts by status and priority
- SLA metrics (MTTA, MTTR, compliance)
- Log source status summary
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import PublishedIncident, LogSource, SlaSnapshot

logger = logging.getLogger(__name__)


class DashboardService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_summary(self, tenant_id: str | None) -> dict:
        """Main dashboard summary: incidents, SLA, sources."""
        incidents = await self._incident_stats(tenant_id)
        sla = await self._latest_sla(tenant_id)
        sources = await self._source_stats(tenant_id)

        return {
            "incidents": incidents,
            "sla": sla,
            "sources": sources,
        }

    async def get_incidents_chart(self, tenant_id: str | None, days: int = 7) -> list[dict]:
        """Incidents by priority grouped by date for chart."""
        since = datetime.now(timezone.utc) - timedelta(days=days)

        query = (
            select(
                func.date(PublishedIncident.published_at).label("date"),
                PublishedIncident.priority,
                func.count().label("count"),
            )
            .where(PublishedIncident.published_at >= since)
        )
        if tenant_id:
            query = query.where(PublishedIncident.tenant_id == tenant_id)

        query = query.group_by(
            func.date(PublishedIncident.published_at), PublishedIncident.priority
        ).order_by(func.date(PublishedIncident.published_at))

        result = await self.db.execute(query)
        rows = result.all()

        # Pivot: group by date, columns = priorities
        chart = {}
        for row in rows:
            d = str(row.date)
            if d not in chart:
                chart[d] = {"date": d, "critical": 0, "high": 0, "medium": 0, "low": 0}
            chart[d][row.priority] = row.count

        return list(chart.values())

    async def get_sla_metrics(self, tenant_id: str | None, days: int = 30) -> dict:
        """SLA metrics for a period."""
        since = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.db.execute(
            select(SlaSnapshot)
            .where(
                SlaSnapshot.tenant_id == tenant_id,
                SlaSnapshot.period_start >= since,
            )
            .order_by(SlaSnapshot.period_start.desc())
            .limit(1)
        )
        snapshot = result.scalar_one_or_none()

        if not snapshot:
            return {"mtta_minutes": None, "mttr_minutes": None, "compliance_pct": None, "by_priority": {}}

        return {
            "mtta_minutes": snapshot.mtta_minutes,
            "mttr_minutes": snapshot.mttr_minutes,
            "compliance_pct": snapshot.sla_compliance_pct,
            "by_priority": snapshot.incidents_by_priority or {},
            "period_start": snapshot.period_start.isoformat() if snapshot.period_start else None,
            "period_end": snapshot.period_end.isoformat() if snapshot.period_end else None,
        }

    async def get_sla_history(self, tenant_id: str | None, days: int = 90) -> list[dict]:
        """SLA trend: snapshots over time for charts."""
        since = datetime.now(timezone.utc) - timedelta(days=days)

        query = (
            select(SlaSnapshot)
            .where(SlaSnapshot.period_start >= since)
        )
        if tenant_id:
            query = query.where(SlaSnapshot.tenant_id == tenant_id)

        query = query.order_by(SlaSnapshot.period_end.asc())
        result = await self.db.execute(query)
        snapshots = result.scalars().all()

        # Deduplicate by date (keep latest per day)
        by_date: dict[str, dict] = {}
        for s in snapshots:
            d = s.period_end.strftime("%Y-%m-%d") if s.period_end else None
            if not d:
                continue
            by_date[d] = {
                "date": d,
                "mtta_minutes": s.mtta_minutes,
                "mttr_minutes": s.mttr_minutes,
                "compliance_pct": s.sla_compliance_pct,
                "incidents_total": s.incidents_total,
            }

        return list(by_date.values())

    # ── Private ───────────────────────────────────────────────────

    async def _incident_stats(self, tenant_id: str | None) -> dict:
        """Incident counts by status and priority."""
        query = select(
            func.count().label("total"),
            func.count().filter(PublishedIncident.status.notin_(["closed", "false_positive"])).label("open"),
            func.count().filter(PublishedIncident.priority == "critical").label("critical"),
            func.count().filter(PublishedIncident.priority == "high").label("high"),
            func.count().filter(PublishedIncident.priority == "medium").label("medium"),
            func.count().filter(PublishedIncident.priority == "low").label("low"),
            func.count().filter(PublishedIncident.status == "new").label("new"),
            func.count().filter(PublishedIncident.status == "in_progress").label("in_progress"),
            func.count().filter(PublishedIncident.status == "awaiting_customer").label("awaiting_customer"),
            func.count().filter(PublishedIncident.status == "resolved").label("resolved"),
            func.count().filter(PublishedIncident.status == "closed").label("closed"),
        )
        if tenant_id:
            query = query.where(PublishedIncident.tenant_id == tenant_id)

        result = await self.db.execute(query)
        row = result.one()

        return {
            "total": row.total,
            "open": row.open,
            "by_priority": {
                "critical": row.critical,
                "high": row.high,
                "medium": row.medium,
                "low": row.low,
            },
            "by_status": {
                "new": row.new,
                "in_progress": row.in_progress,
                "awaiting_customer": row.awaiting_customer,
                "resolved": row.resolved,
                "closed": row.closed,
            },
        }

    async def _source_stats(self, tenant_id: str | None) -> dict:
        """Log source status summary."""
        query = select(
            func.count().label("total"),
            func.count().filter(LogSource.status == "active").label("active"),
            func.count().filter(LogSource.status == "degraded").label("degraded"),
            func.count().filter(LogSource.status == "no_logs").label("no_logs"),
            func.count().filter(LogSource.status == "error").label("error"),
        ).where(LogSource.is_active == True)  # noqa: E712
        if tenant_id:
            query = query.where(LogSource.tenant_id == tenant_id)

        result = await self.db.execute(query)
        row = result.one()

        return {
            "total": row.total,
            "active": row.active,
            "degraded": row.degraded,
            "no_logs": row.no_logs,
            "error": row.error,
        }

    async def _latest_sla(self, tenant_id: str | None) -> dict:
        if not tenant_id:
            return {"mtta_minutes": None, "mttr_minutes": None, "compliance_pct": None}

        result = await self.db.execute(
            select(SlaSnapshot)
            .where(SlaSnapshot.tenant_id == tenant_id)
            .order_by(SlaSnapshot.period_end.desc())
            .limit(1)
        )
        snapshot = result.scalar_one_or_none()

        if not snapshot:
            return {"mtta_minutes": None, "mttr_minutes": None, "compliance_pct": None}

        return {
            "mtta_minutes": snapshot.mtta_minutes,
            "mttr_minutes": snapshot.mttr_minutes,
            "compliance_pct": snapshot.sla_compliance_pct,
        }
