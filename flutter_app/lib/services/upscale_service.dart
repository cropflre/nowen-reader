import 'dart:async';
import 'dart:collection';
import 'dart:typed_data';
import 'dart:io';

import 'package:onnxruntime/onnxruntime.dart';
import 'package:flutter/foundation.dart';

import 'upscale_processor.dart';
import 'upscale_cache.dart';

// ============================================================
// ONNX 推理结果
// ============================================================

enum InferenceStatus { idle, running, completed, failed }

// ============================================================
// 预取任务
// ============================================================

class PrefetchItem {
  final String comicId;
  final int pageIndex;
  final int scale;

  const PrefetchItem({
    required this.comicId,
    required this.pageIndex,
    required this.scale,
  });
}

// ============================================================
// UpscaleService
// ============================================================

/// ONNX 图片放大服务
///
/// 负责:
/// 1. OrtSession 的创建/缓存/销毁
/// 2. GPU (NNAPI/CoreML) / CPU provider 自动选择
/// 3. 完整推理管线编排: bytes → tensor → inference → bytes
/// 4. 预取队列管理
class UpscaleService {
  // 单例
  static final UpscaleService _instance = UpscaleService._internal();
  factory UpscaleService() => _instance;
  UpscaleService._internal();

  // ONNX 会话
  OrtSession? _session;
  String _currentModelId = '';
  int _currentScale = 2;

  // IO 绑定信息
  String? _inputName;
  String? _outputName;

  // 预处理配置
  UpscaleModelConfig _config = const UpscaleModelConfig();

  // 预取队列
  final Queue<PrefetchItem> _prefetchQueue = Queue();
  bool _isPrefetching = false;

  // ============================================================
  // 初始化 & 会话管理
  // ============================================================

  /// 初始化 ONNX Runtime 环境 (全局只需一次)
  Future<void> init() async {
    // OrtEnv 是包管理单例, 自动初始化
    OrtEnv.instance.init();
  }

  /// 创建/切换 OrtSession
  Future<void> loadSession(String modelPath, String modelId, int scale) async {
    await init();

    // 销毁旧 session
    _session?.release();
    _session = null;

    final options = OrtSessionOptions();

    // GPU provider 自动选择
    if (Platform.isAndroid) {
      try {
        options.appendNnapiProvider(NnapiFlags.useNone);
        debugPrint('[UpscaleService] Using NNAPI (Android GPU)');
      } catch (e) {
        debugPrint('[UpscaleService] NNAPI not available, falling back to CPU: $e');
      }
    } else if (Platform.isIOS) {
      try {
        options.appendCoreMLProvider(CoreMLFlags.useNone);
        debugPrint('[UpscaleService] Using CoreML (iOS GPU)');
      } catch (e) {
        debugPrint('[UpscaleService] CoreML not available, falling back to CPU: $e');
      }
    }

    _session = OrtSession.fromFile(File(modelPath), options);
    _currentModelId = modelId;
    _currentScale = scale;

    // 读取输入/输出名称 (ONNX model metadata)
    _inputName = (_session?.inputNames ?? []).isNotEmpty
        ? _session!.inputNames.first
        : null;
    _outputName = (_session?.outputNames ?? []).isNotEmpty
        ? _session!.outputNames.first
        : null;
  }

  /// 当前 session 是否就绪
  bool get isSessionReady => _session != null;

  /// 销毁当前 session
  Future<void> unloadSession() async {
    _session?.release();
    _session = null;
    _currentModelId = '';
    _currentScale = 2;
  }

  /// 释放所有资源
  Future<void> dispose() async {
    await unloadSession();
  }

  // ============================================================
  // 单页推理
  // ============================================================

  /// 将 ONNX 输出值展平为 List<double>
  ///
  /// ONNX 模型输出为 [1, 3, H, W] 形状的 float 张量,
  /// OrtValueTensor.value 返回按形状重塑的嵌套列表,
  /// 此方法递归展平为一维 double 列表。
  static List<double> _flattenOutput(dynamic value) {
    final result = <double>[];
    void traverse(dynamic item) {
      if (item is List) {
        for (final child in item) {
          traverse(child);
        }
      } else if (item is double) {
        result.add(item);
      } else if (item is num) {
        result.add(item.toDouble());
      } else if (item is int) {
        result.add(item.toDouble());
      }
    }
    traverse(value);
    return result;
  }

