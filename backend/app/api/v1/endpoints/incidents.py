"""
Client-facing incident endpoints.

Clients can:
- View incidents published to their organization
- Read recommendations and SOC actions
- Add comments describing their response actions
- Change incident status (e.g., mark as resolved/closed)
- Add their response description
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel

from app.core.security import CurrentUser, RoleRequired, get_current_user

router = APIRouter()

# Client roles that can view incidents
client_viewer = RoleRequired("client_admin", "client_security", "client_auditor", "client_readonly")
# Client roles that can modify incidents
client_editor = RoleRequired("client_admin", "client_security")


# ── Schemas ───────────────────────────────────────────────────────

class AddCommentRequest(BaseModel):
    text: str


class ChangeStatusRequest(BaseModel):
    status: str  # in_progress, awaiting_soc, resolved, closed
    comment: str | None = None  # Optional reason for status change


class ClientResponseRequest(BaseModel):
    """Client describes what they did in response to the incident."""
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
):
    """List incidents published to the client's organization.

    Filtered by tenant_id from JWT automatically (RLS).
    Status values: new, in_progress, awaiting_customer, awaiting_soc, resolved, closed
    Priority values: critical, high, medium, low
    """
    # TODO: Query published_incidents WHERE tenant_id = user.tenant_id
    return {"items": [], "total": 0, "page": page, "pages": 0}


# ── Get incident detail ──────────────────────────────────────────

@router.get("/{incident_id}")
async def get_incident(
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_viewer),
):
    """Get full incident detail including:
    - Auto-populated fields from RuSIEM (title, description, IPs, etc.)
    - SOC recommendations
    - SOC actions taken
    - Client response
    - Comment thread (SOC + client)
    - Status change history (timeline)
    """
    # TODO: Fetch PublishedIncident with comments and status_history
    # Verify tenant_id matches user's tenant
    return {}


# ── Add client comment ────────────────────────────────────────────

@router.post("/{incident_id}/comments")
async def add_comment(
    body: AddCommentRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_editor),
):
    """Add a comment from the client side (is_soc=False).

    Clients use comments to:
    - Describe actions taken in response
    - Ask clarifying questions to SOC
    - Provide additional context
    """
    # TODO: Create IncidentComment with is_soc=False
    # Notify SOC analysts about new comment
    return {"id": "", "text": body.text, "is_soc": False, "created_at": ""}


# ── Change incident status ────────────────────────────────────────

@router.put("/{incident_id}/status")
async def change_status(
    body: ChangeStatusRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_editor),
):
    """Change incident status.

    Allowed client transitions:
    - new → in_progress          (client acknowledged)
    - in_progress → awaiting_soc (client needs SOC help)
    - in_progress → resolved     (client finished response)
    - awaiting_customer → in_progress (client resumes work)
    - resolved → closed          (confirmed resolved)

    Each change is logged to incident_status_changes for audit trail.
    """
    # TODO: Validate transition, update status, create IncidentStatusChange
    # If status -> closed: set closed_by and closed_at
    # Notify SOC about status change
    allowed_transitions = {
        "new": ["in_progress"],
        "in_progress": ["awaiting_soc", "resolved"],
        "awaiting_customer": ["in_progress"],
        "resolved": ["closed"],
    }
    return {"ok": True}


# ── Update client response ────────────────────────────────────────

@router.put("/{incident_id}/response")
async def update_client_response(
    body: ClientResponseRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(client_editor),
):
    """Update the client's response description.

    Dedicated field for structured response: what was done,
    what was the result. Separate from free-form comments.
    """
    # TODO: Update published_incidents.client_response
    return {"ok": True}
