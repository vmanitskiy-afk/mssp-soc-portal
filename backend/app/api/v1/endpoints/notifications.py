from fastapi import APIRouter, Depends, Query, Path

from app.core.security import CurrentUser, get_current_user

router = APIRouter()


@router.get("/")
async def list_notifications(
    read: bool | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    """List user notifications, optionally filtered by read status."""
    return []


@router.put("/{notification_id}/read")
async def mark_read(
    notification_id: str = Path(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Mark a notification as read."""
    return {"ok": True}
