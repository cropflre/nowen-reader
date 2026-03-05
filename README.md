# NowenReader

> 现代化的本地漫画管理与阅读工具 | A modern local comic management and reading tool

---

## 中文文档

### 简介

NowenReader 是一款基于 Next.js 16 全栈开发的本地漫画阅读器。将漫画文件放入 `comics/` 目录或通过 Web 上传，系统自动扫描解析、生成缩略图并入库管理。支持多格式解析、多种阅读模式、完整的元数据管理、用户认证、云同步、OPDS 协议、插件系统等丰富功能。

### 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.1.6 |
| UI | React | 19 |
| 样式 | Tailwind CSS | v4 |
| 语言 | TypeScript | 5 |
| ORM | Prisma (LibSQL 适配器) | 7 |
| 数据库 | SQLite | - |
| 图片处理 | Sharp | 0.34 |
| 压缩包解析 | adm-zip / node-unrar-js / node-7z | - |
| PDF 解析 | pdf-lib / pdfjs-dist | - |
| 认证 | bcryptjs | - |
| 图标 | lucide-react | - |

### 功能特性

#### 漫画库管理 (书架)

- **双视图模式**: 网格视图 (响应式 2-6 列) 和列表视图，可在列表工具栏切换
- **搜索**: 按标题、标签模糊搜索
- **标签筛选**: 多标签 OR 筛选，10 种预设颜色
- **分组管理**: 按分组筛选，支持单本/批量设置分组
- **收藏过滤**: 一键切换仅显示收藏
- **多维排序**: 按标题 / 最近阅读 / 评分 / 自定义排序，支持升降序
- **拖拽排序**: 网格视图下拖拽手柄自定义排列顺序
- **文件上传**: 支持 `.zip` / `.cbz` / `.cbr` / `.rar` / `.7z` / `.cb7` / `.pdf` 格式
- **自动同步**: 自动扫描 `comics/` 目录，新增入库、删除清理

#### 批量操作

- 进入批量模式后可多选漫画
- 支持全选 / 取消全选
- 批量收藏 / 取消收藏
- 批量添加标签
- 批量设置分组
- 批量删除

#### 重复检测

- 三层检测策略：文件内容哈希 (SHA-256) → 文件大小+页数 → 标题相似度
- 每组可选择要保留的项
- 支持逐个删除或一键删除所有重复

#### 漫画阅读器

- **三种阅读模式**:
  - 单页模式 — 点击左右翻页
  - 双页模式 — 双页并排，模拟实体书
  - 长条模式 (Webtoon) — 上下滚动，适合条漫
- **阅读方向**: 左→右 (LTR) / 右→左 (RTL，日漫风格)
- **日/夜间模式**: 全局主题切换 + 阅读器独立日夜模式
- **键盘快捷键**: ← → / A D 翻页, F 全屏, I 信息面板, Esc 返回
- **全屏阅读**: 支持浏览器全屏 API
- **进度保存**: 自动保存阅读进度，下次打开恢复到上次位置
- **页面滑块**: 底部拖动条快速跳页
- **阅读时长记录**: 自动记录每次阅读会话的时长和页数

#### 漫画详情页

- 独立的漫画详情页面
- 封面大图展示
- 完整元数据展示 (作者/出版社/年份/简介/类型/系列)
- 收藏切换 / 1-5 星评分
- 标签管理 (添加/删除)
- 阅读进度展示

#### 阅读统计

- 独立统计页面 (`/stats`)
- 总阅读时长、总阅读次数、已读漫画数
- 近 30 天阅读时长图表
- 最近阅读记录列表

#### 元数据管理

- 从漫画压缩包内的 `ComicInfo.xml` 自动提取元数据
- 在线元数据搜索与应用 (作者/出版社/年份/简介/类型/系列)
- 丰富的数据库字段：作者、出版社、年份、简介、语言、系列名、系列序号、类型

#### 用户系统

- 用户注册 / 登录
- 管理员 / 普通用户角色
- Session 会话管理
- 认证守卫保护

#### 云同步

- WebDAV 同步支持
- 数据导入 / 导出

#### 推荐系统

- 独立推荐页面 (`/recommendations`)
- 基于标签 / 类型 / 作者 / 系列的相似漫画推荐

#### OPDS 协议

- 标准 OPDS 目录服务
- 兼容外部阅读器访问

#### 插件系统

- 插件管理器界面
- 权限控制

#### PWA 支持

- 可安装为桌面/移动应用
- Service Worker 离线缓存
- 安装提示引导

