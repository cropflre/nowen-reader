# Brainstorm Summary

- Change: onnx-image-upscaler
- Date: 2026-07-04

## Confirmed Technical Approach

**双模型方案**：同时维护 x2 和 x4 两个 ONNX 模型文件，按用户选择加载。

**模型来源**：服务端 API 下发模型下载地址，Flutter 端首次使用时下载并缓存到本地。

**推荐模型组合**：
- **x2**：Real-ESRGAN anime video variant（轻量 ~2-4MB）— 默认选项，速度快
- **x4**：Real-ESRGAN anime 6B ONNX（~8-15MB）— 高质量选项，GPU 下可接受

**推理架构**：方案 A — Main Isolate 串行推理
- ONNX Runtime Flutter 包（`onnxruntime`）
- GPU provider 优先（Android NNAPI / iOS CoreML），CPU 回退
- 串行推理队列，每次一页
- 大图 tile 分块 + 边缘重叠合并（8px 重叠消除接缝）
- 后台预取后续 N 页（默认 N=3）
- `compute()` offload 图片编解码等像素密集操作

## Key Trade-offs and Risks

| 风险 | 缓解措施 |
|------|---------|
| CPU 推理慢（2-5 秒/页） | 默认关闭，GPU 加速，后台预取降低感知延迟 |
| 模型下载失败 | 网络检测 + 断点续传 + 手动重试 |
| 超大图片 OOM | Tile 分块 + 串行推理队列（并发=1） |
| 磁盘缓存膨胀 | 500MB LRU 上限 |
| 模型切换（x2↔x4） | 缓存键含 scale，自动失效；下载完成后重建 OrtSession |

## Testing Strategy

- ONNX 模型加载/下载流程单元测试
- 推理管线（bytes → preprocess → inference → postprocess → bytes）正确性验证
- 不同模型/倍率组合切换测试
- GPU/CPU provider 自动选择验证
- 大图 tile 分块合并一致性测试
- 磁盘缓存 LRU 策略测试
- 阅读器内开关状态持久化测试

## Spec Patches

无。现有 spec 已覆盖双模型方案。
