# NowenReader

[![Docker Pulls](https://img.shields.io/docker/pulls/cropflre/nowen-reader?style=flat-square)](https://hub.docker.com/r/cropflre/nowen-reader)
[![Docker Image Size](https://img.shields.io/docker/image-size/cropflre/nowen-reader/latest?style=flat-square)](https://hub.docker.com/r/cropflre/nowen-reader/tags)
[![GitHub Stars](https://img.shields.io/github/stars/cropflre/nowen-reader?style=flat-square)](https://github.com/cropflre/nowen-reader)
[![License](https://img.shields.io/github/license/cropflre/nowen-reader?style=flat-square)](https://github.com/cropflre/nowen-reader/blob/main/LICENSE)

**高性能、轻量、NAS 友好的自托管漫画与小说管理阅读平台。**

NowenReader 使用 Go 单二进制后端和内嵌 React 前端，默认采用 SQLite，无需额外数据库服务。镜像支持 `linux/amd64` 和 `linux/arm64`，适合群晖、威联通、绿联、铁威马、家庭服务器和普通 Linux 主机。

- 项目主页：https://github.com/cropflre/nowen-reader
- 完整文档：https://github.com/cropflre/nowen-reader/tree/main/docs
- 问题反馈：https://github.com/cropflre/nowen-reader/issues
- QQ 交流群：`1093473044`

## 功能特性

- 漫画、小说和 PDF 统一管理与阅读
- 自动扫描入库、标签、分类、收藏、评分和阅读状态
- 漫画单页、双页、条漫和 Webtoon 阅读模式
- 小说章节阅读、继续阅读、进度同步和阅读统计
- AniList、Bangumi、MangaDex、MangaUpdates、Kitsu 元数据抓取
- 可选 AI 摘要、标签建议、语义搜索、翻译和阅读辅助
- OPDS 支持，可连接 KOReader、Moon+ Reader 等客户端
- 多用户与书库权限管理
- Web、PWA 和 Flutter 原生客户端
- 深色模式、中英双语界面

## 支持格式

**漫画：** ZIP、CBZ、CBR、RAR、7Z、CB7、PDF

**小说：** TXT、EPUB、MOBI、AZW3、HTML

## 快速开始

### Docker Compose（推荐）

```bash
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
```

启动后访问：

```text
http://localhost:6680
```

首次访问会引导注册管理员账号。将漫画放入 `./comics/`，小说放入 `./novels/`，系统会自动扫描入库。

### 完整 Compose 示例

```yaml
services:
  nowen-reader:
    image: cropflre/nowen-reader:latest
    container_name: nowen-reader
    restart: unless-stopped
    ports:
      - "6680:3000"
    volumes:
      - ./data:/data
      - ./comics:/app/comics
      - ./novels:/app/novels
      - ./cache:/app/.cache
    environment:
      - GIN_MODE=release
      - DATABASE_URL=/data/nowen-reader.db
      - COMICS_DIR=/app/comics
      - NOVELS_DIR=/app/novels
      - DATA_DIR=/app/.cache
      - PORT=3000
      - TZ=Asia/Shanghai
```

保存为 `docker-compose.yml` 后运行：

```bash
docker compose up -d
```

### Docker Run

```bash
mkdir -p nowen-reader/{data,comics,novels,cache}
cd nowen-reader

docker run -d \
  --name nowen-reader \
  --restart unless-stopped \
  -p 6680:3000 \
  -v "$PWD/data:/data" \
  -v "$PWD/comics:/app/comics" \
  -v "$PWD/novels:/app/novels" \
  -v "$PWD/cache:/app/.cache" \
  -e GIN_MODE=release \
  -e DATABASE_URL=/data/nowen-reader.db \
  -e COMICS_DIR=/app/comics \
  -e NOVELS_DIR=/app/novels \
  -e DATA_DIR=/app/.cache \
  -e PORT=3000 \
  -e TZ=Asia/Shanghai \
  cropflre/nowen-reader:latest
```

## 数据目录

| 容器路径 | 用途 | 是否必须持久化 |
|---|---|---|
| `/data` | SQLite 数据库 | **必须** |
| `/app/comics` | 漫画目录 | 推荐 |
| `/app/novels` | 小说目录 | 推荐 |
| `/app/.cache` | 缩略图与页面缓存 | 推荐 |

> 请勿删除 `/data` 对应的宿主机目录，否则会丢失账号、书库配置、阅读进度和其他数据库数据。

## NAS 部署

下载 NAS 专用配置：

```bash
curl -O https://raw.githubusercontent.com/cropflre/nowen-reader/main/docker-compose.nas.yml
```

修改其中的宿主机目录后启动：

```bash
docker compose -f docker-compose.nas.yml up -d
```

群晖路径示例：

```yaml
volumes:
  - /volume1/docker/nowen-reader/data:/data
  - /volume1/docker/nowen-reader/cache:/app/.cache
  - /volume1/comics:/app/comics
  - /volume1/novels:/app/novels
```

漫画或小说分散在多个目录时，可以挂载更多路径，然后进入 Web 界面的 **设置 → 额外漫画目录 / 额外电子书目录** 添加对应的容器内路径。

## 文件权限

NAS 上出现 `permission denied` 时，可以设置：

```yaml
environment:
  - PUID=1000
  - PGID=1000
  - UMASK=0002
```

通过以下命令查看宿主机目录的 UID/GID：

```bash
ls -ln
```

如果使用 SMB、NFS 等无法 `chown` 的挂载，并且 UID/GID 正确后仍无法写入，可以增加：

```yaml
environment:
  - PERMISSION_FIX_MODE=relaxed
```

## 更新镜像

Docker Compose：

```bash
docker compose pull
docker compose up -d
```

使用官方生产配置文件时：

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Docker Run 用户可以重新拉取镜像并重建容器。只要数据目录挂载不变，升级不会删除数据库和书库数据。

## 常用命令

```bash
# 查看日志
docker logs -f nowen-reader

# 查看容器状态
docker ps --filter name=nowen-reader

# 重启
docker restart nowen-reader

# 停止
docker stop nowen-reader

# 删除容器（不会删除已挂载的数据目录）
docker rm nowen-reader
```

## 镜像标签

- `latest`：最新稳定镜像
- `vX.Y.Z`：对应版本发布镜像
- Git 提交 SHA：自动构建的精确提交镜像

建议生产环境使用明确的版本标签，升级前备份 `/data` 目录。

## 更多文档

- 安装指南：https://github.com/cropflre/nowen-reader/blob/main/docs/INSTALL.md
- 配置说明：https://github.com/cropflre/nowen-reader/blob/main/docs/CONFIGURATION.md
- API 文档：https://github.com/cropflre/nowen-reader/blob/main/docs/API.md
- 常见问题：https://github.com/cropflre/nowen-reader/blob/main/docs/FAQ.md
- 开发指南：https://github.com/cropflre/nowen-reader/blob/main/docs/DEVELOPMENT.md
- Flutter 客户端：https://github.com/cropflre/nowen-reader/blob/main/flutter_app/README.md

## 开源协议

NowenReader 使用 [GNU General Public License v3.0](https://github.com/cropflre/nowen-reader/blob/main/LICENSE) 发布。