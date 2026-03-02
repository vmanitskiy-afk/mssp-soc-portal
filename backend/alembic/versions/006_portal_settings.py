"""add portal_settings table

Revision ID: 006
Revises: 005
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "006"
down_revision = "005"


def upgrade():
    op.create_table(
        "portal_settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.Text, nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
    )
    # Seed NKCKI defaults
    op.execute("""
        INSERT INTO portal_settings (key, value) VALUES
        ('nkcki_api_url', 'https://test-lk.cert.gov.ru/api/v2'),
        ('nkcki_api_token', ''),
        ('nkcki_enabled', 'false')
        ON CONFLICT DO NOTHING
    """)


def downgrade():
    op.drop_table("portal_settings")
