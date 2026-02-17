"""
Reports endpoints.

/api/reports/              — list generated reports
/api/reports/{id}/download — download PDF
/api/reports/generate      — trigger async generation
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, RoleRequired

router = APIRouter()

client_viewer = RoleRequired(
    "client_admin", "client_security", "client_auditor", "client_readonly"
)
client_editor = RoleRequired("client_admin", "client_security")


class ReportGenerateRequest(BaseModel):
    type: str  # monthly_soc, sla, rca, threat
    period_from: str
    period_to: str


@router.get("/")
async def list_reports(
    type: str | None = Query(None),
    page: int = Query(1, ge=1),
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """List generated reports for the client."""
    # TODO: Query reports table (will be added in report generation sprint)
    return {"items": [], "total": 0}


@router.get("/{report_id}/download")
async def download_report(
    report_id: str = Path(...),
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Download report as PDF."""
    # TODO: Return FileResponse for the generated PDF
    raise HTTPException(status_code=501, detail="Report download will be available in the next sprint")


@router.post("/generate")
async def generate_report(
    body: ReportGenerateRequest,
    user: CurrentUser = Depends(client_editor),
    db: AsyncSession = Depends(get_db),
):
    """Trigger async report generation via Celery."""
    # TODO: Enqueue Celery task, return report_id for polling
    raise HTTPException(status_code=501, detail="Report generation will be available in the next sprint")
