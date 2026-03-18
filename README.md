# NowenReader

<p align="center">
  <strong>高性能自托管漫画 & 小说管理平台</strong><br>
  Go 构建 — 单二进制、轻量、易部署
</p>

---

## ✨ 特性

### 📚 内容管理
- 📖 **多格式支持** — 漫画：ZIP/CBZ/CBR/RAR/7Z/CB7/PDF；小说：TXT/EPUB/MOBI/AZW3/HTML
- 🔄 **自动扫描** — 文件系统监听 + 定时同步，自动发现新文件
- 🏷️ **标签 & 分类** — 多标签、多分类管理，标签颜色自定义
- 📚 **书架系统** — 自定义书架，灵活归类漫画和小说
- ⭐ **收藏 & 评分** — 一键收藏、1-5 星评分
- 📋 **阅读状态** — 未读 / 在读 / 已读，配合「继续阅读」快速恢复
- ✏️ **元数据编辑** — 在线编辑标题、作者、出版社等元数据字段
- 📤 **文件上传** — 支持 ZIP/CBZ/CBR/RAR/7Z/PDF 直接上传
- 🔄 **批量操作** — 批量打标签、分类、删除、翻译
- 🧹 **无效清理** — 一键清理文件已不存在的失效条目

### 🔍 元数据 & 智能
- 🌐 **元数据抓取** — AniList / Bangumi / MangaDex / MangaUpdates / Kitsu
- 📋 **ComicInfo.xml 扫描** — 自动提取漫画内嵌元数据
- 🤖 **AI 集成** — 17+ LLM 供应商，智能标签、语义搜索、封面相似度检测
- 🏷️ **标签翻译** — 中英文标签自动翻译
- 🎯 **个性化推荐** — 基于阅读历史 + 相似度的智能推荐

### 📖 阅读体验
- 📖 **漫画阅读器** — 内置翻页阅读器，支持进度记忆
- 📕 **小说阅读器** — EPUB 章节渲染、TXT 智能分章阅读
- ▶️ **继续阅读** — 首页快速恢复上次阅读位置
- 📊 **阅读统计** — 阅读时间、会话记录、每日趋势、增强统计、年度报告
- 📁 **文件统计** — 各格式文件数量、存储空间占用分析
- 🎯 **阅读目标** — 设定每日/每周阅读目标，追踪达成进度
- 📤 **数据导出** — JSON 全量导出、CSV 会话/漫画导出

### 🔗 协议 & 同步
- 📡 **OPDS 协议** — 支持 KOReader / Moon+ Reader 等阅读器
- 🔄 **WebDAV 云同步** — 跨设备阅读进度同步
### 🛠️ 部署 & 架构
- 🚀 **Go 单二进制** — 无需 Node.js / npm，开箱即用
- 📦 **前端嵌入** — Vite SPA 前端编译进二进制，一个文件部署
- 🔐 **用户认证** — 多用户支持，管理员 / 普通用户角色
- 🖼️ **缩略图管理** — WebP 自动生成，批量管理，自定义尺寸
- 📂 **文件夹浏览** — Web 界面直接浏览并选择服务器目录
- 📋 **错误日志** — 管理员可查看、导出、清理系统错误日志
- 💾 **SQLite** — 零配置数据库，WAL 模式高性能
- 🐳 **Docker** — 多平台镜像（amd64/arm64）
- 📱 **PWA** — 可安装为桌面 / 移动应用
- 🔌 **插件系统** — 内置插件，可扩展
- ⚙️ **独立设置页** — 站点设置、AI 配置、文件统计、关于信息集中管理

## 📁 项目结构

