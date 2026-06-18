#!/bin/bash
set -e

CONTAINER_NAME="ps-plugin-v2"
IMAGE_NAME="ps-plugin-v2"
PORT=8081

cd "$(dirname "$0")"

echo "Stopping old container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

echo "Building new image..."
docker build -t "$IMAGE_NAME" .

echo "Starting container..."
docker run -d -p ${PORT}:${PORT} --name "$CONTAINER_NAME" "$IMAGE_NAME"

echo "Waiting for container to start..."
sleep 2

if docker ps | grep -q "$CONTAINER_NAME"; then
    echo "[OK] Container is running on port $PORT"
else
    echo "[FAIL] Container failed to start. Logs:"
    docker logs "$CONTAINER_NAME"
    exit 1
fi
