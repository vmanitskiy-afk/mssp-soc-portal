#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════
# MSSP SOC Portal — Server Setup Script
# Run on a fresh Ubuntu 24.04 LTS server as root
# Usage: sudo bash setup-server.sh
# ══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Check root
[[ $EUID -ne 0 ]] && err "Run as root: sudo bash $0"

log "Starting MSSP SOC Portal server setup..."

# ── 1. System updates ────────────────────────────────────────
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
    curl git ufw fail2ban unattended-upgrades \
    ca-certificates gnupg lsb-release

# ── 2. Docker ────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    log "Installing Docker..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    log "Docker installed: $(docker --version)"
else
    log "Docker already installed: $(docker --version)"
fi

# ── 3. Create deploy user ────────────────────────────────────
DEPLOY_USER="deploy"
if ! id "$DEPLOY_USER" &>/dev/null; then
    log "Creating deploy user..."
    useradd -m -s /bin/bash -G docker "$DEPLOY_USER"
    warn "Set password for deploy user: passwd $DEPLOY_USER"
else
    log "Deploy user already exists"
    usermod -aG docker "$DEPLOY_USER"
fi

# ── 4. SSH hardening ─────────────────────────────────────────
log "Hardening SSH..."
SSHD_CONF="/etc/ssh/sshd_config"
cp "$SSHD_CONF" "${SSHD_CONF}.backup"

# Disable root login and password auth (enable key-only)
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' "$SSHD_CONF"
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' "$SSHD_CONF"
sed -i 's/^#\?MaxAuthTries .*/MaxAuthTries 3/' "$SSHD_CONF"
sed -i 's/^#\?ClientAliveInterval .*/ClientAliveInterval 300/' "$SSHD_CONF"
sed -i 's/^#\?ClientAliveCountMax .*/ClientAliveCountMax 2/' "$SSHD_CONF"

warn "SSH: root login disabled, password auth disabled"
warn "MAKE SURE you have SSH key for '$DEPLOY_USER' before restarting sshd!"
warn "  mkdir -p /home/$DEPLOY_USER/.ssh"
warn "  echo 'your_public_key' >> /home/$DEPLOY_USER/.ssh/authorized_keys"
warn "  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh"

# ── 5. Firewall ──────────────────────────────────────────────
log "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment "SSH"
ufw allow 80/tcp    comment "HTTP"
ufw allow 443/tcp   comment "HTTPS"
ufw --force enable
log "UFW active: $(ufw status | grep -c ALLOW) rules"

# ── 6. Fail2ban ──────────────────────────────────────────────
log "Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200
EOF
systemctl enable fail2ban
systemctl restart fail2ban
log "Fail2ban configured"

# ── 7. Auto-updates ──────────────────────────────────────────
log "Enabling automatic security updates..."
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# ── 8. Prepare project dir ───────────────────────────────────
PROJECT_DIR="/opt/mssp-soc-portal"
mkdir -p "$PROJECT_DIR" /opt/mssp-soc-portal/backups
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$PROJECT_DIR"

# ── 9. DB backup cron ────────────────────────────────────────
log "Setting up daily DB backup..."
cat > /etc/cron.d/mssp-backup << 'EOF'
# Daily backup at 3 AM
0 3 * * * deploy cd /opt/mssp-soc-portal && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U portal mssp_portal | gzip > backups/backup-$(date +\%Y\%m\%d).sql.gz 2>/dev/null
# Keep last 30 days
0 4 * * * deploy find /opt/mssp-soc-portal/backups -name "*.sql.gz" -mtime +30 -delete 2>/dev/null
EOF
chmod 644 /etc/cron.d/mssp-backup

# ── Done ─────────────────────────────────────────────────────
echo ""
log "═══════════════════════════════════════════════════"
log " Server setup complete!"
log "═══════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "  1. Add SSH key for 'deploy' user"
echo "  2. Restart SSH: systemctl restart sshd"
echo "  3. Login as deploy: ssh deploy@<IP>"
echo "  4. Clone repo: cd /opt && git clone <repo> mssp-soc-portal"
echo "  5. Create .env.production from .env.production.example"
echo "  6. Run: bash deploy/deploy.sh"
echo ""