```
nowen-reader/
├── cmd/
│   ├── server/              # 主服务入口 (main.go)
│   └── migrate/             # 数据库迁移 CLI (main.go)
├── internal/
│   ├── archive/             # 压缩包解析 (ZIP/RAR/7Z/PDF/EPUB/TXT)
│   ├── config/              # 配置管理 (站点设置、路径、扩展名)
│   ├── handler/             # HTTP API Handler (23 个文件)
│   │   ├── router.go        # 路由注册
│   │   ├── auth.go          # 认证 (注册/登录/登出/用户管理)
│   │   ├── comic.go         # 漫画 CRUD (列表/详情/收藏/评分/进度/元数据编辑)
│   │   ├── images.go        # 图片服务 (页面/缩略图/EPUB资源/章节内容)
│   │   ├── metadata.go      # 元数据抓取 (搜索/应用/扫描/批量)
│   │   ├── ai_handler.go    # AI 服务 (语义搜索/分析/相似检测)
│   │   ├── shelf_handler.go # 书架系统 (创建/更新/删除/漫画归属)
│   │   ├── goal_handler.go  # 阅读目标 (设定/进度/删除)
│   │   ├── export_handler.go # 数据导出 (JSON/CSV)
│   │   ├── opds_handler.go  # OPDS 协议
│   │   ├── browse.go        # 文件夹浏览 (服务器目录选择)
│   │   ├── log_handler.go   # 错误日志 (查看/统计/导出/清理)
│   │   ├── thumbnails.go    # 缩略图管理 (批量生成/清理)
│   │   ├── tag_translate_handler.go # 标签翻译
│   │   ├── spa.go           # SPA 路由
│   │   └── ...              # 其他 (标签/分类/统计/上传/缓存/同步/设置)
│   ├── middleware/           # 中间件 (CORS/Auth/Gzip/Logger/RateLimit/Security)
│   ├── model/               # 数据模型 (User/Comic/Tag/Category/ReadingSession)
│   ├── service/             # 业务逻辑 (AI/元数据/推荐/扫描/OPDS/标签翻译)
│   └── store/               # 数据库 CRUD + 迁移 (SQLite)
│       ├── db.go            # 数据库连接与初始化
│       ├── migrate.go       # Schema 迁移
│       ├── comic_store.go   # 漫画存储
│       ├── comic_query.go   # 复杂查询 (搜索/筛选/分页/排序)
│       ├── comic_batch.go   # 批量操作
│       ├── comic_stats.go   # 统计查询
│       ├── shelf_store.go   # 书架存储
│       ├── reading_goal.go  # 阅读目标存储
│       └── user_store.go    # 用户存储
├── web/
│   ├── embed.go             # go:embed 前端嵌入
│   └── dist/                # 前端构建产物 (编译时填充)
├── frontend/                # Vite + React + TypeScript 前端
│   └── src/
│       └── app/
│           ├── page.tsx            # 首页 (漫画列表)
│           ├── comic/[id]/         # 漫画详情页
│           ├── novel/[id]/         # 小说详情页
│           ├── reader/[id]/        # 阅读器
│           ├── settings/           # 独立设置页 (站点/AI/文件统计/关于)
│           ├── stats/              # 阅读统计
│           ├── recommendations/    # 推荐页
│           ├── logs/               # 错误日志页 (管理员)
├── Dockerfile├── docker-compose.yml       # 一键部署 (源码构建)
├── docker-compose.prod.yml  # 生产部署 (Docker Hub 镜像)
├── docker-compose.nas.yml   # NAS 部署 (群晖/威联通)
├── docker-entrypoint.sh     # Docker 启动脚本
├── Makefile                 # 构建自动化
└── go.mod
```

## 🚀 快速开始

### 方式 1: Docker Compose（推荐）

```bash
# 克隆项目
git clone https://github.com/cropflre/nowen-reader.git
cd nowen-reader

# 一键启动（从源码构建）
docker compose up -d

# 访问 http://localhost:6680
```

### 方式 2: Docker Hub 镜像（生产部署）

```bash
# 下载配置文件
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.prod.yml

# 启动
docker compose -f docker-compose.prod.yml up -d

# 更新到最新版本
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### 方式 3: NAS 部署（群晖 / 威联通 / 铁威马）

```bash
# 下载 NAS 配置文件
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.nas.yml

# 编辑配置，修改漫画目录路径
vi docker-compose.nas.yml

# 启动（内存限制 512MB，适合 NAS）
docker compose -f docker-compose.nas.yml up -d
```

### 方式 4: 从源码构建

```bash
# 前提条件: Go 1.23+, Node.js 20+ (可选，用于前端)

# 克隆
git clone https://github.com/cropflre/nowen-reader.git
cd nowen-reader

# 仅构建后端
make build

# 或构建含前端的完整版本
make build-full

# 运行
./nowen-reader
```

## ⚙️ 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `DATABASE_URL` | `./data/nowen-reader.db` | SQLite 数据库路径 |
| `COMICS_DIR` | `./comics` | 漫画/小说文件目录 |
| `DATA_DIR` | `./.cache` | 数据/缓存目录 |
| `FRONTEND_DIR` | - | 前端构建目录（开发模式用） |
| `GIN_MODE` | `debug` | Gin 模式（`debug` / `release`） |
| `TZ` | `Asia/Shanghai` | 时区 |

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
  "theme": "dark",
  "scannerConfig": {
    "syncCooldownSec": 10,
    "fsDebounceMs": 500,
    "fullSyncBatchSize": 100,
    "quickSyncIntervalSec": 30,
    "fullSyncIntervalSec": 3600
  }
}
```

### 支持的文件格式

