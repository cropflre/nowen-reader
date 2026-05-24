# NowenReader

<p align="center">
  <img src="https://img.shields.io/github/license/cropflre/nowen-reader?style=flat-square" alt="License" />
  <img src="https://img.shields.io/github/stars/cropflre/nowen-reader?style=flat-square" alt="Stars" />
  <img src="https://img.shields.io/docker/pulls/cropflre/nowen-reader?style=flat-square" alt="Docker Pulls" />
  <img src="https://img.shields.io/docker/image-size/cropflre/nowen-reader/latest?style=flat-square" alt="Image Size" />
  <img src="https://img.shields.io/badge/Go-1.23-00ADD8?style=flat-square&logo=go" alt="Go" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React" />
</p>

<p align="center">
  <strong>High-performance self-hosted manga & novel management and reading platform</strong><br>
  Single Go binary · Lightweight · AI-powered · NAS-friendly
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="./docs/INSTALL.en.md">Installation</a> •
  <a href="./docs/CONFIGURATION.en.md">Configuration</a> •
  <a href="./docs/API.md">API</a> •
  <a href="./docs/DEVELOPMENT.md">Development</a> •
  <a href="./docs/FAQ.md">FAQ</a>
</p>

---

## 💡 Introduction

NowenReader is a self-hosted manga / novel management and reading platform optimized for NAS and personal server environments.

| 🏆 Highlights | Description |
|:---|:---|
| 💾 **Ultra Lightweight** | Runs smoothly with 512 MB memory limit; Docker image only ~30 MB |
| 📦 **Zero Dependency** | Compiled into a single static Go binary with embedded frontend (`go:embed`) |
| 🐳 **One-click Docker** | Three Compose configurations: generic, production, NAS |
| 🤖 **AI-powered (optional)** | 17+ LLM providers supported, including major Chinese models |
| 📚 **Full Format Support** | Manga: ZIP / CBZ / CBR / RAR / 7Z / CB7 / PDF · Novels: TXT / EPUB / MOBI / AZW3 / HTML |
| 🌐 **Bilingual UI** | Chinese / English interface with metadata translation |
| 📱 **Multi-platform** | Web PWA + Flutter native client (Android / iOS / Desktop) |
| 🏗️ **Multi-arch** | amd64 / arm64; covers mainstream NAS (Synology, QNAP, UGreen, TerraMaster, etc.) |

## ✨ Features

- **📚 Content Management** — Multi-format, auto-scan, tags & categories, group merging, favorites & ratings, reading status, metadata editing, file upload, batch operations, duplicate detection, invalid cleanup
- **🔍 Metadata Scraping** — AniList / Bangumi / MangaDex / MangaUpdates / Kitsu; ComicInfo.xml & novel metadata extraction
- **🤖 AI Assistance (optional)** — Semantic search, smart summary, tag/category suggestions, cover analysis, filename parsing, reading insights, AI chat, chapter summary, page translation, etc.
- **📖 Reading Experience** — Single/double-page, webtoon mode, novel chapters, PDF rendering, continue reading, reading stats & goals, data export
- **📡 Protocol Integration** — OPDS support (KOReader / Moon+ Reader, etc.)
- **📱 Multi-platform** — Web PWA + Flutter native client (Material 3, gesture zoom, immersive reading, progress sync)
- **🛠️ Deploy-friendly** — Single Go binary, SQLite (WAL + FTS5), multi-arch Docker, i18n, theming, responsive

## 🚀 Quick Start

Three steps to a minimal deployment:

```bash
# 1. Download the production compose file
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.prod.yml

# 2. Start the container
docker compose -f docker-compose.prod.yml up -d

# 3. Open in browser
# http://localhost:6680
```

On first visit you'll be prompted to register an admin account. Place manga in `./comics/` and novels in `./novels/` to enable auto-scanning.

> 🔧 Need a different deployment method? See the [Installation Guide](./docs/INSTALL.en.md) (NAS / source build / binary / Docker Hub).

## 📚 Documentation

