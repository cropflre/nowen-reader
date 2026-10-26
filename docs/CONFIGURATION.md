# 配置说明

[English](./CONFIGURATION.en.md) · 简体中文

## 环境变量

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `PORT` | `3000` | HTTP 服务监听端口 |
| `BASE_PATH` | `/` | 子路径部署前缀（例如 `/reader` 或 `/reader/`，留空或 `/` 为根部署） |
| `TRUST_PROXY_HEADERS` | `false` | 是否信任 `X-Forwarded-Proto`、`X-Forwarded-Host` 和 `X-Forwarded-Prefix`；仅在可信反向代理后启用 |
| `DATABASE_URL` | `./data/nowen-reader.db` | SQLite 数据库文件路径 |
| `COMICS_DIR` | `./comics` | 漫画主目录 |
| `NOVELS_DIR` | `./novels` | 电子书主目录 |
| `DATA_DIR` | `./.cache` | 数据/缓存目录（缩略图、页面缓存、`site-config.json`、`ai-config.json`） |
| `FRONTEND_DIR` | — | 开发模式下指向独立前端构建产物；生产环境留空以使用嵌入前端 |
| `GIN_MODE` | `debug` | Gin 运行模式（`debug` 详细日志 / `release` 静默） |
| `TZ` | `Asia/Shanghai` | 时区 |
| `PUID` / `PGID` | `1001` / `1001` | Docker 内进程的 UID / GID（用于解决 bind-mount 权限问题） |
| `UMASK` | `0002` | Docker 内新建文件/目录的权限掩码；`0002` 适合 NAS/共享目录的同组写入 |
| `PERMISSION_FIX_MODE` | `auto` | Docker 启动时的权限修复模式：`auto` 自动修复，`relaxed` 在 NAS/SMB/NFS 无法 `chown` 时回退到更宽松权限，`off` 只检测不修复 |

## 子路径部署

Docker 中设置 `BASE_PATH=/reader` 后，Web、API、PWA 和 OPDS 都会挂载到 `/reader`：

```yaml
environment:
  - BASE_PATH=/reader
  - TRUST_PROXY_HEADERS=true
```

`TRUST_PROXY_HEADERS` 仅应在服务位于可信反向代理后时启用。Nginx 示例：

