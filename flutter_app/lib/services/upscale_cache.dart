import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

/// 放大结果磁盘缓存 (LRU, 500MB 上限)
class UpscaleCache {
  static const int maxSizeBytes = 500 * 1024 * 1024; // 500MB
  static const String _cacheDirName = 'upscale_cache';

  String? _cachePath;

  /// 可选的测试用路径覆盖
  UpscaleCache({String? testCachePath}) : _cachePath = testCachePath;

  /// 初始化缓存目录
  Future<void> init() async {
    if (_cachePath != null) return;
    final base = await getApplicationDocumentsDirectory();
    _cachePath = '${base.path}/$_cacheDirName';
    final dir = Directory(_cachePath!);
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
  }

  String _ensurePath() {
    assert(_cachePath != null, 'UpscaleCache not initialized. Call init() first.');
    return _cachePath!;
  }

  /// 缓存文件名
  String _cacheKey(String comicId, int pageIndex, int scale) {
    return '${comicId}_p${pageIndex}_s$scale.img';
  }

  String _filePath(String comicId, int pageIndex, int scale) {
    return '${_ensurePath()}/${_cacheKey(comicId, pageIndex, scale)}';
  }

  /// 检查缓存是否存在
  Future<bool> has(String comicId, int pageIndex, int scale) async {
    final file = File(_filePath(comicId, pageIndex, scale));
    return await file.exists();
  }

  /// 读取缓存
  Future<Uint8List?> get(String comicId, int pageIndex, int scale) async {
    final file = File(_filePath(comicId, pageIndex, scale));
    if (!await file.exists()) return null;

    // LRU: 读取时更新访问时间 (touch 文件 mtime)
    try {
      await file.setLastModified(DateTime.now());
    } catch (_) {}

    return await file.readAsBytes();
  }

  /// 写入缓存
  Future<void> set(String comicId, int pageIndex, int scale, Uint8List data) async {
    await init();
    final file = File(_filePath(comicId, pageIndex, scale));
    await file.writeAsBytes(data);

    // 写入后检查总大小, 超过上限则触发 LRU 淘汰
    await _evictIfNeeded();
  }

  /// 清空所有放大缓存
  Future<void> clear() async {
    final dir = Directory(_ensurePath());
    if (await dir.exists()) {
      await dir.delete(recursive: true);
      await dir.create();
    }
  }

  /// 获取缓存目录当前总大小
  Future<int> _totalSize() async {
    final dir = Directory(_ensurePath());
    if (!await dir.exists()) return 0;
    int total = 0;
    await for (final entity in dir.list(recursive: true)) {
      if (entity is File) {
        total += await entity.length();
      }
    }
    return total;
  }

  /// LRU 淘汰: 删除最早访问的文件直到低于上限
  Future<void> _evictIfNeeded() async {
    final dir = Directory(_ensurePath());
    if (!await dir.exists()) return;

    int total = await _totalSize();
    if (total <= maxSizeBytes) return;

    // 获取所有文件按最后修改时间排序
    final files = <File>[];
    await for (final entity in dir.list()) {
      if (entity is File) {
        files.add(entity);
      }
    }
    files.sort((a, b) {
      final aM = a.lastModifiedSync();
      final bM = b.lastModifiedSync();
      return aM.compareTo(bM); // 最旧的在前
    });

    // 从最旧开始删除直到低于上限
    for (final file in files) {
      if (total <= maxSizeBytes) break;
      final size = await file.length();
      await file.delete();
      total -= size;
    }
  }

  /// 获取当前缓存文件列表及大小 (用于调试/UI)
  Future<Map<String, int>> listCache() async {
    final dir = Directory(_ensurePath());
    if (!await dir.exists()) return {};
    final result = <String, int>{};
    await for (final entity in dir.list()) {
      if (entity is File) {
        result[entity.path.split('/').last] = await entity.length();
      }
    }
    return result;
  }
}

/// 全局单例
final upscaleCache = UpscaleCache();
