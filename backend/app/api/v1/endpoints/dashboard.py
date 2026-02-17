"""
Dashboard endpoints — client facing.

/api/dashboard/summary            — main dashboard data
/api/dashboard/incidents-chart    — incidents by priority over time
/api/dashboard/sla                — SLA metrics for period
"""

import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, RoleRequired
from app.services.dashboard_service import DashboardService

router = APIRouter()

client_viewer = RoleRequired(
    "client_admin", "client_security", "client_auditor", "client_readonly"
)


def _parse_period(period: str) -> int:
    """Parse '7d', '30d', '2w' to number of days."""
    m = re.match(r"^(\d+)([dwm])$", period)
    if not m:
        return 7
    n, unit = int(m.group(1)), m.group(2)
    if unit == "d":
        return n
    if unit == "w":
        return n * 7
    if unit == "m":
        return n * 30
    return 7


@router.get("/summary")
async def dashboard_summary(
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Main dashboard: incident stats, SLA, source status."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = DashboardService(db)
    return await service.get_summary(user.tenant_id)


@router.get("/incidents-chart")
async def incidents_chart(
    period: str = Query("7d", pattern=r"^\d+[dwm]$"),
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Incidents by priority over time for chart rendering."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = DashboardService(db)
    return await service.get_incidents_chart(user.tenant_id, days=_parse_period(period))


@router.get("/sla")
async def sla_metrics(
    period: str = Query("30d", pattern=r"^\d+[dwm]$"),
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """SLA metrics: MTTA, MTTR, compliance by priority."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = DashboardService(db)
    return await service.get_sla_metrics(user.tenant_id, days=_parse_period(period))
