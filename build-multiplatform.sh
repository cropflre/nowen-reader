#!/bin/bash
# ============================================================
# NowenReader - 多平台 Docker 镜像构建脚本
# 构建 linux/amd64 + linux/arm64 双平台镜像并推送到 Docker Hub
#
# 前置要求:
#   1. 已安装 Docker 且支持 buildx
#   2. 已登录 Docker Hub: docker login
#
# 使用方法:
#   chmod +x build-multiplatform.sh
#   ./build-multiplatform.sh                    # 使用默认镜像名
#   ./build-multiplatform.sh myuser/myrepo      # 自定义镜像名
#   ./build-multiplatform.sh myuser/myrepo 1.0  # 自定义镜像名和版本号
# ============================================================

set -e

# 配置
IMAGE_NAME="${1:-cropflre/nowen-reader}"
VERSION="${2:-latest}"
PLATFORMS="linux/amd64,linux/arm64"
BUILDER_NAME="nowen-multiplatform"

echo "========================================="
echo "  NowenReader 多平台构建"
echo "  镜像: ${IMAGE_NAME}:${VERSION}"
echo "  平台: ${PLATFORMS}"
echo "========================================="

# 创建/使用 buildx builder（如果不存在）
if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
    echo "[build] 创建 buildx builder: ${BUILDER_NAME}"
    docker buildx create --name "${BUILDER_NAME}" --use --driver docker-container --bootstrap
else
    echo "[build] 使用已有 builder: ${BUILDER_NAME}"
    docker buildx use "${BUILDER_NAME}"
fi

# 构建标签
TAGS="-t ${IMAGE_NAME}:${VERSION}"
if [ "${VERSION}" != "latest" ]; then
    TAGS="${TAGS} -t ${IMAGE_NAME}:latest"
fi

# 获取 Git 信息
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "[build] Git commit: ${GIT_COMMIT}"
echo "[build] Build time: ${BUILD_TIME}"
echo "[build] 开始多平台构建并推送..."
echo ""

# 构建并推送
docker buildx build \
    --platform "${PLATFORMS}" \
    ${TAGS} \
    --build-arg VERSION="${VERSION}" \
    --build-arg GIT_COMMIT="${GIT_COMMIT}" \
    --build-arg BUILD_TIME="${BUILD_TIME}" \
    --push \
    .

echo ""
echo "========================================="
echo "  ✅ 构建并推送成功!"
echo "  ${IMAGE_NAME}:${VERSION}"
echo "  支持平台: ${PLATFORMS}"
echo "========================================="
echo ""
echo "在目标机器上拉取:"
echo "  docker pull ${IMAGE_NAME}:${VERSION}"
echo "  docker compose up -d"
