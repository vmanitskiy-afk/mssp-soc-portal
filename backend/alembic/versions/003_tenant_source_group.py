"""add rusiem_source_group to tenants

Revision ID: 003
Revises: 002
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"


def upgrade():
    op.add_column("tenants", sa.Column("rusiem_source_group", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("tenants", "rusiem_source_group")
