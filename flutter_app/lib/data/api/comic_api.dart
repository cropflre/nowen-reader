import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

/// 漫画 API
class ComicApi {
  final Dio _dio;
  ComicApi(this._dio);

  /// 获取漫画列表
  Future<Map<String, dynamic>> listComics({
    int page = 1,
    int limit = 20,
    String sort = 'addedAt',
    String order = 'desc',
    String? search,
    String? tag,
    String? category,
    String? type,
    String? readingStatus,
    bool? favoritesOnly,
  }) async {
    final params = <String, dynamic>{
      'page': page,
      'pageSize': limit,
      'sortBy': sort,
      'sortOrder': order,
    };
    if (search != null && search.isNotEmpty) params['search'] = search;
    if (tag != null && tag.isNotEmpty) params['tags'] = tag;
    if (category != null && category.isNotEmpty) params['category'] = category;
    if (type != null && type.isNotEmpty) params['contentType'] = type;
    if (readingStatus != null && readingStatus.isNotEmpty) {
      params['readingStatus'] = readingStatus;
    }
    if (favoritesOnly == true) params['favorites'] = 'true';

    final res = await _dio.get('/comics', queryParameters: params);
    return res.data;
  }

  /// 获取单本漫画详情
  Future<Map<String, dynamic>> getComic(String id) async {
    final res = await _dio.get('/comics/$id');
    return res.data;
  }

  /// 获取漫画页面列表
  Future<Map<String, dynamic>> getPages(String comicId) async {
    final res = await _dio.get('/comics/$comicId/pages');
    return res.data;
  }

  /// 获取小说章节内容
  Future<Map<String, dynamic>> getChapterContent(String comicId, int chapterIndex) async {
    final res = await _dio.get('/comics/$comicId/chapter/$chapterIndex');
    return res.data;
  }

  /// 切换收藏
  Future<Map<String, dynamic>> toggleFavorite(String comicId) async {
    final res = await _dio.put('/comics/$comicId/favorite');
    return res.data;
  }

  /// 更新评分
  Future<void> updateRating(String comicId, int? rating) async {
    await _dio.put('/comics/$comicId/rating', data: {'rating': rating});
  }

  /// 保存阅读进度
  Future<void> updateProgress(String comicId, int page) async {
    await _dio.put('/comics/$comicId/progress', data: {'page': page});
  }

  /// 设置阅读状态
  Future<void> setReadingStatus(String comicId, String status) async {
    await _dio.put('/comics/$comicId/reading-status',
        data: {'status': status});
  }

  /// 获取标签列表
  Future<List<dynamic>> getTags() async {
    final res = await _dio.get('/tags');
    return res.data['tags'] ?? [];
  }

  /// 获取分类列表
  Future<List<dynamic>> getCategories() async {
    final res = await _dio.get('/categories');
    return res.data['categories'] ?? [];
  }

  /// 获取阅读统计
  Future<Map<String, dynamic>> getStats() async {
    final res = await _dio.get('/stats');
    return res.data;
  }

  /// 获取增强统计
  Future<Map<String, dynamic>> getEnhancedStats() async {
    final res = await _dio.get('/stats/enhanced');
    return res.data;
  }

  /// 开始阅读会话
  Future<int?> startSession(String comicId, int startPage) async {
    try {
      final res = await _dio.post('/stats/session', data: {
        'comicId': comicId,
        'startPage': startPage,
      });
      return res.data['sessionId'];
    } catch (_) {
      return null;
    }
  }

  /// 结束阅读会话
  Future<void> endSession(int sessionId, int endPage, int duration) async {
    try {
      await _dio.put('/stats/session', data: {
        'sessionId': sessionId,
        'endPage': endPage,
        'duration': duration,
      });
    } catch (_) {
      // 静默失败
    }
  }

  /// 获取分组列表（支持按内容类型过滤）
  Future<List<dynamic>> getGroups({String? contentType}) async {
    final params = <String, dynamic>{};
    if (contentType != null && contentType.isNotEmpty) {
      params['contentType'] = contentType;
    }
    final res = await _dio.get('/groups', queryParameters: params);
    return res.data['groups'] ?? [];
  }

  /// 获取分组详情
  Future<Map<String, dynamic>> getGroupDetail(int groupId, {String? contentType}) async {
    final params = <String, dynamic>{};
    if (contentType != null && contentType.isNotEmpty) {
      params['contentType'] = contentType;
    }
    final res = await _dio.get('/groups/$groupId', queryParameters: params);
    return res.data;
  }

  /// 创建分组
  Future<Map<String, dynamic>> createGroup(String name, {List<String>? comicIds}) async {
    final res = await _dio.post('/groups', data: {
      'name': name,
      'comicIds': comicIds ?? [],
    });
    return res.data;
  }

  /// 删除分组
  Future<void> deleteGroup(int groupId) async {
    await _dio.delete('/groups/$groupId');
  }

  /// 更新分组名称
  Future<void> updateGroup(int groupId, String name, {String? coverUrl}) async {
    await _dio.put('/groups/$groupId', data: {
      'name': name,
      'coverUrl': coverUrl ?? '',
    });
  }

  /// 添加漫画到分组
  Future<void> addComicsToGroup(int groupId, List<String> comicIds) async {
    await _dio.post('/groups/$groupId/comics', data: {
      'comicIds': comicIds,
    });
  }

