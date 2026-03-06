# NowenReader

> 现代化的本地漫画管理与阅读工具 | A modern local comic management and reading tool

---

## 中文文档

### 简介

NowenReader 是一款基于 Next.js 16 全栈开发的本地漫画阅读器，专为 NAS / Docker 一键部署设计。将漫画文件放入 `comics/` 目录或通过 Web 上传，系统自动扫描解析、生成缩略图并入库管理。支持多格式解析、多种阅读模式、完整的元数据管理、AI 智能分析、E-Hentai 集成、用户认证、云同步、OPDS 协议、分类系统、插件系统等丰富功能。

### 技术栈

#### 前端

| 层面 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.1.6 |
| UI 库 | React | 19.2.3 |
| 语言 | TypeScript | ^5 |
| 样式 | Tailwind CSS v4 + PostCSS | ^4 |
| 图标 | Lucide React | ^0.475.0 |
| PWA | Service Worker + manifest.json | 自定义 |

#### 后端 (Next.js API Routes)

| 层面 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js 20 (Alpine) | Dockerfile 指定 |
| API | Next.js Route Handlers | `src/app/api/` 下 57 个端点 |
| 认证 | bcryptjs + Session Token | Cookie-based |
| 爬虫/解析 | cheerio | HTML 解析（E-Hentai 集成） |

#### 数据库

| 层面 | 技术 | 说明 |
|------|------|------|
| ORM | Prisma | ^7.4.2 |
| Driver Adapter | @prisma/adapter-libsql | ^7.4.2 |
| 底层驱动 | @libsql/client | ^0.17.0（libsql，SQLite 分叉） |
| 数据库 | SQLite（WAL 模式） | 嵌入式，零配置 |
| 性能优化 | 自定义 PRAGMA 注入 | mmap 256MB + cache 64MB |

#### 文件处理

| 格式 | 库 | 说明 |
|------|------|------|
| ZIP/CBZ | adm-zip + node-stream-zip | 双引擎 |
| RAR/CBR | node-unrar-js | WASM 实现，无系统依赖 |
| 7Z/CB7 | node-7z + 7zip-bin | 依赖系统 p7zip |
| PDF | pdfjs-dist + pdf-lib | 渲染 + 操作 |
| 图片处理 | sharp | 缩略图生成、压缩 |
| XML 解析 | xml2js | ComicInfo.xml 元数据 |

#### 部署 & 基础设施

| 层面 | 技术 | 说明 |
|------|------|------|
| 容器化 | Docker 多阶段构建 | 3 阶段：deps → build → runner |
| 编排 | Docker Compose | 3 套配置（dev/prod/NAS） |
| 输出模式 | Next.js Standalone | 最小化生产镜像 |
| 进程管理 | Tini | 僵尸进程回收 |
| 权限控制 | su-exec | 容器内降权运行 (uid 1001) |
| 持久化 | Docker Volume | `/data`（数据库）+ `/app/comics`（漫画） |

#### 开发工具链

| 工具 | 说明 |
|------|------|
| Lint | ESLint 9 + eslint-config-next（Core Web Vitals + TypeScript） |
| 构建 | Next.js 内置 Webpack |
| 路径别名 | `@/*` → `./src/*` |
| i18n | 自研多语言（`src/lib/i18n/`） |

#### 架构特点

- **单镜像全栈部署** — 前后端 + 数据库打包在一个 Docker 镜像中，面向 NAS 场景
- **Prisma Driver Adapter 模式** — 绕过 Prisma 原生 Rust 引擎，由 libsql 接管数据库连接
- **模块级单例** — `prisma` 通过 `globalForPrisma` 保证进程内唯一
- **7 种漫画格式全支持** — `.zip/.cbz/.cbr/.rar/.7z/.cb7/.pdf`
- **AI 集成** — 通过外部模型 API 实现漫画分析/智能搜索/重复检测
- **E-Hentai 集成** — 搜索/浏览/下载/代理

### 功能特性

#### 漫画库管理 (书架)

- **双视图模式**: 网格视图 (响应式 2-6 列) 和列表视图，可在工具栏切换
- **搜索**: 按标题、标签模糊搜索
- **标签筛选**: 多标签 OR 筛选，10 种预设颜色
- **分类筛选**: 按分类 (Category) 过滤漫画，支持 Emoji 图标和自定义排序
- **分组管理**: 按分组筛选，支持单本/批量设置分组
- **收藏过滤**: 一键切换仅显示收藏
- **多维排序**: 按标题 / 最近阅读 / 评分 / 添加时间 / 自定义排序，支持升降序
- **拖拽排序**: 网格视图下拖拽手柄自定义排列顺序
- **文件上传**: 支持 `.zip` / `.cbz` / `.cbr` / `.rar` / `.7z` / `.cb7` / `.pdf` 格式
- **自动同步**: 自动扫描 `comics/` 目录及额外挂载目录，新增入库、删除清理

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
- **图片预加载**: 智能预加载相邻页面，提升翻页流畅度
- **阅读时长记录**: 自动记录每次阅读会话的时长和页数

