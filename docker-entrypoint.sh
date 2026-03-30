#!/bin/sh
set -e

# ============================================================
# NowenReader Go Docker Entrypoint
# ============================================================

echo "========================================="
echo "  NowenReader - Starting up..."
echo "========================================="

# ============================================================
# PUID/PGID 支持：允许用户指定容器内运行的 UID/GID
# 用法：在 docker-compose.yml 中设置：
#   environment:
#     - PUID=1000
#     - PGID=1000
# 默认值：1001（与 Dockerfile 中创建的 appuser 一致）
# ============================================================
PUID=${PUID:-1001}
PGID=${PGID:-1001}

echo "[init] Running with UID=${PUID}, GID=${PGID}"

# 如果 PUID/PGID 与默认 appuser(1001) 不同，修改 appuser 的 UID/GID
if [ "$PUID" != "1001" ] || [ "$PGID" != "1001" ]; then
    echo "[init] Adjusting appuser UID/GID to ${PUID}:${PGID}..."
    # 修改 group GID
    if [ "$PGID" != "1001" ]; then
        sed -i "s/^appgroup:x:1001:/appgroup:x:${PGID}:/" /etc/group 2>/dev/null || true
    fi
    # 修改 user UID 和 GID
    sed -i "s/^appuser:x:1001:1001:/appuser:x:${PUID}:${PGID}:/" /etc/passwd 2>/dev/null || true
fi

# Ensure directories exist (volumes may be empty on first run)
mkdir -p /data 2>/dev/null || true
mkdir -p /app/.cache/thumbnails 2>/dev/null || true
mkdir -p /app/.cache/pages 2>/dev/null || true
mkdir -p /app/comics 2>/dev/null || true
mkdir -p /app/novels 2>/dev/null || true

# Set defaults
export DATABASE_URL="${DATABASE_URL:-/data/nowen-reader.db}"
export COMICS_DIR="${COMICS_DIR:-/app/comics}"
export NOVELS_DIR="${NOVELS_DIR:-/app/novels}"
export DATA_DIR="${DATA_DIR:-/app/.cache}"
export PORT="${PORT:-3000}"
export GIN_MODE="${GIN_MODE:-release}"

# ============================================================
# 权限修复函数
# 策略：先尝试 chown，失败则回退到 chmod（兼容 NAS/NFS/CIFS 等文件系统）
# ============================================================
fix_permissions() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        return
    fi
    
    # 尝试 chown
    if chown -R "${PUID}:${PGID}" "$dir" 2>/dev/null; then
        echo "[init] ✅ chown ${PUID}:${PGID} $dir"
    else
        # chown 失败（常见于 NAS 的 NFS/CIFS/SMB 挂载），回退到 chmod
        echo "[init] ⚠️  chown failed for $dir (filesystem may not support it), trying chmod..."
        if chmod -R 755 "$dir" 2>/dev/null; then
            echo "[init] ✅ chmod 755 $dir"
        else
            echo "[init] ⚠️  chmod also failed for $dir — files may not be readable"
            echo "[init]    💡 Tip: Set PUID/PGID to match your NAS file owner, or use 'user: \"0:0\"' in docker-compose.yml"
        fi
    fi
}

# 修复核心目录权限
echo "[init] Ensuring directory permissions..."
fix_permissions /data
fix_permissions /app/.cache

# 修复漫画目录权限
fix_permissions "${COMICS_DIR}"

# 修复小说目录权限
fix_permissions "${NOVELS_DIR}"

# 修复额外挂载目录权限（通过 EXTRA_DIRS 环境变量指定，逗号分隔）
# 用法：EXTRA_DIRS=/mnt/manga,/mnt/novels2
if [ -n "${EXTRA_DIRS}" ]; then
    echo "[init] Fixing permissions for extra directories: ${EXTRA_DIRS}"
    OLD_IFS="$IFS"
    IFS=','
    for extra_dir in ${EXTRA_DIRS}; do
        extra_dir=$(echo "$extra_dir" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        if [ -n "$extra_dir" ] && [ -d "$extra_dir" ]; then
            fix_permissions "$extra_dir"
        fi
    done
    IFS="$OLD_IFS"
fi

# 检测常见的自定义挂载点并修复权限（/mnt 下的目录）
for mount_dir in /mnt/*/; do
    if [ -d "$mount_dir" ]; then
        fix_permissions "$mount_dir"
    fi
done

# First run detection
if [ ! -f /data/nowen-reader.db ]; then
    echo "[init] First run detected - database will be created automatically"
fi

echo "[init] Database: ${DATABASE_URL}"
echo "[init] Comics:   ${COMICS_DIR}"
echo "[init] Novels:   ${NOVELS_DIR}"
echo "[init] Cache:    ${DATA_DIR}"
echo "[init] Port:     ${PORT}"
echo "[init] User:     ${PUID}:${PGID}"
echo "========================================="

# Start the server (drop privileges to appuser via su-exec)
echo "[init] Starting server as appuser (${PUID}:${PGID})..."
exec su-exec appuser ./nowen-reader
