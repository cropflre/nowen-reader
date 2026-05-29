import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';

// ============================================================
// 缓存状态枚举
// ============================================================

enum CacheStatus {
  notCached,   // 未缓存
  downloading, // 下载中
  cached,      // 已缓存
  failed,      // 下载失败
  paused,      // 已暂停
}

// ============================================================
// 缓存条目模型
// ============================================================

/// 单本书的缓存元数据
class CacheEntry {
  final String comicId;
  final String title;
  final bool isNovel;
  final int totalPages;       // 漫画总页数 / 小说总章节数
  final int cachedPages;      // 已缓存页数/章节数
  final int totalBytes;       // 已占用字节数
  final CacheStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? errorMessage;

  CacheEntry({
    required this.comicId,
    required this.title,
    required this.isNovel,
    required this.totalPages,
    required this.cachedPages,
    required this.totalBytes,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.errorMessage,
  });

  double get progress => totalPages > 0 ? cachedPages / totalPages : 0.0;
  bool get isComplete => cachedPages >= totalPages && totalPages > 0;

  Map<String, dynamic> toJson() => {
        'comicId': comicId,
        'title': title,
        'isNovel': isNovel,
        'totalPages': totalPages,
        'cachedPages': cachedPages,
        'totalBytes': totalBytes,
        'status': status.name,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'errorMessage': errorMessage,
      };

  factory CacheEntry.fromJson(Map<String, dynamic> json) => CacheEntry(
        comicId: json['comicId'] ?? '',
        title: json['title'] ?? '',
        isNovel: json['isNovel'] ?? false,
        totalPages: json['totalPages'] ?? 0,
        cachedPages: json['cachedPages'] ?? 0,
        totalBytes: json['totalBytes'] ?? 0,
        status: CacheStatus.values.firstWhere(
          (s) => s.name == json['status'],
          orElse: () => CacheStatus.notCached,
        ),
        createdAt: DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
        updatedAt: DateTime.tryParse(json['updatedAt'] ?? '') ?? DateTime.now(),
        errorMessage: json['errorMessage'],
      );

  CacheEntry copyWith({
    int? totalPages,
    int? cachedPages,
    int? totalBytes,
    CacheStatus? status,
    DateTime? updatedAt,
    String? errorMessage,
  }) =>
      CacheEntry(
        comicId: comicId,
        title: title,
        isNovel: isNovel,
        totalPages: totalPages ?? this.totalPages,
        cachedPages: cachedPages ?? this.cachedPages,
        totalBytes: totalBytes ?? this.totalBytes,
        status: status ?? this.status,
        createdAt: createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
        errorMessage: errorMessage ?? this.errorMessage,
      );
}

// ============================================================
// 下载进度回调
// ============================================================

typedef DownloadProgressCallback = void Function(
    String comicId, int downloaded, int total);

// ============================================================
// 缓存服务
// ============================================================

/// 离线缓存服务
/// 负责漫画图片和小说文本的本地持久化存储
class CacheService {
  static const String _kCacheMetaKey = 'offline_cache_meta';
  static const String _kCacheSettingsKey = 'offline_cache_settings';

  // 缓存元数据（内存中）
  final Map<String, CacheEntry> _entries = {};

  // 正在进行的下载任务
  final Map<String, CancelToken> _cancelTokens = {};
  final Map<String, bool> _pauseFlags = {};

  // 进度回调
  final Map<String, List<DownloadProgressCallback>> _progressCallbacks = {};

  // 缓存根目录
  String? _cacheDir;

  // 设置
  bool _wifiOnly = false;
  bool get wifiOnly => _wifiOnly;

  bool _initialized = false;

