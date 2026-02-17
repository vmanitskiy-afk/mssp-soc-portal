"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-02-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Enums ─────────────────────────────────────────────────
    incident_status = postgresql.ENUM(
        "new", "in_progress", "awaiting_customer", "awaiting_soc",
        "resolved", "closed", "false_positive",
        name="incident_status", create_type=True,
    )
    incident_status.create(op.get_bind(), checkfirst=True)

    user_role = postgresql.ENUM(
        "soc_admin", "soc_analyst",
        "client_admin", "client_security", "client_auditor", "client_readonly",
        name="user_role", create_type=True,
    )
    user_role.create(op.get_bind(), checkfirst=True)

    # ── Tenants ───────────────────────────────────────────────
    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("short_name", sa.String(50), nullable=False),
        sa.Column("rusiem_api_url", sa.String(512), nullable=False),
        sa.Column("rusiem_api_key", sa.Text, nullable=False),
        sa.Column("sla_config", postgresql.JSONB, nullable=True),
        sa.Column("contact_email", sa.String(255), nullable=True),
        sa.Column("contact_phone", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── Users ─────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("mfa_secret", sa.Text, nullable=True),
        sa.Column("mfa_enabled", sa.Boolean, server_default="false"),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    op.create_index("ix_users_email", "users", ["email"])

    # ── Published Incidents ───────────────────────────────────
    op.create_table(
        "published_incidents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        # RuSIEM fields
        sa.Column("rusiem_incident_id", sa.Integer, nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("priority", sa.String(20), nullable=False),
        sa.Column("priority_num", sa.Integer, server_default="4"),
        sa.Column("category", sa.String(255), nullable=True),
        sa.Column("mitre_id", sa.String(50), nullable=True),
        sa.Column("source_ips", postgresql.JSONB, nullable=True),
        sa.Column("source_hostnames", postgresql.JSONB, nullable=True),
        sa.Column("event_source_ips", postgresql.JSONB, nullable=True),
        sa.Column("event_count", sa.Integer, server_default="0"),
        sa.Column("symptoms", postgresql.JSONB, nullable=True),
        sa.Column("rusiem_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rusiem_raw_data", postgresql.JSONB, nullable=True),
        # SOC fields
        sa.Column("status", incident_status, server_default="new"),
        sa.Column("recommendations", sa.Text, nullable=True),
        sa.Column("soc_actions", sa.Text, nullable=True),
        # Client fields
        sa.Column("client_response", sa.Text, nullable=True),
        # Tracking
        sa.Column("published_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("closed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_incidents_tenant_id", "published_incidents", ["tenant_id"])
    op.create_index("ix_incidents_status", "published_incidents", ["status"])
    op.create_index("ix_incidents_priority", "published_incidents", ["priority"])
    op.create_index("ix_incidents_published_at", "published_incidents", ["published_at"])
    op.create_index(
        "ix_incidents_tenant_rusiem",
        "published_incidents",
        ["tenant_id", "rusiem_incident_id"],
        unique=True,
    )

    # ── Incident Comments ─────────────────────────────────────
    op.create_table(
        "incident_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("published_incidents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("is_soc", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_comments_incident_id", "incident_comments", ["incident_id"])

    # ── Incident Status Changes ───────────────────────────────
    op.create_table(
        "incident_status_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("published_incidents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("old_status", sa.String(30), nullable=False),
        sa.Column("new_status", sa.String(30), nullable=False),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_status_changes_incident", "incident_status_changes", ["incident_id"])

    # ── SLA Snapshots ─────────────────────────────────────────
    op.create_table(
        "sla_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("mtta_minutes", sa.Float, nullable=True),
        sa.Column("mttr_minutes", sa.Float, nullable=True),
        sa.Column("sla_compliance_pct", sa.Float, nullable=True),
        sa.Column("incidents_total", sa.Integer, server_default="0"),
        sa.Column("incidents_by_priority", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_sla_tenant_period", "sla_snapshots", ["tenant_id", "period_start"])

    # ── Log Sources ───────────────────────────────────────────
    op.create_table(
        "log_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_type", sa.String(100), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("vendor", sa.String(255), nullable=True),
        sa.Column("product", sa.String(255), nullable=True),
        sa.Column("rusiem_group_name", sa.String(255), nullable=True),
        sa.Column("status", sa.String(50), server_default="'unknown'"),
        sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("eps", sa.Float, nullable=True),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_sources_tenant_id", "log_sources", ["tenant_id"])

    # ── Audit Logs ────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(100), nullable=True),
        sa.Column("resource_id", sa.String(255), nullable=True),
        sa.Column("details", postgresql.JSONB, nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_audit_tenant_id", "audit_logs", ["tenant_id"])
    op.create_index("ix_audit_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_action", "audit_logs", ["action"])
    op.create_index("ix_audit_created_at", "audit_logs", ["created_at"])

    # ── Notifications ─────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("is_read", sa.Boolean, server_default="false"),
        sa.Column("extra_data", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_notif_tenant_user", "notifications", ["tenant_id", "user_id"])
    op.create_index("ix_notif_unread", "notifications", ["tenant_id", "is_read"])

    # ── Row-Level Security policies ───────────────────────────
    # These ensure tenant isolation at the database level.
    # The app sets: SET app.current_tenant = '<uuid>' on each connection.

    rls_tables = [
        "published_incidents", "incident_comments", "sla_snapshots",
        "log_sources", "notifications",
    ]

    for table in rls_tables:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
            USING (tenant_id = current_tenant_id())
        """)
        # Allow superuser/owner to bypass RLS
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    # updated_at trigger function
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ language 'plpgsql';
    """)

    # Apply updated_at triggers
    for table in ["tenants", "users", "published_incidents", "log_sources"]:
        op.execute(f"""
            CREATE TRIGGER update_{table}_updated_at
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        """)


def downgrade() -> None:
    tables = [
        "notifications", "audit_logs", "log_sources", "sla_snapshots",
        "incident_status_changes", "incident_comments",
        "published_incidents", "users", "tenants",
    ]
    for t in tables:
        op.drop_table(t)

    op.execute("DROP TYPE IF EXISTS incident_status")
    op.execute("DROP TYPE IF EXISTS user_role")
    op.execute("DROP FUNCTION IF EXISTS update_updated_at_column()")
