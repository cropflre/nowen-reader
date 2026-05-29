import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/cache_service.dart';
import '../api/api_client.dart';
import '../api/comic_api.dart';

// ============================================================
// 缓存状态 Provider
// ============================================================

/// 缓存服务 Provider（全局单例）
final cacheServiceProvider = Provider<CacheService>((ref) {
  return cacheService;
});

/// 所有缓存条目列表 Provider（可监听变化）
final cacheEntriesProvider =
    StateNotifierProvider<CacheEntriesNotifier, List<CacheEntry>>((ref) {
  return CacheEntriesNotifier(ref.watch(cacheServiceProvider));
});

/// 指定书籍的缓存状态 Provider
final comicCacheStatusProvider =
    Provider.family<CacheStatus, String>((ref, comicId) {
  final entries = ref.watch(cacheEntriesProvider);
  final entry = entries.firstWhere(
    (e) => e.comicId == comicId,
    orElse: () => CacheEntry(
      comicId: comicId,
      title: '',
      isNovel: false,
      totalPages: 0,
      cachedPages: 0,
      totalBytes: 0,
      status: CacheStatus.notCached,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    ),
  );
  return entry.status;
});

/// 指定书籍的缓存条目 Provider
final comicCacheEntryProvider =
    Provider.family<CacheEntry?, String>((ref, comicId) {
  final entries = ref.watch(cacheEntriesProvider);
  try {
    return entries.firstWhere((e) => e.comicId == comicId);
  } catch (_) {
    return null;
  }
});

/// 总缓存大小字符串 Provider
final totalCacheSizeProvider = Provider<String>((ref) {
  ref.watch(cacheEntriesProvider); // 依赖变化
  return cacheService.totalCacheSizeStr;
});

// ============================================================
// 缓存条目状态通知器
// ============================================================

class CacheEntriesNotifier extends StateNotifier<List<CacheEntry>> {
  final CacheService _service;

  CacheEntriesNotifier(this._service) : super([]) {
    _refresh();
  }

  void _refresh() {
    state = _service.allEntries;
  }

  /// 刷新列表
  void refresh() => _refresh();

  /// 开始缓存漫画
  Future<void> startCache({
    required String comicId,
    required String title,
    required bool isNovel,
    required int totalPages,
    required String serverUrl,
  }) async {
    await _service.cacheComic(
      comicId: comicId,
      title: title,
      totalPages: totalPages,
      serverUrl: serverUrl,
      isNovel: isNovel,
    );
    _refresh();

    // 注册进度回调，实时更新状态
    _service.addProgressCallback(comicId, (id, downloaded, total) {
      _refresh();
    });
  }

  /// 暂停下载
  Future<void> pauseDownload(String comicId) async {
    await _service.pauseDownload(comicId);
    // 等待状态更新
    await Future.delayed(const Duration(milliseconds: 500));
    _refresh();
  }

  /// 恢复下载
  Future<void> resumeDownload({
    required String comicId,
    required String serverUrl,
  }) async {
    await _service.resumeDownload(
        comicId: comicId, serverUrl: serverUrl);
    _refresh();

    _service.addProgressCallback(comicId, (id, downloaded, total) {
      _refresh();
    });
  }

  /// 删除缓存
  Future<void> deleteCache(String comicId) async {
    await _service.deleteCache(comicId);
    _refresh();
  }

  /// 清空所有缓存
  Future<void> clearAll() async {
    await _service.clearAllCache();
    _refresh();
  }
}

// ============================================================
// 缓存操作 Provider（用于触发下载）
// ============================================================

/// 缓存操作 Provider — 提供便捷的缓存触发方法
final cacheActionsProvider = Provider<CacheActions>((ref) {
  return CacheActions(ref);
});

class CacheActions {
  final Ref _ref;
  CacheActions(this._ref);

  /// 缓存整本书（自动获取页数）
  Future<void> cacheBook(String comicId) async {
    final api = _ref.read(comicApiProvider);
    final serverUrl = _ref.read(apiClientProvider).serverUrl;
    final notifier = _ref.read(cacheEntriesProvider.notifier);

    try {
      // 获取书籍信息
      final data = await api.getComic(comicId);
      final title = data['title'] ?? '';
      final isNovel = (data['type'] ?? data['comicType'] ?? '') == 'novel';
      final totalPages = data['pageCount'] ?? 0;

      if (totalPages <= 0) return;

      await notifier.startCache(
        comicId: comicId,
        title: title,
        isNovel: isNovel,
        totalPages: totalPages,
        serverUrl: serverUrl,
      );
    } catch (_) {}
  }

  /// 删除缓存
  Future<void> deleteCache(String comicId) async {
    await _ref.read(cacheEntriesProvider.notifier).deleteCache(comicId);
  }

  /// 暂停下载
  Future<void> pauseDownload(String comicId) async {
    await _ref.read(cacheEntriesProvider.notifier).pauseDownload(comicId);
  }

  /// 恢复下载
  Future<void> resumeDownload(String comicId) async {
    final serverUrl = _ref.read(apiClientProvider).serverUrl;
    await _ref.read(cacheEntriesProvider.notifier).resumeDownload(
          comicId: comicId,
          serverUrl: serverUrl,
        );
  }
}
