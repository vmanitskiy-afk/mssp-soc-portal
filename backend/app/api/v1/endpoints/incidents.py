from fastapi import APIRouter, Depends, Query, Path
from pydantic import BaseModel

from app.core.security import CurrentUser, get_current_user

router = APIRouter()


class CommentCreate(BaseModel):
    text: str


@router.get("/")
async def list_incidents(
    status: str | None = Query(None),
    priority: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    """List incidents with filtering and pagination.

    Fetches from RuSIEM API with tenant isolation via tenant_uuid.
    Status values: new, in_progress, awaiting_customer, resolved, closed, false_positive
    Priority values: critical, high, medium, low
    """
    # TODO: Fetch from RuSIEM, apply status/priority mapping
    return {"items": [], "total": 0, "page": page, "pages": 0}


@router.get("/{incident_id}")
async def get_incident(
    incident_id: int = Path(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Get incident detail with timeline, metadata, and IOCs."""
    # TODO: Fetch incident + fullinfo + history from RuSIEM, merge with portal comments
    return {}


@router.get("/{incident_id}/events")
async def get_incident_events(
    incident_id: int = Path(...),
    page: int = Query(1, ge=1),
    user: CurrentUser = Depends(get_current_user),
):
    """Get security events associated with an incident."""
    # TODO: Fetch from RuSIEM events/incident/{id}
    return {"items": [], "total": 0}


@router.post("/{incident_id}/comments")
async def add_comment(
    incident_id: int = Path(...),
    body: CommentCreate = ...,
    user: CurrentUser = Depends(get_current_user),
):
    """Add a comment to an incident (stored in portal DB)."""
    # TODO: Save to incident_comments table
    return {"id": "", "text": body.text, "created_at": ""}


@router.post("/{incident_id}/acknowledge")
async def acknowledge_incident(
    incident_id: int = Path(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Acknowledge receipt of a critical incident."""
    # TODO: Log acknowledgement, update notification status
    return {"ok": True}
