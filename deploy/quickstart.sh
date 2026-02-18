#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════
# MSSP SOC Portal — Quick Deploy for soc.itnovation.pro
# Run as root on fresh Ubuntu 24.04 (85.239.57.76)
#
# Usage: curl -sfL <raw_url>/deploy/quickstart.sh | bash
# ══════════════════════════════════════════════════════════════

DOMAIN="soc.itnovation.pro"
PROJECT_DIR="/opt/mssp-soc-portal"
DEPLOY_USER="deploy"
REPO="https://github.com/vmanitskiy-afk/mssp-soc-portal.git"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Run as root"

# ── 1. System setup ──────────────────────────────────────────
log "Step 1/8: System update..."
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw fail2ban unattended-upgrades ca-certificates gnupg

# ── 2. Docker ────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    log "Step 2/8: Installing Docker..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
else
    log "Step 2/8: Docker already installed"
fi

# ── 3. Deploy user ───────────────────────────────────────────
log "Step 3/8: Creating deploy user..."
id "$DEPLOY_USER" &>/dev/null || useradd -m -s /bin/bash -G docker "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

# ── 4. Firewall ──────────────────────────────────────────────
log "Step 4/8: Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── 5. Fail2ban ──────────────────────────────────────────────
log "Step 5/8: Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
[sshd]
enabled = true
maxretry = 3
bantime = 7200
EOF
systemctl enable fail2ban && systemctl restart fail2ban

# ── 6. Clone and configure ───────────────────────────────────
log "Step 6/8: Cloning project..."
mkdir -p "$PROJECT_DIR" /opt/mssp-soc-portal/backups
rm -rf "$PROJECT_DIR"
git clone "$REPO" "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Generate secrets
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(64))")
DB_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
REDIS_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")

cat > .env.production << ENVEOF
APP_ENV=production
APP_DEBUG=false
APP_LOG_LEVEL=WARNING
SECRET_KEY=${SECRET_KEY}

DB_NAME=mssp_portal
DB_USER=portal
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql+asyncpg://portal:${DB_PASSWORD}@db:5432/mssp_portal

REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1
CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2

RUSIEM_API_URL=https://your-rusiem.local/api/v1
RUSIEM_API_KEY=CHANGE_ME
RUSIEM_VERIFY_SSL=true

CORS_ORIGINS=https://${DOMAIN}

ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
ENVEOF

chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$PROJECT_DIR"

# ── 7. Build and start ───────────────────────────────────────
log "Step 7/8: Building and starting services..."
cd "$PROJECT_DIR"
docker compose -f docker-compose.prod.yml build --parallel
docker compose -f docker-compose.prod.yml up -d db
sleep 8
docker compose -f docker-compose.prod.yml run --rm backend alembic upgrade head
docker compose -f docker-compose.prod.yml up -d

# ── 8. SSL ────────────────────────────────────────────────────
log "Step 8/8: Obtaining SSL certificate..."
mkdir -p certbot/conf certbot/www

# Stop nginx briefly for standalone cert
docker compose -f docker-compose.prod.yml stop nginx

docker run --rm \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    -p 80:80 \
    certbot/certbot certonly \
    --standalone \
    --email admin@itnovation.pro \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

# Write HTTPS nginx config
cat > deploy/nginx/default.conf << 'SSLCONF'
upstream backend {
    server backend:8000;
}

upstream frontend {
    server frontend:80;
}

limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name soc.itnovation.pro;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name soc.itnovation.pro;

    ssl_certificate /etc/letsencrypt/live/soc.itnovation.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/soc.itnovation.pro/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    include /etc/nginx/snippets/security.conf;

    location /api/auth/login {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        limit_req zone=login burst=3 nodelay;
    }

    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        limit_req zone=api burst=30 nodelay;
        proxy_read_timeout 30s;
        proxy_connect_timeout 10s;
        client_max_body_size 10M;
    }

    location /health {
        proxy_pass http://backend;
    }

    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
SSLCONF

# Restart everything with SSL
docker compose -f docker-compose.prod.yml up -d

# ── 9. Backup cron ───────────────────────────────────────────
cat > /etc/cron.d/mssp-backup << 'EOF'
0 3 * * * deploy cd /opt/mssp-soc-portal && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U portal mssp_portal | gzip > backups/backup-$(date +\%Y\%m\%d).sql.gz 2>/dev/null
0 4 * * * deploy find /opt/mssp-soc-portal/backups -name "*.sql.gz" -mtime +30 -delete 2>/dev/null
EOF

# ── Done ─────────────────────────────────────────────────────
echo ""
log "═══════════════════════════════════════════════════════"
log " MSSP SOC Portal deployed!"
log " https://soc.itnovation.pro"
log "═══════════════════════════════════════════════════════"
echo ""
echo "  Create first admin:"
echo "  docker compose -f docker-compose.prod.yml exec backend python -m app.scripts.seed_admin"
echo ""
echo "  ⚠ Don't forget to update RuSIEM credentials:"
echo "  nano /opt/mssp-soc-portal/.env.production"
echo "  → RUSIEM_API_URL and RUSIEM_API_KEY"
echo "  → then: docker compose -f docker-compose.prod.yml restart backend"
echo ""
