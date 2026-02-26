"""
User management service.

Used by SOC admins to create/manage users for tenants and SOC staff.
"""

import logging
import uuid

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.models import User, Tenant, AuditLog

logger = logging.getLogger(__name__)

SOC_ROLES = ("soc_admin", "soc_analyst")
CLIENT_ROLES = ("client_admin", "client_security", "client_auditor", "client_readonly")
ALL_ROLES = SOC_ROLES + CLIENT_ROLES


class UserServiceError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_user(
        self,
        email: str,
        name: str,
        password: str,
        role: str,
        tenant_id: str | None = None,
        created_by_id: str | None = None,
    ) -> User:
        """Create a new user.

        Rules:
        - SOC roles (soc_admin, soc_analyst) must have tenant_id=None
        - Client roles must have a valid tenant_id
        - Password min 12 chars
        - Email must be unique
        """
        if role not in ALL_ROLES:
            raise UserServiceError(f"Недопустимая роль: {role}. Допустимые: {ALL_ROLES}")

        if role in SOC_ROLES and tenant_id:
            raise UserServiceError("Сотрудники SOC не привязываются к клиенту")

        if role in CLIENT_ROLES and not tenant_id:
            raise UserServiceError("Для клиентской роли необходимо выбрать клиента")

        if len(password) < 12:
            raise UserServiceError("Пароль должен содержать минимум 12 символов")

        # Check email uniqueness
        existing = await self.db.execute(
            select(User).where(User.email == email)
        )
        if existing.scalar_one_or_none():
            raise UserServiceError(f"Пользователь с email {email} уже существует")

        # Verify tenant exists
        if tenant_id:
            tenant = await self.db.execute(
                select(Tenant).where(Tenant.id == tenant_id)
            )
            if not tenant.scalar_one_or_none():
                raise UserServiceError(f"Клиент {tenant_id} не найден")

        user = User(
            email=email,
            name=name,
            password_hash=hash_password(password),
            role=role,
            tenant_id=uuid.UUID(tenant_id) if tenant_id else None,
        )
        self.db.add(user)
        await self.db.flush()

        # Audit
        if created_by_id:
            self.db.add(AuditLog(
                tenant_id=user.tenant_id,
                user_id=uuid.UUID(created_by_id),
                action="user_created",
                resource_type="user",
                resource_id=str(user.id),
                details={"email": email, "role": role},
            ))
            await self.db.flush()

        logger.info(f"User created: {email} ({role})")
        return user

    async def list_users(
        self,
        tenant_id: str | None = None,
        role: str | None = None,
        page: int = 1,
        per_page: int = 25,
    ) -> dict:
        """List users with optional filters."""
        query = select(User).where(User.is_active == True)  # noqa: E712

        if tenant_id:
            query = query.where(User.tenant_id == tenant_id)
        if role:
            query = query.where(User.role == role)

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Paginate
        query = query.order_by(User.created_at.desc())
        query = query.offset((page - 1) * per_page).limit(per_page)
        result = await self.db.execute(query)
        users = result.scalars().all()

        return {
            "items": [self._user_to_dict(u) for u in users],
            "total": total,
            "page": page,
            "pages": (total + per_page - 1) // per_page,
        }

    async def get_user(self, user_id: str) -> User | None:
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def deactivate_user(self, user_id: str, deactivated_by_id: str) -> dict:
        """Soft-delete user."""
        user = await self.get_user(user_id)
        if not user:
            raise UserServiceError("Пользователь не найден", 404)

        user.is_active = False
        await self.db.flush()

        self.db.add(AuditLog(
            tenant_id=user.tenant_id,
            user_id=uuid.UUID(deactivated_by_id),
            action="user_deactivated",
            resource_type="user",
            resource_id=str(user.id),
        ))
        await self.db.flush()

        return {"ok": True}

    async def update_user(
        self, user_id: str, updated_by_id: str,
        name: str | None = None, role: str | None = None,
        tenant_id: str | None = None, is_active: bool | None = None,
    ) -> dict:
        """Update user fields."""
        user = await self.get_user(user_id)
        if not user:
            raise UserServiceError("Пользователь не найден", 404)

        if name is not None:
            user.name = name
        if role is not None:
            valid_roles = ["soc_admin", "soc_analyst", "client_admin", "client_security", "client_auditor", "client_readonly"]
            if role not in valid_roles:
                raise UserServiceError(f"Недопустимая роль: {role}")
            user.role = role
        if tenant_id is not None:
            user.tenant_id = uuid.UUID(tenant_id) if tenant_id else None
        if is_active is not None:
            user.is_active = is_active

        await self.db.flush()

        self.db.add(AuditLog(
            tenant_id=user.tenant_id,
            user_id=uuid.UUID(updated_by_id),
            action="user_updated",
            resource_type="user",
            resource_id=str(user.id),
        ))
        await self.db.flush()

        return self._user_to_dict(user)

    async def reset_password(self, user_id: str, new_password: str, reset_by_id: str) -> dict:
        """Admin password reset (no old password needed)."""
        if len(new_password) < 12:
            raise UserServiceError("Пароль должен содержать минимум 12 символов")

        user = await self.get_user(user_id)
        if not user:
            raise UserServiceError("Пользователь не найден", 404)

        user.password_hash = hash_password(new_password)
        user.mfa_enabled = False  # Force MFA re-setup after reset
        user.mfa_secret = None
        user.otp_code = None
        user.otp_expires_at = None
        await self.db.flush()

        self.db.add(AuditLog(
            tenant_id=user.tenant_id,
            user_id=uuid.UUID(reset_by_id),
            action="password_reset_by_admin",
            resource_type="user",
            resource_id=str(user.id),
        ))
        await self.db.flush()

        return {"ok": True}

    @staticmethod
    def _user_to_dict(user: User) -> dict:
        return {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "tenant_id": str(user.tenant_id) if user.tenant_id else None,
            "mfa_enabled": user.mfa_enabled,
            "is_active": user.is_active,
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }
