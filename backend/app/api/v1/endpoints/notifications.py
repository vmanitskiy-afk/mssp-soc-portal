"""
Notification endpoints.

/api/notifications/          — list (unread by default)
/api/notifications/{id}/read — mark as read
/api/notifications/read-all  — mark all as read
/api/notifications/count     — unread count (for badge)
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, get_current_user
from app.models.models import Notification

router = APIRouter()


@router.get("/count")
async def unread_count(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get unread notification count (for header badge)."""
    if not user.tenant_id:
        return {"count": 0}

    result = await db.execute(
        select(func.count()).where(
            Notification.tenant_id == user.tenant_id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    return {"count": result.scalar() or 0}


@router.get("/")
async def list_notifications(
    read: bool | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List notifications for the current user's tenant."""
    if not user.tenant_id:
        return {"items": [], "total": 0}

    query = select(Notification).where(Notification.tenant_id == user.tenant_id)
    if read is not None:
        query = query.where(Notification.is_read == read)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(Notification.created_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    notifs = result.scalars().all()

    return {
        "items": [
            {
                "id": str(n.id),
                "type": n.type,
                "title": n.title,
                "message": n.message,
                "is_read": n.is_read,
                "extra_data": n.extra_data,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notifs
        ],
        "total": total,
    }


@router.put("/{notification_id}/read")
async def mark_read(
    notification_id: str = Path(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a single notification as read."""
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id)
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    if user.tenant_id and str(notif.tenant_id) != user.tenant_id:
        raise HTTPException(status_code=403, detail="Access denied")

    notif.is_read = True
    await db.flush()
    return {"ok": True}


@router.put("/read-all")
async def mark_all_read(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read for current tenant."""
    if not user.tenant_id:
        return {"ok": True, "updated": 0}

    result = await db.execute(
        update(Notification)
        .where(Notification.tenant_id == user.tenant_id, Notification.is_read == False)  # noqa: E712
        .values(is_read=True)
    )
    return {"ok": True, "updated": result.rowcount}
