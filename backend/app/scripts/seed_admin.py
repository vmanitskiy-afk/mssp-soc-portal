"""
Create initial SOC admin user.

Usage:
    docker compose exec backend python -m app.scripts.seed_admin

Creates the first soc_admin user so you can log in and manage the system.
"""

import asyncio
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.models import User


async def create_admin():
    email = input("Admin email: ").strip()
    name = input("Admin name: ").strip()
    password = input("Password (min 12 chars): ").strip()

    if len(password) < 12:
        print("ERROR: Password must be at least 12 characters")
        sys.exit(1)

    async with AsyncSessionLocal() as db:
        # Check if exists
        result = await db.execute(select(User).where(User.email == email))
        if result.scalar_one_or_none():
            print(f"User {email} already exists!")
            sys.exit(1)

        user = User(
            email=email,
            name=name,
            password_hash=hash_password(password),
            role="soc_admin",
            tenant_id=None,
        )
        db.add(user)
        await db.commit()
        print(f"\nSOC Admin created:")
        print(f"  ID:    {user.id}")
        print(f"  Email: {email}")
        print(f"  Role:  soc_admin")
        print(f"\nLogin at /api/auth/login")
        print(f"Then setup MFA at /api/auth/mfa/setup")


if __name__ == "__main__":
    asyncio.run(create_admin())
