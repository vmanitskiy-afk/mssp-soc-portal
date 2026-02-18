"""Seed a demo tenant with RuSIEM connection."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import select
from app.core.database import async_session
from app.models.models import Tenant


async def create_tenant():
    name = input("Tenant name (e.g. IDS): ").strip()
    short_name = input("Short name (e.g. ids): ").strip()
    rusiem_url = input(f"RuSIEM URL [{os.getenv('RUSIEM_API_URL', 'https://172.16.177.216')}]: ").strip()
    if not rusiem_url:
        rusiem_url = os.getenv("RUSIEM_API_URL", "https://172.16.177.216")
    rusiem_key = input(f"RuSIEM API key [{os.getenv('RUSIEM_API_KEY', '')}]: ").strip()
    if not rusiem_key:
        rusiem_key = os.getenv("RUSIEM_API_KEY", "")
    contact_email = input("Contact email (optional): ").strip() or None

    async with async_session() as db:
        # Check if tenant exists
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
        print(f"\n✅ Tenant created!")
        print(f"   ID: {tenant.id}")
        print(f"   Name: {tenant.name}")
        print(f"   RuSIEM: {rusiem_url}")


if __name__ == "__main__":
    asyncio.run(create_tenant())