#### 国际化 (i18n)

- 中文 / 英文双语支持
- 语言切换器

#### 后端服务

- **文件系统同步**: 每次请求自动扫描目录，保持数据库与文件一致
- **多格式解析**: ZIP/CBZ (adm-zip)、RAR/CBR (node-unrar-js)、7Z/CB7 (node-7z)、PDF (pdf-lib + pdfjs-dist)
- **智能过滤**: 过滤 macOS 元数据文件、自然排序页面文件名
- **缩略图缓存**: Sharp 生成 400×560 WebP 封面，缓存到 `.cache/thumbnails/`
- **稳定 ID**: 基于文件名 MD5 哈希

### 快速开始

```bash
# 安装依赖
npm install

# 初始化数据库
npm run db:push

# 启动开发服务器
npm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000)。

将漫画文件 (.zip / .cbz / .cbr / .rar / .7z / .cb7 / .pdf) 放入项目根目录的 `comics/` 文件夹，刷新页面即可自动识别。

### 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 (含 Prisma 生成 + Schema 推送) |
| `npm run start` | 启动生产服务器 |
| `npm run db:push` | 推送 Schema 到数据库 |
| `npm run db:studio` | 打开 Prisma Studio 数据库管理 |
| `npm run db:generate` | 生成 Prisma Client |

### 项目结构

```
nowen-reader/
├── comics/                      # 漫画文件存放目录
├── prisma/
│   └── schema.prisma            # 数据库模型 (User, Comic, Tag, ReadingSession 等)
├── public/
│   ├── manifest.json            # PWA 清单
│   ├── sw.js                    # Service Worker
│   └── icons/                   # PWA 图标
├── src/
│   ├── app/
│   │   ├── page.tsx             # 书架主页面
│   │   ├── comic/[id]/          # 漫画详情页
│   │   ├── reader/[id]/         # 阅读器页面
│   │   ├── stats/               # 阅读统计页
│   │   ├── recommendations/     # 推荐页
│   │   └── api/                 # RESTful API (30+ 端点)
│   │       ├── auth/            # 认证 (登录/注册/登出/用户管理)
│   │       ├── comics/          # 漫画 CRUD / 批量 / 重复检测 / 排序
│   │       ├── metadata/        # 元数据搜索与扫描
│   │       ├── opds/            # OPDS 协议端点
│   │       ├── stats/           # 阅读统计
│   │       ├── sync/            # 云同步
│   │       ├── plugins/         # 插件系统
│   │       ├── recommendations/ # 推荐
│   │       ├── groups/          # 分组
│   │       ├── tags/            # 标签
│   │       └── upload/          # 文件上传
│   ├── components/
│   │   ├── Navbar.tsx           # 导航栏 (搜索/上传/主题/语言/用户)
│   │   ├── ComicCard.tsx        # 漫画卡片 (网格/列表/拖拽)
│   │   ├── BatchToolbar.tsx     # 批量操作工具栏
│   │   ├── DuplicateDetector.tsx # 重复检测弹窗
│   │   ├── TagFilter.tsx        # 标签筛选器
│   │   ├── GroupFilter.tsx      # 分组筛选器
│   │   ├── StatsBar.tsx         # 统计栏
│   │   ├── SettingsModal.tsx    # 设置弹窗
│   │   ├── CloudSync.tsx        # 云同步面板
│   │   ├── PluginManager.tsx    # 插件管理器
│   │   ├── MetadataSearch.tsx   # 元数据搜索
│   │   ├── Recommendations.tsx  # 推荐组件
│   │   ├── AuthGuard.tsx        # 认证守卫
│   │   ├── UserMenu.tsx         # 用户菜单
│   │   ├── LanguageSwitcher.tsx # 语言切换器
│   │   ├── PWAInstall.tsx       # PWA 安装提示
│   │   └── reader/              # 阅读器视图组件
│   │       ├── ReaderToolbar.tsx # 阅读器工具栏
│   │       ├── SinglePageView.tsx
│   │       ├── DoublePageView.tsx
│   │       └── WebtoonView.tsx
│   ├── hooks/
│   │   └── useComics.ts         # 核心 Hook (列表/上传/批量/分组/统计)
│   ├── lib/
│   │   ├── db.ts                # 数据库连接
│   │   ├── config.ts            # 全局配置
│   │   ├── comic-parser.ts      # 漫画文件解析
│   │   ├── archive-parser.ts    # 压缩包解析 (ZIP/RAR/7Z/PDF)
│   │   ├── comic-service.ts     # 漫画服务层 (CRUD/搜索/重复检测)
│   │   ├── auth.ts              # 认证工具
│   │   ├── auth-context.tsx     # 认证上下文
│   │   ├── theme-context.tsx    # 主题上下文 (日/夜间模式)
│   │   ├── cloud-sync.ts        # 云同步逻辑
│   │   ├── metadata-scraper.ts  # 元数据刮削
│   │   ├── opds.ts              # OPDS 协议实现
│   │   ├── plugin-system.ts     # 插件系统
│   │   ├── recommendation.ts    # 推荐算法
│   │   ├── pwa.ts               # PWA 工具
│   │   └── i18n/                # 国际化 (zh-CN / en)
│   └── types/
│       ├── comic.ts             # 漫画/统计类型定义
│       └── reader.ts            # 阅读器类型定义
└── package.json
```

### API 接口

#### 认证

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| GET | `/api/auth/users` | 用户管理 |

#### 漫画管理

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/comics` | 获取漫画列表 (含自动同步/分页/搜索/排序) |
| GET | `/api/comics/[id]` | 获取漫画详情 |
| DELETE | `/api/comics/[id]/delete` | 删除漫画 (含磁盘文件) |
| PUT | `/api/comics/[id]/favorite` | 切换收藏 |
| PUT | `/api/comics/[id]/rating` | 更新评分 |
| PUT | `/api/comics/[id]/progress` | 更新阅读进度 |
| POST | `/api/comics/[id]/tags` | 添加标签 |
| DELETE | `/api/comics/[id]/tags` | 删除标签 |
| PUT | `/api/comics/[id]/group` | 设置分组 |
| GET | `/api/comics/[id]/thumbnail` | 获取封面缩略图 |
| GET | `/api/comics/[id]/pages` | 获取页面列表 |
| GET | `/api/comics/[id]/page/[pageIndex]` | 获取单页图片 |
| POST | `/api/comics/batch` | 批量操作 (收藏/标签/分组/删除) |
| GET | `/api/comics/duplicates` | 检测重复漫画 |
| POST | `/api/comics/reorder` | 更新拖拽排序 |
| POST | `/api/upload` | 上传漫画文件 |

