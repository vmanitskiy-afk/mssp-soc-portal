"""
Dashboard endpoints — client and SOC facing.

/api/dashboard/summary            — main dashboard data
/api/dashboard/incidents-chart    — incidents by priority over time
/api/dashboard/sla                — SLA metrics for period
"""

import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, get_current_user
from app.services.dashboard_service import DashboardService

router = APIRouter()


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


def _resolve_tenant(user: CurrentUser, tenant_id: str | None) -> str | None:
    """Resolve tenant_id: SOC can pass explicit, client uses own."""
    if user.role in ("soc_admin", "soc_analyst"):
        return tenant_id  # SOC can view any tenant or None for all
    return user.tenant_id  # client always uses own


@router.get("/summary")
async def dashboard_summary(
    tenant_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Main dashboard: incident stats, SLA, source status."""
    tid = _resolve_tenant(user, tenant_id)
    if not tid and user.role not in ("soc_admin", "soc_analyst"):
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = DashboardService(db)
    return await service.get_summary(tid)


@router.get("/incidents-chart")
async def incidents_chart(
    period: str = Query("7d", pattern=r"^\d+[dwm]$"),
    tenant_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Incidents by priority over time for chart rendering."""
    tid = _resolve_tenant(user, tenant_id)
    if not tid and user.role not in ("soc_admin", "soc_analyst"):
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = DashboardService(db)
    return await service.get_incidents_chart(tid, days=_parse_period(period))


@router.get("/sla-history")
async def sla_history(
    period: str = Query("90d", pattern=r"^\d+[dwm]$"),
    tenant_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SLA trend data: MTTA, MTTR, compliance over time."""
    tid = _resolve_tenant(user, tenant_id)
    if not tid and user.role not in ("soc_admin", "soc_analyst"):
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = DashboardService(db)
    return await service.get_sla_history(tid, days=_parse_period(period))


@router.get("/sla")
async def sla_metrics(
    period: str = Query("30d", pattern=r"^\d+[dwm]$"),
    tenant_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SLA metrics: MTTA, MTTR, compliance by priority."""
    tid = _resolve_tenant(user, tenant_id)
    if not tid and user.role not in ("soc_admin", "soc_analyst"):
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = DashboardService(db)
    return await service.get_sla_metrics(tid, days=_parse_period(period))


@router.get("/recent-incidents")
async def recent_incidents(
    period: str = Query("14d", pattern=r"^\d+[dwm]$"),
    tenant_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Recent incidents list for dashboard table view."""
    tid = _resolve_tenant(user, tenant_id)
    if not tid and user.role not in ("soc_admin", "soc_analyst"):
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = DashboardService(db)
    return await service.get_recent_incidents(tid, days=_parse_period(period))