| 类型 | 格式 |
|------|------|
| 漫画/压缩包 | `.zip` `.cbz` `.cbr` `.rar` `.7z` `.cb7` `.pdf` |
| 小说/电子书 | `.txt` `.epub` `.mobi` `.azw3` `.html` `.htm` |
| 图片 | `.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.avif` |

## 🔄 从 Next.js 版本迁移

如果你之前使用的是 Next.js 版本，可以无缝迁移数据：

```bash
# 使用迁移工具导入 Prisma 数据库
./nowen-migrate -import /path/to/old/prisma/dev.db

# 或指定新数据库路径
./nowen-migrate -db /data/nowen-reader.db -import /path/to/old/prisma/dev.db
```

迁移会自动导入：用户、漫画、标签、分类、阅读会话等所有数据。

## 🛠️ 开发

```bash
# 安装依赖
go mod download

# 开发模式运行（后端）
make dev

# 开发模式运行（含前端目录）
make dev-with-frontend

# 构建后端
make build

# 构建含前端的完整版本
make build-full

# 运行测试
make test

# 运行测试（含覆盖率）
make test-cover

# 代码检查
make vet
make lint

# 代码格式化
make fmt
```

### Makefile 目标

| 命令 | 说明 |
|------|------|
| `make build` | 构建当前平台二进制 |
| `make build-linux` | 构建 Linux amd64 二进制 |
| `make build-arm64` | 构建 Linux arm64 二进制 |
| `make build-all` | 构建所有平台 |
| `make build-static` | 静态编译（CGO_ENABLED=0） |
| `make build-full` | 构建前端 + 后端完整版本 |
| `make dev` | 开发模式运行 |
| `make dev-with-frontend` | 开发模式运行（含前端目录） |
| `make test` | 运行所有测试 |
| `make test-short` | 运行短测试 |
| `make test-cover` | 运行测试并生成覆盖率报告 |
| `make vet` | Go vet 检查 |
| `make lint` | golangci-lint 检查 |
| `make fmt` | 代码格式化 |
| `make docker` | 构建 Docker 镜像 |
| `make docker-push` | 推送 Docker 镜像 |
| `make docker-multiarch` | 构建多平台镜像（amd64 + arm64） |
| `make docker-up` | docker compose up |
| `make docker-down` | docker compose down |
| `make docker-logs` | 查看容器日志 |
| `make frontend` | 构建前端到 web/dist/ |
| `make migrate` | 构建迁移工具 |
| `make clean` | 清理构建产物 |
| `make version` | 显示版本信息 |
| `make info` | 显示完整构建信息 |

## 📡 API 端点

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册（限流） |
| POST | `/api/auth/login` | 登录（限流） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户信息 |
| GET | `/api/auth/users` | 用户列表 🔒管理员 |
| PUT | `/api/auth/users` | 更新用户 🔒管理员 |
| DELETE | `/api/auth/users` | 删除用户 🔒管理员 |

### 漫画
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/comics` | 列表（搜索/筛选/分页/排序） |
| GET | `/api/comics/:id` | 详情 |
| PUT | `/api/comics/:id/favorite` | 切换收藏 🔒 |
| PUT | `/api/comics/:id/rating` | 更新评分 🔒 |
| PUT | `/api/comics/:id/progress` | 更新阅读进度 🔒 |
| PUT | `/api/comics/:id/reading-status` | 设置阅读状态（未读/在读/已读） 🔒 |
| PUT | `/api/comics/:id/metadata` | 编辑元数据 🔒 |
| DELETE | `/api/comics/:id/delete` | 删除 🔒 |
| POST | `/api/comics/batch` | 批量操作 🔒 |
| POST | `/api/comics/cleanup` | 清理无效条目 🔒 |
| PUT | `/api/comics/reorder` | 排序 🔒 |
| GET | `/api/comics/duplicates` | 重复检测 |

### 标签
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tags` | 标签列表 |
| PUT | `/api/tags/color` | 更新标签颜色 |
| POST | `/api/tags/translate` | 标签翻译 |
| POST | `/api/comics/:id/tags` | 添加标签 🔒 |
| DELETE | `/api/comics/:id/tags` | 移除标签 🔒 |
| POST | `/api/comics/:id/translate-metadata` | 翻译元数据 🔒 |

### 分类
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 分类列表 |
| POST | `/api/categories` | 初始化分类 |
| POST | `/api/comics/:id/categories` | 添加分类 🔒 |
| PUT | `/api/comics/:id/categories` | 设置分类 🔒 |
| DELETE | `/api/comics/:id/categories` | 移除分类 🔒 |

