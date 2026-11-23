# 飞牛应用中心上架资料

应用名称：弄文阅读

一句话简介：把飞牛 NAS 里的漫画和小说整理成私人书架，换台设备也能接着读。

## 应用简介

**把飞牛 NAS 里的漫画和小说，变成随手可读的书架。**

把漫画和小说放进飞牛共享目录，弄文阅读会自动扫描入库。打开浏览器，就能按封面挑书、用标签找书，也能接着上次的进度读。弄文阅读免费开源，书籍和阅读记录保存在自己的 NAS。

## 主要功能

- **漫画和小说都能读。** 漫画支持单页、双页和竖向滚动，小说按章节阅读。支持无 DRM 的本地文件，包括 ZIP、CBZ、CBR、RAR、7Z、CB7、PDF 漫画及 TXT、EPUB、MOBI、AZW3、HTML 电子书。
- **藏书多，也好找。** 按封面浏览，用标签、收藏和评分整理书架。支持编辑书籍信息、批量管理和重复检测。
- **换个屏幕，接着读。** 电脑、平板和手机都能用浏览器打开书架，同一账号同步阅读进度。也支持 PWA、配套客户端及兼容 OPDS 的第三方阅读器。
- **全家共用一台飞牛，各读各的。** 为家人分别创建账号，按书库分配访问权限，每个人都有自己的阅读状态和进度。

按需配置 AI 服务，可使用语义搜索、智能摘要和标签建议。AI 与在线元数据服务需要联网，AI 服务可能另行收费。

## 安装与使用

本 FPK 为 Docker 应用包，安装时需要联网拉取镜像；镜像包含 amd64 与 arm64 版本。默认访问地址为 `http://飞牛IP:6680`，也可点击飞牛桌面图标打开。

首次访问按页面引导创建管理员账号。安装后，应用创建 `nowen-reader` 共享目录；将漫画放入其中的 `comics` 文件夹，将小说放入 `novels` 文件夹。也可通过网页上传书籍。数据库和缩略图缓存放在应用的运行时数据目录，与共享书籍分开保存。

本包只挂载应用自己的共享目录，不会自动接入 NAS 上其他现有书库。需要接入其他位置时，请按实际权限配置额外挂载，或使用仓库内的 Docker Compose 部署方式。卸载前请备份书籍和应用数据，并仔细确认飞牛卸载界面的数据清理选项。

## 项目信息

- 项目主页：<https://github.com/cropflre/nowen-reader>
- 问题反馈：<https://github.com/cropflre/nowen-reader/issues>
- QQ 交流群：1093473044
- 微信公众号：Nowen 开源实验室
- 开源协议：GPL-3.0

## 图标设计

深海军蓝底上，白色书页折出 Nowen 的 N，亮蓝色右页用一道分格呼应漫画。飞牛图标采用透明圆角，保留纸白与亮蓝的对比，方便在桌面小尺寸下识别。

源图：`docs/assets/nowen-reader-fnos-icon.png`。飞牛包使用 64、256 像素 PNG，另提供 512 和 1024 像素版本用于上架。Web 和 Flutter 客户端沿用同一图形，iOS 和支持系统裁切的 Web 图标使用不透明底色。

使用内置 imagegen 生成。完整生成提示词见 `docs/assets/nowen-reader-fnos-icon-prompt.txt`。

## v1.2.4 更新说明（相对 v1.2.3）

- **书库管理与大书库性能**：增加书库子目录浏览、分页与系列层级管理能力，改进大规模图书列表的加载和定位。
- **标签筛选与展示**：改善作品标签点击筛选、颜色显示及书库标签刷新体验。
- **Web 阅读与管理**：优化作品详情、书架和目录导航相关交互与数据一致性。
- **Android 客户端**：修复小说阅读页面底部文字裁切和页码遮挡；此修复属于单独的 Android APK，**不包含在飞牛 FPK 包体内**。

飞牛 FPK 为 Docker 自托管服务端/Web 应用，安装时拉取固定的 `v1.2.4` 双架构镜像；已有数据目录不应在升级时被清空。首次升级前建议备份数据库和书库。

## 打包

使用 Python 3 和官方 fnpack 1.2.3，无需安装前端或 Go 依赖：

```bash
python3 scripts/fpk/build-fpk.py --fnpack /path/to/fnpack-1.2.3-linux-amd64
```

输出：`dist/fpk/nowen-reader-1.2.4.fpk`、`SHA256SUMS` 与 `package-info.json`。

版本及镜像摘要见 `scripts/fpk/release.json`；更新版本时应先确认对应镜像存在，并同步更新摘要。应用中心简介来自 `scripts/fpk/app-description.html`。打包脚本会检查归档中的配置、脚本权限和图标，并写入构建记录。

`install_init` 不创建数据目录；平台准备好应用运行时目录和权限后，由 `install_callback` 以应用用户身份创建数据库目录及 `cache/thumbnails`、`cache/pages`。升级时沿用已有数据目录。

Linux 下可运行安装时序回归测试，覆盖平台尚未创建应用目录、回调目录权限和重复初始化保留数据的场景：

```bash
python3 -B scripts/fpk/test_lifecycle.py -v
```

包结构遵循飞牛官方文档：[Docker 应用案例](https://developer.fnnas.com/docs/examples/docker/)、[Manifest](https://developer.fnnas.com/docs/core-concepts/manifest/)、[应用资源](https://developer.fnnas.com/docs/core-concepts/resource/)。本地打包和容器测试不能代替真实飞牛设备的安装、启动、升级与卸载验收。
