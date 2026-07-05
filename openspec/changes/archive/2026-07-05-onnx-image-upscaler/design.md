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

**选择**: `ComicReaderScreen` 当前页变化时，发射信号触发预取队列

**策略**:
- 当前页码变化 → 预取 N（默认 N=3）张后续页面
- 预取按键进入 `UpscaleService.prefetchQueue`
- 队列串行执行（避免多页同时推理撑爆内存）
- 已缓存的页面跳过

### D7: 放大结果缓存

**选择**: 写入应用文档目录的 `upscale_cache/`，文件命名 `{comicId}_page_{pageIndex}_2x.img`

**理由**: 推理耗时（CPU 1-5 秒/页），缓存避免重复计算。缓存键包含放大倍率，切换模型时自动失效。缓存大小上限 500MB，超限时 LRU 清理。

### D8: ReaderSettings 集成

**字段扩展**:
```dart
class ReaderSettings {
  // ... 现有字段
  final bool imageUpscaling;      // 默认 false
  final UpscaleQuality upscaleQuality; // 标准/高质量
}
```

持久化到 SharedPreferences，与现有机制一致。

### D9: 图片加载流程变更

```
原始:
  download bytes → Image widget

带放大:
  download bytes → 放大开关off → Image widget
                  → 放大开关on → UpscaleProcessor → 检查upscale_cache
                    → cache hit → Image widget
                    → cache miss → ONNX推理 → 写入cache → Image widget
```

## Architecture

```
┌────────────────────────────────────────────────══════════════════┐
│                      UpscaleService（单例）                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ 模型下载/管理  │  │ ONNX Session │  │ 预取队列 + 调度器     │   │
│  └──────────────┘  └──────┬───────┘  └──────────────────────┘   │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
┌───────────────────────────┼──────────────────────────────────────┐
│                  UpscaleProcessor                                │
│  ┌──────────────┐  ┌──────┴───────┐  ┌──────────────────────┐   │
│  │ bytes→ui.Image│  │ Image↔Tensor │  │ 推理 → bytes 编码    │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│  ┌──────────────────────────────────────────────┐               │
│  │ TileProcessor（大图分块→合并）                  │               │
│  └──────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────┼──────────────────────────────────────┐
│                  UpscaleCache                                    │
│  ┌──────────────────────────────────────────────────────┐        │
│  │  LRU 磁盘缓存（上限 500MB，键: comicId_pageIndex_scale）│        │
│  └──────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                            │
                    ┌───────┴────────┐
                    │   Reader 集成   │
                    │  ┌──────────┐   │
                    │  │ 开关 Toggle│   │
                    │  └──────────┘   │
                    └────────────────┘
```

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|---------|
| CPU 推理速度慢（2-5 秒/页） | 默认关闭，用户按需开启；GPU 加速；后台预取降低感知延迟 |
| 模型下载失败或无网络 | 下载前检测网络；断点续传；提供手动重试 |
| 超大图片 OOM | Tile 分块处理；限制并发推理数为 1 |
| iOS 审核（下载可执行内容） | 模型文件为纯数据，不含代码；首次下载提示用户确认 |
| 磁盘缓存膨胀 | 500MB 上限 + LRU 清理策略 |
| 电池消耗 | 放大开关默认关闭；预取限速 |

## Open Questions

- 需要确认具体使用哪个 ONNX 模型版本？Real-ESRGAN-anime 的 ONNX 转换版是否有现成的公开下载源？
- 模型下载 URL 是硬编码还是通过后端 API 下发？
- 预取的 N 值（3/5/8）需要实测后确定最佳值
- iOS CoreML 集成是否需要额外的 .mlpackage 配置
