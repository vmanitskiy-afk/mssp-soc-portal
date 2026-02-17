from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.core.security import (
    CurrentUser, create_access_token, create_refresh_token,
    get_current_user, hash_password, verify_password,
    generate_mfa_secret, get_mfa_uri, verify_mfa_code,
)

router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    requires_mfa: bool
    temp_token: str | None = None
    access_token: str | None = None


class MFAVerifyRequest(BaseModel):
    temp_token: str
    totp_code: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    """Authenticate user with email and password.

    If MFA is enabled, returns a temporary token that must be verified
    via /auth/mfa/verify endpoint.
    """
    # TODO: Implement - lookup user in DB, verify password
    # If MFA enabled -> return temp_token + requires_mfa=True
    # If MFA not enabled -> return access_token directly
    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.post("/mfa/verify", response_model=TokenResponse)
async def mfa_verify(body: MFAVerifyRequest):
    """Verify TOTP code after login for MFA-enabled users."""
    # TODO: Decode temp_token, verify TOTP, issue JWT pair
    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token():
    """Exchange refresh token for new access token."""
    raise HTTPException(status_code=501, detail="Not implemented yet")


@router.post("/mfa/setup")
async def setup_mfa(user: CurrentUser = Depends(get_current_user)):
    """Generate MFA secret and QR code URI for initial setup."""
    secret = generate_mfa_secret()
    uri = get_mfa_uri(secret, user.email)
    return {"secret": secret, "qr_uri": uri}
