# Comet Design Handoff

- Change: onnx-image-upscaler
- Phase: design
- Mode: compact
- Context hash: c9e865a3a9386af3282ddaba517447f24ff03dadb267cfc24adfe3f07e227433

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/onnx-image-upscaler/proposal.md

- Source: openspec/changes/onnx-image-upscaler/proposal.md
- Lines: 1-39
- SHA256: 8821c1b22dc96b96635ff216c21672df31c28147c890a3c0baca9b337b5fc066

```md
## Why

在移动端阅读漫画时，原始图片的分辨率往往不足以在 Retina 屏幕上清晰显示，缩放的锯齿和模糊影响阅读体验。目前所有图片处理依赖服务器端，客户端缺乏本地 AI 超分能力。通过集成 ONNX Runtime 在本地运行 ESRGAN/Waifu2x 模型，可以在无网络延迟的情况下实时放大漫画图片，让人眼感知更清晰。

## What Changes

- 集成 `onnxruntime` Flutter 包，支持 Android/iOS 本地 ONNX 模型推理
- 内置 ESRGAN/Waifu2x ONNX 模型，实现漫画图片 2x/4x 超分辨率放大
- 首次使用时从远程下载模型文件（可预期 5-50MB 模型）
- GPU 加速优先（Android NNAPI / iOS CoreML），自动回退到 CPU
- 阅读器内增加放大开关，可动态开启/关闭
- 当前页放大 + 后台预取后续页面（翻页后 N 页自动预放大）
- 放大结果写入磁盘缓存，避免重复推理
- 超大图片按 tile 分块处理，防止 OOM

## Capabilities

### New Capabilities

- `local-ai-upscaling`: 本地 AI 图片超分辨率放大，支持 ESRGAN/Waifu2x ONNX 模型，GPU/CPU 混合推理，阅读器内动态开关

### Modified Capabilities

<!-- No existing capabilities are modified -->

## Impact

### Flutter 端新增文件
- `lib/services/upscale_service.dart` — ONNX Runtime 会话管理、模型下载/加载
- `lib/services/upscale_processor.dart` — 图片 ↔ Tensor 转换、推理管线
- `lib/services/upscale_cache.dart` — 放大结果磁盘缓存
- `lib/providers/upscale_provider.dart` — Riverpod 状态管理（模型状态、开关）

### Flutter 端修改文件
- `lib/features/reader/comic_reader_screen.dart` — 集成放大后图片加载流程
- `lib/widgets/reader_settings_panel.dart` — 增加放大开关 UI
- `pubspec.yaml` — 增加 `onnxruntime` 依赖
- `android/app/build.gradle` — ONNX Runtime native libs 配置
- `ios/Podfile` — ONNX Runtime pod 配置
```

## openspec/changes/onnx-image-upscaler/design.md

- Source: openspec/changes/onnx-image-upscaler/design.md
- Lines: 1-174
- SHA256: 269659fc182bd508ca88bdf1598a6cea2d8d9fadc96432bd295e891362a588b3

[TRUNCATED]

