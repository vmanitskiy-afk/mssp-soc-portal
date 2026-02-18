"""add incident card fields: ioc, assets, acknowledgment

Revision ID: 002
Revises: 001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "002"
down_revision = "001"


def upgrade() -> None:
    op.add_column("published_incidents", sa.Column("ioc_indicators", JSONB, nullable=True))
    op.add_column("published_incidents", sa.Column("affected_assets", JSONB, nullable=True))
    op.add_column("published_incidents", sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "published_incidents",
        sa.Column("acknowledged_by", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_incident_acknowledged_by",
        "published_incidents",
        "users",
        ["acknowledged_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_incident_acknowledged_by", "published_incidents", type_="foreignkey")
    op.drop_column("published_incidents", "acknowledged_by")
    op.drop_column("published_incidents", "acknowledged_at")
    op.drop_column("published_incidents", "affected_assets")
    op.drop_column("published_incidents", "ioc_indicators")
