## 1. 原生平台配置

- [x] 1.1 Android Gradle 配置 ONNX Runtime native 依赖（arm64-v8a, armeabi-v7a）
- [x] 1.2 iOS Podfile 配置 ONNX Runtime CocoaPod
- [x] 1.3 pubspec.yaml 添加 `onnxruntime` 依赖

## 2. ONNX 模型管理

- [x] 2.1 实现模型下载服务：URL 指定、断点续传、进度回调
- [x] 2.2 实现模型文件存储管理：本地路径、版本跟踪、校验和验证
- [x] 2.3 实现模型加载：OrtSession 从本地文件初始化
- [x] 2.4 实现 GPU/CPU Provider 自动检测与选择（NNAPI / CoreML / CPU fallback）

## 3. 图像预处理与后处理

- [x] 3.1 实现 bytes → ui.Image 解码（原始图片加载）
- [x] 3.2 实现 Image → Tensor 转换：像素提取、归一化、维度重排（NCHW）
- [x] 3.3 实现 ONNX 推理调用：session.run() 输入输出管理
- [x] 3.4 实现 Tensor → 编码图片：反归一化、钳位、编码回 PNG/JPEG bytes
- [x] 3.5 实现大图分块处理器：tile 分割、独立推理、边缘重叠消除接缝、合并
- [x] 3.6 实现完整推理管线：输入 bytes → 预处理 → 推理 → 后处理 → 输出 bytes

## 4. 放大结果缓存

- [x] 4.1 实现 UpscaleCache：磁盘缓存存储、LRU 淘汰策略、500MB 上限
- [x] 4.2 缓存键设计：comicId + pageIndex + scaleFactor
- [x] 4.3 缓存命中/未命中逻辑集成到推理管线

## 5. 后台预取

- [ ] 5.1 实现预取队列（串行执行，最大并发 1）
- [ ] 5.2 阅读器翻页时触发当前页 + 后续 N 页预取
- [ ] 5.3 开关关闭时清空并停止预取队列

## 6. 阅读器集成

- [x] 6.1 ReaderSettings 增加 `imageUpscaling`、`upscaleQuality` 字段
- [x] 6.2 ReaderSettingsPanel 增加图片放大开关 UI
- [x] 6.3 ReaderSettings 持久化新字段到 SharedPreferences
- [x] 6.4 修改 ComicReaderScreen：图片加载时根据开关状态插入放大管线
- [x] 6.5 修改 AuthenticatedImage：支持放大模式（可选 bytes 后处理）
- [x] 6.6 放大时显示 Loading 状态，完成后无缝替换

## 7. Riverpod 状态管理

- [x] 7.1 实现 UpscaleService 单例中的 Riverpod provider
- [x] 7.2 暴露模型状态（未下载/下载中/就绪/错误）
- [x] 7.3 暴露推理状态（空闲/推理中/完成/失败）