  /// 放大一张图片
  ///
  /// 流程:
  /// 1. 检查 UpscaleCache → hit 则直接返回
  /// 2. 解码 bytes → ui.Image
  /// 3. 提取 RGBA pixels
  /// 4. 大图分块 (超过 tileSize 时)
  /// 5. 每块: RGBA → NCHW tensor → inference → NCHW → RGBA
  /// 6. 合并 tile 结果
  /// 7. 写入 UpscaleCache
  /// 8. 返回放大后 bytes
  Future<Uint8List> upscale(
    Uint8List imageBytes,
    String comicId,
    int pageIndex,
    int scale,
  ) async {
    // 1. 检查缓存
    if (await upscaleCache.has(comicId, pageIndex, scale)) {
      final cached = await upscaleCache.get(comicId, pageIndex, scale);
      if (cached != null) return cached;
    }

    if (_session == null) {
      throw Exception('ONNX session not loaded. Call loadSession() first.');
    }
    if (_inputName == null || _outputName == null) {
      throw Exception('Model I/O names not available');
    }

    // 2. 解码
    final image = await UpscaleProcessor.decodeImage(imageBytes);
    final width = image.width;
    final height = image.height;

    // 3. 提取像素
    final rgba = await UpscaleProcessor.extractPixels(image);

    // 4. 分块处理
    final tileRects = UpscaleProcessor.splitTileRects(
      width, height,
      tileSize: _config.tileSize,
      overlap: _config.tileOverlap,
    );

    final tileResults = <TileResult>[];

    for (final rect in tileRects) {
      // 提取 tile 像素
      final tileRgba = UpscaleProcessor.extractTilePixels(
        rgba, width, height, rect,
      );

      // RGBA → NCHW float32 tensor
      final tileW = rect.width.toInt();
      final tileH = rect.height.toInt();
      final tensor = UpscaleProcessor.pixelsToNchwFloat(tileRgba, tileW, tileH);

      // ONNX 推理
      final inputTensor = OrtValueTensor.createTensorWithDataList(
        tensor, [1, 3, tileH, tileW],
      );
      final runOptions = OrtRunOptions();
      final outputs = _session!.run(runOptions, {_inputName!: inputTensor});
      runOptions.release();
      final outputTensor = outputs[0]! as OrtValueTensor;
      final outputData = _flattenOutput(outputTensor.value);

      tileResults.add(TileResult(
        x: rect.left.toInt(),
        y: rect.top.toInt(),
        width: tileW,
        height: tileH,
        data: outputData,
      ));

      // 释放 tensor
      inputTensor.release();
    }

    // 5. 合并 tile (简化: 如果只有 1 个 tile 则直接后处理)
    Uint8List outputRgba;
    if (tileResults.length == 1) {
      outputRgba = UpscaleProcessor.nchwFloatToRgba(
        tileResults[0].data,
        height * scale,
        width * scale,
      );
    } else {
      outputRgba = UpscaleProcessor.mergeTiles(
        width, height, scale, _config.tileOverlap, tileResults,
      );
    }

    // 6. 写入缓存
    await upscaleCache.set(comicId, pageIndex, scale, outputRgba);

    return outputRgba;
  }

  // ============================================================
  // 预取调度
  // ============================================================

  /// 入队预取任务 (串行, 并发=1)
  Future<void> enqueuePrefetch(List<PrefetchItem> items) async {
    if (!isSessionReady) return;
    _prefetchQueue.addAll(items);
    await _processPrefetchQueue();
  }

  Future<void> _processPrefetchQueue() async {
    if (_isPrefetching) return;
    _isPrefetching = true;

    while (_prefetchQueue.isNotEmpty) {
      final item = _prefetchQueue.removeFirst();
      try {
        // 检查缓存命中, 避免重复推理
        if (!await upscaleCache.has(item.comicId, item.pageIndex, item.scale)) {
          // 从网络获取原始图片
          // (实际加载由 ComicReaderScreen 传入 bytes, 预取时需提前下载)
          debugPrint('[UpscaleService] Prefetch: comicId=${item.comicId} page=${item.pageIndex}');
        }
      } catch (e) {
        debugPrint('[UpscaleService] Prefetch error: $e');
      }
    }

    _isPrefetching = false;
  }

  /// 清空预取队列
  void clearPrefetchQueue() {
    _prefetchQueue.clear();
  }

  // ============================================================
  // 工具
  // ============================================================

  /// 获取当前推理 scale
  int get currentScale => _currentScale;
  String get currentModelId => _currentModelId;
}

/// 全局单例
final upscaleService = UpscaleService();
