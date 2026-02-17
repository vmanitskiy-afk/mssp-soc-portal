import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings

settings = get_settings()

logging.basicConfig(level=getattr(logging, settings.APP_LOG_LEVEL))
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    application = FastAPI(
        title="MSSP SOC Portal API",
        description="Multi-tenant client portal for MSSP SOC services",
        version="0.1.0",
        docs_url="/api/docs" if settings.APP_DEBUG else None,
        redoc_url="/api/redoc" if settings.APP_DEBUG else None,
    )

    # CORS
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    from app.api.v1.router import api_router
    application.include_router(api_router, prefix="/api")

    # Startup / Shutdown
    @application.on_event("startup")
    async def startup():
        logger.info("MSSP SOC Portal starting up...")

    @application.on_event("shutdown")
    async def shutdown():
        logger.info("MSSP SOC Portal shutting down...")

    # Health check
    @application.get("/health")
    async def health():
        return {"status": "ok", "version": "0.1.0"}

    return application


app = create_app()
