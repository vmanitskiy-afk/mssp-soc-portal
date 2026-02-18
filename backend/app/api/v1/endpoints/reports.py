"""
Reports endpoints.

/api/reports/monthly     — download monthly SOC report PDF
/api/reports/incident    — download single incident report PDF
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, get_current_user
from app.services.report_service import ReportService, ReportServiceError

router = APIRouter()


@router.get("/monthly")
async def monthly_report(
    period_from: str = Query(..., description="Start date YYYY-MM-DD"),
    period_to: str = Query(..., description="End date YYYY-MM-DD"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate and download monthly SOC report PDF."""
    tenant_id = user.tenant_id
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = ReportService(db)
    try:
        pdf_bytes = await service.generate_monthly_report(
            tenant_id, period_from, period_to
        )
    except ReportServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    filename = f"soc_report_{period_from}_{period_to}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/incident/{incident_id}")
async def incident_report(
    incident_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate and download single incident report PDF."""
    tenant_id = user.tenant_id
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = ReportService(db)
    try:
        pdf_bytes = await service.generate_incident_report(tenant_id, incident_id)
    except ReportServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    filename = f"incident_{incident_id[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