#### 数据与服务

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/tags` | 获取所有标签 |
| GET | `/api/groups` | 获取所有分组 |
| GET | `/api/stats` | 获取阅读统计 |
| POST | `/api/stats/session` | 记录阅读会话 |
| POST | `/api/metadata/search` | 搜索元数据 |
| POST | `/api/metadata/scan` | 扫描 ComicInfo.xml |
| POST | `/api/metadata/apply` | 应用元数据 |
| POST | `/api/sync` | 云同步 |
| GET | `/api/plugins` | 插件列表 |
| GET | `/api/recommendations` | 获取推荐漫画 |
| GET | `/api/recommendations/similar/[id]` | 获取相似推荐 |

#### OPDS 协议

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/opds/catalog` | OPDS 目录根 |
| GET | `/api/opds/search` | OPDS 搜索 |
| 其他 | `/api/opds/*` | 更多 OPDS 端点 |

---

## English Documentation

### Introduction

NowenReader is a full-stack local comic reader built with Next.js 16. Drop comic files into the `comics/` directory or upload via the web interface — the system automatically scans, parses, generates thumbnails, and catalogs your collection. Features multi-format support, multiple reading modes, comprehensive metadata management, user authentication, cloud sync, OPDS protocol, plugin system, and more.

### Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | Next.js (App Router) | 16.1.6 |
| UI | React | 19 |
| Styling | Tailwind CSS | v4 |
| Language | TypeScript | 5 |
| ORM | Prisma (LibSQL adapter) | 7 |
| Database | SQLite | - |
| Image Processing | Sharp | 0.34 |
| Archive Parsing | adm-zip / node-unrar-js / node-7z | - |
| PDF Parsing | pdf-lib / pdfjs-dist | - |
| Authentication | bcryptjs | - |
| Icons | lucide-react | - |

### Features

#### Comic Library (Bookshelf)

- **Dual View Modes**: Grid view (responsive 2-6 columns) and list view, switchable from the list toolbar
- **Search**: Fuzzy search by title and tags
- **Tag Filtering**: Multi-tag OR filtering with 10 preset colors
- **Group Management**: Filter by group, single or batch group assignment
- **Favorites Filter**: One-click toggle to show favorites only
- **Multi-Dimension Sorting**: By title / last read / rating / custom order, ascending or descending
- **Drag & Drop Sorting**: Custom arrangement with drag handles in grid view
- **File Upload**: Supports `.zip` / `.cbz` / `.cbr` / `.rar` / `.7z` / `.cb7` / `.pdf` formats
- **Auto Sync**: Automatically scans the `comics/` directory — new files are added, removed files are cleaned up

