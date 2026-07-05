---
comet_change: onnx-image-upscaler
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-05-onnx-image-upscaler
status: final
---

# ONNX Image Upscaler — 本地 AI 图片超分辨率放大

## 概述

在 NowenReader Flutter 客户端集成 ONNX Runtime，利用 ESRGAN/Waifu2x 模型对漫画图片进行本地超分辨率放大。GPU 优先，自动 CPU 回退，阅读器内动态开关。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    UpscaleService (Singleton)                │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ ModelManager      │  │ ONNX Session │  │ PrefetchQueue │ │
│  │ - 下载/缓存/切换   │  │ - GPU/CPU EP │  │ - 串行队列     │ │
│  │ - x2/x4 双模型    │  │ - provider   │  │ - N=3 预取    │ │
│  └──────────────────┘  └──────┬───────┘  └───────────────┘ │
└───────────────────────────────┼─────────────────────────────┘
                                │
┌───────────────────────────────┼─────────────────────────────┐
│                   UpscaleProcessor                           │
│  ┌──────────────┐  ┌─────────┴──────────┐  ┌────────────┐  │
│  │ bytes → Image │  │ Tensor 预处理      │  │ ONNX       │  │
│  │ decode        │  │ normalize → NCHW  │  │ inference  │  │
│  └──────────────┘  └────────────────────┘  └──────┬─────┘  │
│  ┌──────────────┐  ┌────────────────────┐  ┌──────┴─────┐  │
│  │ postprocess   │  │ Tile 分块+合并     │  │ bytes      │  │
│  │ denormalize   │  │ (8px 重叠接缝)    │  │ encode     │  │
│  └──────────────┘  └────────────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────┼─────────────────────────────┐
│                    UpscaleCache                               │
│  磁盘缓存: comicId_pageIndex_scale.img                        │
│  上限 500MB, LRU 淘汰                                         │
└───────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────┼─────────────────────────────┐
│                   Reader 集成                                 │
│  AuthenticatedImage 加载管线中插入放大环节                     │
│  ReaderSettings: imageUpscaling, upscaleModel, upscaleScale  │
└───────────────────────────────────────────────────────────────┘
```

## 模型管理

### 双模型方案

| 倍率 | 推荐 ONNX 模型 | 预估体积 | 加载时机 |
|------|--------------|---------|---------|
| **x2** (默认) | ESRGAN animevideo x2 或 Waifu2x scale2x ONNX 转换版 | ~3-5MB | 首次开启放大时下载 |
| **x4** | Real-ESRGAN anime 6B ONNX 转换版 | ~8-15MB | 用户切换到 4x 时下载 |

### 模型生命周期

1. 用户打开放大开关 → 检查本地是否存在当前模型文件
2. 不存在 → 从服务端 API `GET /api/upscale/models` 获取下载 URL
3. 开始下载（显示进度），完成后再初始化 OrtSession
4. 用户切换模型或倍率 → 检查新模型文件 → 同上流程
5. 模型文件存储于 `{appDocDir}/onnx_models/`

### 模型 API 协议

```
请求: GET /api/upscale/models
响应:
{
  "models": {
    "realesrgan-anime": {
      "x2": "https://cdn.example.com/realesrgan-anime-x2.onnx",
      "x4": "https://cdn.example.com/realesrgan-anime-x4.onnx",
      "md5_x2": "abc123...",
      "md5_x4": "def456..."
    },
    "waifu2x": {
      "x2": "https://cdn.example.com/waifu2x-x2.onnx",
      "x4": "https://cdn.example.com/waifu2x-x4.onnx",
      "md5_x2": "ghi789...",
      "md5_x4": "jkl012..."
    }
  }
}
```

## 推理管线

### 单页推理流程

```
输入: Uint8List (原始图片字节)
  ↓
① 图片解码 (ui.Image.decodeFromBytes)
  ↓
② 检查图片尺寸 - 是否超过模型输入尺寸 (512×512)
   ├── 否 → 单块推理
   └── 是 → Tile 分块 (512×512 tiles, 8px 边缘重叠)
  ↓
③ Tensor 预处理
   - 缩放至模型输入尺寸 (若需要)
   - RGB 归一化 [0, 255] → [0, 1] 或 [-1, 1]
   - 维度转换 HWC → NCHW (batch=1)
   - 转换为 Float32 List
  ↓
④ ONNX session.run({input: tensor}) → output tensor
  ↓
⑤ 后处理
   - float32 钳位 [0, 1]
   - 反归一化 → [0, 255]
   - Tensor → ui.Image (NCHW → HWC → bytes)
  ↓
⑥ 多 tile 合并（如有分块）
  ↓
⑦ 编码为 JPEG/PNG bytes
  ↓
⑧ 写入磁盘缓存 (UpscaleCache)
  ↓
