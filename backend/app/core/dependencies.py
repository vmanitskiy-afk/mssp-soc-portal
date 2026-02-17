"""
FastAPI dependencies for injection into endpoints.

Provides: database sessions, Redis client, RuSIEM client, current user with tenant context.
"""

from typing import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, set_tenant_context
from app.core.security import CurrentUser, get_current_user
from app.integrations.rusiem.client import RuSIEMClient
from app.models.models import Tenant

settings = get_settings()

# ── Redis singleton ───────────────────────────────────────────────

_redis_pool: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
        )
    return _redis_pool


# ── Database session ──────────────────────────────────────────────

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── Database session with tenant isolation (for client endpoints) ─

async def get_db_with_tenant(
    user: CurrentUser = Depends(get_current_user),
) -> AsyncGenerator[AsyncSession, None]:
    """DB session with RLS tenant context set from JWT.

    For client-facing endpoints: automatically filters all queries
    by the user's tenant_id via PostgreSQL Row-Level Security.
    SOC staff (tenant_id=None) gets unfiltered access.
    """
    async with AsyncSessionLocal() as session:
        try:
            if user.tenant_id:
                await set_tenant_context(session, user.tenant_id)
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── RuSIEM client factory ────────────────────────────────────────

async def get_rusiem_client(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    redis_client: aioredis.Redis = Depends(get_redis),
) -> RuSIEMClient:
    """Build RuSIEM client for the current context.

    For SOC staff: uses default RuSIEM config from env (single instance).
    For client users: would use tenant-specific config (future).
    """
    # For now, single RuSIEM instance. In the future, per-tenant config from DB.
    client = RuSIEMClient(
        base_url=settings.RUSIEM_API_URL,
        api_key=settings.RUSIEM_API_KEY,
        redis_client=redis_client,
        verify_ssl=settings.RUSIEM_VERIFY_SSL,
    )
    return client


async def get_rusiem_for_tenant(
    tenant_id: str,
    db: AsyncSession,
    redis_client: aioredis.Redis,
) -> RuSIEMClient:
    """Build RuSIEM client for a specific tenant. Used by SOC endpoints."""
    # For now, single instance. Future: decrypt tenant's API key from DB
    return RuSIEMClient(
        base_url=settings.RUSIEM_API_URL,
        api_key=settings.RUSIEM_API_KEY,
        redis_client=redis_client,
        verify_ssl=settings.RUSIEM_VERIFY_SSL,
    )
