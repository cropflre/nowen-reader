# 飞牛应用中心上架资料

应用名称：弄文阅读

一句话简介：把 NAS 变成你的私人漫画与小说书房。

## 应用简介

收藏了很多好书，却总在文件夹里翻找？让弄文阅读帮你把散落在 NAS 里的漫画与小说，整理成一座有封面、有分类、记得阅读进度的私人书房。

弄文阅读是一款免费开源的自托管漫画与小说管理阅读应用。自动扫描本地书籍，按封面浏览、用标签整理、把喜欢的作品加入收藏；在电脑上细读，在平板上翻漫画，在手机上接着看。书籍与阅读记录存放在自己的 NAS，什么时候读、怎么整理，由你做主。

## 主要功能

- **漫画、小说，一处收藏**：支持 ZIP、CBZ、CBR、RAR、7Z、CB7、PDF 漫画，以及 TXT、EPUB、MOBI、AZW3、HTML 电子书，适用于无 DRM 的本地文件。
- **文件夹变书架**：自动扫描入库，支持封面与元数据管理、标签分类、收藏评分、批量操作和重复检测，让藏书更容易找到。
- **按你的习惯阅读**：漫画支持单页、双页和条漫模式，搭配缩放、图片滤镜与书签；小说支持章节阅读，让长篇阅读更连贯。
- **换个屏幕，接着读**：通过浏览器、PWA 或配套客户端访问，同一账号同步阅读进度；也可通过 OPDS 连接兼容阅读器。
- **家人的书架，各有空间**：支持多用户和书库权限管理，每位用户独立记录阅读状态与进度。
- **AI 辅助，按需开启**：配置兼容的模型服务后，可使用智能摘要、语义搜索、标签建议等功能。AI 与在线元数据服务需要联网，AI 服务可能另行收费。

把好故事留在自己的书架上，把时间留给阅读。

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

深靛蓝底色对应安静的私人书房，纸白书页组合出隐含的 N 字形；右页的漫画分格与左页的整幅书页分别代表漫画与小说，琥珀色书签呼应继续阅读。

源图：`docs/assets/nowen-reader-fnos-icon.png`。飞牛包使用同一设计导出的 64、256 像素 PNG；另提供 512 和 1024 像素版本用于上架。

使用内置 imagegen 生成。完整生成提示词见 `docs/assets/nowen-reader-fnos-icon-prompt.txt`。

## 打包

使用 Python 3 和官方 fnpack 1.2.3，无需安装前端或 Go 依赖：

```bash
python3 scripts/fpk/build-fpk.py --fnpack /path/to/fnpack-1.2.3-linux-amd64
```

输出：`dist/fpk/nowen-reader-1.2.3.fpk`、`SHA256SUMS` 与 `package-info.json`。

版本及镜像摘要见 `scripts/fpk/release.json`；更新版本时应先确认对应镜像存在，并同步更新摘要。应用中心简介来自 `scripts/fpk/app-description.html`。打包脚本会检查归档中的配置、脚本权限和图标，并写入构建记录。

`install_init` 不创建数据目录；平台准备好应用运行时目录和权限后，由 `install_callback` 以应用用户身份创建数据库目录及 `cache/thumbnails`、`cache/pages`。升级时沿用已有数据目录。

Linux 下可运行安装时序回归测试，覆盖平台尚未创建应用目录、回调目录权限和重复初始化保留数据的场景：

```bash
python3 -B scripts/fpk/test_lifecycle.py -v
```

包结构遵循飞牛官方文档：[Docker 应用案例](https://developer.fnnas.com/docs/examples/docker/)、[Manifest](https://developer.fnnas.com/docs/core-concepts/manifest/)、[应用资源](https://developer.fnnas.com/docs/core-concepts/resource/)。本地打包和容器测试不能代替真实飞牛设备的安装、启动、升级与卸载验收。
