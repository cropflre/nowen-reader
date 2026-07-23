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
UMASK=${UMASK:-0002}
PERMISSION_FIX_MODE=${PERMISSION_FIX_MODE:-auto}

echo "[init] Running with UID=${PUID}, GID=${PGID}"
echo "[init] Permission fix mode: ${PERMISSION_FIX_MODE}, umask: ${UMASK}"

if ! umask "${UMASK}" 2>/dev/null; then
    echo "[init] ⚠️  Invalid UMASK=${UMASK}; keeping the default shell umask"
fi

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

# Set defaults
export DATABASE_URL="${DATABASE_URL:-/data/nowen-reader.db}"
export COMICS_DIR="${COMICS_DIR:-/app/comics}"
export NOVELS_DIR="${NOVELS_DIR:-/app/novels}"
export DATA_DIR="${DATA_DIR:-/app/.cache}"
export PORT="${PORT:-3000}"
export BASE_PATH="${BASE_PATH:-/}"
export GIN_MODE="${GIN_MODE:-release}"

# Ensure directories exist (volumes may be empty on first run)
mkdir -p /data 2>/dev/null || true
mkdir -p "${DATA_DIR}/thumbnails" 2>/dev/null || true
mkdir -p "${DATA_DIR}/pages" 2>/dev/null || true
mkdir -p "${COMICS_DIR}" 2>/dev/null || true
mkdir -p "${NOVELS_DIR}" 2>/dev/null || true

# ============================================================
# 权限修复函数
# 策略：先验证 appuser 是否真的可写，再按需修复。
# PERMISSION_FIX_MODE:
#   auto    - 默认：尝试 chown/chmod 到 PUID:PGID + 组可写
#   relaxed - auto 失败后，再回退到 a+rwX（适合无法 chown 的 NAS/SMB）
#   off     - 不修复权限，只做可写性检测
# ============================================================
user_can_write() {
    local dir="$1"
    su-exec appuser sh -c 'test -d "$1" && touch "$1/.nowen-reader-write-test" && rm -f "$1/.nowen-reader-write-test"' sh "$dir" >/dev/null 2>&1
}

fix_permissions() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        return
    fi

    if user_can_write "$dir"; then
        echo "[init] ✅ writable by appuser: $dir"
        return
    fi

    if [ "$PERMISSION_FIX_MODE" = "off" ]; then
        echo "[init] ⚠️  not writable by appuser: $dir"
        echo "[init]    Permission fixing is disabled. Set PUID/PGID or enable PERMISSION_FIX_MODE=auto."
        return
    fi

    echo "[init] Fixing permissions for $dir..."

    # Fast path for empty/new bind mounts: adjust only the directory itself first.
    chown "${PUID}:${PGID}" "$dir" 2>/dev/null || true
    chmod u+rwx,g+rwx "$dir" 2>/dev/null || true
    if user_can_write "$dir"; then
        echo "[init] ✅ fixed directory owner/mode: $dir"
        return
    fi

    # Existing SQLite files, thumbnails, and uploaded files may also need adjustment.
    if chown -R "${PUID}:${PGID}" "$dir" 2>/dev/null; then
        chmod -R u+rwX,g+rwX "$dir" 2>/dev/null || true
        if user_can_write "$dir"; then
            echo "[init] ✅ chown -R ${PUID}:${PGID} $dir"
            return
        fi
    else
        echo "[init] ⚠️  chown failed for $dir (common on NAS/NFS/CIFS/SMB mounts)"
    fi

    # If ownership cannot be changed but group mapping is correct, group write is enough.
    if chmod -R u+rwX,g+rwX "$dir" 2>/dev/null; then
        if user_can_write "$dir"; then
            echo "[init] ✅ chmod group-writable $dir"
            return
        fi
    fi

    # Some NAS/SMB mounts map container users to a guest/nobody identity. Make the
    # broad fallback explicit so operators can opt in instead of silently using 777.
    if [ "$PERMISSION_FIX_MODE" = "relaxed" ] || [ "$PERMISSION_FIX_MODE" = "permissive" ]; then
        echo "[init] ⚠️  trying relaxed chmod a+rwX for $dir"
        if chmod -R a+rwX "$dir" 2>/dev/null && user_can_write "$dir"; then
            echo "[init] ✅ relaxed permissions allow writes: $dir"
            return
        fi
    fi

    echo "[init] ❌ appuser still cannot write: $dir"
    echo "[init]    Set PUID/PGID to the host file owner (check with ls -ln),"
    echo "[init]    or set PERMISSION_FIX_MODE=relaxed for NAS/SMB mounts that cannot chown."
}

# 修复核心目录权限
echo "[init] Ensuring directory permissions..."
fix_permissions /data
fix_permissions "${DATA_DIR}"

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
if [ ! -f "${DATABASE_URL}" ]; then
    echo "[init] First run detected - database will be created automatically"
fi

echo "[init] Database: ${DATABASE_URL}"
echo "[init] Comics:   ${COMICS_DIR}"
echo "[init] Novels:   ${NOVELS_DIR}"
echo "[init] Cache:    ${DATA_DIR}"
echo "[init] Port:     ${PORT}"
echo "[init] User:     ${PUID}:${PGID}"
echo "[init] Umask:    ${UMASK}"
echo "========================================="

# Start the server (drop privileges to appuser via su-exec)
echo "[init] Starting server as appuser (${PUID}:${PGID})..."
exec su-exec appuser ./nowen-reader
