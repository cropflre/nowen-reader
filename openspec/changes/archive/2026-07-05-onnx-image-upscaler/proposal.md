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