输出: Uint8List (放大后图片字节)
```

### 大图分块 (Tiling)

对于超过模型输入尺寸的漫画页：

```
┌──────────────────────────┐
│       原始图片 (2000×3000)│
├──────────┬───────────────┤
│ tile 0   │ tile 1        │  ← 每块 512×512
│ 512×512  │ 512×512       │     8px 重叠边缘
├──────────┼───────────────┤
│ tile 2   │ tile 3        │
│ 512×512  │ 512×512       │
├──────────┼───────────────┤
│   ...    │    ...        │
└──────────┴───────────────┘
         ↓ 对各 tile 独立推理
         ↓ 按位置拼接
         ↓ 去除重叠部分
┌──────────────────────────┐
│   放大后图片 (4000×6000)  │
└──────────────────────────┘
```

## GPU/CPU Provider

| 平台 | GPU Provider | 回退 |
|------|-------------|------|
| Android | NNAPIExecutionProvider | CPUExecutionProvider |
| iOS | CoreMLExecutionProvider | CPUExecutionProvider |

OrtSession 初始化伪代码：

```dart
List<OrtSessionOptions> getProviders() {
  final options = OrtSessionOptions();
  if (Platform.isAndroid) {
    try {
      options.addNnapi();         // GPU 优先
    } catch (_) {
      options.enableCpu();        // CPU 回退
    }
  } else if (Platform.isIOS) {
    try {
      options.addCoreMl();        // GPU 优先
    } catch (_) {
      options.enableCpu();        // CPU 回退
    }
  }
  return options;
}
```

Session 缓存：当前选中的模型×倍率对应一个 `OrtSession` 单例。切换模型或倍率时销毁旧 session，创建新 session。

## 阅读器集成

### ReaderSettings 扩展

```dart
class ReaderSettings {
  // ... 现有字段

  // 新增:
  final bool imageUpscaling;        // 放大开关, 默认 false
  final String upscaleModel;        // 模型: "realesrgan-anime" | "waifu2x"
  final int upscaleScale;           // 倍率: 2 | 4
}
```

### 图片加载管线变更

```
AuthenticatedImage._loadImage()
  └→ Dio HTTP download → Uint8List
       ├─ upscaling=OFF → Image.memory(bytes)          ← 原始路径
       └─ upscaling=ON  → UpscaleService.upscale(bytes)
            ├─ UpscaleCache hit → 返回缓存 bytes
            └─ UpscaleCache miss
                 ├─ UpscalePreprocessor.bytesToTensor(bytes)
                 ├─ session.run(tensor) → outputTensor
                 ├─ UpscalePostprocessor.tensorToBytes(outputTensor)
                 ├─ UpscaleCache.save(bytes)
                 └─ Image.memory(bytes)
```

### 预取策略

```
翻页事件 (当前页=X)
  ↓
预取 X+1, X+2, X+3
  ↓
串行入队, 每次并发=1
  ↓
每页: 检查 UpscaleCache → miss → 推理 → 写缓存
```

## 缓存

### UpscaleCache 设计

| 参数 | 值 |
|------|-----|
| 缓存目录 | `{appDocDir}/upscale_cache/` |
| 文件名格式 | `{comicId}_p{pageIndex}_s{scale}.img` |
| 上限 | 500MB |
| 淘汰策略 | LRU (最近最少使用) |
| 缓存键 | comicId + pageIndex + upscaleScale |

### 缓存生命周期

- 写入：推理完成后异步写入
- 读取：显示前先检查缓存
- 失效：切换模型/倍率时自动失效（键中不含模型名，切换模型时需清缓存）
- 清理：达到 500MB 上限时 LRU 淘汰

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 4x 模型文件大，下载费时 | 下载进度展示 + 仅首次需下载 + WiFi/移动数据提示 |
| CPU 推理慢（2-5 秒/页） | 默认关闭，用户按需开启；预取降低感知延迟 |
| 超大图片 OOM | Tile 分块（512×512）+ 串行队列 |
| iOS CoreML 兼容性 | 仅 CoreML ExecutionProvider，测试机覆盖 |
| 磁盘缓存膨胀 | 500MB 硬上限 + LRU 淘汰 |
| 模型文件损坏 | MD5 校验 + 重新下载 |

## 文件清单

### 新增文件

```
lib/services/upscale_service.dart     — ONNX 会话管理、推理入口、预取调度
lib/services/upscale_processor.dart   — 图片 ↔ Tensor 转换、tile 分块
lib/services/upscale_cache.dart       — 放大结果磁盘缓存 (LRU)
lib/services/model_manager.dart       — 模型下载、校验、缓存、切换
lib/providers/upscale_provider.dart   — Riverpod 状态管理
```

### 修改文件

```
lib/features/reader/comic_reader_screen.dart  — 插入放大管线
lib/widgets/reader_settings_panel.dart        — 增加放大开关 UI
lib/widgets/authenticated_image.dart          — 可选放大后处理
lib/widgets/authenticated_image_provider.dart — 同上
pubspec.yaml                                  — onnxruntime 依赖
```
