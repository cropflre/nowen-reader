import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../data/api/api_client.dart';

// ============================================================
// 模型 manifest 类型
// ============================================================

/// 单个模型在不同倍率下的信息
class UpscaleModelEntry {
  final String downloadUrl;
  final String md5;
  final int fileSize;

  const UpscaleModelEntry({
    required this.downloadUrl,
    required this.md5,
    this.fileSize = 0,
  });

  factory UpscaleModelEntry.fromJson(Map<String, dynamic> json) =>
      UpscaleModelEntry(
        downloadUrl: json['downloadUrl'] ?? json['url'] ?? '',
        md5: json['md5'] ?? '',
        fileSize: json['fileSize'] ?? 0,
      );
}

/// 模型完整信息
class UpscaleModelInfo {
  final String id;
  final String name;
  final UpscaleModelEntry? x2;
  final UpscaleModelEntry? x4;

  const UpscaleModelInfo({
    required this.id,
    required this.name,
    this.x2,
    this.x4,
  });

  factory UpscaleModelInfo.fromJson(String id, Map<String, dynamic> json) =>
      UpscaleModelInfo(
        id: id,
        name: json['name'] ?? id,
        x2: json['x2'] != null
            ? UpscaleModelEntry.fromJson(json['x2'])
            : null,
        x4: json['x4'] != null
            ? UpscaleModelEntry.fromJson(json['x4'])
            : null,
      );

  UpscaleModelEntry? entryForScale(int scale) =>
      scale == 2 ? x2 : scale == 4 ? x4 : null;
}

/// 模型 manifest 全量
class UpscaleModelManifest {
  final List<UpscaleModelInfo> models;

  const UpscaleModelManifest({required this.models});

  factory UpscaleModelManifest.fromJson(Map<String, dynamic> json) {
    final modelsMap = json['models'] as Map<String, dynamic>? ?? {};
    final list = modelsMap.entries.map((e) {
      final data = e.value is Map<String, dynamic>
          ? e.value as Map<String, dynamic>
          : <String, dynamic>{};
      return UpscaleModelInfo.fromJson(e.key, data);
    }).toList();
    return UpscaleModelManifest(models: list);
  }

  UpscaleModelInfo? getModel(String id) {
    try {
      return models.firstWhere((m) => m.id == id);
    } catch (_) {
      return null;
    }
  }
}

// ============================================================
// 模型下载状态
// ============================================================

enum ModelDownloadStatus { notDownloaded, downloading, ready, error }

// ============================================================
// 模型管理器
// ============================================================

/// 下载进度回调类型
typedef DownloadProgressCallback = void Function(double progress);

/// 管理 ONNX 模型的下载、校验、本地存储和切换
class ModelManager {
  final Dio _dio;

  ModelManager(this._dio);

  /// 模型文件根目录
  Future<Directory> get _modelDir async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/onnx_models');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  /// 模型文件本地路径
  Future<String> _modelPath(String modelId, int scale) async {
    final dir = await _modelDir;
    return '${dir.path}/${modelId}_x$scale.onnx';
  }



  // 当前进行中的下载任务（用于取消）
  CancelToken? _currentDownloadCancel;

  /// 从服务端获取模型列表
  Future<UpscaleModelManifest> fetchModels() async {
    final response = await _dio.get('/upscale/models');
    return UpscaleModelManifest.fromJson(response.data);
  }

  /// 检查模型文件是否本地就绪
  Future<bool> isModelReady(String modelId, int scale) async {
    final path = await _modelPath(modelId, scale);
    final file = File(path);
    if (!await file.exists()) return false;
    final stats = await file.stat();
    return stats.size > 0;
  }

  /// 获取模型文件路径（供 OrtSession 加载）
  Future<String> getModelPath(String modelId, int scale) async {
    return await _modelPath(modelId, scale);
  }

  /// 下载模型文件 (带 MD5 校验)
  Future<void> downloadModel({
    required String modelId,
    required int scale,
    required String url,
    required String expectedMd5,
    DownloadProgressCallback? onProgress,
  }) async {
    final path = await _modelPath(modelId, scale);
    final file = File(path);

    _currentDownloadCancel = CancelToken();

    try {
      await _dio.download(
        url,
        path,
        cancelToken: _currentDownloadCancel,
        onReceiveProgress: (received, total) {
          if (total > 0 && onProgress != null) {
            onProgress(received / total);
          }
        },
      );

      // MD5 校验
      if (expectedMd5.isNotEmpty) {
        final bytes = await file.readAsBytes();
        final digest = md5.convert(bytes);
        final computed = digest.toString();
        if (computed != expectedMd5) {
          await file.delete();
          throw Exception(
              'MD5 mismatch for model $modelId x$scale: expected $expectedMd5, got $computed');
        }
      }
    } finally {
      _currentDownloadCancel = null;
    }
  }

  /// 取消当前模型下载
  void cancelDownload() {
    _currentDownloadCancel?.cancel('用户取消');
    _currentDownloadCancel = null;
  }

  /// 删除本地模型文件
  Future<void> deleteModel(String modelId, int scale) async {
    final path = await _modelPath(modelId, scale);
    final file = File(path);
    if (await file.exists()) {
      await file.delete();
    }
  }
}
