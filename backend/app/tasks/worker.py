"""
Celery worker and periodic tasks.

Tasks:
- sla_calculator: runs hourly, computes MTTA/MTTR per tenant
"""

import logging
from datetime import datetime, timedelta, timezone

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

celery_app = Celery(
    "mssp_soc",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "sla-calculator-hourly": {
            "task": "app.tasks.worker.calculate_sla",
            "schedule": crontab(minute=0),  # Every hour
        },
    },
)


@celery_app.task(name="app.tasks.worker.calculate_sla")
def calculate_sla():
    """Calculate SLA metrics (MTTA, MTTR) for all active tenants.

    Runs hourly via Celery Beat.

    MTTA = avg time from published_at to first status change to 'in_progress'
    MTTR = avg time from published_at to closed_at

    Results stored in sla_snapshots table.
    """
    import asyncio
    asyncio.run(_calculate_sla_async())


async def _calculate_sla_async():
    from sqlalchemy import select, func, and_
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.core.database import AsyncSessionLocal
    from app.models.models import (
        Tenant, PublishedIncident, IncidentStatusChange, SlaSnapshot,
    )

    now = datetime.now(timezone.utc)
    period_end = now
    period_start = now - timedelta(hours=24 * 30)  # Last 30 days

    async with AsyncSessionLocal() as db:
        # Get all active tenants
        result = await db.execute(
            select(Tenant).where(Tenant.is_active == True)
        )
        tenants = result.scalars().all()

        for tenant in tenants:
            try:
                # Get closed incidents in period
                incidents = await db.execute(
                    select(PublishedIncident).where(
                        PublishedIncident.tenant_id == tenant.id,
                        PublishedIncident.published_at >= period_start,
                        PublishedIncident.status.in_(["closed", "resolved"]),
                    )
                )
                closed_incidents = incidents.scalars().all()

                if not closed_incidents:
                    continue

                mtta_values = []
                mttr_values = []

                for inc in closed_incidents:
                    # MTTA: time to first in_progress
                    first_ack = await db.execute(
                        select(IncidentStatusChange.created_at).where(
                            IncidentStatusChange.incident_id == inc.id,
                            IncidentStatusChange.new_status == "in_progress",
                        ).order_by(IncidentStatusChange.created_at).limit(1)
                    )
                    ack_time = first_ack.scalar_one_or_none()
                    if ack_time and inc.published_at:
                        mtta = (ack_time - inc.published_at).total_seconds() / 60
                        mtta_values.append(mtta)

                    # MTTR: time to close
                    if inc.closed_at and inc.published_at:
                        mttr = (inc.closed_at - inc.published_at).total_seconds() / 60
                        mttr_values.append(mttr)

                avg_mtta = sum(mtta_values) / len(mtta_values) if mtta_values else None
                avg_mttr = sum(mttr_values) / len(mttr_values) if mttr_values else None

                # SLA compliance: % of incidents within SLA targets
                sla_config = tenant.sla_config or {}
                sla_targets = sla_config.get("mttr_targets", {
                    "critical": 240, "high": 1440, "medium": 4320, "low": 10080,
                })
                compliant = 0
                total_with_mttr = 0
                for inc in closed_incidents:
                    if inc.closed_at and inc.published_at:
                        mttr_min = (inc.closed_at - inc.published_at).total_seconds() / 60
                        target = sla_targets.get(inc.priority, 10080)
                        total_with_mttr += 1
                        if mttr_min <= target:
                            compliant += 1

                compliance = (compliant / total_with_mttr * 100) if total_with_mttr else None

                snapshot = SlaSnapshot(
                    tenant_id=tenant.id,
                    period_start=period_start,
                    period_end=period_end,
                    mtta_minutes=round(avg_mtta, 1) if avg_mtta else None,
                    mttr_minutes=round(avg_mttr, 1) if avg_mttr else None,
                    sla_compliance_pct=round(compliance, 1) if compliance else None,
                    incidents_total=len(closed_incidents),
                    incidents_by_priority={
                        "critical": sum(1 for i in closed_incidents if i.priority == "critical"),
                        "high": sum(1 for i in closed_incidents if i.priority == "high"),
                        "medium": sum(1 for i in closed_incidents if i.priority == "medium"),
                        "low": sum(1 for i in closed_incidents if i.priority == "low"),
                    },
                )
                db.add(snapshot)
                logger.info(
                    f"SLA snapshot for {tenant.short_name}: "
                    f"MTTA={avg_mtta:.1f}min MTTR={avg_mttr:.1f}min "
                    f"compliance={compliance:.1f}%"
                    if avg_mtta and avg_mttr and compliance
                    else f"SLA snapshot for {tenant.short_name}: insufficient data"
                )

            except Exception as e:
                logger.error(f"SLA calc failed for tenant {tenant.id}: {e}")

        await db.commit()
    logger.info("SLA calculation complete")