### 书架
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/shelves` | 书架列表 |
| POST | `/api/shelves/init` | 初始化书架 |
| POST | `/api/shelves` | 创建书架 🔒 |
| PUT | `/api/shelves/:id` | 更新书架 🔒 |
| DELETE | `/api/shelves/:id` | 删除书架 🔒 |
| POST | `/api/shelves/:id/comics` | 添加漫画到书架 🔒 |
| DELETE | `/api/shelves/:id/comics` | 从书架移除漫画 🔒 |
| GET | `/api/comics/:id/shelves` | 获取漫画的书架归属 |

### 图片 & 内容
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/comics/:id/pages` | 页面列表 |
| GET | `/api/comics/:id/page/:pageIndex` | 页面图片 |
| GET | `/api/comics/:id/thumbnail` | 缩略图 |
| POST | `/api/comics/:id/cover` | 更新封面 🔒 |
| GET | `/api/comics/:id/chapter/:chapterIndex` | 小说章节内容 |
| GET | `/api/comics/:id/epub-resource/*resourcePath` | EPUB 资源（图片等） |
| POST | `/api/thumbnails/manage` | 缩略图管理 🔒 |

### 元数据
| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/metadata/search` | 搜索元数据 |
| POST | `/api/metadata/apply` | 应用元数据 |
| POST | `/api/metadata/scan` | 扫描 ComicInfo.xml |
| POST | `/api/metadata/novel-scan` | 扫描小说元数据 |
| POST | `/api/metadata/batch` | 批量操作 |
| POST | `/api/metadata/translate-batch` | 批量翻译 |

### AI
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/status` | AI 服务状态 |
| GET | `/api/ai/settings` | 获取 AI 设置 |
| PUT | `/api/ai/settings` | 更新 AI 设置 |
| GET | `/api/ai/models` | 可用模型列表 |

### 阅读统计
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats` | 阅读统计 |
| GET | `/api/stats/yearly` | 年度阅读报告 |
| POST | `/api/stats/session` | 开始阅读会话 |
| PUT | `/api/stats/session` | 结束阅读会话 |
| POST | `/api/stats/session/end` | 结束阅读会话（sendBeacon 兜底） |
| GET | `/api/stats/enhanced` | 增强统计数据 |
| GET | `/api/stats/files` | 文件统计（格式/大小分布） |

### 阅读目标
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/goals` | 获取目标进度 |
| POST | `/api/goals` | 设定阅读目标 🔒 |
| DELETE | `/api/goals` | 删除阅读目标 🔒 |

### 数据导出
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/export/json` | JSON 全量导出 |
| GET | `/api/export/csv/sessions` | CSV 阅读会话导出 |
| GET | `/api/export/csv/comics` | CSV 漫画列表导出 |

### OPDS 协议
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/opds` | OPDS 根目录 |
| GET | `/api/opds/all` | 全部漫画 |
| GET | `/api/opds/recent` | 最近更新 |
| GET | `/api/opds/favorites` | 收藏列表 |
| GET | `/api/opds/search` | OPDS 搜索 |
| GET | `/api/opds/download/:id` | 下载原始文件 |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查（含运行时信息） |
| GET/PUT | `/api/site-settings` | 站点设置 |
| POST | `/api/upload` | 文件上传 🔒 |
| POST | `/api/cache` | 缓存管理 🔒 |
| POST | `/api/sync` | 触发文件同步 🔒 |
| GET | `/api/recommendations` | 个性化推荐 |
| GET | `/api/recommendations/similar/:id` | 相似推荐 |

### 文件夹浏览
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/browse-dirs` | 浏览服务器目录 🔒 |

### 错误日志
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs` | 错误日志列表 🔒管理员 |
| GET | `/api/logs/stats` | 错误日志统计 🔒管理员 |
| GET | `/api/logs/export` | 导出错误日志 🔒管理员 |
| DELETE | `/api/logs` | 清理错误日志 🔒管理员 |

> 🔒 = 需要认证

## 🏗️ 技术栈

| 组件 | 技术 |
|------|------|
| 后端语言 | Go 1.23 |
| Web 框架 | Gin |
| 数据库 | SQLite（modernc.org/sqlite，纯 Go，零 CGO） |
| 前端框架 | Vite + React + TypeScript |
| 密码加密 | bcrypt |
| 压缩包解析 | archive/zip + rardecode/v2 + 外部 CLI（7z） |
| PDF 渲染 | mupdf-tools（mutool draw） |
| 图片处理 | 纯 Go image 库 + libwebp-tools（cwebp） |
| 认证方式 | Cookie Session |
| 前端嵌入 | go:embed |
| 文件监听 | fsnotify |
| 容器化 | Docker 多阶段构建（Alpine 3.20） |
| 多语言 | i18n（中文 / English / 日本語） |
| CI/CD | GitHub Actions |

## 📄 License

MIT