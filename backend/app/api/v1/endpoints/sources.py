"""
Log sources endpoints — client view.

/api/sources/          — list sources with filters
/api/sources/stats     — status statistics
/api/sources/types     — distinct source types (for filter dropdown)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, RoleRequired
from app.services.log_source_service import LogSourceService

router = APIRouter()

client_viewer = RoleRequired(
    "client_admin", "client_security", "client_auditor", "client_readonly"
)


@router.get("/")
async def list_sources(
    status: str | None = Query(None, description="Фильтр по статусу: active, degraded, no_logs, error, unknown"),
    search: str | None = Query(None, description="Поиск по имени, хосту, вендору"),
    source_type: str | None = Query(None, description="Фильтр по типу источника"),
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """List log sources assigned to the client's organization."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="Нет привязки к организации")

    service = LogSourceService(db)
    return await service.list_for_tenant(
        tenant_id=str(user.tenant_id),
        status=status,
        search=search,
        source_type=source_type,
    )


@router.get("/stats")
async def source_stats(
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Source status statistics for the client dashboard widget."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="Нет привязки к организации")

    service = LogSourceService(db)
    return await service.get_stats(str(user.tenant_id))


@router.get("/types")
async def source_types(
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Get distinct source types for filter dropdown."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="Нет привязки к организации")

    service = LogSourceService(db)
    types = await service.get_source_types(str(user.tenant_id))
    return {"items": types}
