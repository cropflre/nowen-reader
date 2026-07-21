import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/comic_api.dart';
import '../services/cache_service.dart';
import '../services/offline_library_service.dart';

final cacheServiceProvider = Provider<CacheService>((ref) {
  return cacheService;
});

final cacheEntriesProvider =
    StateNotifierProvider<CacheEntriesNotifier, List<CacheEntry>>((ref) {
  return CacheEntriesNotifier(ref.watch(cacheServiceProvider));
});

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

final comicCacheEntryProvider =
    Provider.family<CacheEntry?, String>((ref, comicId) {
  final entries = ref.watch(cacheEntriesProvider);
  try {
    return entries.firstWhere((e) => e.comicId == comicId);
  } catch (_) {
    return null;
  }
});

final totalCacheSizeProvider = Provider<String>((ref) {
  ref.watch(cacheEntriesProvider);
  return cacheService.totalCacheSizeStr;
});

class CacheEntriesNotifier extends StateNotifier<List<CacheEntry>> {
  final CacheService _service;

  CacheEntriesNotifier(this._service) : super([]) {
    _refresh();
  }

  void _refresh() {
    state = _service.allEntries;
  }

  void refresh() => _refresh();

  Future<void> startCache({
    required String comicId,
    required String title,
    required bool isNovel,
    required int totalPages,
    required String serverUrl,
    Map<int, String> chapterTitles = const {},
  }) async {
    final previous = await offlineLibraryService.getManifest(comicId);

    // 当前缓存文件仍按 comicId 存储。若另一个服务器出现相同 ID，
    // 先清理旧缓存再写入，避免把两台服务器的内容混在一起。
    if (previous != null &&
        previous.serverUrl.isNotEmpty &&
        previous.serverUrl != serverUrl) {
      await _service.deleteCache(comicId);
      await offlineLibraryService.deleteManifest(comicId);
    }

    await offlineLibraryService.saveManifest(
      OfflineBookManifest(
        comicId: comicId,
        serverUrl: serverUrl,
        title: title,
        isNovel: isNovel,
        totalChapters: totalPages,
        chapterTitles: chapterTitles,
        cachedAt: DateTime.now(),
      ),
    );

    await _service.cacheComic(
      comicId: comicId,
      title: title,
      totalPages: totalPages,
      serverUrl: serverUrl,
      isNovel: isNovel,
    );
    _refresh();

    _service.addProgressCallback(comicId, (id, downloaded, total) {
      _refresh();
    });
  }

  Future<void> pauseDownload(String comicId) async {
    await _service.pauseDownload(comicId);
    await Future.delayed(const Duration(milliseconds: 500));
    _refresh();
  }

  Future<void> resumeDownload({
    required String comicId,
    required String serverUrl,
  }) async {
    await _service.resumeDownload(
      comicId: comicId,
      serverUrl: serverUrl,
    );
    _refresh();

    _service.addProgressCallback(comicId, (id, downloaded, total) {
      _refresh();
    });
  }

  Future<void> deleteCache(String comicId) async {
    await _service.deleteCache(comicId);
    await offlineLibraryService.deleteManifest(comicId);
    _refresh();
  }

  Future<void> clearAll() async {
    await _service.clearAllCache();
    await offlineLibraryService.clear();
    _refresh();
  }
}

final cacheActionsProvider = Provider<CacheActions>((ref) {
  return CacheActions(ref);
});

class CacheActions {
  final Ref _ref;
  CacheActions(this._ref);

  Future<void> cacheBook(String comicId) async {
    final api = _ref.read(comicApiProvider);
    final serverUrl = _ref.read(apiClientProvider).serverUrl;
    final notifier = _ref.read(cacheEntriesProvider.notifier);

    try {
      final data = await api.getComic(comicId);
      final title = data['title']?.toString() ?? '';
      final isNovel =
          (data['type'] ?? data['comicType'] ?? '').toString() == 'novel';
      var totalPages = data['pageCount'] as int? ?? 0;
      final chapterTitles = <int, String>{};

      if (isNovel) {
        try {
          final pageData = await api.getPages(comicId);
          final pages = (pageData['pages'] as List<dynamic>?) ?? const [];
          if (pages.isNotEmpty) totalPages = pages.length;

          for (var i = 0; i < pages.length; i++) {
            final raw = pages[i];
            if (raw is Map) {
              final value = raw['title'] ?? raw['name'];
              if (value != null && value.toString().trim().isNotEmpty) {
                chapterTitles[i] = value.toString();
              }
            }
          }
        } catch (_) {
          // 章节目录获取失败时仍可按详情中的 pageCount 缓存。
        }
      }

      if (totalPages <= 0 || serverUrl.isEmpty) return;

      await notifier.startCache(
        comicId: comicId,
        title: title,
        isNovel: isNovel,
        totalPages: totalPages,
        serverUrl: serverUrl,
        chapterTitles: chapterTitles,
      );
    } catch (_) {}
  }

  Future<void> deleteCache(String comicId) async {
    await _ref.read(cacheEntriesProvider.notifier).deleteCache(comicId);
  }

  Future<void> pauseDownload(String comicId) async {
    await _ref.read(cacheEntriesProvider.notifier).pauseDownload(comicId);
  }

  Future<void> resumeDownload(String comicId) async {
    final serverUrl = _ref.read(apiClientProvider).serverUrl;
    await _ref.read(cacheEntriesProvider.notifier).resumeDownload(
          comicId: comicId,
          serverUrl: serverUrl,
        );
  }
}
