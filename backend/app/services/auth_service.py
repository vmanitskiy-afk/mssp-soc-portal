"""
Authentication service.

Handles: login flow, MFA verification, token management, user lookup.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
    generate_mfa_secret,
    get_mfa_uri,
    verify_mfa_code,
)
from app.models.models import User, AuditLog

logger = logging.getLogger(__name__)


class AuthError(Exception):
    def __init__(self, detail: str, status_code: int = 401):
        self.detail = detail
        self.status_code = status_code


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── User lookup ───────────────────────────────────────────────

    async def get_user_by_email(self, email: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.email == email, User.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.id == user_id, User.is_active == True)  # noqa: E712
        )
        return result.scalar_one_or_none()

    # ── Login ─────────────────────────────────────────────────────

    async def login(self, email: str, password: str, ip_address: str = "") -> dict:
        """Authenticate user with email + password.

        Returns:
        - If MFA enabled:  {"requires_mfa": True, "temp_token": "..."}
        - If MFA disabled: {"requires_mfa": False, "access_token": "...", "refresh_token": "..."}
        """
        user = await self.get_user_by_email(email)
        if not user:
            raise AuthError("Invalid email or password")

        if not verify_password(password, user.password_hash):
            await self._log_action(user, "login_failed", ip_address=ip_address)
            raise AuthError("Invalid email or password")

        token_data = self._build_token_data(user)

        if user.mfa_enabled and user.mfa_secret:
            # Issue temporary token (short-lived, type=mfa_pending)
            temp_token = create_access_token(
                {**token_data, "type": "mfa_pending"},
                expires_minutes=5,
            )
            await self._log_action(user, "login_mfa_pending", ip_address=ip_address)
            return {"requires_mfa": True, "temp_token": temp_token}

        # No MFA — issue full tokens
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        await self._update_last_login(user)
        await self._log_action(user, "login_success", ip_address=ip_address)

        return {
            "requires_mfa": False,
            "access_token": access_token,
            "refresh_token": refresh_token,
        }

    # ── MFA verification ──────────────────────────────────────────

    async def verify_mfa(self, temp_token: str, totp_code: str, ip_address: str = "") -> dict:
        """Verify TOTP code after successful password authentication.

        Returns: {"access_token": "...", "refresh_token": "..."}
        """
        payload = decode_token(temp_token)

        if payload.get("type") != "mfa_pending":
            raise AuthError("Invalid token type for MFA verification")

        user = await self.get_user_by_id(payload["sub"])
        if not user or not user.mfa_secret:
            raise AuthError("User not found or MFA not configured")

        if not verify_mfa_code(user.mfa_secret, totp_code):
            await self._log_action(user, "mfa_failed", ip_address=ip_address)
            raise AuthError("Invalid TOTP code")

        token_data = self._build_token_data(user)
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        await self._update_last_login(user)
        await self._log_action(user, "login_success", ip_address=ip_address)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
        }

    # ── Token refresh ─────────────────────────────────────────────

    async def refresh(self, refresh_token_str: str) -> dict:
        """Exchange refresh token for new access token."""
        payload = decode_token(refresh_token_str)

        if payload.get("type") != "refresh":
            raise AuthError("Invalid token type")

        user = await self.get_user_by_id(payload["sub"])
        if not user:
            raise AuthError("User not found")

        token_data = self._build_token_data(user)
        new_access = create_access_token(token_data)
        new_refresh = create_refresh_token(token_data)

        return {
            "access_token": new_access,
            "refresh_token": new_refresh,
        }

    # ── MFA setup ─────────────────────────────────────────────────

    async def setup_mfa(self, user_id: str) -> dict:
        """Generate new MFA secret. Returns secret + QR URI.

        User must call confirm_mfa with a valid code to activate.
        """
        user = await self.get_user_by_id(user_id)
        if not user:
            raise AuthError("User not found", 404)

        secret = generate_mfa_secret()
        uri = get_mfa_uri(secret, user.email)

        # Store secret but don't enable yet — wait for confirmation
        user.mfa_secret = secret
        await self.db.flush()

        return {"secret": secret, "qr_uri": uri}

    async def confirm_mfa(self, user_id: str, totp_code: str) -> dict:
        """Confirm MFA setup by verifying first TOTP code."""
        user = await self.get_user_by_id(user_id)
        if not user or not user.mfa_secret:
            raise AuthError("MFA not initialized. Call /auth/mfa/setup first.", 400)

        if not verify_mfa_code(user.mfa_secret, totp_code):
            raise AuthError("Invalid TOTP code. Scan QR again and retry.", 400)

        user.mfa_enabled = True
        await self.db.flush()
        await self._log_action(user, "mfa_enabled")

        return {"mfa_enabled": True}

    # ── Change password ───────────────────────────────────────────

    async def change_password(
        self, user_id: str, old_password: str, new_password: str
    ) -> dict:
        user = await self.get_user_by_id(user_id)
        if not user:
            raise AuthError("User not found", 404)

        if not verify_password(old_password, user.password_hash):
            raise AuthError("Current password is incorrect", 400)

        if len(new_password) < 12:
            raise AuthError("Password must be at least 12 characters", 400)

        user.password_hash = hash_password(new_password)
        await self.db.flush()
        await self._log_action(user, "password_changed")

        return {"ok": True}

    # ── Helpers ───────────────────────────────────────────────────

    @staticmethod
    def _build_token_data(user: User) -> dict:
        return {
            "sub": str(user.id),
            "email": user.email,
            "role": user.role,
            "tenant_id": str(user.tenant_id) if user.tenant_id else None,
            "name": user.name,
        }

    async def _update_last_login(self, user: User) -> None:
        user.last_login = datetime.now(timezone.utc)
        await self.db.flush()

    async def _log_action(
        self, user: User, action: str, ip_address: str = "", details: dict | None = None
    ) -> None:
        log = AuditLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action=action,
            resource_type="auth",
            ip_address=ip_address or None,
            details=details,
        )
        self.db.add(log)
        await self.db.flush()
