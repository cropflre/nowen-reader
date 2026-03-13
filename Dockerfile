# ============================================================
# NowenReader - Multi-stage Docker Build
# Builds the complete application: frontend SPA + Go backend
# Final image: ~30MB (Alpine + static binary + frontend assets)
# ============================================================

# --- Stage 1: Build frontend (optional, skip if no frontend/) ---
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Copy frontend source if it exists
# If your frontend is in a separate repo, either:
#   1. Build it externally and copy to web/dist/ before docker build
#   2. Include it as a submodule at frontend/
COPY frontend/package*.json ./
RUN npm ci --production=false 2>/dev/null || true

COPY frontend/ ./
RUN npm run build 2>/dev/null || mkdir -p /frontend/dist

# --- Stage 2: Build Go backend ---
FROM golang:1.23-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

# Copy source
COPY . .

# Resolve dependencies (tidy ensures go.sum is correct)
RUN go mod tidy && go mod download

# Copy frontend build output into web/dist/ for embedding
COPY --from=frontend-builder /frontend/dist/ ./web/dist/
# Ensure dist/ has at least one file so go:embed doesn't fail on empty dir
RUN if [ -z "$(ls -A ./web/dist/ 2>/dev/null)" ]; then echo "no frontend" > ./web/dist/.gitkeep; fi

# Build static binary with version info
ARG VERSION=docker
ARG BUILD_TIME
ARG GIT_COMMIT

RUN BUILD_TIME=${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)} && \
    GIT_COMMIT=${GIT_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")} && \
    CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w \
      -X main.Version=${VERSION} \
      -X main.BuildTime=${BUILD_TIME} \
      -X main.GitCommit=${GIT_COMMIT}" \
    -o nowen-reader ./cmd/server

# ============================================================
# Stage 3: Runtime (minimal image)
# ============================================================
FROM alpine:3.20

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
RUN apk add --no-cache \
    p7zip \
    mupdf-tools \
    libwebp-tools \
    tini \
    ca-certificates \
    tzdata

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/nowen-reader .

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories with correct permissions
RUN mkdir -p /data /app/comics /app/.cache/thumbnails /app/.cache/pages && \
    chown -R appuser:appgroup /data /app /app/comics /app/.cache

# Environment defaults
ENV GIN_MODE=release \
    PORT=3000 \
    DATABASE_URL=/data/nowen-reader.db \
    COMICS_DIR=/app/comics \
    DATA_DIR=/app/.cache \
    TZ=Asia/Shanghai

EXPOSE 3000

# Declare volumes for persistent data
VOLUME ["/data", "/app/comics", "/app/.cache"]

USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/docker-entrypoint.sh"]
