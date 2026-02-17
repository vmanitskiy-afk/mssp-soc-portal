"""
MSSP SOC Portal — FastAPI application entry point.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.APP_LOG_LEVEL),
    format="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup and shutdown logic."""
    logger.info("MSSP SOC Portal starting up...")
    logger.info(f"Environment: {settings.APP_ENV}")
    yield
    # Cleanup
    from app.core.dependencies import _redis_pool
    if _redis_pool:
        await _redis_pool.close()
    logger.info("MSSP SOC Portal shut down.")


def create_app() -> FastAPI:
    application = FastAPI(
        title="MSSP SOC Portal API",
        description="Multi-tenant client portal for MSSP SOC services",
        version="0.2.0",
        lifespan=lifespan,
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

    # Health check
    @application.get("/health")
    async def health():
        return {"status": "ok", "version": "0.2.0"}

    return application


app = create_app()
