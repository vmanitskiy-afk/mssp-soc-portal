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
        "source-status-sync": {
            "task": "app.tasks.worker.sync_source_statuses",
            "schedule": crontab(minute="*/5"),  # Every 5 minutes
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
    from sqlalchemy import select
    from app.core.database import create_celery_session
    from app.models.models import (
        Tenant, PublishedIncident, IncidentStatusChange, SlaSnapshot,
    )

    now = datetime.now(timezone.utc)
    period_end = now
    period_start = now - timedelta(hours=24 * 30)  # Last 30 days

    _engine, _session_factory = create_celery_session()
    async with _session_factory() as db:
        # Get all active tenants
        result = await db.execute(
            select(Tenant).where(Tenant.is_active == True)  # noqa: E712
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
    await _engine.dispose()
    logger.info("SLA calculation complete")


# ── Email notification tasks ─────────────────────────────────────

@celery_app.task(name="app.tasks.worker.send_incident_email")
def send_incident_email(
    to_emails: list[str],
    incident_title: str,
    rusiem_id: int,
    priority: str,
    recommendations: str,
    portal_url: str = "",
):
    """Send new incident email notification."""
    from app.services.email_service import send_email, new_incident_email
    subject, body = new_incident_email(
        incident_title, rusiem_id, priority, recommendations, portal_url
    )
    for email in to_emails:
        send_email(email, subject, body)


@celery_app.task(name="app.tasks.worker.send_status_change_email")
def send_status_change_email(
    to_emails: list[str],
    incident_title: str,
    rusiem_id: int,
    old_status: str,
    new_status: str,
    changed_by: str,
    portal_url: str = "",
):
    """Send status change email notification."""
    from app.services.email_service import send_email, status_change_email
    subject, body = status_change_email(
        incident_title, rusiem_id, old_status, new_status, changed_by, portal_url
    )
    for email in to_emails:
        send_email(email, subject, body)


@celery_app.task(name="app.tasks.worker.send_comment_email")
def send_comment_email(
    to_emails: list[str],
    incident_title: str,
    rusiem_id: int,
    comment_by: str,
    comment_text: str,
    portal_url: str = "",
):
    """Send new comment email notification."""
    from app.services.email_service import send_email, new_comment_email
    subject, body = new_comment_email(
        incident_title, rusiem_id, comment_by, comment_text, portal_url
    )
    for email in to_emails:
        send_email(email, subject, body)


# ── Source status sync task ───────────────────────────────────────

@celery_app.task(name="app.tasks.worker.sync_source_statuses")
def sync_source_statuses():
    """Sync log source statuses from RuSIEM for all active tenants.

    Runs every 5 minutes via Celery Beat.
    For each tenant's sources, queries RuSIEM for recent events
    and updates source statuses accordingly.

    Status logic:
    - active:   last event < 30 min ago
    - degraded: last event 30 min–2 hours ago
    - no_logs:  last event > 2 hours ago or never
    """
    import asyncio
    asyncio.run(_sync_sources_async())


async def _sync_sources_async():
    from sqlalchemy import select
    from app.core.database import create_celery_session
    from app.models.models import Tenant, LogSource
    from app.services.log_source_service import LogSourceService
    from app.integrations.rusiem.client import RuSIEMClient

    import redis.asyncio as aioredis

    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

    _engine, _session_factory = create_celery_session()
    async with _session_factory() as db:
        # Get all active tenants
        tenants = (await db.execute(
            select(Tenant).where(Tenant.is_active == True)  # noqa: E712
        )).scalars().all()

        for tenant in tenants:
            try:
                # Get active sources for this tenant
                sources = (await db.execute(
                    select(LogSource).where(
                        LogSource.tenant_id == tenant.id,
                        LogSource.is_active == True,  # noqa: E712
                    )
                )).scalars().all()

                if not sources:
                    continue

                rusiem = RuSIEMClient(
                    base_url=settings.RUSIEM_API_URL,
                    api_key=settings.RUSIEM_API_KEY,
                    redis_client=redis_client,
                    verify_ssl=settings.RUSIEM_VERIFY_SSL,
                )

                service = LogSourceService(db)
                source_events = {}

                for source in sources:
                    try:
                        events = await rusiem.search_events(
                            query=f"host:{source.host}",
                            interval="24h",
                            limit=1,
                        )
                        event_data = events.get("data", [])
                        if event_data:
                            ts = event_data[0].get("timestamp") or event_data[0].get("@timestamp")
                            logger.info(f"Source {source.host}: found event, ts={ts}")
                            if ts:
                                if isinstance(ts, str):
                                    last_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                                else:
                                    last_dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                                source_events[source.host] = last_dt
                            else:
                                source_events[source.host] = None
                        else:
                            source_events[source.host] = None
                    except Exception as e:
                        logger.warning(f"Source check failed for {source.host}: {e}")
                        source_events[source.host] = None

                updated = await service.update_statuses_for_tenant(
                    str(tenant.id), source_events
                )

                await rusiem.close()

                if updated >= 0:
                    logger.info(
                        f"Source sync {tenant.short_name}: "
                        f"{len(sources)} checked, {updated} updated, events={source_events}"
                    )

            except Exception as e:
                logger.error(f"Source sync failed for tenant {tenant.id}: {e}")

        await db.commit()

    await redis_client.close()
    await _engine.dispose()
    logger.info("Source status sync complete")
