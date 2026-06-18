#!/bin/bash
set -e

# ============================
# PS Plugin Webapp Deploy Script
# ============================

REMOTE_USER="ubuntu"
REMOTE_HOST="123.207.74.28"
REMOTE_DIR="~/photoshop-plugin-v2"
CONTAINER_NAME="ps-plugin-v2"
IMAGE_NAME="ps-plugin-v2"
PORT=8081

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
command -v npm  >/dev/null || error "npm not found."
command -v scp  >/dev/null || error "scp not found."
command -v ssh  >/dev/null || error "ssh not found."

# --- Step 1: Build ---
info "Building webapp..."
cd code/webapp
npm run build
cd ../..
[ -d "code/webapp/dist" ] || error "Build failed: dist/ not found."
info "Build complete."

# --- Step 2: Upload ---
info "Uploading dist/ to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}..."
scp -r code/webapp/dist/* "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/dist/"
info "Upload complete."

# --- Step 3: Rebuild Docker & Restart ---
info "Rebuilding Docker container on remote server..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" << 'REMOTE_SCRIPT'
set -e
cd ~/photoshop-plugin-v2

echo "Stopping old container..."
docker stop ps-plugin-v2 2>/dev/null || true
docker rm ps-plugin-v2 2>/dev/null || true

echo "Building new image..."
docker build -t ps-plugin-v2 .

echo "Starting container..."
docker run -d -p 8081:8081 --name ps-plugin-v2 ps-plugin-v2

echo "Waiting for container to start..."
sleep 2

if docker ps | grep -q ps-plugin-v2; then
    echo "[OK] Container is running on port 8081"
else
    echo "[FAIL] Container failed to start. Showing logs:"
    docker logs ps-plugin-v2
    exit 1
fi
REMOTE_SCRIPT

info "Deploy complete! Webapp is live at http://${REMOTE_HOST}:${PORT}"
