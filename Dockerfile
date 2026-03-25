# ============================================================
# NowenReader - Multi-stage Docker Build (Multi-platform)
# Builds the complete application: frontend SPA + Go backend
# Supports: linux/amd64, linux/arm64
# Final image: ~30MB (Alpine + static binary + frontend assets)
# ============================================================

# --- Stage 1: Build frontend (optional, skip if no frontend/) ---
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Copy frontend source if it exists
# If your frontend is in a separate repo, either:
#   1. Build it externally and copy to web/dist/ before docker build
#   2. Include it as a submodule at frontend/
COPY frontend/package*.json ./
# Use China npm mirror for faster & more reliable access
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci --production=false

COPY frontend/ ./
RUN npm run build && \
    echo "[frontend] Build succeeded" && \
    ls -la /frontend/dist/ && \
    test -f /frontend/dist/index.html && echo "[frontend] index.html found ✅" || \
    (echo "[frontend] ERROR: index.html not found in dist/" && exit 1)

# --- Stage 2: Build Go backend ---
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS builder

# Multi-platform build args (automatically set by Docker buildx)
ARG TARGETPLATFORM
ARG TARGETOS=linux
ARG TARGETARCH

# Use Aliyun mirror for faster & more reliable access in China
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache git

WORKDIR /build

# Use China Go module proxy for faster & more reliable access
ENV GOPROXY=https://goproxy.cn,direct

# Copy source
COPY . .

# Resolve dependencies (tidy ensures go.sum is correct)
RUN go mod tidy && go mod download

# Copy frontend build output into web/dist/ for embedding
COPY --from=frontend-builder /frontend/dist/ ./web/dist/
# Ensure dist/ has at least one file so go:embed doesn't fail on empty dir
RUN if [ -z "$(ls -A ./web/dist/ 2>/dev/null)" ]; then echo "no frontend" > ./web/dist/.gitkeep; fi

# Build static binary with version info
# Uses TARGETOS/TARGETARCH for cross-compilation (supports amd64 + arm64)
ARG VERSION=docker
ARG BUILD_TIME
ARG GIT_COMMIT

RUN BUILD_TIME=${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)} && \
    GIT_COMMIT=${GIT_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")} && \
    echo "[build] Target platform: ${TARGETOS}/${TARGETARCH}" && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags="-s -w \
      -X main.Version=${VERSION} \
      -X main.BuildTime=${BUILD_TIME} \
      -X main.GitCommit=${GIT_COMMIT}" \
    -o nowen-reader ./cmd/server

# ============================================================
# Stage 3: Runtime (minimal image)
# ============================================================
FROM --platform=$TARGETPLATFORM alpine:3.20

LABEL maintainer="NowenReader"
LABEL description="NowenReader - Self-hosted comic management platform"

# Install runtime deps:
# - p7zip: for .7z/.cb7 archive extraction (also RAR fallback)
# - mupdf-tools: for PDF page rendering (mutool draw)
# - libwebp-tools: for thumbnail WebP conversion (cwebp)
# - tini: proper PID 1 signal handling
# - ca-certificates: for HTTPS requests (metadata scrapers, AI APIs)
# - tzdata: timezone support
# Note: calibre (ebook-convert) is NOT available in Alpine repos.
#       MOBI/AZW3 support is optional; mount ebook-convert binary or install via pip if needed.
# Use Aliyun mirror for faster & more reliable access in China
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache \
    p7zip \
    mupdf-tools \
    libwebp-tools \
    tini \
    su-exec \
    ca-certificates \
    tzdata

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/nowen-reader .

# Copy entrypoint script (sed removes Windows CRLF line endings if present)
COPY --chown=appuser:appgroup docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod 755 /docker-entrypoint.sh

# Create data directories with correct permissions
RUN mkdir -p /data /app/comics /app/novels /app/.cache/thumbnails /app/.cache/pages && \
    chown -R appuser:appgroup /data /app /app/comics /app/novels /app/.cache

# Environment defaults
ENV GIN_MODE=release \
    PORT=3000 \
    DATABASE_URL=/data/nowen-reader.db \
    COMICS_DIR=/app/comics \
    NOVELS_DIR=/app/novels \
    DATA_DIR=/app/.cache \
    TZ=Asia/Shanghai

EXPOSE 3000

# Declare volumes for persistent data
VOLUME ["/data", "/app/comics", "/app/novels", "/app/.cache"]

# Note: NOT using USER appuser here.
# entrypoint runs as root to fix bind-mount permissions,
# then drops to appuser via su-exec before starting the server.

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/docker-entrypoint.sh"]
