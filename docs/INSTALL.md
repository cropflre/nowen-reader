# 安装指南

[English](./INSTALL.en.md) · 简体中文

NowenReader 提供 5 种部署方式，按你的环境选择最适合的方案：

| 方式 | 适用场景 | 推荐度 |
|:---|:---|:---:|
| [Docker Hub 镜像](#方式-1docker-hub-镜像推荐) | 大多数用户，开箱即用 | ⭐⭐⭐⭐⭐ |
| [NAS 部署](#方式-2nas-部署群晖--威联通--绿联--铁威马) | 群晖 / 威联通 / 绿联 / 铁威马等 NAS | ⭐⭐⭐⭐⭐ |
| [源码构建 Docker](#方式-3源码构建-docker) | 需要定制构建的用户 | ⭐⭐⭐ |
| [从源码编译](#方式-4从源码编译二进制) | 不使用 Docker 的环境 | ⭐⭐⭐ |
| [预编译二进制](#方式-5预编译二进制) | 直接运行无需编译 | ⭐⭐⭐⭐ |

---

## 方式 1：Docker Hub 镜像（推荐）

> 适用于大多数用户，开箱即用。

```bash
# 下载配置文件
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.prod.yml

# 启动
docker compose -f docker-compose.prod.yml up -d

# 访问 http://localhost:6680
```

**更新版本：**

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## 方式 2：NAS 部署（群晖 / 威联通 / 绿联 / 铁威马）

> 专为 NAS 环境优化，内存限制 512 MB，轻量可靠。

```bash
# 下载 NAS 专用配置
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.nas.yml

# 编辑配置，修改路径为 NAS 上的实际路径
vi docker-compose.nas.yml

# 启动
docker compose -f docker-compose.nas.yml up -d
```

### NAS 路径映射示例（以群晖为例）

| 容器路径 | 宿主机路径示例 | 说明 |
|:---|:---|:---|
| `/data` | `/volume1/docker/nowen-reader/data` | 数据库（重要，勿删） |
| `/app/.cache` | `/volume1/docker/nowen-reader/cache` | 缩略图与页面缓存 |
| `/app/comics` | `/volume1/comics` | 漫画主目录 |
| `/app/novels` | `/volume1/novels` | 电子书主目录（可选） |

> 💡 **多目录挂载**：如果漫画/小说分散在多个文件夹，将它们全部挂载进容器（如 `/mnt/manga`、`/mnt/novels2`），然后在 Web 界面 **设置 → 额外漫画目录 / 额外电子书目录** 中添加对应路径即可。
>
> 🔑 **权限问题**：NAS 上如遇到 `permission denied`，可在 compose 的 `environment` 中取消注释并设置 `PUID` / `PGID` 为宿主机文件的实际 UID/GID（通过 `ls -ln` 查看）。

---

## 方式 3：源码构建 Docker

```bash
git clone https://github.com/cropflre/nowen-reader.git
cd nowen-reader

# 一键构建并启动
docker compose up -d

# 访问 http://localhost:6680
```

---

## 方式 4：从源码编译二进制

> 适用于不使用 Docker 的环境，或需要定制化构建的开发者。

**前置条件**：Go 1.23+，Node.js 20+（可选，仅构建前端需要）

```bash
git clone https://github.com/cropflre/nowen-reader.git
cd nowen-reader

# 仅构建后端（API-only 模式，不含前端）
make build

# 构建含前端的完整版本（推荐）
make build-full

# 运行
./nowen-reader
```

---

## 方式 5：预编译二进制

从 [GitHub Releases](https://github.com/cropflre/nowen-reader/releases) 下载对应平台的二进制文件，无需编译直接运行：

| 平台 | 文件名 |
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

## 首次使用

1. 浏览器访问 `http://localhost:6680`
2. 注册管理员账号
3. 将漫画文件放入 `./comics/` 目录、小说放入 `./novels/` 目录
4. 系统会自动扫描入库
5. 也可以通过 Web UI 直接上传文件

## 下一步

- 📖 [配置说明](./CONFIGURATION.md) — 环境变量、站点设置、AI 配置
- 📚 [常见问题](./FAQ.md) — 部署、权限、缩略图等问题
- 🛠️ [开发指南](./DEVELOPMENT.md) — 本地开发与贡献