```md
## Context

NowenReader Flutter 客户端的漫画阅读器当前通过 `AuthenticatedImage` / `AuthenticatedImageProvider` 从后端 HTTP 获取原始图片字节，直接交由 `PhotoView` 或 `Image` widget 渲染。移动端 Retina 屏幕上原始分辨率不足的图像会出现模糊和锯齿，影响阅读体验。

当前系统：
- 图片流：Server → HTTP streaming → Uint8List → Image.memory / PhotoView
- 缓存层：内存缓存（200 张 LRU）+ 磁盘缓存（CacheService，离线下载用）
- 设置持久化：SharedPreferences（ReaderSettings）

本设计引入本地 ONNX 推理管线，在下载和渲染之间插入超分辨率放大环节。

## Goals / Non-Goals

**Goals:**
- 在 Flutter 端集成 ONNX Runtime，运行 ESRGAN/Waifu2x 模型
- 首次使用时从远程下载模型并缓存到本地
- GPU 优先（NNAPI/CoreML），CPU 回退
- 阅读器内动态开关，默认关闭（用户按需开启）
- 当前页放大 + 后台预取后续 N 页
- 放缩结果写入磁盘缓存，同页不重复推理
- 支持 Android + iOS 双平台

**Non-Goals:**
- 不修改 Go 后端代码
- 不训练或微调模型
- 不放大非漫画类型图片（预览图、头像等）
- 不涉及视频或动画放大
- 不做模型热更新或自动升级

## Decisions

### D1: ONNX Runtime Flutter 包

**选择**: `onnxruntime` pub 包

**理由**: pub.dev 上最成熟的 Flutter ONNX Runtime 绑定，支持 Android（arm64-v8a、armeabi-v7a、x86_64）和 iOS（arm64），提供 `OrtSession` / `OrtTensor` 等完整 Dart API。

**备选**: `flutter_onnx`（维护较少）、直接 FFI 绑定（复杂度高，收益低）。

### D2: 模型来源与分发

**选择**: 首次使用时从 GitHub Releases 或 CDN 下载预转换的 ONNX 模型

**理由**:
- 不打包进 APK/IPA（避免包体积膨胀 5-50MB）
- 懒加载，不影响首次安装速度
- 支持后续扩展更多模型（用户可切换不同模型）

**下载策略**: 检测到放大开关首次开启时触发下载，显示下载进度；WiFi 下自动开始，移动数据提示确认。

### D3: 推荐模型

| 模型 | 放大倍率 | 体积 | 特点 |
|------|---------|------|------|
| Real-ESRGAN-anime | 2x/4x | ~6MB | 动漫/漫画专优化 |
| Waifu2x (compact) | 2x | ~3MB | 轻量，速度优先 |
| Real-ESRGAN | 4x | ~10MB | 通用（非动漫也支持） |

下载策略：默认提供 Real-ESRGAN-anime 2x（平衡体积与质量），后续可扩展。

### D4: GPU/CPU Provider 策略

**选择**: ONNX Runtime Session 初始化时检测可用 provider

```
Android:  NNAPIExecutionProvider (GPU) → CPUExecutionProvider (fallback)
iOS:      CoreMLExecutionProvider (GPU) → CPUExecutionProvider (fallback)
```

**Session 缓存**: 保持单例 OrtSession，避免频繁创建/销毁。

### D5: 图片分块（Tiling）

**选择**: 对超过模型输入尺寸的图片进行非重叠分块推理，再拼接

**理由**: ESRGAN 通常固定输入为 256x256 或 512x512。漫画页可能 2000x3000 像素，直接缩放会丢失细节。分块处理可保持细节完整性，且控制单次推理内存。

**边界处理**: 边缘重叠 8px 消除接缝伪影。

### D6: 后台预取
```

Full source: openspec/changes/onnx-image-upscaler/design.md

## openspec/changes/onnx-image-upscaler/tasks.md

- Source: openspec/changes/onnx-image-upscaler/tasks.md
- Lines: 1-48
- SHA256: 8c387d19a8a2237a4cf826599aa187188547a609c3464c85e8cf553aefed3fd7

```md
## 1. 原生平台配置

- [ ] 1.1 Android Gradle 配置 ONNX Runtime native 依赖（arm64-v8a, armeabi-v7a）
- [ ] 1.2 iOS Podfile 配置 ONNX Runtime CocoaPod
- [ ] 1.3 pubspec.yaml 添加 `onnxruntime` 依赖

## 2. ONNX 模型管理

- [ ] 2.1 实现模型下载服务：URL 指定、断点续传、进度回调
- [ ] 2.2 实现模型文件存储管理：本地路径、版本跟踪、校验和验证
- [ ] 2.3 实现模型加载：OrtSession 从本地文件初始化
- [ ] 2.4 实现 GPU/CPU Provider 自动检测与选择（NNAPI / CoreML / CPU fallback）

## 3. 图像预处理与后处理

- [ ] 3.1 实现 bytes → ui.Image 解码（原始图片加载）
- [ ] 3.2 实现 Image → Tensor 转换：像素提取、归一化、维度重排（NCHW）
- [ ] 3.3 实现 ONNX 推理调用：session.run() 输入输出管理
- [ ] 3.4 实现 Tensor → 编码图片：反归一化、钳位、编码回 PNG/JPEG bytes
- [ ] 3.5 实现大图分块处理器：tile 分割、独立推理、边缘重叠消除接缝、合并
- [ ] 3.6 实现完整推理管线：输入 bytes → 预处理 → 推理 → 后处理 → 输出 bytes

## 4. 放大结果缓存

- [ ] 4.1 实现 UpscaleCache：磁盘缓存存储、LRU 淘汰策略、500MB 上限
- [ ] 4.2 缓存键设计：comicId + pageIndex + scaleFactor
- [ ] 4.3 缓存命中/未命中逻辑集成到推理管线

## 5. 后台预取

- [ ] 5.1 实现预取队列（串行执行，最大并发 1）
- [ ] 5.2 阅读器翻页时触发当前页 + 后续 N 页预取
- [ ] 5.3 开关关闭时清空并停止预取队列

## 6. 阅读器集成

- [ ] 6.1 ReaderSettings 增加 `imageUpscaling`、`upscaleQuality` 字段
- [ ] 6.2 ReaderSettingsPanel 增加图片放大开关 UI
- [ ] 6.3 ReaderSettings 持久化新字段到 SharedPreferences
- [ ] 6.4 修改 ComicReaderScreen：图片加载时根据开关状态插入放大管线
- [ ] 6.5 修改 AuthenticatedImage：支持放大模式（可选 bytes 后处理）
- [ ] 6.6 放大时显示 Loading 状态，完成后无缝替换

## 7. Riverpod 状态管理

- [ ] 7.1 实现 UpscaleService 单例中的 Riverpod provider
- [ ] 7.2 暴露模型状态（未下载/下载中/就绪/错误）
- [ ] 7.3 暴露推理状态（空闲/推理中/完成/失败）
```

