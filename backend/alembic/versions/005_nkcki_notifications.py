"""add nkcki_notifications table

Revision ID: 005
Revises: 004
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "005"
down_revision = "004"


def upgrade():
    op.create_table(
        "nkcki_notifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("incident_id", UUID(as_uuid=True), sa.ForeignKey("published_incidents.id"), nullable=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        # NKCKI response
        sa.Column("nkcki_uuid", sa.String(255), nullable=True),
        sa.Column("nkcki_identifier", sa.String(100), nullable=True),
        # Notification data
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("type", sa.String(255), nullable=False),
        sa.Column("company_name", sa.String(500), nullable=False),
        sa.Column("owner_name", sa.String(500), nullable=False),
        sa.Column("tlp", sa.String(20), nullable=False),
        sa.Column("event_description", sa.Text, nullable=False),
        sa.Column("detect_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activity_status", sa.String(100), nullable=False),
        sa.Column("detection_tool", sa.String(500), nullable=True),
        sa.Column("assistance", sa.Boolean, server_default="false"),
        # Affected system
        sa.Column("affected_system_name", sa.String(500), nullable=False),
        sa.Column("affected_system_category", sa.String(255), nullable=False),
        sa.Column("affected_system_function", sa.String(255), nullable=False),
        sa.Column("affected_system_connection", sa.Boolean, server_default="false"),
        sa.Column("location", sa.String(20), nullable=False),
        sa.Column("city", sa.String(255), nullable=True),
        # Impact
        sa.Column("integrity_impact", sa.String(50), nullable=True),
        sa.Column("availability_impact", sa.String(50), nullable=True),
        sa.Column("confidentiality_impact", sa.String(50), nullable=True),
        sa.Column("custom_impact", sa.Text, nullable=True),
        # JSONB
        sa.Column("technical_data", JSONB, nullable=True),
        sa.Column("rkn_data", JSONB, nullable=True),
        # Status
        sa.Column("nkcki_status", sa.String(100), server_default="Отправлено"),
        sa.Column("sent_payload", JSONB, nullable=True),
        sa.Column("response_data", JSONB, nullable=True),
        # Tracking
        sa.Column("sent_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_nkcki_notifications_tenant_id", "nkcki_notifications", ["tenant_id"])
    op.create_index("ix_nkcki_notifications_incident_id", "nkcki_notifications", ["incident_id"])
    op.create_index("ix_nkcki_notifications_nkcki_uuid", "nkcki_notifications", ["nkcki_uuid"])


def downgrade():
    op.drop_table("nkcki_notifications")
