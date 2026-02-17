from fastapi import APIRouter

from app.api.v1.endpoints import auth, dashboard, incidents, sources, reports, notifications, soc

api_router = APIRouter()

# ── Client-facing endpoints ───────────────────────────────────────
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
api_router.include_router(incidents.router, prefix="/incidents", tags=["Incidents (Client)"])
api_router.include_router(sources.router, prefix="/sources", tags=["Log Sources (Client)"])
api_router.include_router(reports.router, prefix="/reports", tags=["Reports"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])

# ── SOC internal endpoints ────────────────────────────────────────
api_router.include_router(soc.router, prefix="/soc", tags=["SOC Operations"])
