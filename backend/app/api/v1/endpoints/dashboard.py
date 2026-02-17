from fastapi import APIRouter, Depends, Query

from app.core.security import CurrentUser, get_current_user

router = APIRouter()


@router.get("/summary")
async def dashboard_summary(user: CurrentUser = Depends(get_current_user)):
    """Main dashboard: incidents stats, SLA metrics, sources status, EPS."""
    # TODO: Aggregate data from RuSIEM + SLA snapshots
    return {
        "incidents": {"total": 0, "critical": 0, "high": 0, "medium": 0, "low": 0, "open": 0},
        "sla": {"mtta_minutes": 0, "mttr_minutes": 0, "compliance_pct": 0},
        "sources": {"total": 0, "active": 0, "degraded": 0, "no_logs": 0},
        "eps": 0,
    }


@router.get("/incidents-chart")
async def incidents_chart(
    period: str = Query("7d", regex=r"^\d+[dmw]$"),
    user: CurrentUser = Depends(get_current_user),
):
    """Incidents by priority over time for chart rendering."""
    # TODO: Query RuSIEM incidents grouped by date and priority
    return []


@router.get("/sla")
async def sla_metrics(
    period: str = Query("30d", regex=r"^\d+[dmw]$"),
    user: CurrentUser = Depends(get_current_user),
):
    """SLA metrics: MTTA, MTTR, compliance percentage by priority."""
    # TODO: Query sla_snapshots table
    return {"mtta": {}, "mttr": {}, "compliance_pct": 0, "by_priority": {}}
