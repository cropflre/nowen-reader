# 常见问题（FAQ）

## Docker 启动后无法访问

1. 确认端口映射正确（默认 `6680:3000`）
2. 检查防火墙是否放行 6680 端口
3. 如果使用 NAS，确认 Docker 服务已正确启动
4. 查看日志排查错误：`docker compose logs -f`

## SQLite "out of memory" 错误

通常是**目录权限问题**，而非内存不足。Docker 环境下 `docker-entrypoint.sh` 会自动修复权限。手动运行时请确保 `data/` 目录对当前用户可写。

## 如何添加漫画/小说？

三种方式：

1. **文件目录** — 将文件放入 `comics/` 目录，系统自动扫描入库
2. **Web 上传** — 通过 Web UI 上传按钮直接上传文件
3. **额外目录** — 在 **设置 → 额外漫画目录** 中添加更多路径（Docker 需先挂载对应目录）

## 缩略图不显示

确保安装了 `libwebp-tools`（cwebp 命令）。Docker 镜像已内置。如仍不显示，在 **设置** 中手动触发缩略图批量生成。

## PDF 无法渲染

PDF 渲染需要 `mupdf-tools`（mutool 命令）。Docker 镜像已内置。手动安装二进制时需自行安装该工具。

## 如何配置 AI？

进入 **设置 → AI 面板**，选择供应商、填入 API Key、选择模型，点击「测试连接」验证后保存即可。AI 功能完全可选，不配置不影响任何核心功能。

## 如何使用 OPDS？

使用支持 OPDS 的阅读器（如 KOReader、Moon+ Reader），添加 OPDS 目录地址：

```
http://你的IP:6680/api/opds
```

## 多漫画目录怎么配置？

1. Docker 环境：先在 `docker-compose.yml` 中挂载对应宿主机目录到容器内路径

   ```yaml
   volumes:
     - /your/manga/path1:/mnt/manga
     - /your/manga/path2:/mnt/comics2
   ```

2. 在 Web UI **设置 → 额外漫画目录** 中添加容器内的挂载路径
3. 系统会自动扫描所有配置的目录

## 如何更新到最新版本？

```bash
# Docker 部署
docker compose pull
docker compose up -d

# 二进制部署
# 下载最新 Release，替换二进制文件后重启即可
```

数据库升级自动完成，无需手动操作。

## NAS 上遇到 permission denied 怎么办？

NAS 上挂载主机目录时常因 UID 不匹配导致权限问题。在 Compose 文件的 `environment` 中取消注释并配置：

```yaml
environment:
  - PUID=1001  # 替换为你 NAS 上的 UID
  - PGID=1001  # 替换为你 NAS 上的 GID
```

可通过 `ls -ln` 查看实际 UID/GID。

## 数据库存在哪？是否需要备份？

数据库默认位于 `${DATA_DIR}/nowen-reader.db`（Docker 内为 `/data/nowen-reader.db`）。

**强烈建议定期备份此文件**，这里存储了：
- 所有用户、阅读历史
- 收藏、评分、阅读进度
- 标签、分类、合并分组
- 元数据修改

直接备份 `.db` 文件即可，无需额外导出。

## 内存占用多少？

实际日常占用通常在 100-200 MB。NAS 配置文件 (`docker-compose.nas.yml`) 默认设置 512 MB 内存上限，足够流畅运行。

## 还有问题？

- 🐛 [GitHub Issues](https://github.com/cropflre/nowen-reader/issues)
- 💡 [GitHub Discussions](https://github.com/cropflre/nowen-reader/discussions)
- 💬 QQ 交流群：**1093473044**
