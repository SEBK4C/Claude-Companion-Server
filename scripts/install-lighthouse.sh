#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# The Companion — Lighthouse Installer
#
# One-command setup for a Lighthouse (proxy-only) Companion Server.
# Run on a fresh Linux machine (Debian/Ubuntu, LXC container, etc.):
#
#   curl -fsSL https://raw.githubusercontent.com/SEBK4C/Claude-Companion-Server/feat/multi-server-registry/scripts/install-lighthouse.sh | bash
#
# Or locally:
#   bash scripts/install-lighthouse.sh
#
# ─────────────────────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/companion"
BRANCH="feat/multi-server-registry"
REPO="https://github.com/SEBK4C/Claude-Companion-Server.git"
PORT="${COMPANION_PORT:-3456}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[lighthouse]${NC} $*"; }
ok()    { echo -e "${GREEN}[lighthouse]${NC} $*"; }
warn()  { echo -e "${YELLOW}[lighthouse]${NC} $*"; }
fail()  { echo -e "${RED}[lighthouse]${NC} $*"; exit 1; }

# ─── Preflight checks ───────────────────────────────────────────────────────

[[ "$(uname)" == "Linux" ]] || fail "This installer is for Linux only."
[[ "$(id -u)" == "0" ]] || fail "Please run as root (or with sudo)."

info "Installing The Companion (Lighthouse mode)"
echo ""

# ─── System dependencies ────────────────────────────────────────────────────

info "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl git unzip ca-certificates > /dev/null 2>&1
ok "System dependencies installed"

# ─── Bun ─────────────────────────────────────────────────────────────────────

if command -v bun &> /dev/null; then
  ok "Bun already installed: $(bun --version)"
else
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  # Ensure bun is on PATH for future shells
  if ! grep -q '.bun/bin' ~/.bashrc 2>/dev/null; then
    echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
    echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
  fi

  ok "Bun installed: $(bun --version)"
fi

# ─── Clone / update repo ────────────────────────────────────────────────────

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing installation..."
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  info "Cloning repository..."
  git clone -b "$BRANCH" "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/web"

# ─── Install dependencies & build frontend ───────────────────────────────────

info "Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install
ok "Dependencies installed"

info "Building frontend..."
bun run build
ok "Frontend built"

# ─── Resolve bun path ───────────────────────────────────────────────────────

BUN_PATH="$(command -v bun)"
[[ -n "$BUN_PATH" ]] || fail "Could not find bun binary"

# ─── Create systemd service ─────────────────────────────────────────────────

info "Creating systemd service..."
cat > /etc/systemd/system/the-companion.service << UNIT
[Unit]
Description=The Companion (Lighthouse)
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/web
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=COMPANION_LIGHTHOUSE=1
Environment=HOME=/root
ExecStart=${BUN_PATH} server/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable the-companion
ok "Systemd service created and enabled"

# ─── Start the service ──────────────────────────────────────────────────────

info "Starting the service..."
systemctl restart the-companion

# Wait for it to come up
for i in 1 2 3 4 5; do
  sleep 1
  if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    break
  fi
done

# ─── Verify ─────────────────────────────────────────────────────────────────

HEALTH=$(curl -sf "http://localhost:${PORT}/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo ""
  ok "=========================================="
  ok "  Lighthouse is running!"
  ok "=========================================="
  echo ""
  echo "  URL:    http://localhost:${PORT}"
  echo "  Health: ${HEALTH}"
  echo "  Token:  $(cat ~/.companion/auth.json 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4)"
  echo ""
  echo "  Next steps:"
  echo "  1. Open the URL in your browser"
  echo "  2. Go to Servers (#/servers) and add your worker machines"
  echo "  3. Create sessions on any server from the home page"
  echo ""
  echo "  Manage:"
  echo "    systemctl status the-companion"
  echo "    journalctl -u the-companion -f"
  echo ""
else
  warn "Service may not have started correctly."
  echo ""
  echo "  Check logs:"
  echo "    journalctl -u the-companion -n 50 --no-pager"
  echo "    systemctl status the-companion"
  echo ""
fi