#### 漫画详情页

- 独立的漫画详情页面
- 封面大图展示（支持自定义外部封面 URL）
- 完整元数据展示 (作者/出版社/年份/简介/类型/系列)
- 收藏切换 / 1-5 星评分
- 标签管理 (添加/删除)
- 分类管理 (添加/删除)
- 阅读进度展示
- 元数据翻译

#### 阅读统计

- 独立统计页面 (`/stats`)
- 总阅读时长、总阅读次数、已读漫画数
- 近 30 天阅读时长图表
- 最近阅读记录列表

#### 元数据管理

- 从漫画压缩包内的 `ComicInfo.xml` 自动提取元数据
- 在线元数据搜索与应用 (作者/出版社/年份/简介/类型/系列)
- 批量元数据扫描与翻译
- 丰富的数据库字段：作者、出版社、年份、简介、语言、系列名、系列序号、类型

#### AI 智能功能

- AI 模型设置管理
- 漫画智能分析
- AI 辅助搜索
- AI 重复检测
- 运行状态监控

#### E-Hentai 集成

- 独立浏览页面 (`/ehentai`)
- E-Hentai 画廊搜索与浏览
- 画廊详情查看
- 漫画下载到本地库
- 图片代理（解决跨域）
- 连接设置管理

#### 分类系统

- 类似 Webtoons 的分类分类（动作、恋爱、奇幻等）
- Emoji 图标标识
- 自定义排序
- 按分类筛选漫画

#### 站点设置

- 站点名称自定义
- 漫画目录配置
- 额外漫画目录（支持多目录挂载）
- 缩略图尺寸配置
- 每页显示数量
- 语言与主题偏好
- 缩略图缓存管理

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
- 全部漫画 / 收藏 / 最近阅读分类
- 漫画搜索与下载
- 兼容 Panels、Chunky、KOReader 等外部阅读器

#### 插件系统

- 插件管理器界面
- 权限控制

#### PWA 支持

- 可安装为桌面/移动应用
- Service Worker 离线缓存
- 安装提示引导

#### 国际化 (i18n)

- 中文 / 英文双语支持
- 标签翻译功能
- 语言切换器

#### 后端服务

- **文件系统同步**: 自动扫描目录（含多目录），保持数据库与文件一致
- **多格式解析**: ZIP/CBZ (adm-zip)、RAR/CBR (node-unrar-js)、7Z/CB7 (node-7z)、PDF (pdf-lib + pdfjs-dist)
- **智能过滤**: 过滤 macOS 元数据文件、自然排序页面文件名
- **缩略图缓存**: Sharp 生成可配置尺寸 WebP 封面，缓存到 `.cache/thumbnails/`
- **SQLite 性能优化**: libSQL 原生 PRAGMA 注入 (mmap=256MB, cache=64MB, synchronous=NORMAL)
- **稳定 ID**: 基于文件名 MD5 哈希
- **非 root 运行**: Docker 容器内以 `nextjs:nodejs` 用户运行

### 快速开始

#### 本地开发

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

#### Docker 部署（推荐）

**方式一：使用 Docker Hub 镜像（最简单）**

```bash
# 创建 docker-compose.yml 后一键启动
docker compose -f docker-compose.prod.yml up -d
```

**方式二：本地构建**

```bash
docker compose up -d
```

打开浏览器访问 http://localhost:3000 即可使用。

#### NAS 部署（群晖/威联通/铁威马）

```bash
# 修改 docker-compose.nas.yml 中的路径后启动
docker compose -f docker-compose.nas.yml up -d
```

NAS 配置要点：
- 数据库持久化：`/volume1/docker/nowen-reader/data:/data`
- 漫画目录：`/volume1/comics:/app/comics`（修改为实际路径）
- 支持挂载多个漫画目录，在 Web 设置中添加额外路径
- 时区设置：`TZ=Asia/Shanghai`

#### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `file:{cwd}/data.db` | 数据库文件路径 |
| `COMICS_DIR` | `{cwd}/comics` | 漫画文件目录 |
| `PORT` | `3000` | 服务端口 |
| `NODE_ENV` | `development` | 运行环境 |

