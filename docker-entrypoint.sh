#!/bin/sh
set -e

# ============================================================
# NowenReader Docker Entrypoint
# 自动初始化数据库、创建必要目录
# ============================================================

echo "========================================="
echo "  NowenReader - Starting up..."
echo "========================================="

# 确保数据目录存在
mkdir -p /data
mkdir -p /app/.cache/thumbnails
mkdir -p /app/comics

# 设置数据库路径
export DATABASE_URL="${DATABASE_URL:-file:/data/nowen-reader.db}"

# 如果漫画目录通过环境变量自定义
export COMICS_DIR="${COMICS_DIR:-/app/comics}"

# 初始化/迁移数据库
echo "[init] Checking database..."
if [ ! -f /data/nowen-reader.db ]; then
    echo "[init] Creating database for first time..."
fi
npx prisma db push --accept-data-loss --skip-generate 2>/dev/null || {
    echo "[init] Database migration done."
}

echo "[init] Database ready."
echo "[init] Comics directory: ${COMICS_DIR}"
echo "[init] Listening on port ${PORT:-3000}"
echo "========================================="

# 启动 Next.js
exec node server.js
