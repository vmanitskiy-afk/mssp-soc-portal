"""
Authentication service.

Handles: login flow, Email OTP verification, token management, user lookup.
"""

import logging
import secrets
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.models import User, AuditLog
from app.services.email_service import send_email, otp_email

logger = logging.getLogger(__name__)

OTP_LENGTH = 6
OTP_TTL_MINUTES = 5


def _generate_otp() -> str:
    """Generate a random numeric OTP code."""
    return "".join([str(secrets.randbelow(10)) for _ in range(OTP_LENGTH)])


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
        - If MFA enabled:  {"requires_mfa": True, "temp_token": "...", "email_hint": "..."}
        - If MFA disabled: {"requires_mfa": False, "access_token": "...", "refresh_token": "..."}
        """
        user = await self.get_user_by_email(email)
        if not user:
            raise AuthError("Неверный email или пароль")

        if not verify_password(password, user.password_hash):
            await self._log_action(user, "login_failed", ip_address=ip_address)
            raise AuthError("Неверный email или пароль")

        token_data = self._build_token_data(user)

        if user.mfa_enabled:
            # Generate OTP, save to DB, send email
            await self._send_otp(user)

            temp_token = create_access_token(
                {**token_data, "type": "mfa_pending"},
                expires_minutes=OTP_TTL_MINUTES,
            )
            await self._log_action(user, "login_mfa_pending", ip_address=ip_address)

            # Mask email: a***@domain.com
            parts = user.email.split("@")
            email_hint = parts[0][0] + "***@" + parts[1] if len(parts) == 2 else "***"

            return {"requires_mfa": True, "temp_token": temp_token, "email_hint": email_hint}

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

    # ── OTP helpers ───────────────────────────────────────────────

    async def _send_otp(self, user: User) -> None:
        """Generate OTP code, store in DB, send via email."""
        code = _generate_otp()
        user.otp_code = code
        user.otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)
        await self.db.flush()

        subject, html = otp_email(code, OTP_TTL_MINUTES)
        sent = send_email(user.email, subject, html)
        if not sent:
            logger.error(f"Failed to send OTP email to {user.email}")
            raise AuthError("Не удалось отправить код. Проверьте настройки SMTP.", 503)

    # ── MFA verification (Email OTP) ──────────────────────────────

    async def verify_mfa(self, temp_token: str, otp_code: str, ip_address: str = "") -> dict:
        """Verify OTP code after successful password authentication.

        Returns: {"access_token": "...", "refresh_token": "..."}
        """
        payload = decode_token(temp_token)

        if payload.get("type") != "mfa_pending":
            raise AuthError("Неверный тип токена для MFA верификации")

        user = await self.get_user_by_id(payload["sub"])
        if not user:
            raise AuthError("Пользователь не найден")

        # Check OTP code and expiry
        if not user.otp_code or not user.otp_expires_at:
            raise AuthError("Код не был отправлен. Запросите новый код.")

        if datetime.now(timezone.utc) > user.otp_expires_at:
            user.otp_code = None
            user.otp_expires_at = None
            await self.db.flush()
            raise AuthError("Код истёк. Запросите новый код.")

        if user.otp_code != otp_code:
            await self._log_action(user, "mfa_failed", ip_address=ip_address)
            raise AuthError("Неверный код")

        # OTP valid — clear it and issue tokens
        user.otp_code = None
        user.otp_expires_at = None

        token_data = self._build_token_data(user)
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        await self._update_last_login(user)
        await self._log_action(user, "login_success", ip_address=ip_address)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
        }

    # ── Resend OTP ────────────────────────────────────────────────

    async def resend_otp(self, temp_token: str) -> dict:
        """Resend OTP code to user's email."""
        payload = decode_token(temp_token)

        if payload.get("type") != "mfa_pending":
            raise AuthError("Неверный тип токена")

        user = await self.get_user_by_id(payload["sub"])
        if not user:
            raise AuthError("Пользователь не найден")

        await self._send_otp(user)
        return {"ok": True, "message": "Код отправлен повторно"}

    # ── Toggle MFA ────────────────────────────────────────────────

    async def toggle_mfa(self, user_id: str, enable: bool) -> dict:
        """Enable or disable Email OTP MFA for user."""
        user = await self.get_user_by_id(user_id)
        if not user:
            raise AuthError("Пользователь не найден", 404)

        user.mfa_enabled = enable
        if not enable:
            user.otp_code = None
            user.otp_expires_at = None
        await self.db.flush()

        action = "mfa_enabled" if enable else "mfa_disabled"
        await self._log_action(user, action)

        return {"mfa_enabled": enable}

    # ── Token refresh ─────────────────────────────────────────────

    async def refresh(self, refresh_token_str: str) -> dict:
        """Exchange refresh token for new access token."""
        payload = decode_token(refresh_token_str)

        if payload.get("type") != "refresh":
            raise AuthError("Неверный тип токена")

        user = await self.get_user_by_id(payload["sub"])
        if not user:
            raise AuthError("Пользователь не найден")

        token_data = self._build_token_data(user)
        new_access = create_access_token(token_data)
        new_refresh = create_refresh_token(token_data)

        return {
            "access_token": new_access,
            "refresh_token": new_refresh,
        }

    # ── Change password ───────────────────────────────────────────

    async def change_password(
        self, user_id: str, old_password: str, new_password: str
    ) -> dict:
        user = await self.get_user_by_id(user_id)
        if not user:
            raise AuthError("Пользователь не найден", 404)

        if not verify_password(old_password, user.password_hash):
            raise AuthError("Текущий пароль неверный", 400)

        if len(new_password) < 12:
            raise AuthError("Пароль должен содержать минимум 12 символов", 400)

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
