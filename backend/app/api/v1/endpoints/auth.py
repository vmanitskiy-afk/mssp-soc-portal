"""
Authentication endpoints.

POST /auth/login         — email + password → temp_token (if MFA) or tokens
POST /auth/mfa/verify    — temp_token + OTP code → tokens
POST /auth/mfa/resend    — temp_token → resend OTP email
POST /auth/refresh       — refresh_token → new tokens
PUT  /auth/mfa/toggle    — enable/disable MFA (auth required)
PUT  /auth/password      — change password (auth required)
GET  /auth/me            — current user info
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db
from app.core.security import CurrentUser, get_current_user
from app.services.auth_service import AuthService, AuthError

router = APIRouter()


# ── Request/Response schemas ──────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    requires_mfa: bool
    temp_token: str | None = None
    email_hint: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None


class MFAVerifyRequest(BaseModel):
    temp_token: str
    otp_code: str


class MFAResendRequest(BaseModel):
    temp_token: str


class MFAToggleRequest(BaseModel):
    enabled: bool


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UserInfoResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    tenant_id: str | None
    mfa_enabled: bool


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate with email + password.

    If MFA is enabled, sends OTP to email and returns temp_token (valid 5 min).
    Use /auth/mfa/verify to complete login.
    """
    service = AuthService(db)
    ip = request.client.host if request.client else ""

    try:
        result = await service.login(body.email, body.password, ip_address=ip)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return LoginResponse(**result)


@router.post("/mfa/verify", response_model=TokenResponse)
async def mfa_verify(
    body: MFAVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Complete MFA login by verifying Email OTP code.

    Requires temp_token from /auth/login response.
    Returns access_token (15 min) + refresh_token (7 days).
    """
    service = AuthService(db)
    ip = request.client.host if request.client else ""

    try:
        result = await service.verify_mfa(body.temp_token, body.otp_code, ip_address=ip)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return TokenResponse(**result)


@router.post("/mfa/resend")
async def mfa_resend(
    body: MFAResendRequest,
    db: AsyncSession = Depends(get_db),
):
    """Resend OTP code to user's email."""
    service = AuthService(db)

    try:
        result = await service.resend_otp(body.temp_token)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return result


@router.put("/mfa/toggle")
async def toggle_mfa(
    body: MFAToggleRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Enable or disable Email OTP MFA for current user."""
    service = AuthService(db)

    try:
        result = await service.toggle_mfa(user.user_id, body.enabled)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return result


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    refresh_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Exchange refresh token for new token pair."""
    service = AuthService(db)

    try:
        result = await service.refresh(refresh_token)
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return TokenResponse(**result)


@router.put("/password")
async def change_password(
    body: ChangePasswordRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change password. Requires current password."""
    service = AuthService(db)

    try:
        result = await service.change_password(
            user.user_id, body.old_password, body.new_password
        )
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)

    return result


@router.get("/me", response_model=UserInfoResponse)
async def get_me(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current authenticated user info."""
    service = AuthService(db)
    db_user = await service.get_user_by_id(user.user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    return UserInfoResponse(
        id=str(db_user.id),
        email=db_user.email,
        name=db_user.name,
        role=db_user.role,
        tenant_id=str(db_user.tenant_id) if db_user.tenant_id else None,
        mfa_enabled=db_user.mfa_enabled,
    )
