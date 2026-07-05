# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NowenReader — a self-hosted manga/comic/novel management and reading platform. Go single-binary backend with embedded React SPA frontend, plus Flutter mobile apps.

## Build & Run Commands

```bash
# Backend
make dev                    # Run dev server (hot-reload with go run)
make build                  # Build native binary
make build-static           # CGO_ENABLED=0 static binary
make test                   # All tests with -race
make test-short             # Tests without -race
make test-cover             # Coverage report
make lint                   # golangci-lint
make fmt                    # go fmt + goimports
go test ./internal/store -run TestTitleSort -v  # Single test

# Frontend (separate dev)
cd frontend && npm install && npm run dev

# Full build with embedded frontend
make build-full

# Docker
make docker                 # Build Docker image
docker compose up -d        # Start with Docker Compose
```

## Project Structure

```
cmd/
  server/              # Main server entrypoint (Gin setup, graceful shutdown)
  migrate/             # Standalone DB migration tool (from Prisma schema)
  dbcheck/             # Database integrity checker

internal/
  config/              # Site config (JSON-based, TTL-cached), env vars, file type detection
  model/               # All data types: User, Comic, ComicGroup, Tag, Category, ReadingSession, etc.
  store/               # SQLite data access layer (db.go init + per-domain files)
    db.go              # DB init, WAL pragmas, FTS5, connection pool
    migrate.go         # Schema migrations
    comic_store.go     # CRUD for comics
    comic_query.go     # Complex queries (filtering, search, sorting)
    comic_batch.go     # Batch operations
    comic_stats.go     # Aggregation queries
    group_*.go         # ComicGroup CRUD, detection, cleanup, categorization
    library_store.go   # Library (scan root) management
    library_access_*.go # User-library access control
    user_store.go      # User CRUD
    user_group_store.go # User group management
    stats_store.go     # Reading stats & goals
    sync_store.go      # Sync state tracking
    title_sort.go      # Title sorting (SQL function)
    scan_rule_log.go   # Scan rule audit log
  service/             # Business logic layer
    scanner.go         # File system scanner (fsnotify watcher + periodic full-scan)
    comic_parser.go    # Archive file parsing (ZIP, RAR, 7Z, etc.)
    archive/           # (separate package) Archive format readers
    metadata_*.go      # Metadata scraping (AniList, Bangumi, MangaDex, Kitsu, MangaUpdates, Google Books)
    ai_*.go            # AI integration (LLM clients, semantic search, summarization, translation, etc.)
    audiobook_prepare.go # Audiobook processing
    opds.go            # OPDS protocol server
    scan_rules.go      # Post-scan rules engine (AI infer, grouping, directory organize)
    translate_engine.go # Translation engine
    recommendation.go  # Content recommendations
    data_qa.go         # Data quality validation & repair
  handler/             # HTTP handlers (Gin controllers)
    router.go          # Top-level route registration
    routes_*.go        # Route group definitions
    auth.go            # Auth (login, register, sessions)
    comic.go           # Comic CRUD endpoints
    images.go          # Page image streaming
    settings.go        # Site settings
    library_handler.go # Library management
    group_*.go         # Comic group endpoints
    metadata_*.go      # Metadata endpoints
    ai_*.go            # AI feature endpoints
    opds_handler.go    # OPDS endpoint
    spa.go             # SPA static file serving
    data_admin.go      # Storage management
    data_qa.go         # Data QA endpoints
    browse.go          # Directory browser
    export_handler.go  # Data export (JSON/CSV)
    stats.go           # Reading stats endpoints
    tags.go / categories.go / thumbnails.go / upload.go / etc.
  middleware/          # Gin middleware
    auth.go            # Session/auth check
    cors.go / gzip.go / ratelimit.go / security.go / timeout.go / logger.go / error_log.go / scraper.go

web/
  embed.go             # go:embed for production frontend build

frontend/              # React SPA (Vite + TypeScript + Tailwind CSS v4)
  src/
    api/               # API client modules (comics, groups, libraries, etc.)
    app/               # Route pages
    components/        # Shared UI components
    hooks/             # React hooks
    types/             # TypeScript type definitions

flutter_app/           # Flutter mobile app (Android/iOS/desktop)
  lib/
  test/

docs/                  # Documentation (API.md, INSTALL.md, CONFIGURATION.md, DEVELOPMENT.md, FAQ.md)
```

## Architecture

- **Layered**: `handler (HTTP) → service (business logic) → store (SQLite)`. Handlers parse requests and call services; services hold logic and coordinate across stores; stores do raw SQL.
- **SQLite via modernc.org/sqlite**: CGO-free pure Go SQLite. WAL mode + FTS5 full-text search. Connection pool with max 8 open connections.
- **Frontend embedded**: React SPA built into the Go binary via `go:embed` at `web/embed.go`. In dev, set `FRONTEND_DIR` env var to serve from a separate directory.
- **File scanning**: fsnotify watches library directories for changes; periodic full-scan runs as fallback. Scanner detects comics (ZIP/CBZ/RAR/7Z/CBR/CB7/PDF) and novels (TXT/EPUB/MOBI/AZW3/HTML).
- **Archive parsing**: `internal/service/comic_parser.go` handles archive reading + thumbnail generation + page caching. Backed by `internal/archive/` for format-specific readers.
- **Metadata scraping**: Multiple providers. Each provider is a service file (e.g., `metadata_anilist.go`). Unified query flow in `metadata_query.go` + relevance scoring.
- **AI integration**: Modular LLM client system in `ai_llm.go` supporting 17+ providers. Features: semantic search, metadata inference, summarization, chat, translation, image analysis, recommendations.
- **Multi-user**: Sessions stored in DB with expiry cleanup. Role-based access (admin/user). Per-library access control with user groups.
- **Scan Rules**: Post-scan pipeline for AI title inference, virtual grouping, and directory organization. Configurable via `site-config.json`.

## Key Configuration

- **Environment**: `DATA_DIR` (default .cache), `DATABASE_URL` (default ./data/nowen-reader.db), `COMICS_DIR`, `NOVELS_DIR`, `PORT` (default 5080), `GIN_MODE`, `FRONTEND_DIR`
- **Site config**: Stored in `{DATA_DIR}/site-config.json`, TTL-cached (5s). Contains scanner settings, AI config, scan rules, storage thresholds.
- **File types**: Defined as extension lists in `internal/config/config.go`. Archive = .zip/.cbz/.cbr/.rar/.7z/.cb7/.pdf/.azw3. Novel = .txt/.epub/.mobi/.azw3/.html. Image = .jpg/.jpeg/.png/.gif/.webp/.bmp/.avif.

## Common Patterns

- **Comic ID**: MD5 hash of the file path (relative to scan root).
- **Group ID**: Auto-increment int. ComicGroup combines multiple comics into a logical series.
- **Library ID**: UUID. Libraries define scan roots with type (comic/novel/mixed) and access control defaults.
- **Reading state**: Per-user via `UserComicState` table. Falls back to Comic table fields for single-user compatibility.
- **Migrations**: Stored in `store/migrate.go` as ordered list of SQL statements. Auto-run on startup.
- **API prefix**: All routes under `/api/v1` (or directly `/api`). Health check at `/api/health`.
- **Testing**: `_test.go` files alongside source in `store/`, `handler/`, `middleware/` packages. Use `go test ./... -v -race`.