#### Batch Operations

- Multi-select comics in batch mode
- Select all / deselect all
- Batch favorite / unfavorite
- Batch add tags
- Batch set group
- Batch delete

#### Duplicate Detection

- Three-tier detection: file content hash (SHA-256) → file size + page count → similar title
- Choose which item to keep per group
- Delete one by one or delete all duplicates at once

#### Comic Reader

- **Three Reading Modes**:
  - Single Page — click left/right to turn pages
  - Double Page — side-by-side spread, simulating a physical book
  - Webtoon — vertical scroll, ideal for web comics
- **Reading Direction**: LTR (left-to-right) / RTL (right-to-left, manga style)
- **Day/Night Mode**: Global theme toggle + independent reader day/night mode
- **Keyboard Shortcuts**: ← → / A D for page turn, F for fullscreen, I for info panel, Esc to go back
- **Fullscreen**: Browser Fullscreen API support
- **Progress Saving**: Auto-saves reading progress; resumes from last position
- **Page Slider**: Bottom drag bar for quick page navigation
- **Reading Time Tracking**: Automatically records duration and pages per reading session

#### Comic Detail Page

- Dedicated comic detail page
- Large cover display
- Full metadata display (author/publisher/year/description/genre/series)
- Favorite toggle / 1-5 star rating
- Tag management (add/remove)
- Reading progress display

#### Reading Statistics

- Dedicated statistics page (`/stats`)
- Total reading time, total sessions, comics read
- Last 30 days reading time chart
- Recent reading records list

#### Metadata Management

- Auto-extract metadata from `ComicInfo.xml` inside archives
- Online metadata search and apply (author/publisher/year/description/genre/series)
- Rich database fields: author, publisher, year, description, language, series name, series index, genre

#### User System

- User registration / login
- Admin / regular user roles
- Session-based authentication
- Auth guard protection

#### Cloud Sync

- WebDAV sync support
- Data import / export

#### Recommendation System

- Dedicated recommendations page (`/recommendations`)
- Similar comic recommendations based on tags / genre / author / series

#### OPDS Protocol

- Standard OPDS catalog service
- Compatible with external comic readers

#### Plugin System

- Plugin manager interface
- Permission control

#### PWA Support

- Installable as desktop/mobile app
- Service Worker offline caching
- Install prompt guidance

#### Internationalization (i18n)

- Chinese / English bilingual support
- Language switcher

#### Backend Services

- **File System Sync**: Auto-scans directory on each request, keeping database consistent with files
- **Multi-Format Parsing**: ZIP/CBZ (adm-zip), RAR/CBR (node-unrar-js), 7Z/CB7 (node-7z), PDF (pdf-lib + pdfjs-dist)
- **Smart Filtering**: Filters macOS metadata files, natural sort for page filenames
- **Thumbnail Cache**: Sharp generates 400×560 WebP covers, cached in `.cache/thumbnails/`
- **Stable IDs**: Based on filename MD5 hash

### Quick Start

```bash
# Install dependencies
npm install

# Initialize database
npm run db:push

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Place comic files (.zip / .cbz / .cbr / .rar / .7z / .cb7 / .pdf) in the `comics/` folder at the project root, then refresh the page to auto-detect them.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build (includes Prisma generate + schema push) |
| `npm run start` | Start production server |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Prisma Studio for database management |
| `npm run db:generate` | Generate Prisma Client |

### Project Structure

```
nowen-reader/
├── comics/                      # Comic files directory
├── prisma/
│   └── schema.prisma            # Database models (User, Comic, Tag, ReadingSession, etc.)
├── public/
│   ├── manifest.json            # PWA manifest
│   ├── sw.js                    # Service Worker
│   └── icons/                   # PWA icons
├── src/
│   ├── app/
│   │   ├── page.tsx             # Bookshelf main page
│   │   ├── comic/[id]/          # Comic detail page
│   │   ├── reader/[id]/         # Reader page
│   │   ├── stats/               # Reading statistics page
│   │   ├── recommendations/     # Recommendations page
│   │   └── api/                 # RESTful API (30+ endpoints)
│   ├── components/              # 17 components + 4 reader sub-components
│   ├── hooks/                   # Custom Hooks
│   ├── lib/                     # Core libraries (15 modules)
│   └── types/                   # TypeScript type definitions
└── package.json
```

### API Reference

#### Authentication

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register` | User registration |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user info |
| GET | `/api/auth/users` | User management |