### 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 (含 Prisma 生成 + Schema 推送 + Next.js 构建) |
| `npm run start` | 启动生产服务器 |
| `npm run lint` | ESLint 代码检查 |
| `npm run db:push` | 推送 Schema 到数据库 |
| `npm run db:studio` | 打开 Prisma Studio 数据库管理 |
| `npm run db:generate` | 生成 Prisma Client |

### 项目结构

```
nowen-reader/
├── comics/                        # 漫画文件存放目录
├── prisma/
│   └── schema.prisma              # 数据库模型 (User, Comic, Tag, Category, ReadingSession 等)
├── public/
│   ├── manifest.json              # PWA 清单
│   ├── sw.js                      # Service Worker
│   └── icons/                     # PWA 图标
├── src/
│   ├── app/
│   │   ├── layout.tsx             # 根布局
│   │   ├── page.tsx               # 书架主页面
│   │   ├── globals.css            # 全局样式
│   │   ├── pwa-register.tsx       # PWA 注册
│   │   ├── comic/[id]/            # 漫画详情页
│   │   ├── reader/[id]/           # 阅读器页面
│   │   ├── ehentai/               # E-Hentai 浏览页
│   │   ├── stats/                 # 阅读统计页
│   │   ├── recommendations/       # 推荐页
│   │   └── api/                   # RESTful API (57 个端点)
│   │       ├── ai/                # AI 智能 (分析/搜索/重复检测/模型/设置/状态)
│   │       ├── auth/              # 认证 (登录/注册/登出/用户管理)
│   │       ├── comics/            # 漫画 CRUD / 批量 / 重复检测 / 排序 / 封面 / 分类
│   │       ├── ehentai/           # E-Hentai (搜索/画廊/下载/代理/设置/状态)
│   │       ├── metadata/          # 元数据 (搜索/扫描/应用/批量/翻译)
│   │       ├── opds/              # OPDS 协议 (目录/全部/收藏/最近/搜索/下载)
│   │       ├── categories/        # 分类管理
│   │       ├── tags/              # 标签 (列表/翻译)
│   │       ├── stats/             # 阅读统计
│   │       ├── sync/              # 云同步
│   │       ├── cache/             # 缓存管理
│   │       ├── thumbnails/        # 缩略图管理
│   │       ├── site-settings/     # 站点设置
│   │       ├── plugins/           # 插件系统
│   │       ├── recommendations/   # 推荐 (列表/相似)
│   │       └── upload/            # 文件上传
│   ├── components/                # 20 个组件 + 4 个阅读器子组件
│   │   ├── Navbar.tsx             # 导航栏 (搜索/上传/主题/语言/用户)
│   │   ├── ComicCard.tsx          # 漫画卡片 (网格/列表/拖拽)
│   │   ├── BatchToolbar.tsx       # 批量操作工具栏
│   │   ├── DuplicateDetector.tsx  # 重复检测弹窗
│   │   ├── TagFilter.tsx          # 标签筛选器
│   │   ├── CategoryFilter.tsx     # 分类筛选器
│   │   ├── StatsBar.tsx           # 统计栏
│   │   ├── SettingsModal.tsx      # 设置弹窗
│   │   ├── SiteSettingsPanel.tsx  # 站点设置面板
│   │   ├── AISettingsPanel.tsx    # AI 设置面板
│   │   ├── EHentaiSettingsPanel.tsx # E-Hentai 设置面板
│   │   ├── CloudSync.tsx          # 云同步面板
│   │   ├── PluginManager.tsx      # 插件管理器
│   │   ├── MetadataSearch.tsx     # 元数据搜索
│   │   ├── Recommendations.tsx    # 推荐组件
│   │   ├── AuthGuard.tsx          # 认证守卫
│   │   ├── UserMenu.tsx           # 用户菜单
│   │   ├── LanguageSwitcher.tsx   # 语言切换器
│   │   ├── PWAInstall.tsx         # PWA 安装提示
│   │   └── reader/                # 阅读器视图组件
│   │       ├── ReaderToolbar.tsx  # 阅读器工具栏
│   │       ├── SinglePageView.tsx # 单页视图
│   │       ├── DoublePageView.tsx # 双页视图
│   │       └── WebtoonView.tsx    # 长条模式视图
│   ├── hooks/
│   │   ├── useComics.ts           # 核心 Hook (列表/上传/批量/分组/统计)
│   │   └── useImagePreloader.ts   # 图片预加载 Hook
│   ├── lib/
│   │   ├── db.ts                  # 数据库连接 (Prisma + libSQL + PRAGMA 优化)
│   │   ├── config.ts              # 全局配置 (站点设置/目录/缩略图)
│   │   ├── comic-parser.ts        # 漫画文件解析 (异步 fs)
│   │   ├── archive-parser.ts      # 压缩包解析 (ZIP/RAR/7Z/PDF)
│   │   ├── comic-service.ts       # 漫画服务层 (CRUD/搜索/重复检测)
│   │   ├── ai-service.ts          # AI 智能服务
│   │   ├── ehentai-service.ts     # E-Hentai 服务
│   │   ├── auth.ts                # 认证工具
│   │   ├── auth-context.tsx       # 认证上下文
│   │   ├── theme-context.tsx      # 主题上下文 (日/夜间模式)
│   │   ├── cloud-sync.ts          # 云同步逻辑
│   │   ├── metadata-scraper.ts    # 元数据刮削
│   │   ├── tag-translate.ts       # 标签翻译
│   │   ├── opds.ts                # OPDS 协议实现
│   │   ├── plugin-system.ts       # 插件系统
│   │   ├── recommendation.ts      # 推荐算法
│   │   ├── pwa.ts                 # PWA 工具
│   │   └── i18n/                  # 国际化
│   │       ├── index.ts           # 入口
│   │       ├── context.tsx        # i18n 上下文
│   │       └── locales/           # 语言包 (zh-CN / en)
│   └── types/
│       ├── comic.ts               # 漫画/统计类型定义
│       └── reader.ts              # 阅读器类型定义
├── Dockerfile                     # 多阶段 Docker 构建 (deps → build → runner)
├── docker-compose.yml             # 本地构建部署
├── docker-compose.prod.yml        # 生产部署 (Docker Hub 镜像)
├── docker-compose.nas.yml         # NAS 专用部署
├── docker-entrypoint.sh           # 容器入口脚本
├── db-init.mjs                    # 轻量数据库初始化 (替代 Prisma CLI)
└── package.json
```

