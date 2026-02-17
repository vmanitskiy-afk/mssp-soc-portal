from fastapi import APIRouter, Depends, Query, Path
from pydantic import BaseModel

from app.core.security import CurrentUser, get_current_user, RoleRequired

router = APIRouter()


class ReportGenerateRequest(BaseModel):
    type: str  # monthly_soc, sla, rca, threat
    period_from: str
    period_to: str


@router.get("/")
async def list_reports(
    type: str | None = Query(None),
    period: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    """List generated reports for the tenant."""
    return []


@router.get("/{report_id}/download")
async def download_report(
    report_id: str = Path(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Download report as PDF."""
    # TODO: Return PDF file from storage
    return {}


@router.post("/generate")
async def generate_report(
    body: ReportGenerateRequest,
    user: CurrentUser = Depends(RoleRequired("admin", "security_officer")),
):
    """Trigger async report generation via Celery task."""
    # TODO: Enqueue Celery task
    return {"report_id": "", "status": "generating"}