#### Comic Management

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/comics` | List comics (with auto sync/pagination/search/sort) |
| GET | `/api/comics/[id]` | Get comic details |
| DELETE | `/api/comics/[id]/delete` | Delete comic (including disk file) |
| PUT | `/api/comics/[id]/favorite` | Toggle favorite |
| PUT | `/api/comics/[id]/rating` | Update rating |
| PUT | `/api/comics/[id]/progress` | Update reading progress |
| POST | `/api/comics/[id]/tags` | Add tag |
| DELETE | `/api/comics/[id]/tags` | Remove tag |
| PUT | `/api/comics/[id]/group` | Set group |
| GET | `/api/comics/[id]/thumbnail` | Get cover thumbnail |
| GET | `/api/comics/[id]/pages` | Get page list |
| GET | `/api/comics/[id]/page/[pageIndex]` | Get single page image |
| POST | `/api/comics/batch` | Batch operations (favorite/tag/group/delete) |
| GET | `/api/comics/duplicates` | Detect duplicate comics |
| POST | `/api/comics/reorder` | Update drag-and-drop order |
| POST | `/api/upload` | Upload comic file |

#### Data & Services

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/tags` | Get all tags |
| GET | `/api/groups` | Get all groups |
| GET | `/api/stats` | Get reading statistics |
| POST | `/api/stats/session` | Record reading session |
| POST | `/api/metadata/search` | Search metadata |
| POST | `/api/metadata/scan` | Scan ComicInfo.xml |
| POST | `/api/metadata/apply` | Apply metadata |
| POST | `/api/sync` | Cloud sync |
| GET | `/api/plugins` | Plugin list |
| GET | `/api/recommendations` | Get recommended comics |
| GET | `/api/recommendations/similar/[id]` | Get similar recommendations |

#### OPDS Protocol

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/opds/catalog` | OPDS catalog root |
| GET | `/api/opds/search` | OPDS search |
| Other | `/api/opds/*` | More OPDS endpoints |

---

## 未来计划 / Roadmap

### 近期 / Short Term

- [ ] **日语支持** — i18n 新增日语翻译  
  *Japanese support — add Japanese locale to i18n*
- [ ] **漫画导入向导** — 引导式批量导入流程，自动检测格式与元数据  
  *Import wizard — guided bulk import with auto format & metadata detection*
- [ ] **阅读器手势优化** — 触摸屏捏合缩放、滑动翻页手势  
  *Reader gesture improvements — pinch-to-zoom, swipe-to-turn on touch screens*
- [ ] **书架自定义主题** — 支持自定义配色方案和背景  
  *Bookshelf custom themes — custom color schemes and backgrounds*

### 中期 / Mid Term

- [ ] **Electron 桌面版** — 打包为独立桌面应用，原生文件系统访问  
  *Electron desktop app — standalone desktop application with native file system access*
- [ ] **多用户书架隔离** — 不同用户拥有独立的书架、收藏和阅读进度  
  *Per-user bookshelf isolation — independent bookshelf, favorites and progress per user*
- [ ] **高级搜索** — 按作者/出版社/年份/评分等多维度组合搜索  
  *Advanced search — multi-dimensional search by author/publisher/year/rating*
- [ ] **阅读目标** — 设置每日/每周阅读目标并追踪完成度  
  *Reading goals — set daily/weekly reading goals with progress tracking*
- [ ] **更多元数据源** — 接入 AniList / MangaUpdates 等数据库  
  *More metadata sources — integrate AniList / MangaUpdates databases*

### 远期 / Long Term

- [ ] **多设备实时同步** — 实时同步阅读状态，多端无缝切换  
  *Real-time multi-device sync — seamless reading state synchronization across devices*
- [ ] **漫画社区** — 评论、分享、书单推荐  
  *Community features — comments, sharing, curated reading lists*
- [ ] **AI 智能标签** — 基于封面/内容自动识别类型和标签  
  *AI smart tagging — auto-detect genre and tags from cover/content*
- [ ] **阅读器自定义布局** — 可调节页面间距、背景色、字体等  
  *Reader custom layout — adjustable page gaps, background color, fonts*

---

## 许可证 / License

MIT