```nginx
location /reader/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

代理必须保留 `/reader` 前缀，不要在转发时将其剥离。配置完成后可通过 `/reader/api/health` 检查服务状态。

## 站点设置

可通过 Web UI 的 **设置** 面板修改，或直接编辑 `{DATA_DIR}/site-config.json`：

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

### 扫描器参数详解

| 参数 | 默认值 | 说明 |
|:---|:---|:---|
| `syncCooldownSec` | 30 | 两次同步之间的最小冷却时间（秒） |
| `fsDebounceMs` | 2000 | 文件变更后延迟触发同步的防抖时间（毫秒） |
| `fullSyncBatchSize` | 50 | 完整同步每批处理的漫画数量 |
| `quickSyncIntervalSec` | 60 | 快速同步轮询间隔（秒），作为 fsnotify 兜底 |
| `fullSyncIntervalSec` | 120 | 完整同步间隔（秒），处理页数统计与 MD5 计算 |
| `md5Workers` | 2 | MD5 计算的并发数；网盘挂载场景建议设为 1–2 |

### 注册模式（registrationMode）

| 取值 | 说明 |
|:---|:---|
| `open` | 开放注册（默认），任何人可自行注册 |
| `invite` | 仅限邀请，管理员生成邀请码后方可注册 |
| `closed` | 关闭注册，仅管理员可创建账号 |

## AI 配置

通过 Web UI 的 **设置 → AI 面板** 配置，或编辑 `{DATA_DIR}/ai-config.json`。AI 功能完全可选，不配置不影响任何核心功能。

**国际供应商**：OpenAI / Anthropic / Google Gemini / Groq / Mistral / Cohere / Together AI / Perplexity / Fireworks 等

**国内供应商**：通义千问 / DeepSeek / 智谱 GLM / 百川 / 月之暗面 Kimi / 零一万物 / MiniMax / 讯飞星火 等

进入 **设置 → AI 面板**，选择供应商、填入 API Key、选择模型，点击「测试连接」验证后保存即可。

## 支持的文件格式

| 类型 | 格式 |
|:---|:---|
| 漫画 / 压缩包 | `.zip` `.cbz` `.cbr` `.rar` `.7z` `.cb7` `.pdf` `.azw3` |
| 小说 / 电子书 | `.txt` `.epub` `.mobi` `.azw3` `.html` `.htm` |
| 图片（压缩包内） | `.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.avif` |

## 外部依赖（Docker 已内置）

| 工具 | 用途 | 是否必须 |
|:---|:---|:---|
| `p7zip` | 解压 .7z / .cb7 文件 | 可选 |
| `mupdf-tools` (mutool) | PDF 页面渲染 | 可选 |
| `libwebp-tools` (cwebp) | WebP 缩略图生成 | 可选（降级为 JPEG） |

> Docker 镜像已内置所有依赖，手动安装二进制时按需安装即可。

## 书库管理与多目录配置（推荐）

新版支持在**管理后台 → 书库管理**中创建独立书库（漫画库、小说库），每个书库可配置：

| 设置 | 说明 |
|:---|:---|
| `rootPath` / `rootPaths` | 书库根目录（支持多根目录与目录浏览选择） |
| `seriesDepth` | 漫画书库的作品目录层级（`1..8`，默认 `1`；小说书库固定为 `1`） |
| `defaultAccess` | 访问控制：`public`（所有登录用户可访问）/ `private`（仅授权用户可访问） |
| `scanEnabled` | 是否参与自动扫描 |

管理员还可以为每个用户或用户组分配书库访问权限，实现**多用户资源隔离**。

### 作品目录层级（`seriesDepth`）与目录分类导航

针对在 NAS/本地磁盘中按分类文件夹整理漫画的场景，可在漫画书库中配置**作品目录层级（`seriesDepth`）**，无需移动任何磁盘文件：

- **`seriesDepth = 1`（默认，兼容既有书库）**：根目录下的第 1 层子目录作为作品名。至少包含 2 个阅读单元的目录折叠为作品；仅 1 个文件的目录按普通单本展示。
  ```text
  /mnt/manga/
  └── 葬送的芙莉莲/
      ├── 第01卷.cbz
      └── 第02卷.cbz
  ```
- **`seriesDepth = 2`（一级分类 + 作品目录）**：第 1 层作为只读**目录分类**，第 2 层作为作品目录，更深层子目录自动识别为作品内的季/卷篇章：
  ```text
  /mnt/manga/
  ├── 韩漫/                  # 第 1 层：目录分类（Web / Flutter 书架“目录分类”导航）
  │   ├── 我独自升级/         # 第 2 层：多话作品
  │   │   ├── 第1季/         # 第 3 层：作品内篇章
  │   │   │   └── 第001话.cbz
  │   │   └── 第2季/
  │   │       └── 第111话.cbz
  │   ├── 某短篇漫画/         # 第 2 层：单话作品（即使只有 1 个章节也保留作品标题）
  │   │   └── 全一话.cbz
  │   └── 独立散本.cbz        # 层级浅于 seriesDepth：保留为独立漫画，不会丢失
  └── 日漫/
      └── 迷宫饭/
          └── 第01卷.cbz
  ```
- **`seriesDepth = 3..8`（多级分类 + 作品目录）**：前 `1 .. (seriesDepth - 1)` 层均可在 Web 与 Flutter 书架通过面包屑逐级浏览（如 `韩漫 → 连载`），不会污染或覆盖手动维护的“分类 / 合集”。
- **安全切换与快照恢复**：在管理后台修改 `seriesDepth` 时会自动生成影响预览；确认保存时在单事务内自动归档切换前快照（保留作品刮削元数据、标签、分类与合集关联），支持导出 JSON 备份与一键恢复，绝不改动磁盘源文件与用户阅读进度。
- **多根目录建议**：若同一漫画书库配置了多个 `rootPaths`，各根目录下相同相对路径（如两个根目录中都有 `韩漫/书A`）会按同一书库相对路径归并；若不希望跨根目录归并，建议拆分为独立书库。

### 旧版目录配置

旧版的 `ComicsDir`、`ExtraComicsDirs`、`NovelsDir`、`ExtraNovelsDirs` 环境变量和"站点设置 → 额外漫画目录"仍然生效，但推荐使用书库管理统一管理。

1. **Docker 环境**：先在 `docker-compose.yml` 中挂载对应宿主机目录到容器内路径

   ```yaml
   volumes:
     - /your/manga/path1:/mnt/manga
     - /your/manga/path2:/mnt/comics2
   ```

2. 在**管理后台 → 书库管理**中创建书库，选择对应的**容器内路径**，例如 `/mnt/manga`，不要填写宿主机路径 `/your/manga/path1`
3. 系统会自动扫描所有已启用且 scanEnabled=true 的书库

### 上传目标书库

管理员可在首页上传区域选择目标书库：

- **选择具体书库**：文件写入该书库的 `rootPath`，并按书库类型校验文件格式
- **选择"默认目录"**（不选书库）：文件写入旧 `comicsDir` / `novelsDir`，兼容旧配置

只有满足以下条件的书库才会出现在选择列表中：
- `enabled = true`
- `rootPath` 非空
- 书库类型与当前页面内容类型匹配（漫画页显示 comic/mixed，小说页显示 novel/mixed）

**推荐**：新用户优先使用书库管理创建 `rootPath` 明确的书库，上传后系统会通过自动扫描将文件入库。

## 相关文档

- 📦 [安装指南](./INSTALL.md)
- 📚 [常见问题](./FAQ.md)
- 🛠️ [开发指南](./DEVELOPMENT.md)
