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

import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, get_redis
from app.core.security import CurrentUser, RoleRequired
from app.integrations.rusiem.client import RuSIEMClient
from app.core.config import get_settings
from app.services.incident_service import IncidentService, IncidentServiceError
from app.services.user_service import UserService, UserServiceError
from app.services.log_source_service import LogSourceService, LogSourceServiceError

router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)

soc_only = RoleRequired("soc_admin", "soc_analyst")
admin_only = RoleRequired("soc_admin")


# ── Schemas ───────────────────────────────────────────────────────

class PublishIncidentRequest(BaseModel):
    rusiem_incident_id: int
    tenant_id: str
    recommendations: str
    soc_actions: str | None = None
    incident_type: str | None = None


class UpdateIncidentRequest(BaseModel):
    recommendations: str | None = None
    soc_actions: str | None = None
    incident_type: str | None = None
    mitre_id: str | None = None


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


class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: str | None = None
    tenant_id: str | None = None
    is_active: bool | None = None


class CreateSourceRequest(BaseModel):
    tenant_id: str
    name: str
    source_type: str
    host: str
    vendor: str | None = None
    product: str | None = None
    rusiem_group_name: str | None = None


class UpdateSourceRequest(BaseModel):
    name: str | None = None
    source_type: str | None = None
    host: str | None = None
    vendor: str | None = None
    product: str | None = None
    rusiem_group_name: str | None = None


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
    include_inactive: bool = Query(False),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """List all tenants for SOC."""
    from app.models.models import Tenant, LogSource, User

    query = select(Tenant).order_by(Tenant.name)
    if not include_inactive:
        query = query.where(Tenant.is_active == True)  # noqa: E712

    tenants = (await db.execute(query)).scalars().all()

    # Count sources and users per tenant
    src_counts = dict(
        (await db.execute(
            select(LogSource.tenant_id, func.count()).where(LogSource.is_active == True).group_by(LogSource.tenant_id)  # noqa: E712
        )).all()
    )
    usr_counts = dict(
        (await db.execute(
            select(User.tenant_id, func.count()).where(User.is_active == True).group_by(User.tenant_id)  # noqa: E712
        )).all()
    )

    return {
        "items": [
            {
                "id": str(t.id),
                "name": t.name,
                "short_name": t.short_name,
                "contact_email": t.contact_email,
                "contact_phone": t.contact_phone,
                "is_active": t.is_active,
                "sources_count": src_counts.get(t.id, 0),
                "users_count": usr_counts.get(t.id, 0),
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tenants
        ]
    }


class CreateTenantRequest(BaseModel):
    name: str
    short_name: str
    contact_email: str | None = None
    contact_phone: str | None = None


@router.post("/tenants")
async def create_tenant(
    body: CreateTenantRequest,
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Create a new tenant."""
    from app.models.models import Tenant
    from app.core.config import get_settings

    settings = get_settings()

    # Check duplicate short_name
    existing = await db.execute(
        select(Tenant).where(Tenant.short_name == body.short_name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"Клиент с кодом '{body.short_name}' уже существует")

    tenant = Tenant(
        name=body.name,
        short_name=body.short_name,
        rusiem_api_url=settings.RUSIEM_API_URL,
        rusiem_api_key=settings.RUSIEM_API_KEY,
        contact_email=body.contact_email,
        contact_phone=body.contact_phone,
        is_active=True,
    )
    db.add(tenant)
    await db.flush()
    return {"ok": True, "id": str(tenant.id)}


class UpdateTenantRequest(BaseModel):
    name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None


@router.put("/tenants/{tenant_id}")
async def update_tenant(
    body: UpdateTenantRequest,
    tenant_id: str = Path(...),
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Update tenant info."""
    from app.models.models import Tenant
    import uuid as _uuid

    tenant = await db.get(Tenant, _uuid.UUID(tenant_id))
    if not tenant:
        raise HTTPException(404, "Клиент не найден")

    if body.name is not None:
        tenant.name = body.name
    if body.contact_email is not None:
        tenant.contact_email = body.contact_email or None
    if body.contact_phone is not None:
        tenant.contact_phone = body.contact_phone or None

    await db.flush()
    return {"ok": True}


@router.put("/tenants/{tenant_id}/toggle")
async def toggle_tenant(
    tenant_id: str = Path(...),
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Activate/deactivate a tenant."""
    from app.models.models import Tenant
    import uuid as _uuid

    tenant = await db.get(Tenant, _uuid.UUID(tenant_id))
    if not tenant:
        raise HTTPException(404, "Клиент не найден")

    tenant.is_active = not tenant.is_active
    await db.flush()
    return {"ok": True, "is_active": tenant.is_active}


@router.get("/tenants/{tenant_id}/sources")
async def get_tenant_sources(
    tenant_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Get all sources for a tenant."""
    from app.models.models import LogSource
    import uuid as _uuid

    sources = (await db.execute(
        select(LogSource).where(
            LogSource.tenant_id == _uuid.UUID(tenant_id),
            LogSource.is_active == True,  # noqa: E712
        ).order_by(LogSource.name)
    )).scalars().all()

    return {
        "items": [
            {
                "id": str(s.id),
                "name": s.name,
                "host": s.host,
                "source_type": s.source_type,
                "status": s.status,
            }
            for s in sources
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
            incident_type=body.incident_type,
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
            incident_type=body.incident_type,
            mitre_id=body.mitre_id,
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


@router.put("/incidents/{incident_id}/ioc-assets")
async def update_ioc_assets(
    incident_id: str = Path(...),
    body: dict = Body(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Update IOC indicators and affected assets (SOC only)."""
    service = IncidentService(db)
    try:
        await service.update_ioc_assets(
            incident_id=incident_id,
            ioc_indicators=body.get("ioc_indicators") if body else None,
            affected_assets=body.get("affected_assets") if body else None,
        )
    except IncidentServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    return {"ok": True}


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


@router.put("/users/{user_id}")
async def update_user(
    body: UpdateUserRequest,
    user_id: str = Path(...),
    user: CurrentUser = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    """Update user name, role, tenant, active status."""
    service = UserService(db)
    try:
        return await service.update_user(
            user_id=user_id,
            updated_by_id=user.user_id,
            name=body.name,
            role=body.role,
            tenant_id=body.tenant_id,
            is_active=body.is_active,
        )
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


# ══════════════════════════════════════════════════════════════════
# Log Source Management (SOC)
# ══════════════════════════════════════════════════════════════════

@router.get("/sources")
async def list_all_sources(
    tenant_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """List all log sources across tenants (SOC view)."""
    service = LogSourceService(db)
    return await service.list_all(
        tenant_id=tenant_id, status=status, search=search,
        page=page, per_page=per_page,
    )


@router.post("/sources")
async def create_source(
    body: CreateSourceRequest,
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Add a new log source to a client's organization."""
    service = LogSourceService(db)
    try:
        source = await service.create(
            tenant_id=body.tenant_id,
            name=body.name,
            source_type=body.source_type,
            host=body.host,
            vendor=body.vendor,
            product=body.product,
            rusiem_group_name=body.rusiem_group_name,
        )
    except LogSourceServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {
        "id": str(source.id),
        "name": source.name,
        "host": source.host,
        "status": source.status,
    }


@router.put("/sources/{source_id}")
async def update_source(
    body: UpdateSourceRequest,
    source_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing log source."""
    service = LogSourceService(db)
    try:
        source = await service.update_source(
            source_id=source_id,
            **body.model_dump(exclude_none=True),
        )
    except LogSourceServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return {"ok": True, "id": str(source.id), "name": source.name}


@router.delete("/sources/{source_id}")
async def delete_source(
    source_id: str = Path(...),
    user: CurrentUser = Depends(soc_only),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a log source."""
    service = LogSourceService(db)
    try:
        return await service.delete_source(source_id)
    except LogSourceServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.post("/sources/sync")
async def trigger_source_sync(
    tenant_id: str | None = Query(None, description="Sync specific tenant, or all if empty"),
    user: CurrentUser = Depends(soc_only),
    redis_client: aioredis.Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger source status sync from RuSIEM.

    Queries RuSIEM for recent events per source host, updates statuses.
    """
    from app.services.log_source_service import LogSourceService
    from app.models.models import Tenant, LogSource
    from datetime import datetime, timezone

    rusiem = await _get_rusiem(redis_client)
    service = LogSourceService(db)
    results = []

    try:
        # Get tenants to sync
        if tenant_id:
            tenants_query = select(Tenant).where(Tenant.id == tenant_id, Tenant.is_active == True)  # noqa: E712
        else:
            tenants_query = select(Tenant).where(Tenant.is_active == True)  # noqa: E712

        tenants = (await db.execute(tenants_query)).scalars().all()

        for tenant in tenants:
            # Get all active sources for this tenant
            sources = (await db.execute(
                select(LogSource).where(
                    LogSource.tenant_id == tenant.id,
                    LogSource.is_active == True,  # noqa: E712
                )
            )).scalars().all()

            if not sources:
                continue

            source_events: dict[str, datetime | None] = {}

            for source in sources:
                try:
                    # Search recent events from this source host in RuSIEM
                    events = await rusiem.search_events(
                        query=f"source_ip:{source.host} OR event_source_ip:{source.host}",
                        interval="2h",
                        limit=1,
                    )
                    event_data = events.get("data", [])
                    if event_data and len(event_data) > 0:
                        # Get timestamp of most recent event
                        ts = event_data[0].get("timestamp") or event_data[0].get("@timestamp")
                        if ts:
                            if isinstance(ts, str):
                                last_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                            else:
                                last_dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                            source_events[source.host] = last_dt
                        else:
                            source_events[source.host] = None
                    else:
                        source_events[source.host] = None
                except Exception as e:
                    logger.warning(f"Failed to check source {source.host}: {e}")
                    source_events[source.host] = None

            updated = await service.update_statuses_for_tenant(
                str(tenant.id), source_events
            )
            results.append({
                "tenant": tenant.short_name,
                "sources_checked": len(sources),
                "sources_updated": updated,
            })

    finally:
        await rusiem.close()

    return {"ok": True, "results": results}
