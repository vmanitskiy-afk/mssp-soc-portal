"""Seed a demo tenant with RuSIEM connection.

Usage: python -m app.scripts.seed_tenant <name> <short_name> [rusiem_url] [rusiem_key] [email]
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.models import Tenant


async def create_tenant():
    if len(sys.argv) < 3:
        print("Usage: python -m app.scripts.seed_tenant <name> <short_name> [rusiem_url] [rusiem_key] [email]")
        print("Example: python -m app.scripts.seed_tenant IDS ids")
        sys.exit(1)

    name = sys.argv[1]
    short_name = sys.argv[2]
    rusiem_url = sys.argv[3] if len(sys.argv) > 3 else os.getenv("RUSIEM_API_URL", "https://172.16.177.216")
    rusiem_key = sys.argv[4] if len(sys.argv) > 4 else os.getenv("RUSIEM_API_KEY", "")
    contact_email = sys.argv[5] if len(sys.argv) > 5 else None

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Tenant).where(Tenant.short_name == short_name))
        existing = result.scalar_one_or_none()
        if existing:
            print(f"Tenant '{short_name}' already exists (id: {existing.id})")
            return

        tenant = Tenant(
            name=name,
            short_name=short_name,
            rusiem_api_url=rusiem_url,
            rusiem_api_key=rusiem_key,
            contact_email=contact_email,
            is_active=True,
        )
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)
        print(f"Tenant created! ID: {tenant.id} | Name: {tenant.name} | RuSIEM: {rusiem_url}")


if __name__ == "__main__":
    asyncio.run(create_tenant())
