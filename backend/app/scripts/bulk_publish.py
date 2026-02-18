"""
Bulk publish incidents from RuSIEM to a tenant.

Usage:
    python -m app.scripts.bulk_publish <tenant_short_name> [--limit 10] [--skip-existing]

Fetches recent incidents from RuSIEM and publishes them to the specified tenant.
"""

import asyncio
import logging
import sys
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.models.models import PublishedIncident, Tenant, User

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

settings = get_settings()

PRIORITY_MAP = {1: "low", 2: "medium", 3: "high", 4: "critical"}


def _parse_dt(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace(" ", "T"))
    except (ValueError, TypeError):
        return None


async def fetch_rusiem_incidents(limit: int = 50) -> list[dict]:
    """Fetch incidents list from RuSIEM."""
    url = f"{settings.RUSIEM_API_URL}/api/v1/incidents"
    params = {"_api_key": settings.RUSIEM_API_KEY, "limit": limit}

    async with httpx.AsyncClient(verify=False) as client:
        resp = await client.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("items", data.get("data", []))


async def fetch_incident_detail(incident_id: int) -> dict | None:
    """Fetch single incident detail from RuSIEM."""
    url = f"{settings.RUSIEM_API_URL}/api/v1/incidents/{incident_id}"
    params = {"_api_key": settings.RUSIEM_API_KEY}

    async with httpx.AsyncClient(verify=False) as client:
        try:
            resp = await client.get(url, params=params, timeout=30)
            if resp.status_code != 200:
                return None
            return resp.json()
        except Exception as e:
            logger.warning(f"Failed to fetch #{incident_id}: {e}")
            return None


async def bulk_publish(tenant_short: str, limit: int = 10, skip_existing: bool = True):
    async with AsyncSessionLocal() as db:
        # Find tenant
        result = await db.execute(
            select(Tenant).where(Tenant.short_name == tenant_short)
        )
        tenant = result.scalar_one_or_none()
        if not tenant:
            logger.error(f"Tenant '{tenant_short}' not found")
            return

        # Find SOC admin to use as publisher
        result = await db.execute(
            select(User).where(User.role == "soc_admin").limit(1)
        )
        publisher = result.scalar_one_or_none()
        if not publisher:
            logger.error("No SOC admin found")
            return

        logger.info(f"Tenant: {tenant.name} ({tenant.id})")
        logger.info(f"Publisher: {publisher.name} ({publisher.email})")

        # Fetch incidents from RuSIEM
        logger.info(f"Fetching up to {limit} incidents from RuSIEM...")
        incidents = await fetch_rusiem_incidents(limit=limit * 2)
        logger.info(f"Got {len(incidents)} incidents from RuSIEM")

        published_count = 0
        for inc in incidents:
            if published_count >= limit:
                break

            rid = inc.get("id")
            if not rid:
                continue

            # Check if already published
            if skip_existing:
                existing = await db.execute(
                    select(PublishedIncident).where(
                        PublishedIncident.rusiem_incident_id == rid,
                        PublishedIncident.tenant_id == tenant.id,
                    )
                )
                if existing.scalar_one_or_none():
                    logger.info(f"  #{rid} already published, skipping")
                    continue

            # Get detail
            detail = await fetch_incident_detail(rid)
            if not detail:
                logger.warning(f"  #{rid} failed to fetch detail, skipping")
                continue

            title = detail.get("title") or detail.get("name") or f"Incident #{rid}"
            desc = detail.get("description") or ""
            priority_num = detail.get("priority", 2)
            priority = PRIORITY_MAP.get(priority_num, "medium")
            category = detail.get("category")
            events = detail.get("events_count", 0) or detail.get("eventsCount", 0) or 0

            # Extract IPs
            source_ips = []
            src_hosts = []
            event_src_ips = []
            for src in (detail.get("sources") or []):
                if src.get("ip"):
                    source_ips.append(src["ip"])
                if src.get("hostname"):
                    src_hosts.append(src["hostname"])

            incident = PublishedIncident(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                rusiem_incident_id=rid,
                title=title,
                description=desc[:2000] if desc else None,
                priority=priority,
                category=category,
                source_ips=source_ips,
                source_hostnames=src_hosts,
                event_source_ips=event_src_ips,
                event_count=events,
                symptoms=[],
                recommendations="Рекомендуется провести анализ и принять меры.",
                soc_actions="Проведена первичная диагностика SOC-аналитиком.",
                status="new",
                published_by_id=publisher.id,
                published_at=datetime.now(timezone.utc),
                rusiem_created_at=_parse_dt(detail.get("created_at")),
            )
            db.add(incident)
            published_count += 1
            logger.info(f"  ✓ #{rid} — {title[:60]} [{priority}]")

        await db.commit()
        logger.info(f"\nDone! Published {published_count} incidents to {tenant.name}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m app.scripts.bulk_publish <tenant_short_name> [--limit N]")
        sys.exit(1)

    tenant_name = sys.argv[1]
    lim = 10
    for i, arg in enumerate(sys.argv):
        if arg == "--limit" and i + 1 < len(sys.argv):
            lim = int(sys.argv[i + 1])

    asyncio.run(bulk_publish(tenant_name, limit=lim))
