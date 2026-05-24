# 配置说明

[English](./CONFIGURATION.en.md) · 简体中文

## 环境变量

| 变量 | 默认值 | 说明 |
|:---|:---|:---|
| `PORT` | `3000` | HTTP 服务监听端口 |
| `DATABASE_URL` | `./data/nowen-reader.db` | SQLite 数据库文件路径 |
| `COMICS_DIR` | `./comics` | 漫画主目录 |
| `NOVELS_DIR` | `./novels` | 电子书主目录 |
| `DATA_DIR` | `./.cache` | 数据/缓存目录（缩略图、页面缓存、`site-config.json`、`ai-config.json`） |
| `FRONTEND_DIR` | — | 开发模式下指向独立前端构建产物；生产环境留空以使用嵌入前端 |
| `GIN_MODE` | `debug` | Gin 运行模式（`debug` 详细日志 / `release` 静默） |
| `TZ` | `Asia/Shanghai` | 时区 |
| `PUID` / `PGID` | `1001` / `1001` | Docker 内进程的 UID / GID（用于解决 bind-mount 权限问题） |

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

## 多漫画/电子书目录配置

1. **Docker 环境**：先在 `docker-compose.yml` 中挂载对应宿主机目录到容器内路径

   ```yaml
   volumes:
     - /your/manga/path1:/mnt/manga
     - /your/manga/path2:/mnt/comics2
   ```

2. 在 Web UI **设置 → 额外漫画目录 / 额外电子书目录** 中添加容器内的挂载路径
3. 系统会自动扫描所有配置的目录

## 相关文档

- 📦 [安装指南](./INSTALL.md)
- 📚 [常见问题](./FAQ.md)
- 🛠️ [开发指南](./DEVELOPMENT.md)
