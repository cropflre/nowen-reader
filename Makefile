.PHONY: build run dev clean test docker docker-push frontend all migrate

BINARY=nowen-reader
MIGRATE_BINARY=nowen-migrate
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

LDFLAGS=-ldflags "-s -w \
	-X main.Version=$(VERSION) \
	-X main.BuildTime=$(BUILD_TIME) \
	-X main.GitCommit=$(GIT_COMMIT)"

# ============================================================
# Build targets
# ============================================================

all: build

build:
	go build $(LDFLAGS) -o $(BINARY).exe ./cmd/server

build-linux:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BINARY)-linux-amd64 ./cmd/server

build-arm64:
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o $(BINARY)-linux-arm64 ./cmd/server

build-all: build build-linux build-arm64

# Static build (CGO_ENABLED=0, for Docker and standalone deployment)
build-static:
	CGO_ENABLED=0 go build $(LDFLAGS) -o $(BINARY) ./cmd/server

# ============================================================
# Run targets
# ============================================================

run: build
	./$(BINARY).exe

dev:
	go run ./cmd/server

# Dev mode with frontend directory (for development with separate frontend)
dev-with-frontend:
	FRONTEND_DIR=./frontend/dist go run ./cmd/server

# ============================================================
# Frontend targets
# ============================================================

frontend:
	@if [ -d "frontend" ]; then \
		cd frontend && npm install && npm run build; \
		rm -rf web/dist/*; \
		cp -r frontend/dist/* web/dist/; \
		echo "[OK] Frontend built and copied to web/dist/"; \
	else \
		echo "[SKIP] No frontend/ directory found"; \
	fi

# Build with embedded frontend
build-full: frontend build

# ============================================================
# Docker targets
# ============================================================

docker:
	docker build \
		--build-arg VERSION=$(VERSION) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		-t $(BINARY):$(VERSION) \
		-t $(BINARY):latest \
		.

docker-push:
	docker tag $(BINARY):latest cropflre/nowen-reader:latest
	docker tag $(BINARY):$(VERSION) cropflre/nowen-reader:$(VERSION)
	docker push cropflre/nowen-reader:latest
	docker push cropflre/nowen-reader:$(VERSION)

# Multi-platform build (amd64 + arm64, requires docker buildx)
docker-multiarch:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--build-arg VERSION=$(VERSION) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		-t cropflre/nowen-reader:$(VERSION) \
		-t cropflre/nowen-reader:latest \
		--push \
		.

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# ============================================================
# Quality targets
# ============================================================

clean:
	rm -f $(BINARY) $(BINARY).exe $(BINARY)-linux-*
	rm -f $(MIGRATE_BINARY) $(MIGRATE_BINARY).exe
	rm -f coverage.out
	go clean

test:
	go test ./... -v -race

test-short:
	go test ./... -short

test-cover:
	go test ./... -race -coverprofile=coverage.out -covermode=atomic
	go tool cover -func=coverage.out
	@echo ""
	@echo "To view HTML coverage report: go tool cover -html=coverage.out"

# ============================================================
# Migration tool
# ============================================================

migrate:
	go build $(LDFLAGS) -o $(MIGRATE_BINARY) ./cmd/migrate

migrate-run: migrate
	./$(MIGRATE_BINARY)

migrate-import: migrate
	@if [ -z "$(FROM)" ]; then \
		echo "Usage: make migrate-import FROM=/path/to/prisma/dev.db"; \
		exit 1; \
	fi
	./$(MIGRATE_BINARY) -import $(FROM)

deps:
	go mod tidy
	go mod download

fmt:
	go fmt ./...
	goimports -w .

lint:
	golangci-lint run ./...

vet:
	go vet ./...

# ============================================================
# Info targets
# ============================================================

version:
	@echo "Version:    $(VERSION)"
	@echo "Build Time: $(BUILD_TIME)"
	@echo "Git Commit: $(GIT_COMMIT)"

info: version
	@echo "Binary:     $(BINARY)"
	@echo "Go Version: $(shell go version)"
	@echo "Platform:   $(shell go env GOOS)/$(shell go env GOARCH)"