## openspec/changes/onnx-image-upscaler/specs/local-ai-upscaling/spec.md

- Source: openspec/changes/onnx-image-upscaler/specs/local-ai-upscaling/spec.md
- Lines: 1-80
- SHA256: f0d4e1457d0da6240cf839d75bb795d1027598c2f77334cff6621b1b4d14e0cd

```md
## ADDED Requirements

### Requirement: ONNX Runtime 模型加载
系统 SHALL 在 Flutter 端集成 ONNX Runtime 引擎，支持加载 ONNX 格式的 ESRGAN/Waifu2x 超分辨率模型。

#### Scenario: 成功加载模型
- **WHEN** 用户首次开启图片放大功能
- **THEN** 系统开始下载预配置的 ONNX 模型文件
- **AND** 下载完成后初始化 OrtSession

#### Scenario: 模型加载失败
- **WHEN** 模型下载失败或文件损坏
- **THEN** 系统显示错误提示，放大功能保持关闭状态
- **AND** 用户可手动重试下载

### Requirement: GPU/CPU 自动选择
系统 SHALL 自动检测设备可用的推理加速 Provider，优先使用 GPU（Android NNAPI / iOS CoreML），不可用时回退到 CPU。

#### Scenario: GPU 可用
- **WHEN** 设备支持 NNAPI（Android）或 CoreML（iOS）
- **THEN** ONNX Session 使用 GPU ExecutionProvider 初始化

#### Scenario: GPU 不可用
- **WHEN** 设备不支持 GPU 加速
- **THEN** ONNX Session 自动回退到 CPUExecutionProvider

### Requirement: 图片超分辨率放大
系统 SHALL 对漫画页面图片进行 AI 超分辨率放大处理，提升人眼感知清晰度。

#### Scenario: 单页放大
- **WHEN** 放大开关开启，用户翻到某一页
- **THEN** 原始图片字节经 ONNX 推理放大后渲染到屏幕
- **AND** 放大结果存入磁盘缓存

#### Scenario: 超大图片分块
- **WHEN** 图片尺寸超过模型输入尺寸（如 512x512）
- **THEN** 系统将图片分割为多个 tile 分别推理
- **AND** 推理完成后合并为完整放大后图片

#### Scenario: 切换放大开关
- **WHEN** 用户关闭放大开关
- **THEN** 系统立即显示原始未放大图片
- **AND** 停止后台预取推理

### Requirement: 后台预取
系统 SHALL 在阅读器翻页后自动预放大后续 N 页（默认 N=3），存入缓存以减少等待。

#### Scenario: 翻页触发预取
- **WHEN** 用户翻到第 X 页
- **THEN** 系统开始后台放大第 X+1, X+2, X+3 页
- **AND** 预取队列串行执行，避免并发 OOM

#### Scenario: 预取命中缓存
- **WHEN** 用户翻到已预取的页面
- **THEN** 系统直接从磁盘缓存读取放大结果
- **AND** 无需重新执行推理

### Requirement: 放大结果缓存
系统 SHALL 将放大后的图片写入磁盘缓存，避免重复推理。缓存上限 500MB，超限时 LRU 清理。

#### Scenario: 缓存命中
- **WHEN** 同一页面第二次打开放大
- **THEN** 系统直接读取缓存，跳过推理
- **AND** 缓存键包含放大倍率以区分不同配置

#### Scenario: 缓存超限
- **WHEN** 缓存总大小超过 500MB
- **THEN** 系统按 LRU 策略淘汰最久未使用的缓存条目

### Requirement: 阅读器内动态开关
漫画阅读器的设置面板 SHALL 增加"图片放大"开关，可动态开启/关闭。设置通过 SharedPreferences 持久化。

#### Scenario: 打开/关闭
- **WHEN** 用户在设置面板切换"图片放大"开关
- **THEN** 当前页即时切换放大/原始显示
- **AND** 设置持久化到 SharedPreferences

#### Scenario: 跨会话保持
- **WHEN** 用户关闭阅读器再次打开
- **THEN** 放大开关保持上次的设置状态
```