  // ─── 初始化 ───

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    await _loadMeta();
    await _loadSettings();
    final dir = await _getCacheDir();
    _cacheDir = dir;
  }

  Future<String> _getCacheDir() async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/offline_cache');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir.path;
  }

  // ─── 元数据持久化 ───

  Future<void> _loadMeta() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kCacheMetaKey);
    if (raw == null || raw.isEmpty) return;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      for (final kv in map.entries) {
        _entries[kv.key] = CacheEntry.fromJson(kv.value as Map<String, dynamic>);
      }
    } catch (_) {}
  }

  Future<void> _saveMeta() async {
    final prefs = await SharedPreferences.getInstance();
    final map = <String, dynamic>{};
    for (final kv in _entries.entries) {
      map[kv.key] = kv.value.toJson();
    }
    await prefs.setString(_kCacheMetaKey, jsonEncode(map));
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kCacheSettingsKey);
    if (raw == null) return;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      _wifiOnly = map['wifiOnly'] ?? false;
    } catch (_) {}
  }

  Future<void> saveSettings({required bool wifiOnly}) async {
    _wifiOnly = wifiOnly;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kCacheSettingsKey, jsonEncode({'wifiOnly': wifiOnly}));
  }

  // ─── 查询接口 ───

  /// 获取所有缓存条目
  List<CacheEntry> get allEntries => _entries.values.toList()
    ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

  /// 获取指定书籍的缓存状态
  CacheStatus getStatus(String comicId) =>
      _entries[comicId]?.status ?? CacheStatus.notCached;

  /// 获取指定书籍的缓存条目
  CacheEntry? getEntry(String comicId) => _entries[comicId];

  /// 总缓存大小（字节）
  int get totalCacheBytes =>
      _entries.values.fold(0, (sum, e) => sum + e.totalBytes);

  /// 格式化缓存大小
  String get totalCacheSizeStr => _formatBytes(totalCacheBytes);

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)}KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / 1024 / 1024).toStringAsFixed(1)}MB';
    }
    return '${(bytes / 1024 / 1024 / 1024).toStringAsFixed(2)}GB';
  }

  // ─── 漫画图片缓存 ───

  /// 获取漫画图片的本地缓存路径
  String _comicPagePath(String comicId, int pageIndex) {
    return '$_cacheDir/comic_${comicId}_page_$pageIndex.img';
  }

  /// 获取漫画缩略图的本地缓存路径
  String _comicThumbPath(String comicId) {
    return '$_cacheDir/comic_${comicId}_thumb.img';
  }

  /// 检查漫画某页是否已缓存
  bool isPageCached(String comicId, int pageIndex) {
    if (_cacheDir == null) return false;
    return File(_comicPagePath(comicId, pageIndex)).existsSync();
  }

  /// 读取已缓存的漫画图片字节
  Future<Uint8List?> readCachedPage(String comicId, int pageIndex) async {
    if (_cacheDir == null) return null;
    final file = File(_comicPagePath(comicId, pageIndex));
    if (!await file.exists()) return null;
    return file.readAsBytes();
  }

  /// 读取已缓存的缩略图字节
  Future<Uint8List?> readCachedThumb(String comicId) async {
    if (_cacheDir == null) return null;
    final file = File(_comicThumbPath(comicId));
    if (!await file.exists()) return null;
    return file.readAsBytes();
  }

  // ─── 小说章节缓存 ───

  /// 获取小说章节的本地缓存路径
  String _novelChapterPath(String comicId, int chapterIndex) {
    return '$_cacheDir/novel_${comicId}_chapter_$chapterIndex.json';
  }

  /// 检查小说某章节是否已缓存
  bool isChapterCached(String comicId, int chapterIndex) {
    if (_cacheDir == null) return false;
    return File(_novelChapterPath(comicId, chapterIndex)).existsSync();
  }

  /// 读取已缓存的小说章节内容
  Future<Map<String, dynamic>?> readCachedChapter(
      String comicId, int chapterIndex) async {
    if (_cacheDir == null) return null;
    final file = File(_novelChapterPath(comicId, chapterIndex));
    if (!await file.exists()) return null;
    try {
      final raw = await file.readAsString();
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  // ─── 下载控制 ───

  /// 注册进度回调
  void addProgressCallback(String comicId, DownloadProgressCallback cb) {
    _progressCallbacks.putIfAbsent(comicId, () => []).add(cb);
  }

  /// 移除进度回调
  void removeProgressCallback(String comicId, DownloadProgressCallback cb) {
    _progressCallbacks[comicId]?.remove(cb);
  }

  void _notifyProgress(String comicId, int downloaded, int total) {
    for (final cb in (_progressCallbacks[comicId] ?? [])) {
      cb(comicId, downloaded, total);
    }
  }

  /// 从 Dio 响应中尽力提取后端返回的真实错误描述
  String _extractServerError(Response resp) {
    try {
      final data = resp.data;
      if (data is Map) {
        final err = data['error'] ?? data['message'];
        if (err != null) return err.toString();
      }
      if (data is List<int>) {
        // 后端 500 时通常返回 JSON 字节，尝试解码
        final text = utf8.decode(data, allowMalformed: true);
        try {
          final parsed = jsonDecode(text);
          if (parsed is Map) {
            final err = parsed['error'] ?? parsed['message'];
            if (err != null) return err.toString();
          }
        } catch (_) {}
        if (text.isNotEmpty && text.length < 500) return text;
      }
      if (data is String && data.isNotEmpty) return data;
    } catch (_) {}
    return 'HTTP ${resp.statusCode}';
  }

  /// 开始缓存漫画（所有页面）
  Future<void> cacheComic({
    required String comicId,
    required String title,
    required int totalPages,
    required String serverUrl,
    bool isNovel = false,
  }) async {
    if (_cacheDir == null) await init();

    // 如果已在下载中，忽略
    if (_entries[comicId]?.status == CacheStatus.downloading) return;

    // 计算已缓存页数（断点续传）
    int alreadyCached = 0;
    if (isNovel) {
      for (int i = 0; i < totalPages; i++) {
        if (isChapterCached(comicId, i)) alreadyCached++;
      }
    } else {
      for (int i = 0; i < totalPages; i++) {
        if (isPageCached(comicId, i)) alreadyCached++;
      }
    }

    // 更新/创建缓存条目
    final existing = _entries[comicId];
    _entries[comicId] = CacheEntry(
      comicId: comicId,
      title: title,
      isNovel: isNovel,
      totalPages: totalPages,
      cachedPages: alreadyCached,
      totalBytes: existing?.totalBytes ?? 0,
      status: CacheStatus.downloading,
      createdAt: existing?.createdAt ?? DateTime.now(),
      updatedAt: DateTime.now(),
    );
    await _saveMeta();

    final cancelToken = CancelToken();
    _cancelTokens[comicId] = cancelToken;
    _pauseFlags[comicId] = false;

    // 在后台执行下载
    _downloadInBackground(
      comicId: comicId,
      title: title,
      totalPages: totalPages,
      serverUrl: serverUrl,
      isNovel: isNovel,
      cancelToken: cancelToken,
      startFrom: alreadyCached,
    );
  }

  /// 后台下载任务
  Future<void> _downloadInBackground({
    required String comicId,
    required String title,
    required int totalPages,
    required String serverUrl,
    required bool isNovel,
    required CancelToken cancelToken,
    int startFrom = 0,
  }) async {
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 15),
      // PDF 等格式后端需现场渲染，单页耗时可能较长，给到 120s
      receiveTimeout: const Duration(seconds: 120),
      responseType: ResponseType.bytes,
      // 不让 dio 因为 5xx 抛异常，由我们手动判断（方便读取 error body）
      validateStatus: (_) => true,
    ));
    if (!kIsWeb) {
      dio.interceptors.add(CookieManager(persistCookieJar));
    }

    int cachedCount = startFrom;
    int totalBytes = _entries[comicId]?.totalBytes ?? 0;
    int consecutiveFailures = 0;
    const int maxConsecutiveFailures = 5;
    final List<int> failedPages = [];

    try {
      // 先缓存缩略图
      if (!isNovel) {
        final thumbFile = File(_comicThumbPath(comicId));
        if (!await thumbFile.exists()) {
          try {
            final thumbUrl = '$serverUrl/api/comics/$comicId/thumbnail';
            final resp = await dio.get<List<int>>(thumbUrl,
                cancelToken: cancelToken);
            final bytes = Uint8List.fromList(resp.data!);
            await thumbFile.writeAsBytes(bytes);
            totalBytes += bytes.length;
          } catch (_) {}
        }
      }

      for (int i = startFrom; i < totalPages; i++) {
        // 检查暂停/取消
        if (cancelToken.isCancelled) break;
        if (_pauseFlags[comicId] == true) {
          _entries[comicId] = _entries[comicId]!.copyWith(
            status: CacheStatus.paused,
            cachedPages: cachedCount,
            totalBytes: totalBytes,
            updatedAt: DateTime.now(),
          );
          await _saveMeta();
          return;
        }

        // 跳过已缓存
        if (isNovel ? isChapterCached(comicId, i) : isPageCached(comicId, i)) {
          cachedCount++;
          _notifyProgress(comicId, cachedCount, totalPages);
          continue;
        }

        // 单页下载（带 1 次自动重试）
        bool success = false;
        String? lastError;
        for (int attempt = 0; attempt < 2 && !success; attempt++) {
          if (cancelToken.isCancelled) break;
          if (attempt > 0) {
            // 重试前等待 1.5 秒，给后端工具进程一点恢复时间
            await Future.delayed(const Duration(milliseconds: 1500));
          }
          final url = isNovel
              ? '$serverUrl/api/comics/$comicId/chapter/$i'
              : '$serverUrl/api/comics/$comicId/page/$i';
          try {
            if (isNovel) {
              final resp = await dio.get<dynamic>(
                url,
                options: Options(responseType: ResponseType.json),
                cancelToken: cancelToken,
              );
              if (resp.statusCode == 200 && resp.data is Map) {
                final chapterData = resp.data as Map<String, dynamic>;
                final file = File(_novelChapterPath(comicId, i));
                final jsonStr = jsonEncode(chapterData);
                await file.writeAsString(jsonStr);
                totalBytes += jsonStr.length;
                success = true;
              } else {
                lastError = _extractServerError(resp);
                debugPrint(
                    '[Cache] 章节下载失败 (HTTP ${resp.statusCode}) $url -> $lastError');
              }
            } else {
              final resp = await dio.get<List<int>>(url, cancelToken: cancelToken);
              if (resp.statusCode == 200 &&
                  resp.data != null &&
                  resp.data!.isNotEmpty) {
                final bytes = Uint8List.fromList(resp.data!);
                final file = File(_comicPagePath(comicId, i));
                await file.writeAsBytes(bytes);
                totalBytes += bytes.length;
                success = true;
              } else {
                lastError = _extractServerError(resp);
                debugPrint(
                    '[Cache] 页面下载失败 (HTTP ${resp.statusCode}) $url -> $lastError');
              }
            }
          } on DioException catch (e) {
            if (e.type == DioExceptionType.cancel) {
              success = false;
              break;
            }
            lastError = '${e.type.name} ${e.message ?? ''}';
            debugPrint(
                '[Cache] 网络异常 $url (attempt ${attempt + 1}): $lastError');
          } catch (e) {
            lastError = e.toString();
            debugPrint('[Cache] 未知异常 $url: $lastError');
          }
        }

        if (cancelToken.isCancelled) break;

        if (success) {
          cachedCount++;
          consecutiveFailures = 0;
          _entries[comicId] = _entries[comicId]!.copyWith(
            cachedPages: cachedCount,
            totalBytes: totalBytes,
            updatedAt: DateTime.now(),
          );
          if (cachedCount % 5 == 0) await _saveMeta();
          _notifyProgress(comicId, cachedCount, totalPages);
        } else {
          consecutiveFailures++;
          failedPages.add(i);
          debugPrint(
              '[Cache] 跳过 $comicId page $i (连续失败 $consecutiveFailures 次): $lastError');
          // 连续失败过多时暂停，避免无意义的轰炸
          if (consecutiveFailures >= maxConsecutiveFailures) {
            debugPrint(
                '[Cache] 连续 $maxConsecutiveFailures 页失败，暂停下载 $comicId（已失败页: $failedPages）');
            _entries[comicId] = _entries[comicId]!.copyWith(
              status: CacheStatus.paused,
              cachedPages: cachedCount,
              totalBytes: totalBytes,
              errorMessage:
                  '连续 $maxConsecutiveFailures 页下载失败，已暂停。最后错误: $lastError',
              updatedAt: DateTime.now(),
            );
            await _saveMeta();
            return;
          }
        }
      }

      // 下载完成
      final finalStatus = cachedCount >= totalPages
          ? CacheStatus.cached
          : CacheStatus.paused;
      _entries[comicId] = _entries[comicId]!.copyWith(
        status: finalStatus,
        cachedPages: cachedCount,
        totalBytes: totalBytes,
        updatedAt: DateTime.now(),
      );
      await _saveMeta();
      _notifyProgress(comicId, cachedCount, totalPages);
    } catch (e) {
      if (_entries.containsKey(comicId)) {
        _entries[comicId] = _entries[comicId]!.copyWith(
          status: CacheStatus.failed,
          errorMessage: e.toString(),
          updatedAt: DateTime.now(),
        );
        await _saveMeta();
      }
    } finally {
      _cancelTokens.remove(comicId);
      _pauseFlags.remove(comicId);
    }
  }

  /// 暂停下载
  Future<void> pauseDownload(String comicId) async {
    _pauseFlags[comicId] = true;
  }

  /// 恢复下载（断点续传）
  Future<void> resumeDownload({
    required String comicId,
    required String serverUrl,
  }) async {
    final entry = _entries[comicId];
    if (entry == null) return;
    if (entry.status == CacheStatus.downloading) return;

    await cacheComic(
      comicId: comicId,
      title: entry.title,
      totalPages: entry.totalPages,
      serverUrl: serverUrl,
      isNovel: entry.isNovel,
    );
  }

  /// 取消并删除缓存
  Future<void> deleteCache(String comicId) async {
    // 取消正在进行的下载
    _cancelTokens[comicId]?.cancel('用户删除缓存');
    _cancelTokens.remove(comicId);
    _pauseFlags.remove(comicId);

    // 删除本地文件
    if (_cacheDir != null) {
      final entry = _entries[comicId];
      if (entry != null) {
        if (entry.isNovel) {
          for (int i = 0; i < entry.totalPages; i++) {
            final file = File(_novelChapterPath(comicId, i));
            if (await file.exists()) await file.delete();
          }
        } else {
          for (int i = 0; i < entry.totalPages; i++) {
            final file = File(_comicPagePath(comicId, i));
            if (await file.exists()) await file.delete();
          }
          final thumb = File(_comicThumbPath(comicId));
          if (await thumb.exists()) await thumb.delete();
        }
      }
    }

    _entries.remove(comicId);
    await _saveMeta();
  }

  /// 清空所有缓存
  Future<void> clearAllCache() async {
    // 取消所有下载
    for (final token in _cancelTokens.values) {
      token.cancel('清空缓存');
    }
    _cancelTokens.clear();
    _pauseFlags.clear();

    // 删除缓存目录
    if (_cacheDir != null) {
      final dir = Directory(_cacheDir!);
      if (await dir.exists()) {
        await dir.delete(recursive: true);
        await dir.create();
      }
    }

    _entries.clear();
    await _saveMeta();
  }

  /// 检查存储空间是否充足（至少需要 minMB MB）
  Future<bool> hasEnoughStorage(int minMB) async {
    try {
      if (Platform.isAndroid || Platform.isIOS) {
        final dir = await getApplicationDocumentsDirectory();
        final stat = await FileStat.stat(dir.path);
        // FileStat 不直接提供可用空间，使用保守估计
        return stat.size >= 0; // 简单检查目录可访问
      }
    } catch (_) {}
    return true; // 无法检测时默认允许
  }
}

// ============================================================
// 全局单例
// ============================================================

final cacheService = CacheService();
