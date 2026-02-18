#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════
# MSSP SOC Portal — Deploy / Update Script
# Usage: bash deploy/deploy.sh
# Run from project root as deploy user
# ══════════════════════════════════════════════════════════════

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $1"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $1"; exit 1; }

COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

# ── Preflight checks ─────────────────────────────────────────
[[ ! -f .env.production ]] && err ".env.production not found! Copy from .env.production.example"
command -v docker &>/dev/null || err "Docker not installed"

log "═══ MSSP SOC Portal Deploy ═══"
log "Directory: $PROJECT_DIR"

# ── 1. Pull latest code ──────────────────────────────────────
log "Pulling latest code..."
git pull origin main 2>/dev/null || warn "Git pull failed (maybe not a git repo)"

# ── 2. Build images ───────────────────────────────────────────
log "Building Docker images..."
$COMPOSE build --parallel

# ── 3. Run DB migrations ─────────────────────────────────────
log "Running database migrations..."
$COMPOSE up -d db
sleep 5  # Wait for postgres to be ready
$COMPOSE run --rm backend alembic upgrade head
log "Migrations complete"

# ── 4. Start all services ────────────────────────────────────
log "Starting services..."
$COMPOSE up -d

# ── 5. Health check ──────────────────────────────────────────
log "Waiting for services to be healthy..."
sleep 10

HEALTH=$(curl -sf http://localhost/health 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q "ok"; then
    log "Health check: ✓ OK"
else
    warn "Health check failed. Checking containers..."
    $COMPOSE ps
    $COMPOSE logs --tail=20 backend
    err "Backend not healthy. Check logs above."
fi

# ── 6. Status ─────────────────────────────────────────────────
echo ""
log "═══ Deploy complete ═══"
echo ""
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""

SERVER_IP=$(curl -sf https://ifconfig.me 2>/dev/null || echo "YOUR_IP")
log "Portal available at: http://$SERVER_IP"
echo ""
echo "  Useful commands:"
echo "  $COMPOSE logs -f backend     # Watch backend logs"
echo "  $COMPOSE logs -f nginx       # Watch nginx logs"
echo "  $COMPOSE exec backend python -m app.scripts.seed_admin  # Create first admin"
echo "  $COMPOSE restart backend     # Restart backend"
echo ""
