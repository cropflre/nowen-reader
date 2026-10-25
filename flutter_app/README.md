# NowenReader Flutter App

这是 NowenReader 的 Flutter 客户端，用于 Android（和 iOS）设备。

## 环境要求

- Flutter SDK >= 3.32.0
- Dart SDK >= 3.4.0
- Android Studio / VS Code + Flutter 插件

## 快速开始

```bash
# 1. 安装 Flutter SDK
# 参考: https://docs.flutter.dev/get-started/install

# 2. 安装依赖
cd flutter_app
flutter pub get

# 3. 运行到模拟器/真机
flutter run

# 4. 构建 APK
flutter build apk --release

# 5. 构建 App Bundle (推荐用于 Google Play)
flutter build appbundle --release
```

客户端设置中的版本号读取自安装包。默认版本由 `pubspec.yaml` 的
`version` 决定，也可以在发布构建时使用
`flutter build apk --release --build-name=1.2.3 --build-number=4` 指定。
每次发布应增加构建号，以便 Android 识别更新。

正式版可由 GitHub Actions 统一构建，见 [发布指南](../docs/RELEASING.md)。
Release 构建必须配置现有签名，不再回退为 debug 签名；`flutter run` 等调试构建不受影响。

## 内网 / 公网自动切换

在「设置 → 服务器设置 → 编辑地址」填写同一服务器的主线路、备用线路，
例如一个内网 HTTP 地址和一个公网 HTTPS 地址，选择「自动 · 低延迟优先」。
原有的单地址配置会继续保留；双地址和线路模式按服务器分别保存。

- 前台每 30 秒并发检测两条线路，回到前台时立即检测；后台停止定时检测。
- 与 iOS NowenReaderLite 一致，另一条线路至少快 20 ms 且快 20% 才切换，
  切换后 30 秒内避免反复跳动；当前线路连接失败时可直接回退到可达线路。
- 首次登录且两条线路同时可达时，使用同一会话比较用户和书库身份，
  验证成功后保存结果。暂时无法连接内网不会清除已有验证结果。
- 设置首页仅保留服务器设置入口及当前线路、延迟摘要；二级页面统一管理地址和服务器列表。
- 服务器设置页以绿色勾标出当前线路，显示两条线路的响应延迟、不可达状态和验证结果，
  支持重新测速、重新验证及固定使用某条线路。响应延迟不代表下载速度。
- 切换保留当前阅读页面与登录状态；连接失败的读取请求最多在另一条线路重试一次。
  写入请求不自动重发，以免重复提交。

## 项目结构

```
flutter_app/
├── lib/
│   ├── main.dart                          # 入口文件
│   ├── app/
│   │   ├── app.dart                       # App 主组件
│   │   ├── router.dart                    # GoRouter 路由配置
│   │   └── theme.dart                     # Material 3 主题
│   ├── data/
│   │   ├── api/
│   │   │   ├── api_client.dart            # Dio HTTP 客户端 + Cookie 管理
│   │   │   ├── auth_api.dart              # 认证 API
│   │   │   └── comic_api.dart             # 漫画 API（列表/详情/统计/分组等）
│   │   ├── models/
│   │   │   └── comic.dart                 # 数据模型（Comic, Tag, Category, AuthUser, ComicGroup, ReadingStats）
│   │   └── providers/
│   │       ├── auth_provider.dart          # 认证状态（Riverpod）— 登录/注册/服务器配置
│   │       └── comic_provider.dart         # 漫画列表/详情/标签/分类/统计/分组状态
│   └── features/
│       ├── auth/
│       │   └── login_screen.dart           # 登录 & 注册（含首次管理员设置）
│       ├── home/
│       │   └── home_screen.dart            # 首页漫画列表（网格、排序、筛选、收藏）
│       ├── detail/
│       │   └── comic_detail_screen.dart    # 漫画详情（封面、元数据、评分、阅读状态、标签）
│       ├── reader/
│       │   └── comic_reader_screen.dart    # 漫画阅读器 ⭐（翻页、缩放、进度保存、自动翻页）
│       ├── search/
│       │   └── search_screen.dart          # 搜索（关键词 + 标签/分类筛选）
│       ├── stats/
│       │   └── stats_screen.dart           # 阅读统计（时间/场次/已读、每日图表）
│       ├── settings/
│       │   ├── settings_screen.dart        # 设置（用户信息、服务器入口、退出登录）
│       │   └── server_settings_screen.dart # 服务器设置（地址、线路与延迟、服务器列表）
│       ├── server/
│       │   └── server_config_screen.dart   # 服务器配置 & 连接测试
│       ├── groups/
│       │   └── group_detail_screen.dart    # 分组详情
│       └── shell/
│           └── app_shell.dart              # 底部导航壳（首页/搜索/统计/设置）
└── pubspec.yaml
```

## 技术栈

| 技术 | 用途 |
|------|------|
| Flutter 3.x | 跨平台 UI 框架 |
| Riverpod | 状态管理 |
| GoRouter | 声明式路由 + 认证重定向 |
| Dio + CookieManager | HTTP 请求 + Cookie Session |
| CachedNetworkImage | 图片缓存 |
| PhotoView | 图片手势缩放 |
| SharedPreferences | 本地 KV 存储 |

## 功能清单

- [x] 服务器地址配置 & 连接测试
- [x] 用户登录 / 注册 / 退出
- [x] 首次使用管理员账户创建
- [x] 漫画列表（网格布局、排序、筛选）
- [x] 无限滚动分页加载
- [x] 漫画详情（封面、元数据、标签、评分）
- [x] 漫画阅读器（单页翻页模式）
- [x] 手势缩放（PhotoView）
- [x] 阅读进度自动保存
- [x] 阅读会话追踪
- [x] 自动翻页
- [x] 沉浸式阅读模式
- [x] 收藏 & 评分
- [x] 阅读状态管理（想读/在读/读完/搁置）
- [x] 搜索（关键词 + 标签 + 分类筛选）
- [x] 阅读统计（总览 + 每日图表）
- [x] 分组管理（查看分组详情）
- [x] 深色/浅色主题（跟随系统）
- [x] Material 3 设计
- [x] 底部导航栏
- [ ] 离线缓存
- [ ] AI 功能对接
- [x] 小说阅读器
- [x] 条漫（Webtoon）模式
- [x] 双页模式
