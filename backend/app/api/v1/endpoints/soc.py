"""
SOC Operator endpoints.

Internal interface for SOC analysts (L1/L2):
- Publish incidents from RuSIEM to specific clients
- Preview incident data from RuSIEM before publishing
- Update recommendations and SOC actions
- Manage log source assignments
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel

from app.core.security import CurrentUser, RoleRequired

router = APIRouter()

# Only SOC staff can access these endpoints
soc_only = RoleRequired("soc_admin", "soc_analyst")


# ── Schemas ───────────────────────────────────────────────────────

class IncidentPreview(BaseModel):
    """Data auto-populated from RuSIEM when analyst enters incident ID."""
    rusiem_incident_id: int
    title: str
    description: str | None
    priority: str
    priority_num: int
    category: str | None
    mitre_id: str | None
    source_ips: list[str]
    source_hostnames: list[str]
    event_source_ips: list[str]
    event_count: int
    symptoms: list[str]
    rusiem_status: str
    created_at: str | None


class PublishIncidentRequest(BaseModel):
    """Analyst fills this form to publish incident to a client."""
    rusiem_incident_id: int
    tenant_id: str           # UUID of the client
    recommendations: str     # Рекомендации по реагированию
    soc_actions: str | None = None  # Что уже сделал SOC (EDR block, etc.)


class UpdatePublishedIncidentRequest(BaseModel):
    """SOC analyst can update recommendations and actions after publishing."""
    recommendations: str | None = None
    soc_actions: str | None = None


class AssignSourceRequest(BaseModel):
    """Assign a log source to a tenant."""
    tenant_id: str
    name: str
    source_type: str  # firewall, edr, os, ids
    host: str         # IP or hostname
    vendor: str | None = None
    product: str | None = None
    rusiem_group_name: str | None = None


# ── Preview incident from RuSIEM ─────────────────────────────────

@router.get("/incidents/preview/{rusiem_id}", response_model=IncidentPreview)
async def preview_incident(
    rusiem_id: int = Path(..., description="Incident ID in RuSIEM"),
    user: CurrentUser = Depends(soc_only),
):
    """Fetch incident data from RuSIEM by ID.

    Analyst enters the RuSIEM incident ID, portal calls:
    - GET /api/v1/incidents/{id} — base info
    - GET /api/v1/incidents/{id}/fullinfo — metadata (IPs, hostnames, symptoms)

    Returns pre-filled data for the publish form.
    """
    # TODO: Call RuSIEM adapter, merge incident + fullinfo, map fields
    # client = get_rusiem_client()
    # incident = await client.get_incident(rusiem_id)
    # fullinfo = await client.get_incident_fullinfo(rusiem_id)
    # return map_to_preview(incident, fullinfo)
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ── Publish incident to client ────────────────────────────────────

@router.post("/incidents/publish")
async def publish_incident(
    body: PublishIncidentRequest,
    user: CurrentUser = Depends(soc_only),
):
    """Publish a RuSIEM incident to a specific client.

    Workflow:
    1. Analyst enters RuSIEM incident ID → preview auto-fills fields
    2. Analyst selects client (tenant), writes recommendations
    3. Optionally describes SOC actions already taken (EDR, isolation, etc.)
    4. Submit → incident appears in client portal with status 'new'
    5. Client gets email notification about new incident

    The portal stores both the mapped data and raw RuSIEM response
    in rusiem_raw_data JSONB field for audit/reference.
    """
    # TODO:
    # 1. Fetch incident + fullinfo from RuSIEM
    # 2. Map fields (status, priority, IPs, hostnames, symptoms)
    # 3. Create PublishedIncident record in DB
    # 4. Create initial IncidentStatusChange (null -> new)
    # 5. Send email notification to client contacts
    # 6. Return created incident
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ── Update published incident (SOC side) ──────────────────────────

@router.put("/incidents/{incident_id}")
async def update_published_incident(
    body: UpdatePublishedIncidentRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
):
    """Update recommendations or SOC actions on a published incident.

    Use when:
    - SOC performed additional response actions (blocked on EDR, etc.)
    - Recommendations need to be updated based on new findings
    """
    # TODO: Update PublishedIncident, add audit log entry
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ── Add SOC comment ───────────────────────────────────────────────

@router.post("/incidents/{incident_id}/comments")
async def add_soc_comment(
    incident_id: str = Path(...),
    text: str = ...,
    user: CurrentUser = Depends(soc_only),
):
    """Add a comment from SOC side (is_soc=True)."""
    # TODO: Create IncidentComment with is_soc=True
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ── List all published incidents (SOC view) ───────────────────────

@router.get("/incidents")
async def list_all_incidents(
    tenant_id: str | None = Query(None),
    status: str | None = Query(None),
    priority: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(soc_only),
):
    """List all published incidents across all tenants.

    SOC analysts see everything. Can filter by tenant, status, priority.
    """
    # TODO: Query published_incidents with optional filters, no tenant RLS
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ── Log Sources management ────────────────────────────────────────

@router.post("/sources")
async def assign_source(
    body: AssignSourceRequest,
    user: CurrentUser = Depends(soc_only),
):
    """Assign a log source to a tenant.

    Done during client onboarding. SOC operator maps RuSIEM source
    groups to portal tenants.
    """
    # TODO: Create LogSource record
    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.get("/sources")
async def list_all_sources(
    tenant_id: str | None = Query(None),
    user: CurrentUser = Depends(soc_only),
):
    """List all log sources, optionally filtered by tenant."""
    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.delete("/sources/{source_id}")
async def remove_source(
    source_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
):
    """Remove a log source assignment."""
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ── Tenant management ─────────────────────────────────────────────

@router.get("/tenants")
async def list_tenants(user: CurrentUser = Depends(RoleRequired("soc_admin"))):
    """List all tenants. SOC admin only."""
    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.post("/tenants")
async def create_tenant(user: CurrentUser = Depends(RoleRequired("soc_admin"))):
    """Create a new tenant (client). SOC admin only."""
    raise HTTPException(status_code=501, detail="Not implemented yet")