### 数据库模型

| 模型 | 说明 |
|------|------|
| `User` | 用户 (用户名/密码/昵称/角色) |
| `UserSession` | 用户会话 (Session Token / 过期时间) |
| `Comic` | 漫画 (标题/文件/页数/进度/评分/收藏/元数据/排序) |
| `Tag` | 标签 (名称/颜色) |
| `ComicTag` | 漫画-标签关联 |
| `Category` | 分类 (名称/Slug/Emoji 图标/排序) |
| `ComicCategory` | 漫画-分类关联 |
| `ReadingSession` | 阅读会话 (时长/起止页码) |

### API 接口

#### 认证 (5)

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| GET | `/api/auth/users` | 用户管理 |

#### 漫画管理 (16)

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
| POST/DELETE | `/api/comics/[id]/categories` | 管理分类 |
| GET | `/api/comics/[id]/cover` | 获取封面图 |
| GET | `/api/comics/[id]/thumbnail` | 获取封面缩略图 |
| GET | `/api/comics/[id]/pages` | 获取页面列表 |
| GET | `/api/comics/[id]/page/[pageIndex]` | 获取单页图片 |
| POST | `/api/comics/[id]/translate-metadata` | 翻译元数据 |
| POST | `/api/comics/batch` | 批量操作 (收藏/标签/分组/删除) |
| GET | `/api/comics/duplicates` | 检测重复漫画 |
| POST | `/api/comics/reorder` | 更新拖拽排序 |

#### AI 智能 (6)

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/ai/analyze` | AI 分析漫画 |
| GET | `/api/ai/duplicates` | AI 重复检测 |
| GET | `/api/ai/models` | 获取可用模型列表 |
| POST | `/api/ai/search` | AI 辅助搜索 |
| GET/PUT | `/api/ai/settings` | AI 设置管理 |
| GET | `/api/ai/status` | AI 服务状态 |

#### E-Hentai (6)

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/ehentai/search` | 搜索画廊 |
| GET | `/api/ehentai/gallery/[gid]/[token]` | 获取画廊详情 |
| POST | `/api/ehentai/download` | 下载画廊到本地 |
| GET | `/api/ehentai/proxy` | 图片代理 |
| GET/PUT | `/api/ehentai/settings` | E-Hentai 设置 |
| GET | `/api/ehentai/status` | 连接状态 |

