"""
Reports endpoints.

/api/reports/monthly     — download monthly SOC report PDF
/api/reports/incident    — download single incident report PDF
/api/reports/csv         — download incidents CSV
/api/reports/sla-pdf     — download SLA report PDF
"""

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, get_current_user
from app.models.models import PublishedIncident
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


@router.get("/sla-pdf")
async def sla_report_pdf(
    period_from: str = Query(..., description="Start date YYYY-MM-DD"),
    period_to: str = Query(..., description="End date YYYY-MM-DD"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate SLA report PDF with metrics and trends."""
    tenant_id = user.tenant_id
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    service = ReportService(db)
    try:
        pdf_bytes = await service.generate_sla_report(
            tenant_id, period_from, period_to
        )
    except ReportServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    filename = f"sla_report_{period_from}_{period_to}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/csv")
async def incidents_csv(
    period_from: str = Query(..., description="Start date YYYY-MM-DD"),
    period_to: str = Query(..., description="End date YYYY-MM-DD"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download incidents as CSV."""
    tenant_id = user.tenant_id
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Нет привязки к клиенту")

    try:
        dt_from = datetime.fromisoformat(period_from).replace(tzinfo=timezone.utc)
        dt_to = datetime.fromisoformat(period_to).replace(
            hour=23, minute=59, second=59, tzinfo=timezone.utc
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат даты")

    result = await db.execute(
        select(PublishedIncident)
        .where(
            PublishedIncident.tenant_id == tenant_id,
            PublishedIncident.published_at >= dt_from,
            PublishedIncident.published_at <= dt_to,
        )
        .order_by(PublishedIncident.published_at.desc())
    )
    incidents = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "RuSIEM ID", "Название", "Приоритет", "Статус", "Категория",
        "Кол-во событий", "IP адреса", "Дата публикации", "Дата закрытия",
        "Рекомендации", "Действия SOC",
    ])
    for inc in incidents:
        writer.writerow([
            inc.rusiem_incident_id,
            inc.title,
            inc.priority,
            inc.status,
            inc.category or "",
            inc.event_count,
            ", ".join(inc.source_ips or []),
            inc.published_at.strftime("%Y-%m-%d %H:%M") if inc.published_at else "",
            inc.closed_at.strftime("%Y-%m-%d %H:%M") if inc.closed_at else "",
            inc.recommendations or "",
            inc.soc_actions or "",
        ])

    csv_bytes = output.getvalue().encode("utf-8-sig")  # BOM for Excel
    filename = f"incidents_{period_from}_{period_to}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
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
