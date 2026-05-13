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
  <strong>高性能自托管漫画 & 小说管理阅读平台</strong><br>
  Go 单二进制构建 · 轻量极速 · AI 智能辅助 · NAS 友好
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="./docs/INSTALL.md">安装指南</a> •
  <a href="./docs/CONFIGURATION.md">配置说明</a> •
  <a href="./docs/API.md">API</a> •
  <a href="./docs/DEVELOPMENT.md">开发</a> •
  <a href="./docs/FAQ.md">FAQ</a>
</p>

---

> **问题反馈 QQ 群：`1093473044`**

## 💡 项目简介

NowenReader 是一个专为 NAS 与个人服务器场景优化的自托管漫画 / 小说管理阅读平台。

| 🏆 核心优势 | 说明 |
|:---|:---|
| 💾 **极致轻量** | 内存限制 512 MB 即可流畅运行，Docker 镜像仅约 30 MB |
| 📦 **零依赖部署** | Go 编译为单个静态二进制，前端通过 `go:embed` 嵌入其中 |
| 🐳 **Docker 一键启动** | 提供通用、生产、NAS 三种 Compose 配置 |
| 🤖 **AI 智能辅助** | 可选接入 17+ LLM 供应商（含主流国内大模型） |
| 📚 **全格式覆盖** | 漫画 ZIP / CBZ / CBR / RAR / 7Z / CB7 / PDF；小说 TXT / EPUB / MOBI / AZW3 / HTML |
| 🌐 **中文原生支持** | 中英双语界面、元数据中英翻译 |
| 📱 **多端访问** | Web PWA + Flutter 原生客户端（Android / iOS / 桌面） |
| 🏗️ **多平台架构** | amd64 / arm64，覆盖主流 NAS（群晖、威联通、绿联、铁威马等） |

## ✨ 核心特性

- **📚 内容管理** — 多格式支持、自动扫描入库、标签 & 分类、合并分组、收藏 & 评分、阅读状态、元数据编辑、文件上传、批量操作、重复检测、无效清理
- **🔍 元数据抓取** — AniList / Bangumi / MangaDex / MangaUpdates / Kitsu 五大数据源，支持 ComicInfo.xml 和小说元数据自动提取
- **🤖 AI 智能辅助（可选）** — 语义搜索、智能摘要、标签 / 分类建议、封面分析、文件名解析、阅读洞察、AI 对话、章节摘要、页面翻译等 18 项能力
- **📖 阅读体验** — 漫画多种阅读模式（单页/双页/条漫/Webtoon）、小说章节渲染、PDF 渲染、继续阅读、阅读统计、阅读目标、数据导出
- **📡 协议集成** — 支持 OPDS（KOReader / Moon+ Reader 等阅读器远程串流）
- **📱 多端支持** — Web PWA + Flutter 原生客户端（Material 3 设计、手势缩放、沉浸式阅读、阅读进度同步）
- **🛠️ 部署友好** — Go 单二进制、SQLite 零配置（WAL + FTS5）、Docker 多平台镜像、多语言、深浅主题、响应式布局

## 🚀 快速开始

三步完成最小化部署：

```bash
# 1. 下载生产配置
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.prod.yml

# 2. 一键启动
docker compose -f docker-compose.prod.yml up -d

# 3. 打开浏览器访问
# http://localhost:6680
```

首次访问会引导注册管理员账号。将漫画放入 `./comics/`、小说放入 `./novels/` 目录即可自动扫描入库。

> 🔧 需要其他部署方式？参见 [安装指南](./docs/INSTALL.md)（NAS / 源码构建 / 二进制 / Docker Hub）。

## 📚 文档导航

| 文档 | 内容 |
|:---|:---|
| [安装指南](./docs/INSTALL.md) | 5 种部署方式：Docker Hub、NAS、源码构建、二进制、Docker Compose |
| [配置说明](./docs/CONFIGURATION.md) | 环境变量、站点设置、AI 配置、扫描器参数、支持格式 |
| [API 文档](./docs/API.md) | 完整的 RESTful API 参考 |
| [开发指南](./docs/DEVELOPMENT.md) | 前置条件、项目结构、Makefile 命令、技术栈、CI/CD |
| [常见问题](./docs/FAQ.md) | 部署、权限、缩略图、PDF、AI、OPDS 等常见问题 |
| [Flutter 客户端](./flutter_app/README.md) | 移动端开发与构建说明 |

## 📸 界面预览

### 桌面端

<table>
  <tr>
    <td align="center"><b>列表视图（浅色）</b></td>
    <td align="center"><b>网格视图（浅色）</b></td>
  </tr>
  <tr>
    <td><img src="./docs/桌面端1.png" alt="桌面端 - 列表视图（浅色）" /></td>
    <td><img src="./docs/桌面端2.png" alt="桌面端 - 网格视图（浅色）" /></td>
  </tr>
  <tr>
    <td align="center"><b>网格视图（深色）</b></td>
    <td align="center"><b>列表视图（深色）</b></td>
  </tr>
  <tr>
    <td><img src="./docs/桌面端夜间模式.png" alt="桌面端 - 网格视图（深色）" /></td>
    <td><img src="./docs/桌面端夜间模式%20(2).png" alt="桌面端 - 列表视图（深色）" /></td>
  </tr>
</table>

### 后台管理

<p align="center">
  <img src="./docs/桌面端后台.png" alt="后台管理 - 文件统计" width="90%" />
</p>

### 移动端 / PWA

<p align="center">
  <img src="./docs/移动端1.png" alt="移动端 PWA 界面" width="40%" />
</p>

## 🏗️ 架构概览

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

## 🛠️ 技术栈

- **后端**：Go 1.23 · Gin · SQLite (`modernc.org/sqlite`) · FTS5 · fsnotify · go:embed
- **前端**：React 19 · Vite 6 · TypeScript 5 · Tailwind CSS v4 · React Router v7 · PDF.js
- **移动端**：Flutter 3.x · Riverpod 2.x · GoRouter · Dio · Material 3
- **部署**：Docker 多阶段构建（约 30 MB） · amd64 + arm64 · GitHub Actions CI/CD

> 详细技术栈与版本说明参见 [开发指南](./docs/DEVELOPMENT.md#技术栈)。

## 🤝 参与贡献

欢迎以任何形式参与贡献：

- 🐛 [提交 Bug](https://github.com/cropflre/nowen-reader/issues)
- 💡 [发起 Discussion](https://github.com/cropflre/nowen-reader/discussions)
- 🔧 提交 Pull Request
- 🌐 国际化翻译
- 📖 完善文档

详细开发流程参见 [开发指南](./docs/DEVELOPMENT.md)。

## ⭐ Star History

如果这个项目对你有帮助，欢迎点一个 Star ⭐ 支持一下！

[![Star History Chart](https://api.star-history.com/svg?repos=cropflre/nowen-reader&type=Date)](https://star-history.com/#cropflre/nowen-reader&Date)

## 📮 联系方式

- 🐛 Bug / 功能建议：[GitHub Issues](https://github.com/cropflre/nowen-reader/issues) / [Discussions](https://github.com/cropflre/nowen-reader/discussions)
- 💬 QQ 交流群：**1093473044**

## 📄 开源协议

本项目采用 [GNU General Public License v3.0](./LICENSE)（GPL-3.0）开源协议发布。基于本项目的派生作品在对外分发时必须同样以 GPL-3.0 协议开源，并保留原作者版权声明与许可证全文。
