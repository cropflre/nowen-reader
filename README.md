# NowenReader

<p align="center">
  <strong>高性能自托管漫画管理平台</strong><br>
  Go 构建 — 单二进制、轻量、易部署
</p>

---

## ✨ 特性

- 🚀 **Go 单二进制** — 无需 Node.js / npm，开箱即用
- 📦 **前端嵌入** — SPA 前端编译进二进制，一个文件部署
- 🔐 **用户认证** — 多用户支持，管理员/普通用户角色
- 📚 **漫画管理** — 自动扫描、标签、分类、收藏、评分
- 🔍 **元数据抓取** — AniList / Bangumi / MangaDex / MangaUpdates / Kitsu
- 🤖 **AI 集成** — 17+ LLM 供应商，智能标签、语义搜索、封面相似度检测
- 📖 **OPDS 协议** — 支持 KOReader / Moon+ Reader 等阅读器
- 🔄 **WebDAV 同步** — 跨设备阅读进度同步
- 🎯 **个性化推荐** — 基于阅读历史的智能推荐
- 📊 **阅读统计** — 阅读时间、会话记录、每日趋势
- 🌐 **E-Hentai 集成** — 搜索、预览、下载
- 🏷️ **标签翻译** — 中英文标签自动翻译
- 🖼️ **缩略图管理** — WebP 自动生成，批量管理
- 📤 **文件上传** — 支持 ZIP/CBZ/CBR/RAR/7Z/PDF
- 🔌 **插件系统** — 内置 4 个插件，可扩展
- 💾 **SQLite** — 零配置数据库，WAL 模式高性能
- 🐳 **Docker** — 多平台镜像 (amd64/arm64)
- 📱 **PWA** — 可安装为桌面/移动应用

## 📁 项目结构

```
nowen-reader/
├── cmd/
│   ├── server/          # 主服务入口
│   │   └── main.go
│   └── migrate/         # 数据库迁移 CLI
│       └── main.go
├── internal/
│   ├── archive/         # ZIP/RAR/7Z/PDF 压缩包解析
│   ├── config/          # 配置管理（站点设置、路径、扩展名）
│   ├── handler/         # HTTP API Handler（20 个文件）
│   ├── middleware/       # 中间件（CORS、Auth、Gzip、Logger、RateLimit、Security）
│   ├── model/           # 数据模型
│   ├── service/         # 业务逻辑（AI、元数据、推荐、扫描、OPDS 等）
│   └── store/           # 数据库 CRUD + 迁移
├── web/
│   ├── embed.go         # go:embed 前端嵌入
│   └── dist/            # 前端构建产物（编译时填充）
├── Dockerfile           # 多阶段构建
├── docker-compose.yml   # 一键部署
├── Makefile             # 构建自动化
└── go.mod
```

## 🚀 快速开始

### 方式 1: Docker（推荐）

```bash
# 克隆项目
git clone https://github.com/nowen-reader/nowen-reader.git
cd nowen-reader

# 一键启动
docker compose up -d

# 访问 http://localhost:3000
```

### 方式 2: 从源码构建

```bash
# 前提条件: Go 1.23+

# 克隆
git clone https://github.com/nowen-reader/nowen-reader.git
cd nowen-reader

# 构建
make build

# 运行
./nowen-reader
```

### 方式 3: Docker 生产部署

```bash
# 使用预构建镜像
docker compose -f docker-compose.prod.yml up -d
```

### 方式 4: NAS 部署（群晖/威联通）

```bash
docker compose -f docker-compose.nas.yml up -d
```

## ⚙️ 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `DATABASE_URL` | `./data/nowen-reader.db` | SQLite 数据库路径 |
| `COMICS_DIR` | `./comics` | 漫画文件目录 |
| `DATA_DIR` | `./.cache` | 数据/缓存目录 |
| `FRONTEND_DIR` | - | 前端构建目录（开发用） |
| `GIN_MODE` | `debug` | Gin 模式 (`debug`/`release`) |

### 站点设置

运行后通过 Web UI 的设置面板修改，或直接编辑 `{DATA_DIR}/site-config.json`：

```json
{
  "siteName": "NowenReader",
  "comicsDir": "/comics",
  "extraComicsDirs": ["/comics2", "/media/manga"],
  "thumbnailWidth": 400,
  "thumbnailHeight": 560,
  "pageSize": 24,
  "language": "zh",
  "theme": "dark"
}
```

## 🔄 从 Next.js 版本迁移

如果你之前使用的是 Next.js 版本，可以无缝迁移数据：

