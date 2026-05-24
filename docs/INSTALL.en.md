# Installation Guide

English · [简体中文](./INSTALL.md)

NowenReader provides 5 deployment methods. Choose the one that best fits your environment:

| Method | Use Case | Recommended |
|:---|:---|:---:|
| [Docker Hub Image](#method-1-docker-hub-image-recommended) | Most users, out-of-the-box | ⭐⭐⭐⭐⭐ |
| [NAS Deployment](#method-2-nas-deployment-synology--qnap--ugreen--terramaster) | Synology / QNAP / UGreen / TerraMaster, etc. | ⭐⭐⭐⭐⭐ |
| [Build from Source (Docker)](#method-3-build-from-source-docker) | Users needing customized builds | ⭐⭐⭐ |
| [Compile from Source](#method-4-compile-from-source) | Non-Docker environments | ⭐⭐⭐ |
| [Pre-built Binaries](#method-5-pre-built-binaries) | Run without compilation | ⭐⭐⭐⭐ |

---

## Method 1: Docker Hub Image (Recommended)

> Suitable for most users, ready out of the box.

```bash
# Download the compose file
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.prod.yml

# Start
docker compose -f docker-compose.prod.yml up -d

# Visit http://localhost:6680
```

**Update:**

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Method 2: NAS Deployment (Synology / QNAP / UGreen / TerraMaster)

> Optimized for NAS, with a 512 MB memory limit. Lightweight and reliable.

```bash
# Download the NAS compose file
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.nas.yml

# Edit and adjust paths to match your NAS
vi docker-compose.nas.yml

# Start
docker compose -f docker-compose.nas.yml up -d
```

### Volume Mapping (Synology example)

| Container Path | Host Path Example | Description |
|:---|:---|:---|
| `/data` | `/volume1/docker/nowen-reader/data` | Database (important, do not delete) |
| `/app/.cache` | `/volume1/docker/nowen-reader/cache` | Thumbnails & page cache |
| `/app/comics` | `/volume1/comics` | Manga main directory |
| `/app/novels` | `/volume1/novels` | Novels main directory (optional) |

> 💡 **Multiple directories**: If your manga/novels are scattered across folders, mount them all into the container (e.g. `/mnt/manga`, `/mnt/novels2`), then add the corresponding paths under **Settings → Extra Manga Directories / Extra Novel Directories** in the web UI.
>
> 🔑 **Permission issues**: If you encounter `permission denied` on NAS, uncomment and set `PUID` / `PGID` in the compose `environment` section to match the actual UID/GID of your host files (check via `ls -ln`).

---

## Method 3: Build from Source (Docker)

```bash
git clone https://github.com/cropflre/nowen-reader.git
cd nowen-reader

# One-click build and start
docker compose up -d

# Visit http://localhost:6680
```

---

## Method 4: Compile from Source

> For non-Docker environments or developers needing customization.

**Prerequisites**: Go 1.23+, Node.js 20+ (optional, only required for frontend builds)

```bash
git clone https://github.com/cropflre/nowen-reader.git
cd nowen-reader

# Build backend only (API-only mode, no frontend)
make build

# Build full version with frontend (recommended)
make build-full

# Run
./nowen-reader
```

---

## Method 5: Pre-built Binaries

Download the binary for your platform from [GitHub Releases](https://github.com/cropflre/nowen-reader/releases) — no compilation required:

| Platform | Filename |
|:---|:---|
| Linux x86_64 | `nowen-reader-linux-amd64` |
| Linux ARM64 | `nowen-reader-linux-arm64` |
| macOS x86_64 | `nowen-reader-darwin-amd64` |
| macOS ARM64 (Apple Silicon) | `nowen-reader-darwin-arm64` |
| Windows x86_64 | `nowen-reader-windows-amd64.exe` |

```bash
# Linux / macOS
chmod +x nowen-reader-linux-amd64
./nowen-reader-linux-amd64

# Windows
nowen-reader-windows-amd64.exe
```

---

## First Use

1. Visit `http://localhost:6680` in your browser
2. Register an admin account
3. Place manga files in the `./comics/` directory and novels in the `./novels/` directory
4. The system will scan them automatically
5. Or upload files directly via the web UI

## Next Steps

- 📖 [Configuration](./CONFIGURATION.en.md) — Environment variables, site settings, AI config
- 📚 [FAQ](./FAQ.md) — Common questions about deployment, permissions, thumbnails, etc.
- 🛠️ [Development Guide](./DEVELOPMENT.md) — Local development & contributing
