# ============================================================
# NowenReader - Stable Production Dockerfile
# ============================================================


# ----------------------------
# 1. Frontend build stage
# ----------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# install deps
COPY frontend/package*.json ./

RUN npm config set registry https://registry.npmmirror.com && \
    npm ci

# build frontend
COPY frontend/ .

RUN npm run build && \
    echo "frontend build done" && \
    ls -la


# ----------------------------
# 2. Go build stage
# ----------------------------
FROM golang:1.23-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /build

# optional mirror (faster in CN)
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache git

ENV GOPROXY=https://goproxy.cn,direct

# deps first (cache friendly)
COPY go.mod go.sum ./
RUN go mod download

# copy full source
COPY . .

# ----------------------------
# frontend copy (SAFE - NO TRICKS)
# ----------------------------

COPY --from=frontend-builder /frontend/dist ./web/dist
COPY --from=frontend-builder /frontend/build ./web/dist

# ensure embed never fails
RUN mkdir -p ./web/dist && \
    if [ ! -f ./web/dist/index.html ]; then \
        echo "<!doctype html><html><body>empty frontend</body></html>" > ./web/dist/index.html; \
    fi


# ----------------------------
# build metadata (from CI)
# ----------------------------
ARG VERSION=docker
ARG BUILD_TIME
ARG GIT_COMMIT

# ----------------------------
# build binary
# ----------------------------
RUN echo "[build] ${TARGETOS}/${TARGETARCH}" && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -v \
      -ldflags="-s -w \
        -X main.Version=${VERSION} \
        -X main.BuildTime=${BUILD_TIME} \
        -X main.GitCommit=${GIT_COMMIT}" \
      -o nowen-reader ./cmd/server


# ----------------------------
# 3. Runtime stage
# ----------------------------
FROM alpine:3.20

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache \
      tini \
      ca-certificates \
      tzdata \
      p7zip \
      mupdf-tools \
      libwebp-tools \
      su-exec \
      wget

# non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# binary
COPY --from=builder /build/nowen-reader .

# entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# dirs
RUN mkdir -p /data /app/comics /app/novels /app/.cache && \
    chown -R appuser:appgroup /app /data

ENV GIN_MODE=release \
    PORT=3000 \
    DATABASE_URL=/data/nowen-reader.db \
    COMICS_DIR=/app/comics \
    NOVELS_DIR=/app/novels \
    DATA_DIR=/app/.cache \
    TZ=Asia/Shanghai

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/docker-entrypoint.sh"]