```bash
# 使用迁移工具导入 Prisma 数据库
nowen-migrate -import /path/to/old/prisma/dev.db

# 或指定新数据库路径
nowen-migrate -db /data/nowen-reader.db -import /path/to/old/prisma/dev.db
```

迁移会自动导入：用户、漫画、标签、分类、阅读会话等所有数据。

## 🛠️ 开发

```bash
# 安装依赖
go mod download

# 开发模式运行
make dev

# 运行测试
make test

# 代码检查
make lint

# 构建所有平台
make build-all

# 构建 Docker 镜像
make docker-build
```

### Makefile 目标

| 命令 | 说明 |
|------|------|
| `make build` | 构建 Linux amd64 二进制 |
| `make build-all` | 构建 5 个平台 |
| `make dev` | 开发模式运行 |
| `make test` | 运行所有测试 |
| `make test-cover` | 运行测试并生成覆盖率报告 |
| `make lint` | 代码检查 (go vet) |
| `make docker-build` | 构建 Docker 镜像 |
| `make docker-push` | 推送 Docker 镜像 |
| `make clean` | 清理构建产物 |
| `make frontend-build` | 构建前端到 web/dist/ |
| `make migrate` | 构建迁移工具 |

## 📡 API 端点

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户 |
| GET | `/api/auth/users` | 用户列表（管理员） |
| PUT | `/api/auth/users` | 更新用户 |
| DELETE | `/api/auth/users` | 删除用户（管理员） |

### 漫画
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/comics` | 列表（支持搜索、筛选、分页） |
| GET | `/api/comics/:id` | 详情 |
| PUT | `/api/comics/:id/favorite` | 切换收藏 |
| PUT | `/api/comics/:id/rating` | 更新评分 |
| PUT | `/api/comics/:id/progress` | 更新进度 |
| DELETE | `/api/comics/:id/delete` | 删除 |
| POST | `/api/comics/batch` | 批量操作 |
| PUT | `/api/comics/reorder` | 排序 |
| GET | `/api/comics/duplicates` | 重复检测 |

### 标签 & 分类
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tags` | 标签列表 |
| PUT | `/api/tags/color` | 更新颜色 |
| POST | `/api/tags/translate` | 标签翻译 |
| GET | `/api/categories` | 分类列表 |
| POST | `/api/categories` | 初始化分类 |

### 图片 & 缩略图
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/comics/:id/pages` | 页面列表 |
| GET | `/api/comics/:id/page/:pageIndex` | 页面图片 |
| GET | `/api/comics/:id/thumbnail` | 缩略图 |
| POST | `/api/comics/:id/cover` | 更新封面 |
| POST | `/api/thumbnails/manage` | 缩略图管理 |

### 元数据
| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/metadata/search` | 搜索元数据 |
| POST | `/api/metadata/apply` | 应用元数据 |
| POST | `/api/metadata/scan` | 扫描 ComicInfo.xml |
| POST | `/api/metadata/batch` | 批量操作 |
| POST | `/api/metadata/translate-batch` | 批量翻译 |

### AI
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/status` | AI 状态 |
| GET/PUT | `/api/ai/settings` | AI 设置 |
| GET | `/api/ai/search` | 语义搜索 |
| GET | `/api/ai/duplicates` | 视觉相似检测 |
| GET | `/api/ai/models` | 可用模型 |
| POST | `/api/ai/analyze` | 分析漫画 |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/stats` | 阅读统计 |
| POST/PUT | `/api/stats/session` | 阅读会话 |
| GET/PUT | `/api/site-settings` | 站点设置 |
| POST | `/api/upload` | 文件上传 |
| POST | `/api/cache` | 缓存管理 |
| POST | `/api/sync` | 触发同步 |
| GET/POST | `/api/cloud-sync` | WebDAV 同步 |
| GET | `/api/recommendations` | 推荐 |
| GET | `/api/opds/*` | OPDS 协议 |
| GET | `/api/ehentai/*` | E-Hentai |
| GET/POST | `/api/plugins` | 插件管理 |

## 🏗️ 技术栈

| 组件 | 技术 |
|------|------|
| 语言 | Go 1.23 |
| Web 框架 | Gin |
| 数据库 | SQLite (modernc.org/sqlite, 纯 Go) |
| 密码 | bcrypt |
| 压缩包 | archive/zip + 外部 CLI (unrar/7z) |
| 图片处理 | 纯 Go image 库 |
| 认证 | Cookie Session |
| 前端嵌入 | go:embed |
| 容器化 | Docker 多阶段构建 |
| CI/CD | GitHub Actions |

## 📄 License

MIT
