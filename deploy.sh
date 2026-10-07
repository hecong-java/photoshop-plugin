#!/bin/bash
set -e

# ============================
# PS Plugin Webapp Deploy Script
# 目标：jumpB（阿里云 8.163.4.73，SSH 端口 52222）nginx 静态托管
# 线上地址：https://lemongrid.cn/ps/
# 布局：/var/www/ps-plugin/releases/<ts> + current 软链（与 /var/www/lemongrid 同构）
# 2026-10-07 自腾讯云 123.207.74.28:8081（Docker ps-plugin-v2）迁入
# ============================

REMOTE_USER="admin"
REMOTE_HOST="8.163.4.73"
REMOTE_PORT="52222"
SSH_KEY="$HOME/.ssh/id_ed25519_jumpB_nopass"   # jumpB 专用免密钥（已加 authorized_keys）
REMOTE_DIR="/var/www/ps-plugin"
SITE_URL="https://lemongrid.cn/ps/"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# --- Pre-checks ---
cd "$(dirname "$0")"
[ -d "code/webapp" ] || error "Cannot find code/webapp. Run from project root."
command -v npm >/dev/null || error "npm not found."
command -v tar >/dev/null || error "tar not found."
command -v scp >/dev/null || error "scp not found."
command -v ssh >/dev/null || error "ssh not found."

SSH_OPTS=(-i "$SSH_KEY" -p "$REMOTE_PORT")
SCP_OPTS=(-i "$SSH_KEY" -P "$REMOTE_PORT")   # scp 的端口是大写 -P（-p 是 preserve mtime）

# --- Step 1: Build ---
info "Building webapp..."
cd code/webapp
npm run build
cd ../..
[ -d "code/webapp/dist" ] || error "Build failed: dist/ not found."
[ -f "code/webapp/dist/index.html" ] || error "Build failed: dist/index.html not found."
info "Build complete."

# --- Step 2: Package dist ---
TARBALL="ps-plugin-dist.tar.gz"
tar -czf "$TARBALL" -C code/webapp/dist .
info "Packed dist into $TARBALL"

# --- Step 3: Upload & flip release symlink ---
info "Uploading to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PORT} ..."
scp "${SCP_OPTS[@]}" "$TARBALL" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/"

info "Creating new release and flipping 'current' symlink on remote..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" REMOTE_DIR="$REMOTE_DIR" 'bash -s' << 'REMOTE_SCRIPT'
set -e
TS=$(date +%Y%m%d%H%M%S)
REL_DIR="$REMOTE_DIR/releases/$TS"

sudo install -d -m 755 "$REL_DIR"
sudo tar -xzf /tmp/ps-plugin-dist.tar.gz -C "$REL_DIR"
sudo chown -R root:root "$REMOTE_DIR"
[ -f "$REL_DIR/index.html" ] || { echo "[FAIL] release missing index.html"; exit 1; }

PREV=$(sudo readlink "$REMOTE_DIR/current" || true)
sudo ln -sfn "$REL_DIR" "$REMOTE_DIR/current"
rm -f /tmp/ps-plugin-dist.tar.gz

echo "[OK] current -> $REL_DIR"
if [ -n "$PREV" ]; then
  echo "[INFO] previous release (rollback): $PREV"
  echo "[INFO] rollback = ln -sfn $PREV $REMOTE_DIR/current"
fi
# 只保留最近 5 个 release
sudo ls -1dt "$REMOTE_DIR"/releases/* | tail -n +6 | sudo xargs -r rm -rf
REMOTE_SCRIPT
rm -f "$TARBALL"

# --- Step 4: Verify ---
info "Verifying ${SITE_URL} ..."
sleep 1
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL")
if [ "$HTTP_CODE" = "200" ]; then
    info "Deploy complete! Webapp is live at ${SITE_URL}"
else
    error "Verification failed: ${SITE_URL} returned HTTP ${HTTP_CODE}. Check nginx and release dir."
fi
