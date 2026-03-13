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

# Set defaults
export DATABASE_URL="${DATABASE_URL:-/data/nowen-reader.db}"
export COMICS_DIR="${COMICS_DIR:-/app/comics}"
export DATA_DIR="${DATA_DIR:-/app/.cache}"
export PORT="${PORT:-3000}"
export GIN_MODE="${GIN_MODE:-release}"

# First run detection
if [ ! -f /data/nowen-reader.db ]; then
    echo "[init] First run detected - database will be created automatically"
fi

echo "[init] Database: ${DATABASE_URL}"
echo "[init] Comics:   ${COMICS_DIR}"
echo "[init] Cache:    ${DATA_DIR}"
echo "[init] Port:     ${PORT}"
echo "========================================="

# Start the server
exec ./nowen-reader