#### 元数据 (5)

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/metadata/search` | 搜索元数据 |
| POST | `/api/metadata/scan` | 扫描 ComicInfo.xml |
| POST | `/api/metadata/apply` | 应用元数据 |
| POST | `/api/metadata/batch` | 批量元数据操作 |
| POST | `/api/metadata/translate-batch` | 批量翻译元数据 |

#### OPDS 协议 (6)

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/opds` | OPDS 目录根 |
| GET | `/api/opds/all` | 全部漫画 |
| GET | `/api/opds/favorites` | 收藏漫画 |
| GET | `/api/opds/recent` | 最近阅读 |
| GET | `/api/opds/search` | OPDS 搜索 |
| GET | `/api/opds/download/[id]` | 下载漫画文件 |

#### 数据与服务 (13)

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/tags` | 获取所有标签 |
| POST | `/api/tags/translate` | 翻译标签 |
| GET | `/api/categories` | 获取所有分类 |
| GET | `/api/stats` | 获取阅读统计 |
| POST | `/api/stats/session` | 记录阅读会话 |
| GET/PUT | `/api/site-settings` | 站点设置 |
| GET/DELETE | `/api/cache` | 缓存管理 |
| GET/DELETE | `/api/thumbnails/manage` | 缩略图管理 |
| POST | `/api/sync` | 云同步 |
| POST | `/api/upload` | 上传漫画文件 |
| GET | `/api/plugins` | 插件列表 |
| GET | `/api/recommendations` | 获取推荐漫画 |
| GET | `/api/recommendations/similar/[id]` | 获取相似推荐 |

### Docker 架构

```
┌─────────────────────────────────────────────┐
│  多阶段构建 (Dockerfile)                      │
│                                             │
│  Stage 1: deps     → npm ci + 原生模块补装    │
│  Stage 2: builder  → prisma generate + build │
│  Stage 3: runner   → Alpine 最小运行镜像      │
│    ├── tini (PID 1 信号处理)                  │
│    ├── su-exec (非 root 运行)                 │
│    ├── p7zip (7z/cb7 解压)                   │
│    └── node server.js (standalone 输出)       │
│                                             │
│  持久化卷:                                    │
│    /data          → SQLite 数据库             │
│    /app/comics    → 漫画文件                   │
│    /app/.cache    → 缩略图缓存                 │
└─────────────────────────────────────────────┘
```

---

## English Documentation

### Introduction

NowenReader is a full-stack local comic reader built with Next.js 16, designed for one-click NAS / Docker deployment. Drop comic files into the `comics/` directory or upload via the web interface — the system automatically scans, parses, generates thumbnails, and catalogs your collection. Features multi-format support, multiple reading modes, comprehensive metadata management, AI-powered analysis, E-Hentai integration, user authentication, cloud sync, OPDS protocol, category system, plugin system, and more.

### Tech Stack

#### Frontend

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.1.6 |
| UI Library | React | 19.2.3 |
| Language | TypeScript | ^5 |
| Styling | Tailwind CSS v4 + PostCSS | ^4 |
| Icons | Lucide React | ^0.475.0 |
| PWA | Service Worker + manifest.json | Custom |

#### Backend (Next.js API Routes)

| Layer | Technology | Description |
|-------|-----------|-------------|
| Runtime | Node.js 20 (Alpine) | Specified in Dockerfile |
| API | Next.js Route Handlers | 57 endpoints under `src/app/api/` |
| Auth | bcryptjs + Session Token | Cookie-based |
| Scraper | cheerio | HTML parsing (E-Hentai integration) |

#### Database

| Layer | Technology | Description |
|-------|-----------|-------------|
| ORM | Prisma | ^7.4.2 |
| Driver Adapter | @prisma/adapter-libsql | ^7.4.2 |
| Underlying Driver | @libsql/client | ^0.17.0 (libsql, SQLite fork) |
| Database | SQLite (WAL mode) | Embedded, zero-config |
| Performance | Custom PRAGMA injection | mmap 256MB + cache 64MB |

#### File Processing

| Format | Library | Description |
|--------|---------|-------------|
| ZIP/CBZ | adm-zip + node-stream-zip | Dual engine |
| RAR/CBR | node-unrar-js | WASM implementation, no system deps |
| 7Z/CB7 | node-7z + 7zip-bin | Requires system p7zip |
| PDF | pdfjs-dist + pdf-lib | Rendering + manipulation |
| Image Processing | sharp | Thumbnail generation & compression |
| XML Parsing | xml2js | ComicInfo.xml metadata |

#### Deployment & Infrastructure

| Layer | Technology | Description |
|-------|-----------|-------------|
| Containerization | Docker multi-stage build | 3 stages: deps → build → runner |
| Orchestration | Docker Compose | 3 configs (dev/prod/NAS) |
| Output Mode | Next.js Standalone | Minimal production image |
| Process Manager | Tini | Zombie process reaping |
| Privilege Control | su-exec | Non-root execution (uid 1001) |
| Persistence | Docker Volume | `/data` (database) + `/app/comics` (comics) |

#### Developer Toolchain

| Tool | Description |
|------|-------------|
| Lint | ESLint 9 + eslint-config-next (Core Web Vitals + TypeScript) |
| Build | Next.js built-in Webpack |
| Path Aliases | `@/*` → `./src/*` |
| i18n | Custom multilingual (`src/lib/i18n/`) |

#### Architecture Highlights

- **Single-image full-stack deployment** — Frontend + backend + database packed in one Docker image, designed for NAS
- **Prisma Driver Adapter mode** — Bypasses Prisma's native Rust engine; libsql manages DB connections
- **Module-level singleton** — `prisma` instance via `globalForPrisma` ensures single instance per process
- **7 comic formats supported** — `.zip/.cbz/.cbr/.rar/.7z/.cb7/.pdf`
- **AI integration** — Comic analysis / smart search / duplicate detection via external model APIs
- **E-Hentai integration** — Search / browse / download / image proxy

### Features

#### Comic Library (Bookshelf)

- **Dual View Modes**: Grid view (responsive 2-6 columns) and list view, switchable from the toolbar
- **Search**: Fuzzy search by title and tags
- **Tag Filtering**: Multi-tag OR filtering with 10 preset colors
- **Category Filtering**: Filter by category with Emoji icons and custom sort order
- **Group Management**: Filter by group, single or batch group assignment
- **Favorites Filter**: One-click toggle to show favorites only
- **Multi-Dimension Sorting**: By title / last read / rating / added date / custom order, ascending or descending
- **Drag & Drop Sorting**: Custom arrangement with drag handles in grid view
- **File Upload**: Supports `.zip` / `.cbz` / `.cbr` / `.rar` / `.7z` / `.cb7` / `.pdf` formats
- **Auto Sync**: Automatically scans the `comics/` directory and extra mounted directories — new files are added, removed files are cleaned up

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
- **Image Preloading**: Smart preloading of adjacent pages for smooth page turns
- **Reading Time Tracking**: Automatically records duration and pages per reading session

#### Comic Detail Page

- Dedicated comic detail page
- Large cover display (supports custom external cover URL)
- Full metadata display (author/publisher/year/description/genre/series)
- Favorite toggle / 1-5 star rating
- Tag management (add/remove)
- Category management (add/remove)
- Reading progress display
- Metadata translation

#### Reading Statistics

- Dedicated statistics page (`/stats`)
- Total reading time, total sessions, comics read
- Last 30 days reading time chart
- Recent reading records list

#### Metadata Management

- Auto-extract metadata from `ComicInfo.xml` inside archives
- Online metadata search and apply (author/publisher/year/description/genre/series)
- Batch metadata scanning and translation
- Rich database fields: author, publisher, year, description, language, series name, series index, genre

#### AI Features

- AI model settings management
- Smart comic analysis
- AI-assisted search
- AI duplicate detection
- Service status monitoring

#### E-Hentai Integration

- Dedicated browsing page (`/ehentai`)
- E-Hentai gallery search and browsing
- Gallery detail viewing
- Download galleries to local library
- Image proxy (CORS bypass)
- Connection settings management

#### Category System

- Webtoons-style genre classification (Action, Romance, Fantasy, etc.)
- Emoji icon identifiers
- Custom sort order
- Filter comics by category

#### Site Settings

- Custom site name
- Comics directory configuration
- Extra comic directories (multi-directory mount support)
- Thumbnail size configuration
- Page size settings
- Language and theme preferences
- Thumbnail cache management

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
- All comics / favorites / recently read categories
- Comic search and download
- Compatible with Panels, Chunky, KOReader and other external readers

#### Plugin System

- Plugin manager interface
- Permission control

#### PWA Support

- Installable as desktop/mobile app
- Service Worker offline caching
- Install prompt guidance

#### Internationalization (i18n)

- Chinese / English bilingual support
- Tag translation
- Language switcher

#### Backend Services

- **File System Sync**: Auto-scans directories (including extra mounts), keeping database consistent with files
- **Multi-Format Parsing**: ZIP/CBZ (adm-zip), RAR/CBR (node-unrar-js), 7Z/CB7 (node-7z), PDF (pdf-lib + pdfjs-dist)
- **Smart Filtering**: Filters macOS metadata files, natural sort for page filenames
- **Thumbnail Cache**: Sharp generates configurable-size WebP covers, cached in `.cache/thumbnails/`
- **SQLite Performance Tuning**: Native libSQL PRAGMA injection (mmap=256MB, cache=64MB, synchronous=NORMAL)
- **Stable IDs**: Based on filename MD5 hash
- **Non-root Execution**: Runs as `nextjs:nodejs` user inside Docker container

### Quick Start

#### Local Development

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

#### Docker Deployment (Recommended)

**Option 1: Docker Hub Image (Simplest)**

```bash
docker compose -f docker-compose.prod.yml up -d
```

**Option 2: Local Build**

```bash
docker compose up -d
```

Open http://localhost:3000 in your browser.

#### NAS Deployment (Synology / QNAP / TerraMaster)

```bash
# Edit paths in docker-compose.nas.yml, then:
docker compose -f docker-compose.nas.yml up -d
```

NAS configuration notes:
- Database persistence: `/volume1/docker/nowen-reader/data:/data`
- Comics directory: `/volume1/comics:/app/comics` (change to your actual path)
- Multiple comic directories supported — add extra paths in Web settings
- Timezone: `TZ=Asia/Shanghai`

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:{cwd}/data.db` | Database file path |
| `COMICS_DIR` | `{cwd}/comics` | Comics directory |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Runtime environment |

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build (Prisma generate + schema push + Next.js build) |
| `npm run start` | Start production server |
| `npm run lint` | ESLint code check |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Prisma Studio for database management |
| `npm run db:generate` | Generate Prisma Client |

### Project Structure

```
nowen-reader/
├── comics/                        # Comic files directory
├── prisma/
│   └── schema.prisma              # Database models (User, Comic, Tag, Category, ReadingSession, etc.)
├── public/
│   ├── manifest.json              # PWA manifest
│   ├── sw.js                      # Service Worker
│   └── icons/                     # PWA icons
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout
│   │   ├── page.tsx               # Bookshelf main page
│   │   ├── comic/[id]/            # Comic detail page
│   │   ├── reader/[id]/           # Reader page
│   │   ├── ehentai/               # E-Hentai browsing page
│   │   ├── stats/                 # Reading statistics page
│   │   ├── recommendations/       # Recommendations page
│   │   └── api/                   # RESTful API (57 endpoints)
│   │       ├── ai/                # AI (analyze/search/duplicates/models/settings/status)
│   │       ├── auth/              # Auth (login/register/logout/me/users)
│   │       ├── comics/            # Comics CRUD / batch / duplicates / reorder / cover / categories
│   │       ├── ehentai/           # E-Hentai (search/gallery/download/proxy/settings/status)
│   │       ├── metadata/          # Metadata (search/scan/apply/batch/translate)
│   │       ├── opds/              # OPDS (catalog/all/favorites/recent/search/download)
│   │       ├── categories/        # Category management
│   │       ├── tags/              # Tags (list/translate)
│   │       ├── stats/             # Reading statistics
│   │       ├── sync/              # Cloud sync
│   │       ├── cache/             # Cache management
│   │       ├── thumbnails/        # Thumbnail management
│   │       ├── site-settings/     # Site settings
│   │       ├── plugins/           # Plugin system
│   │       ├── recommendations/   # Recommendations (list/similar)
│   │       └── upload/            # File upload
│   ├── components/                # 20 components + 4 reader sub-components
│   ├── hooks/                     # Custom Hooks (useComics, useImagePreloader)
│   ├── lib/                       # Core libraries (19 modules + i18n)
│   └── types/                     # TypeScript type definitions
├── Dockerfile                     # Multi-stage Docker build (deps → build → runner)
├── docker-compose.yml             # Local build deployment
├── docker-compose.prod.yml        # Production deployment (Docker Hub image)
├── docker-compose.nas.yml         # NAS deployment
├── docker-entrypoint.sh           # Container entrypoint script
├── db-init.mjs                    # Lightweight DB init (replaces Prisma CLI)
└── package.json
```

### Database Models

| Model | Description |
|-------|-------------|
| `User` | User (username/password/nickname/role) |
| `UserSession` | Session (token/expiry) |
| `Comic` | Comic (title/file/pages/progress/rating/favorite/metadata/sort) |
| `Tag` | Tag (name/color) |
| `ComicTag` | Comic-Tag relation |
| `Category` | Category (name/slug/emoji icon/sort) |
| `ComicCategory` | Comic-Category relation |
| `ReadingSession` | Reading session (duration/start-end pages) |

### API Reference

#### Authentication (5)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register` | User registration |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user info |
| GET | `/api/auth/users` | User management |

#### Comic Management (16)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/comics` | List comics (auto sync/pagination/search/sort) |
| GET | `/api/comics/[id]` | Get comic details |
| DELETE | `/api/comics/[id]/delete` | Delete comic (including disk file) |
| PUT | `/api/comics/[id]/favorite` | Toggle favorite |
| PUT | `/api/comics/[id]/rating` | Update rating |
| PUT | `/api/comics/[id]/progress` | Update reading progress |
| POST | `/api/comics/[id]/tags` | Add tag |
| DELETE | `/api/comics/[id]/tags` | Remove tag |
| POST/DELETE | `/api/comics/[id]/categories` | Manage categories |
| GET | `/api/comics/[id]/cover` | Get cover image |
| GET | `/api/comics/[id]/thumbnail` | Get cover thumbnail |
| GET | `/api/comics/[id]/pages` | Get page list |
| GET | `/api/comics/[id]/page/[pageIndex]` | Get single page image |
| POST | `/api/comics/[id]/translate-metadata` | Translate metadata |
| POST | `/api/comics/batch` | Batch operations (favorite/tag/group/delete) |
| GET | `/api/comics/duplicates` | Detect duplicate comics |
| POST | `/api/comics/reorder` | Update drag-and-drop order |

#### AI (6)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/ai/analyze` | AI comic analysis |
| GET | `/api/ai/duplicates` | AI duplicate detection |
| GET | `/api/ai/models` | List available models |
| POST | `/api/ai/search` | AI-assisted search |
| GET/PUT | `/api/ai/settings` | AI settings |
| GET | `/api/ai/status` | AI service status |

#### E-Hentai (6)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/ehentai/search` | Search galleries |
| GET | `/api/ehentai/gallery/[gid]/[token]` | Get gallery details |
| POST | `/api/ehentai/download` | Download gallery |
| GET | `/api/ehentai/proxy` | Image proxy |
| GET/PUT | `/api/ehentai/settings` | E-Hentai settings |
| GET | `/api/ehentai/status` | Connection status |

#### Metadata (5)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/metadata/search` | Search metadata |
| POST | `/api/metadata/scan` | Scan ComicInfo.xml |
| POST | `/api/metadata/apply` | Apply metadata |
| POST | `/api/metadata/batch` | Batch metadata operations |
| POST | `/api/metadata/translate-batch` | Batch translate metadata |

#### OPDS Protocol (6)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/opds` | OPDS catalog root |
| GET | `/api/opds/all` | All comics |
| GET | `/api/opds/favorites` | Favorite comics |
| GET | `/api/opds/recent` | Recently read |
| GET | `/api/opds/search` | OPDS search |
| GET | `/api/opds/download/[id]` | Download comic file |

#### Data & Services (13)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/tags` | Get all tags |
| POST | `/api/tags/translate` | Translate tags |
| GET | `/api/categories` | Get all categories |
| GET | `/api/stats` | Get reading statistics |
| POST | `/api/stats/session` | Record reading session |
| GET/PUT | `/api/site-settings` | Site settings |
| GET/DELETE | `/api/cache` | Cache management |
| GET/DELETE | `/api/thumbnails/manage` | Thumbnail management |
| POST | `/api/sync` | Cloud sync |
| POST | `/api/upload` | Upload comic file |
| GET | `/api/plugins` | Plugin list |
| GET | `/api/recommendations` | Get recommended comics |
| GET | `/api/recommendations/similar/[id]` | Get similar recommendations |

### Docker Architecture

```
┌─────────────────────────────────────────────────┐
│  Multi-stage Build (Dockerfile)                  │
│                                                  │
│  Stage 1: deps     → npm ci + native module fix  │
│  Stage 2: builder  → prisma generate + build     │
│  Stage 3: runner   → Alpine minimal runtime      │
│    ├── tini (PID 1 signal handling)              │
│    ├── su-exec (non-root execution)              │
│    ├── p7zip (7z/cb7 extraction)                 │
│    └── node server.js (standalone output)        │
│                                                  │
│  Persistent Volumes:                             │
│    /data          → SQLite database              │
│    /app/comics    → Comic files                  │
│    /app/.cache    → Thumbnail cache              │
└─────────────────────────────────────────────────┘
```

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
- [ ] **阅读器自定义布局** — 可调节页面间距、背景色、字体等
  *Reader custom layout — adjustable page gaps, background color, fonts*

---

## 许可证 / License

MIT
