# Configuration

English · [简体中文](./CONFIGURATION.md)

## Environment Variables

| Variable | Default | Description |
|:---|:---|:---|
| `PORT` | `3000` | HTTP listen port |
| `DATABASE_URL` | `./data/nowen-reader.db` | SQLite database file path |
| `COMICS_DIR` | `./comics` | Manga main directory |
| `NOVELS_DIR` | `./novels` | Novels main directory |
| `DATA_DIR` | `./.cache` | Data/cache directory (thumbnails, page cache, `site-config.json`, `ai-config.json`) |
| `FRONTEND_DIR` | — | Path to standalone frontend build output (dev only); leave empty in production to use the embedded frontend |
| `GIN_MODE` | `debug` | Gin mode (`debug` for verbose logs / `release` for silent) |
| `TZ` | `Asia/Shanghai` | Timezone |
| `PUID` / `PGID` | `1001` / `1001` | UID / GID of the in-container process (for bind-mount permission) |

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

## Multiple Manga/Novel Directories

1. **Docker**: Mount additional host directories into the container in `docker-compose.yml`:

   ```yaml
   volumes:
     - /your/manga/path1:/mnt/manga
     - /your/manga/path2:/mnt/comics2
   ```

2. Add the in-container paths under **Settings → Extra Manga Directories / Extra Novel Directories** in the web UI
3. The system will scan all configured directories automatically

## Related Documents

- 📦 [Installation Guide](./INSTALL.en.md)
- 📚 [FAQ](./FAQ.md)
- 🛠️ [Development Guide](./DEVELOPMENT.md)