| Document | Content |
|:---|:---|
| [Installation Guide](./docs/INSTALL.en.md) | 5 deployment methods: Docker Hub, NAS, source build, binary, Docker Compose |
| [Configuration](./docs/CONFIGURATION.en.md) | Environment variables, site settings, AI config, scanner parameters, supported formats |
| [API Reference](./docs/API.md) | Full RESTful API documentation |
| [Development Guide](./docs/DEVELOPMENT.md) | Prerequisites, project structure, Makefile, tech stack, CI/CD |
| [FAQ](./docs/FAQ.md) | Common questions about deployment, permissions, thumbnails, PDF, AI, OPDS |
| [Flutter Client](./flutter_app/README.md) | Mobile development & build instructions |

## 📸 Screenshots

### Desktop

<table>
  <tr>
    <td align="center"><b>List View (Light)</b></td>
    <td align="center"><b>Grid View (Light)</b></td>
  </tr>
  <tr>
    <td><img src="./docs/桌面端1.png" alt="Desktop - List View (Light)" /></td>
    <td><img src="./docs/桌面端2.png" alt="Desktop - Grid View (Light)" /></td>
  </tr>
  <tr>
    <td align="center"><b>Grid View (Dark)</b></td>
    <td align="center"><b>List View (Dark)</b></td>
  </tr>
  <tr>
    <td><img src="./docs/桌面端夜间模式.png" alt="Desktop - Grid View (Dark)" /></td>
    <td><img src="./docs/桌面端夜间模式%20(2).png" alt="Desktop - List View (Dark)" /></td>
  </tr>
</table>

### Admin Panel

<p align="center">
  <img src="./docs/桌面端后台.png" alt="Admin Panel - File Statistics" width="90%" />
</p>

### Mobile / PWA

<p align="center">
  <img src="./docs/移动端1.png" alt="Mobile PWA UI" width="40%" />
</p>

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  NowenReader Architecture                │
├──────────────────────┬──────────────────────────────────┤
│   Frontend (SPA)     │   Backend (Go)                   │
│  React 19 + Vite 6   │   Gin + SQLite (WAL + FTS5)      │
│  Tailwind CSS v4     │   ┌─────────────────────────┐    │
│  React Router v7     │   │ Handler / Middleware    │    │
│  PDF.js              │   │ Service / Store         │    │
│                      │   │ Archive (ZIP/RAR/7Z/..) │    │
│  go:embed ──────────►│   └─────────────────────────┘    │
├──────────────────────┼──────────────────────────────────┤
│   Flutter App        │      ← HTTP API →                │
│  (Android / iOS)     │                                  │
└──────────────────────┴──────────────────────────────────┘
```

## 🛠️ Tech Stack

- **Backend**: Go 1.23 · Gin · SQLite (`modernc.org/sqlite`) · FTS5 · fsnotify · go:embed
- **Frontend**: React 19 · Vite 6 · TypeScript 5 · Tailwind CSS v4 · React Router v7 · PDF.js
- **Mobile**: Flutter 3.x · Riverpod 2.x · GoRouter · Dio · Material 3
- **Deploy**: Multi-stage Docker (~30 MB) · amd64 + arm64 · GitHub Actions CI/CD

## 🤝 Contributing

All forms of contribution are welcome:

- 🐛 [Report a Bug](https://github.com/cropflre/nowen-reader/issues)
- 💡 [Start a Discussion](https://github.com/cropflre/nowen-reader/discussions)
- 🔧 Submit a Pull Request
- 🌐 Add new translations
- 📖 Improve documentation

See the [Development Guide](./docs/DEVELOPMENT.md) for the workflow.

## ⭐ Star History

If this project helps you, please consider starring it ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=cropflre/nowen-reader&type=Date)](https://star-history.com/#cropflre/nowen-reader&Date)

## 📮 Contact

- 🐛 Bug / Feature: [GitHub Issues](https://github.com/cropflre/nowen-reader/issues) / [Discussions](https://github.com/cropflre/nowen-reader/discussions)

## 📄 License

This project is licensed under the [GNU General Public License v3.0](./LICENSE) (GPL-3.0). Derivative works distributed externally must also be open-sourced under GPL-3.0 with the original copyright notice and full license text preserved.
