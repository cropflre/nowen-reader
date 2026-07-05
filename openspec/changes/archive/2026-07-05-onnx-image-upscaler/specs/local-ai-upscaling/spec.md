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
