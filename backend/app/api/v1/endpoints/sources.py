"""
Log sources endpoints — client view.

/api/sources/ — list sources assigned to the client with status
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, RoleRequired
from app.models.models import LogSource

router = APIRouter()

client_viewer = RoleRequired(
    "client_admin", "client_security", "client_auditor", "client_readonly"
)


@router.get("/")
async def list_sources(
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """List log sources assigned to the client's organization."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    result = await db.execute(
        select(LogSource)
        .where(LogSource.tenant_id == user.tenant_id, LogSource.is_active == True)
        .order_by(LogSource.name)
    )
    sources = result.scalars().all()

    return [
        {
            "id": str(s.id),
            "name": s.name,
            "source_type": s.source_type,
            "host": s.host,
            "vendor": s.vendor,
            "product": s.product,
            "status": s.status,
            "last_event_at": s.last_event_at.isoformat() if s.last_event_at else None,
            "eps": s.eps,
        }
        for s in sources
    ]
