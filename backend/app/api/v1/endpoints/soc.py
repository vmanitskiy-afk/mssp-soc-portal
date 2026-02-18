"""
SOC Operator endpoints — real implementation.

/api/soc/incidents/preview/{id}  — auto-fill from RuSIEM
/api/soc/incidents/publish       — publish to client
/api/soc/incidents               — list all (cross-tenant)
/api/soc/incidents/{id}          — update recommendations/actions
/api/soc/incidents/{id}/comments — add SOC comment
/api/soc/users                   — user management
/api/soc/tenants                 — tenant management
"""

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, get_redis
from app.core.security import CurrentUser, RoleRequired
from app.integrations.rusiem.client import RuSIEMClient
from app.core.config import get_settings
from app.services.incident_service import IncidentService, IncidentServiceError
from app.services.user_service import UserService, UserServiceError

router = APIRouter()
settings = get_settings()

soc_only = RoleRequired("soc_admin", "soc_analyst")
admin_only = RoleRequired("soc_admin")


# ── Schemas ───────────────────────────────────────────────────────

class PublishIncidentRequest(BaseModel):
    rusiem_incident_id: int
    tenant_id: str
    recommendations: str
    soc_actions: str | None = None


class UpdateIncidentRequest(BaseModel):
    recommendations: str | None = None
    soc_actions: str | None = None


class AddCommentRequest(BaseModel):
    text: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str
    tenant_id: str | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str


# ── Helpers ───────────────────────────────────────────────────────

async def _get_rusiem(redis_client: aioredis.Redis) -> RuSIEMClient:
    return RuSIEMClient(
        base_url=settings.RUSIEM_API_URL,
        api_key=settings.RUSIEM_API_KEY,
        redis_client=redis_client,
        verify_ssl=settings.RUSIEM_VERIFY_SSL,
    )


# ── Tenants List ──────────────────────────────────────────────────

@router.get("/tenants")
async def list_tenants(
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """List all active tenants for SOC operator dropdown."""
    from sqlalchemy import select
    from app.models.models import Tenant

    result = await db.execute(
        select(Tenant).where(Tenant.is_active == True).order_by(Tenant.name)  # noqa: E712
    )
    tenants = result.scalars().all()
    return {
        "items": [
            {"id": str(t.id), "name": t.name, "short_name": t.short_name}
            for t in tenants
        ]
    }


# ── Incident Preview ─────────────────────────────────────────────

@router.get("/incidents/preview/{rusiem_id}")
async def preview_incident(
    rusiem_id: int = Path(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Fetch incident from RuSIEM by ID. Returns pre-filled form data."""
    rusiem = await _get_rusiem(redis_client)
    service = IncidentService(db, rusiem)

    try:
        preview = await service.preview_from_rusiem(rusiem_id)
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    finally:
        await rusiem.close()

    return preview


# ── Publish Incident ──────────────────────────────────────────────

@router.post("/incidents/publish")
async def publish_incident(
    body: PublishIncidentRequest,
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
):
    """Publish a RuSIEM incident to a client.

    Auto-fetches fields from RuSIEM, creates incident in portal DB,
    sends notification to client.
    """
    rusiem = await _get_rusiem(redis_client)
    service = IncidentService(db, rusiem)

    try:
        incident = await service.publish_incident(
            rusiem_incident_id=body.rusiem_incident_id,
            tenant_id=body.tenant_id,
            recommendations=body.recommendations,
            soc_actions=body.soc_actions,
            published_by_id=user.user_id,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    finally:
        await rusiem.close()

    return {
        "id": str(incident.id),
        "rusiem_incident_id": incident.rusiem_incident_id,
        "title": incident.title,
        "priority": incident.priority,
        "status": incident.status,
    }


# ── List All Incidents (cross-tenant) ─────────────────────────────

@router.get("/incidents")
async def list_all_incidents(
    tenant_id: str | None = Query(None),
    status: str | None = Query(None),
    priority: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """List all published incidents. SOC sees all tenants."""
    service = IncidentService(db)
    return await service.list_incidents(
        tenant_id=tenant_id, status=status, priority=priority,
        page=page, per_page=per_page,
    )


# ── Get Incident Detail ──────────────────────────────────────────

@router.get("/incidents/{incident_id}")
async def get_incident_detail(
    incident_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Get full incident detail (SOC view — no tenant filter)."""
    service = IncidentService(db)
    try:
        return await service.get_incident_detail(incident_id)
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


# ── Update Incident (SOC fields) ─────────────────────────────────

@router.put("/incidents/{incident_id}")
async def update_incident(
    body: UpdateIncidentRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Update recommendations or SOC actions."""
    service = IncidentService(db)
    try:
        incident = await service.update_soc_fields(
            incident_id,
            recommendations=body.recommendations,
            soc_actions=body.soc_actions,
            updated_by_id=user.user_id,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {"ok": True, "id": str(incident.id)}


# ── SOC Comment ───────────────────────────────────────────────────

@router.post("/incidents/{incident_id}/comments")
async def add_soc_comment(
    body: AddCommentRequest,
    incident_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Add a comment from SOC analyst."""
    service = IncidentService(db)
    try:
        comment = await service.add_comment(
            incident_id=incident_id,
            user_id=user.user_id,
            text=body.text,
            is_soc=True,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {"id": str(comment.id), "text": comment.text, "is_soc": True}


# ── SOC Status Change ────────────────────────────────────────────

@router.put("/incidents/{incident_id}/status")
async def change_status_soc(
    incident_id: str = Path(...),
    new_status: str = Query(...),
    comment: str | None = Query(None),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Change incident status (SOC side)."""
    service = IncidentService(db)
    try:
        incident = await service.change_status(
            incident_id=incident_id,
            new_status=new_status,
            user_id=user.user_id,
            is_soc=True,
            comment=comment,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {"ok": True, "status": incident.status}


# ══════════════════════════════════════════════════════════════════
# User Management (SOC Admin)
# ══════════════════════════════════════════════════════════════════

@router.post("/users")
async def create_user(
    body: CreateUserRequest,
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Create a new user (SOC staff or client user)."""
    service = UserService(db)
    try:
        new_user = await service.create_user(
            email=body.email,
            name=body.name,
            password=body.password,
            role=body.role,
            tenant_id=body.tenant_id,
            created_by_id=user.user_id,
        )
    except UserServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {
        "id": str(new_user.id),
        "email": new_user.email,
        "name": new_user.name,
        "role": new_user.role,
    }


@router.get("/users")
async def list_users(
    tenant_id: str | None = Query(None),
    role: str | None = Query(None),
    page: int = Query(1, ge=1),
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """List all users."""
    service = UserService(db)
    return await service.list_users(tenant_id=tenant_id, role=role, page=page)


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: str = Path(...),
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate (soft-delete) a user."""
    service = UserService(db)
    try:
        return await service.deactivate_user(user_id, user.user_id)
    except UserServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    body: ResetPasswordRequest,
    user_id: str = Path(...),
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Admin reset password. Forces MFA re-setup."""
    service = UserService(db)
    try:
        return await service.reset_password(user_id, body.new_password, user.user_id)
    except UserServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
