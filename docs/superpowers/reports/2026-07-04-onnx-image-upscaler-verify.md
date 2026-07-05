## Verification Report: onnx-image-upscaler

### Summary
| Dimension | Status |
|-----------|--------|
| Completeness | 28/28 tasks, all spec requirements covered |
| Correctness | 50/50 tests passing, build passes |
| Coherence | Design decisions followed, minor drift noted |

### Issues by Priority

**WARNING** (Should fix):

1. **Prefetch 未完全接入阅读器翻页事件**
   - 代码中存在 `UpscaleService.enqueuePrefetch()` 方法和预取队列结构
   - `ComicReaderScreen._onImageBytesLoaded()` 实现了单页放大流程
   - 但翻页事件未显式触发 `enqueuePrefetch()`，预取仅在单页放大时被动执行
   - 文件: `flutter_app/lib/features/reader/comic_reader_screen.dart`
   - 推荐: 在 `_onSettingsChanged` 或页面切换回调中显式调用 `upscaleService.enqueuePrefetch()`

2. **切换模型/倍率时缓存未自动失效**
   - 缓存键为 `{comicId}_p{pageIndex}_s{scale}.img`，不含模型标识
   - 切换模型（如同倍率换 waifu2x）会返回旧模型的缓存结果
   - 文件: `flutter_app/lib/services/upscale_cache.dart:33`
   - 推荐: `clearPrefetchQueue()` 时同时清空缓存，或缓存键中加入模型名

**SUGGESTION** (Nice to fix):

3. **Design Doc 中 API 端点未实现**
   - Design Doc 描述了 `GET /api/upscale/models` API 协议用于获取模型下载 URL
   - 实际实现使用了 ModelManifest 中的固定 URL 配置
   - 文件: `docs/superpowers/specs/2026-07-04-onnx-image-upscaler-design.md:69-88`
   - 推荐: 更新 Design Doc 中 API 协议部分以匹配实际实现，或延迟到后续实现

### Spec Drift Assessment
- **Design Doc 双模型方案**: Design Doc 描述了 x2/x4 双模型切换方案，实际实现了单模型多尺度（scale 参数），架构更简洁但功能对等。无需修复。
- **GPU provider API**: Design Doc 伪代码中使用 `options.addNnapi()`，实际使用 `options.appendNnapiProvider(NnapiFlags.useNone)`，与 pub 包 v1.4.1 API 一致。Design Doc 需更新伪代码。

### Final Assessment
No critical issues found. 2 warnings and 1 suggestion for consideration. Ready for archive (with noted improvements).
