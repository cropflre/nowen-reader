# Configuration

English · [简体中文](./CONFIGURATION.md)

## Environment Variables

| Variable | Default | Description |
|:---|:---|:---|
| `PORT` | `3000` | HTTP listen port |
| `BASE_PATH` | `/` | Subpath deployment prefix (e.g., `/reader` or `/reader/`, default empty/`/` for root) |
| `TRUST_PROXY_HEADERS` | `false` | Trust `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-Prefix`; enable only behind a trusted reverse proxy |
| `DATABASE_URL` | `./data/nowen-reader.db` | SQLite database file path |
| `COMICS_DIR` | `./comics` | Manga main directory |
| `NOVELS_DIR` | `./novels` | Novels main directory |
| `DATA_DIR` | `./.cache` | Data/cache directory (thumbnails, page cache, `site-config.json`, `ai-config.json`) |
| `FRONTEND_DIR` | — | Path to standalone frontend build output (dev only); leave empty in production to use the embedded frontend |
| `GIN_MODE` | `debug` | Gin mode (`debug` for verbose logs / `release` for silent) |
| `TZ` | `Asia/Shanghai` | Timezone |
| `PUID` / `PGID` | `1001` / `1001` | UID / GID of the in-container process (for bind-mount permission) |
| `UMASK` | `0002` | Permission mask for files/directories created in Docker; `0002` is suitable for group-writable NAS/shared folders |
| `PERMISSION_FIX_MODE` | `auto` | Docker startup permission repair mode: `auto` repairs automatically, `relaxed` falls back to broader permissions when NAS/SMB/NFS cannot `chown`, `off` only checks writability |

## Subpath Deployment

Set `BASE_PATH=/reader` in Docker to mount the Web UI, API, PWA, and OPDS under `/reader`:

```yaml
environment:
  - BASE_PATH=/reader
  - TRUST_PROXY_HEADERS=true
```

Enable `TRUST_PROXY_HEADERS` only when the service is behind a trusted reverse proxy. Nginx example:

```nginx
location /reader/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The proxy must preserve the `/reader` prefix instead of stripping it. After deployment, use `/reader/api/health` to verify the service.

## Site Settings

Modify via the **Settings** panel in the web UI, or edit `{DATA_DIR}/site-config.json` directly:

```json
{
  "siteName": "NowenReader",
  "comicsDir": "/app/comics",
  "extraComicsDirs": ["/mnt/manga", "/mnt/comics2"],
  "novelsDir": "/app/novels",
  "extraNovelsDirs": ["/mnt/novels2"],
  "thumbnailWidth": 400,
  "thumbnailHeight": 560,
  "pageSize": 24,
  "language": "zh-CN",
  "theme": "dark",
  "registrationMode": "open",
  "scannerConfig": {
    "syncCooldownSec": 30,
    "fsDebounceMs": 2000,
    "fullSyncBatchSize": 50,
    "quickSyncIntervalSec": 60,
    "fullSyncIntervalSec": 120,
    "md5Workers": 2
  }
}
```

### Scanner Parameters

| Parameter | Default | Description |
|:---|:---|:---|
| `syncCooldownSec` | 30 | Minimum cooldown between two syncs (seconds) |
| `fsDebounceMs` | 2000 | Debounce delay after file changes before triggering a sync (ms) |
| `fullSyncBatchSize` | 50 | Number of items per batch in full sync |
| `quickSyncIntervalSec` | 60 | Quick sync polling interval (seconds), as a fallback for fsnotify |
| `fullSyncIntervalSec` | 120 | Full sync interval (seconds); handles page counting and MD5 |
| `md5Workers` | 2 | Concurrency for MD5 computation; recommended 1–2 for network mounts |

### Registration Mode

| Value | Description |
|:---|:---|
| `open` | Open registration (default) — anyone can register |
| `invite` | Invite-only — admin must generate invite codes |
| `closed` | Closed — only admins can create accounts |

## AI Configuration

Configure via the **Settings → AI** panel in the web UI, or edit `{DATA_DIR}/ai-config.json`. AI features are completely optional; not configuring them does not affect any core functionality.

**International providers**: OpenAI / Anthropic / Google Gemini / Groq / Mistral / Cohere / Together AI / Perplexity / Fireworks, etc.

**Chinese providers**: Tongyi Qianwen / DeepSeek / Zhipu GLM / Baichuan / Moonshot Kimi / 01.AI / MiniMax / iFlytek Spark, etc.

Open **Settings → AI**, select a provider, enter API Key, choose a model, click "Test Connection" to verify, then save.

## Supported File Formats

| Type | Formats |
|:---|:---|
| Manga / Archive | `.zip` `.cbz` `.cbr` `.rar` `.7z` `.cb7` `.pdf` `.azw3` |
| Novel / E-book | `.txt` `.epub` `.mobi` `.azw3` `.html` `.htm` |
| Images (in archives) | `.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.avif` |

## External Dependencies (Bundled in Docker)

| Tool | Purpose | Required |
|:---|:---|:---|
| `p7zip` | Extracting .7z / .cb7 files | Optional |
| `mupdf-tools` (mutool) | PDF page rendering | Optional |
| `libwebp-tools` (cwebp) | WebP thumbnail generation | Optional (falls back to JPEG) |

> The Docker image bundles all dependencies. When installing manually, install them as needed.

## Library Management & Multi-Directory Setup (Recommended)

The new version supports creating independent libraries (manga, novel, mixed) in **Admin Panel → Library Management**, each with:

| Setting | Description |
|:---|:---|
| `rootPath` | Library root directory (with directory browser) |
| `defaultAccess` | Access control: `public` (all logged-in users) / `private` (authorized users only) |
| `scanEnabled` | Whether to include in automatic scanning |

Admins can also assign per-user or per-group library access for **multi-user resource isolation**.

### Legacy Directory Configuration

The legacy `ComicsDir`, `ExtraComicsDirs`, `NovelsDir`, `ExtraNovelsDirs` environment variables and "Site Settings → Extra Manga Directories" still work, but Library Management is recommended.

1. **Docker**: Mount additional host directories into the container in `docker-compose.yml`:

   ```yaml
   volumes:
     - /your/manga/path1:/mnt/manga
     - /your/manga/path2:/mnt/comics2
   ```

2. Create a library in **Admin Panel → Library Management** and select the matching **container path**, such as `/mnt/manga`; do not enter the host path `/your/manga/path1`
3. The system will scan all enabled libraries with scanEnabled=true

## Related Documents

- 📦 [Installation Guide](./INSTALL.en.md)
- 📚 [FAQ](./FAQ.md)
- 🛠️ [Development Guide](./DEVELOPMENT.md)
