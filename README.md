# MSSP SOC Client Portal

Multi-tenant web portal for MSSP SOC clients providing transparency into security operations, incident management, SLA metrics, and log source monitoring.

## Architecture

- **Backend:** Python 3.12 + FastAPI + SQLAlchemy + Celery
- **Frontend:** React 18 + TypeScript + Vite
- **Database:** PostgreSQL 16 (Row-Level Security for tenant isolation)
- **Cache:** Redis 7
- **SIEM Integration:** RuSIEM API v1
- **Auth:** JWT + TOTP MFA

## Project Structure

```
mssp-soc-portal/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # REST API endpoints
│   │   ├── core/               # Config, security, dependencies
│   │   ├── models/             # SQLAlchemy models
│   │   ├── schemas/            # Pydantic schemas
│   │   ├── services/           # Business logic
│   │   ├── integrations/       # RuSIEM adapter
│   │   └── tasks/              # Celery async tasks
│   ├── alembic/                # DB migrations
│   └── tests/
├── frontend/
│   └── src/
│       ├── components/         # React components by module
│       ├── pages/              # Route pages
│       ├── hooks/              # Custom React hooks
│       ├── services/           # API client
│       ├── store/              # State management
│       └── types/              # TypeScript types
├── docker/                     # Dockerfiles
├── docs/                       # Architecture & API docs
└── docker-compose.yml
```

## Quick Start

```bash
# Clone
git clone https://github.com/vmanitskiy-afk/mssp-soc-portal.git
cd mssp-soc-portal

# Copy env file and configure
cp .env.example .env
# Edit .env with your settings

# Start all services
docker compose up -d

# Run migrations
docker compose exec backend alembic upgrade head

# Access
# Portal:  http://localhost:3000
# API:     http://localhost:8000/docs
```

## MVP Scope (Phase 1)

- [x] Project scaffold
- [ ] Auth (JWT + TOTP MFA + RBAC)
- [ ] RuSIEM API integration layer
- [ ] Incidents (list, detail, timeline, comments)
- [ ] Dashboard (incidents stats, SLA metrics, EPS)
- [ ] SLA engine (MTTA/MTTR calculation)
- [ ] Log sources monitoring
- [ ] Email notifications
- [ ] PDF reports generation
- [ ] Frontend SPA

## License

Proprietary — Internal use only.
