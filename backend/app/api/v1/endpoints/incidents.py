"""
Client-facing incident endpoints — real implementation.

All endpoints are tenant-scoped: client only sees their own incidents.
Tenant ID comes from JWT automatically.

/api/incidents/              — list incidents
/api/incidents/{id}          — detail with full card
/api/incidents/{id}/comments — add comment
/api/incidents/{id}/status   — change status
/api/incidents/{id}/response — update client response text
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, RoleRequired, get_current_user
from app.services.incident_service import IncidentService, IncidentServiceError

router = APIRouter()

client_viewer = RoleRequired("client_admin", "client_security", "client_auditor", "client_readonly")
client_editor = RoleRequired("client_admin", "client_security")


# ── Schemas ───────────────────────────────────────────────────────

class AddCommentRequest(BaseModel):
    text: str


class ChangeStatusRequest(BaseModel):
    status: str
    comment: str | None = None


class ClientResponseRequest(BaseModel):
    client_response: str


# ── List incidents ────────────────────────────────────────────────

@router.get("/")
async def list_incidents(
    status: str | None = Query(None),
    priority: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """List incidents for the client's organization."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = IncidentService(db)
    return await service.list_incidents(
        tenant_id=user.tenant_id,
        status=status,
        priority=priority,
        date_from=date_from,
        date_to=date_to,
        page=page,
        per_page=per_page,
    )


# ── Incident detail ──────────────────────────────────────────────

@router.get("/{incident_id}")
async def get_incident(
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Get full incident card with recommendations, comments, timeline."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = IncidentService(db)
    try:
        return await service.get_incident_detail(incident_id, tenant_id=user.tenant_id)
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


# ── Add comment ───────────────────────────────────────────────────

@router.post("/{incident_id}/comments")
async def add_comment(
    body: AddCommentRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_editor),
    db: AsyncSession = Depends(get_db),
):
    """Add a comment from the client side.

    Used to describe response actions, ask questions, provide context.
    """
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = IncidentService(db)
    try:
        comment = await service.add_comment(
            incident_id=incident_id,
            user_id=user.user_id,
            text=body.text,
            is_soc=False,
            tenant_id=user.tenant_id,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {"id": str(comment.id), "text": comment.text, "is_soc": False}


# ── Change status ─────────────────────────────────────────────────

@router.put("/{incident_id}/status")
async def change_status(
    body: ChangeStatusRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_editor),
    db: AsyncSession = Depends(get_db),
):
    """Change incident status from client side.

    Allowed transitions:
    - new → in_progress          (acknowledged)
    - in_progress → awaiting_soc (need SOC help)
    - in_progress → resolved     (response complete)
    - awaiting_customer → in_progress (resume work)
    - resolved → closed          (confirmed closed)
    """
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = IncidentService(db)
    try:
        incident = await service.change_status(
            incident_id=incident_id,
            new_status=body.status,
            user_id=user.user_id,
            is_soc=False,
            comment=body.comment,
            tenant_id=user.tenant_id,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {"ok": True, "status": incident.status}


# ── Update client response ────────────────────────────────────────

@router.put("/{incident_id}/response")
async def update_response(
    body: ClientResponseRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_editor),
    db: AsyncSession = Depends(get_db),
):
    """Update structured client response — what was done in response."""
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = IncidentService(db)
    try:
        await service.update_client_response(
            incident_id=incident_id,
            client_response=body.client_response,
            tenant_id=user.tenant_id,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {"ok": True}


# ── Acknowledge incident ─────────────────────────────────────────

@router.put("/{incident_id}/acknowledge")
async def acknowledge_incident(
    incident_id: str = Path(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Client acknowledges receipt of the incident."""
    tenant_id = user.tenant_id
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant assigned")

    service = IncidentService(db)
    try:
        result = await service.acknowledge_incident(
            incident_id=incident_id,
            user_id=user.user_id,
            tenant_id=tenant_id,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return result
