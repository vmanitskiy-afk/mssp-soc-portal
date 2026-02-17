import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


# ── Enums ─────────────────────────────────────────────────────────

INCIDENT_STATUS = Enum(
    "new",               # Аналитик опубликовал, клиент ещё не видел
    "in_progress",       # Клиент ознакомился / работает над реагированием
    "awaiting_customer", # SOC ждёт действий от клиента
    "awaiting_soc",      # Клиент ждёт действий от SOC
    "resolved",          # Клиент завершил реагирование
    "closed",            # Инцидент закрыт
    "false_positive",    # Ложное срабатывание
    name="incident_status",
)

USER_ROLE = Enum(
    "soc_admin",         # Администратор SOC (управление tenants, пользователями)
    "soc_analyst",       # Аналитик L1/L2 (публикация инцидентов, рекомендации)
    "client_admin",      # Администратор клиента
    "client_security",   # Security Officer клиента
    "client_auditor",    # Аудитор клиента (только чтение)
    "client_readonly",   # Read-only пользователь клиента
    name="user_role",
)


# ── Tenants ───────────────────────────────────────────────────────

class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    short_name: Mapped[str] = mapped_column(String(50), nullable=False)
    rusiem_api_url: Mapped[str] = mapped_column(String(512), nullable=False)
    rusiem_api_key: Mapped[str] = mapped_column(Text, nullable=False)  # encrypted
    sla_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="tenant")
    incidents: Mapped[list["PublishedIncident"]] = relationship(back_populates="tenant")
    log_sources: Mapped[list["LogSource"]] = relationship(back_populates="tenant")


# ── Users ─────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True  # NULL for SOC staff
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(USER_ROLE, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tenant: Mapped["Tenant | None"] = relationship(back_populates="users")

    @property
    def is_soc_staff(self) -> bool:
        return self.role in ("soc_admin", "soc_analyst")


# ── Published Incidents ───────────────────────────────────────────

class PublishedIncident(Base):
    __tablename__ = "published_incidents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)

    # ── From RuSIEM (auto-populated on publish) ──
    rusiem_incident_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False)  # critical, high, medium, low
    priority_num: Mapped[int] = mapped_column(Integer, default=4)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mitre_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_ips: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    source_hostnames: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    event_source_ips: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    symptoms: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    rusiem_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rusiem_raw_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # ── SOC analyst fills in ──
    status: Mapped[str] = mapped_column(INCIDENT_STATUS, default="new")
    recommendations: Mapped[str | None] = mapped_column(Text, nullable=True)
    soc_actions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Client fills in ──
    client_response: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Tracking ──
    published_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    closed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # ── Relations ──
    tenant: Mapped["Tenant"] = relationship(back_populates="incidents")
    publisher: Mapped["User"] = relationship(foreign_keys=[published_by])
    closer: Mapped["User | None"] = relationship(foreign_keys=[closed_by])
    comments: Mapped[list["IncidentComment"]] = relationship(back_populates="incident", order_by="IncidentComment.created_at")
    status_history: Mapped[list["IncidentStatusChange"]] = relationship(back_populates="incident", order_by="IncidentStatusChange.created_at")


# ── Incident Comments ─────────────────────────────────────────────

class IncidentComment(Base):
    __tablename__ = "incident_comments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("published_incidents.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    is_soc: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    incident: Mapped["PublishedIncident"] = relationship(back_populates="comments")
    user: Mapped["User"] = relationship()


# ── Incident Status Changes ───────────────────────────────────────

class IncidentStatusChange(Base):
    __tablename__ = "incident_status_changes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("published_incidents.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    old_status: Mapped[str] = mapped_column(String(30), nullable=False)
    new_status: Mapped[str] = mapped_column(String(30), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    incident: Mapped["PublishedIncident"] = relationship(back_populates="status_history")
    user: Mapped["User"] = relationship()


# ── SLA Snapshots ─────────────────────────────────────────────────

class SlaSnapshot(Base):
    __tablename__ = "sla_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    mtta_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    mttr_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    sla_compliance_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    incidents_total: Mapped[int] = mapped_column(Integer, default=0)
    incidents_by_priority: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── Log Sources ───────────────────────────────────────────────────

class LogSource(Base):
    __tablename__ = "log_sources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(100), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rusiem_group_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="unknown")
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    eps: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    tenant: Mapped["Tenant"] = relationship(back_populates="log_sources")


# ── Audit Log ─────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── Notifications ─────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    extra_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