  /// 从分组移除漫画
  Future<void> removeComicFromGroup(int groupId, String comicId) async {
    await _dio.delete('/groups/$groupId/comics/$comicId');
  }

  /// 重新排序分组内漫画
  Future<void> reorderGroupComics(int groupId, List<String> comicIds) async {
    await _dio.put('/groups/$groupId/reorder', data: {
      'comicIds': comicIds,
    });
  }

  /// 自动检测可合并的系列
  Future<List<dynamic>> autoDetectGroups({String? contentType}) async {
    final res = await _dio.post('/groups/auto-detect', data: {
      'contentType': contentType ?? '',
    });
    return res.data['suggestions'] ?? [];
  }

  /// 批量创建分组
  Future<Map<String, dynamic>> batchCreateGroups(List<Map<String, dynamic>> groups, {bool autoInherit = false}) async {
    final res = await _dio.post('/groups/batch-create', data: {
      'groups': groups,
      'autoInherit': autoInherit,
    });
    return res.data;
  }

  /// 批量删除分组
  Future<Map<String, dynamic>> batchDeleteGroups(List<int> groupIds) async {
    final res = await _dio.post('/groups/batch-delete', data: {
      'groupIds': groupIds,
    });
    return res.data;
  }

  /// 合并分组
  Future<Map<String, dynamic>> mergeGroups(List<int> groupIds, String newName) async {
    final res = await _dio.post('/groups/merge', data: {
      'groupIds': groupIds,
      'newName': newName,
    });
    return res.data;
  }

  /// 获取站点设置
  Future<Map<String, dynamic>> getSiteSettings() async {
    final res = await _dio.get('/site-settings');
    return res.data;
  }

  /// 获取推荐
  Future<Map<String, dynamic>> getRecommendations() async {
    final res = await _dio.get('/recommendations');
    return res.data;
  }

  /// 触发扫描文库（管理员）
  Future<void> triggerSync() async {
    await _dio.post('/sync');
  }

  // ============================================================
  // 文件上传
  // ============================================================

  /// 上传文件到服务器
  /// [filePath] 本地文件路径
  /// [fileName] 文件名
  /// [category] 可选分类: 'comic' 或 'novel'
  Future<Map<String, dynamic>> uploadFile({
    required String filePath,
    required String fileName,
    String? category,
    void Function(int, int)? onProgress,
  }) async {
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(filePath, filename: fileName),
      if (category != null) 'category': category,
    });
    final res = await _dio.post(
      '/upload',
      data: formData,
      options: Options(headers: {'Content-Type': 'multipart/form-data'}),
      onSendProgress: onProgress,
    );
    return res.data;
  }

  // ============================================================
  // AI 标题推断
  // ============================================================

  /// AI 推断标题（单本）
  Future<Map<String, dynamic>> aiInferTitle(String comicId) async {
    final res = await _dio.post('/comics/$comicId/ai-infer-title');
    return res.data;
  }

  // ============================================================
  // 扫描规则管理
  // ============================================================

  /// 获取扫描规则配置
  Future<Map<String, dynamic>> getScanRules() async {
    final res = await _dio.get('/scan-rules');
    return res.data;
  }

  /// 更新扫描规则配置
  Future<Map<String, dynamic>> updateScanRules(Map<String, dynamic> rules) async {
    final res = await _dio.put('/scan-rules', data: rules);
    return res.data;
  }

  /// 执行扫描规则（预览或正式）
  Future<Map<String, dynamic>> applyScanRules({bool dryRun = false, String? scope}) async {
    final url = dryRun ? '/scan-rules/preview' : '/scan-rules/apply';
    final data = <String, dynamic>{};
    if (scope != null) data['scope'] = scope;
    final res = await _dio.post(url, data: data);
    return res.data;
  }

  /// 获取扫描规则执行进度
  Future<Map<String, dynamic>> getScanRulesProgress() async {
    final res = await _dio.get('/scan-rules/progress');
    return res.data;
  }

  /// 获取扫描规则操作日志
  Future<Map<String, dynamic>> getScanRulesLogs({String? batchId, int limit = 100}) async {
    final params = <String, dynamic>{'limit': limit};
    if (batchId != null) params['batchId'] = batchId;
    final res = await _dio.get('/scan-rules/logs', queryParameters: params);
    return res.data;
  }

  /// 还原标题
  Future<Map<String, dynamic>> restoreTitles({bool dryRun = true, bool onlyDuplicates = true}) async {
    final res = await _dio.post('/scan-rules/restore-titles', data: {
      'dryRun': dryRun,
      'onlyDuplicates': onlyDuplicates,
    });
    return res.data;
  }

  // ============================================================
  // 文件夹层级统计
  // ============================================================

  /// 获取文件夹树形统计
  Future<Map<String, dynamic>> getFolderTreeStats() async {
    final res = await _dio.get('/stats/folder-tree');
    return res.data;
  }

  // ============================================================
  // 站点设置
  // ============================================================

  /// 更新站点设置
  Future<Map<String, dynamic>> updateSiteSettings(Map<String, dynamic> settings) async {
    final res = await _dio.put('/site-settings', data: settings);
    return res.data;
  }
}

final comicApiProvider = Provider<ComicApi>((ref) {
  return ComicApi(ref.watch(dioProvider));
});
