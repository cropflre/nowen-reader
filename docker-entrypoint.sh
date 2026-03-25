#!/bin/sh
set -e

# ============================================================
# NowenReader Go Docker Entrypoint
# ============================================================

echo "========================================="
echo "  NowenReader - Starting up..."
echo "========================================="

# Ensure directories exist (volumes may be empty on first run)
mkdir -p /data 2>/dev/null || true
mkdir -p /app/.cache/thumbnails 2>/dev/null || true
mkdir -p /app/.cache/pages 2>/dev/null || true
mkdir -p /app/comics 2>/dev/null || true
mkdir -p /app/novels 2>/dev/null || true

# Fix permissions for bind-mounted directories
# When host directories are bind-mounted, they are owned by root,
# causing SQLite "out of memory" (actually permission denied) errors.
# entrypoint runs as root, so we can always fix permissions here.
echo "[init] Ensuring directory permissions for appuser (1001)..."
chown -R 1001:1001 /data /app/.cache /app/comics /app/novels 2>/dev/null || true

# Set defaults
export DATABASE_URL="${DATABASE_URL:-/data/nowen-reader.db}"
export COMICS_DIR="${COMICS_DIR:-/app/comics}"
export NOVELS_DIR="${NOVELS_DIR:-/app/novels}"
export DATA_DIR="${DATA_DIR:-/app/.cache}"
export PORT="${PORT:-3000}"
export GIN_MODE="${GIN_MODE:-release}"

# First run detection
if [ ! -f /data/nowen-reader.db ]; then
    echo "[init] First run detected - database will be created automatically"
fi

echo "[init] Database: ${DATABASE_URL}"
echo "[init] Comics:   ${COMICS_DIR}"
echo "[init] Novels:   ${NOVELS_DIR}"
echo "[init] Cache:    ${DATA_DIR}"
echo "[init] Port:     ${PORT}"
echo "========================================="

# Start the server (drop privileges to appuser via su-exec)
echo "[init] Starting server as appuser..."
exec su-exec appuser ./nowen-reader
