from fastapi import APIRouter, Depends

from app.core.security import CurrentUser, get_current_user

router = APIRouter()


@router.get("/")
async def list_sources(user: CurrentUser = Depends(get_current_user)):
    """List log sources with current status.

    Status determined by checking RuSIEM events API for recent activity.
    Statuses: active, no_logs, degraded, parsing_errors
    """
    # TODO: Read from log_sources table + check freshness via RuSIEM events
    return []
