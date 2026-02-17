#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════
# Enable Let's Encrypt SSL
# Usage: bash deploy/enable-ssl.sh portal.yourcompany.ru
# ══════════════════════════════════════════════════════════════

cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
[[ -z "$DOMAIN" ]] && { echo "Usage: $0 <domain>"; echo "Example: $0 portal.yourcompany.ru"; exit 1; }

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "[+] Obtaining SSL certificate for $DOMAIN..."

# Create certbot dirs
mkdir -p certbot/conf certbot/www

# Get certificate
docker run --rm \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    -p 80:80 \
    certbot/certbot certonly \
    --standalone \
    --email admin@${DOMAIN} \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

# Generate nginx SSL config
cat > deploy/nginx/default.conf << EOF
upstream backend {
    server backend:8000;
}

upstream frontend {
    server frontend:80;
}

limit_req_zone \$binary_remote_addr zone=api:10m rate=60r/m;
limit_req_zone \$binary_remote_addr zone=login:10m rate=5r/m;

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    include /etc/nginx/snippets/security.conf;

    location /api/auth/login {
        proxy_pass http://backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        limit_req zone=login burst=3 nodelay;
    }

    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

# Uncomment certbot service in docker-compose
echo "[+] Enabling certbot auto-renewal..."
sed -i 's/^  # certbot:/  certbot:/' docker-compose.prod.yml
sed -i 's/^  #   image:/    image:/' docker-compose.prod.yml
sed -i 's/^  #   volumes:/    volumes:/' docker-compose.prod.yml
sed -i 's/^  #     - .\//      - .\//g' docker-compose.prod.yml
sed -i 's/^  #   entrypoint:/    entrypoint:/' docker-compose.prod.yml

# Update CORS in .env
echo "[+] Updating CORS_ORIGINS..."
sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN|" .env.production

# Restart
echo "[+] Restarting services..."
$COMPOSE up -d

echo ""
echo "[✓] SSL enabled! Portal: https://$DOMAIN"
echo ""
echo "  Auto-renewal via certbot container is active."
echo "  Test: curl -I https://$DOMAIN"
echo ""
