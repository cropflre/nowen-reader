import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

class NovelChapterRule {
  final String id;
  final String name;
  final String pattern;
  final bool system;

  const NovelChapterRule({
    required this.id,
    required this.name,
    required this.pattern,
    required this.system,
  });

  factory NovelChapterRule.fromJson(Map<String, dynamic> json) {
    return NovelChapterRule(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      pattern: json['pattern']?.toString() ?? '',
      system: json['system'] == true,
    );
  }
}

class ComicChapterRuleInfo {
  final String comicId;
  final String ruleId;
  final NovelChapterRule? rule;
  final bool isTxt;
  final bool canManage;
  final bool canEditGlobalRules;

  const ComicChapterRuleInfo({
    required this.comicId,
    required this.ruleId,
    required this.rule,
    required this.isTxt,
    required this.canManage,
    required this.canEditGlobalRules,
  });

  factory ComicChapterRuleInfo.fromJson(Map<String, dynamic> json) {
    final rawRule = json['rule'];
    return ComicChapterRuleInfo(
      comicId: json['comicId']?.toString() ?? '',
      ruleId: json['ruleId']?.toString() ?? 'auto',
      rule: rawRule is Map<String, dynamic>
          ? NovelChapterRule.fromJson(rawRule)
          : rawRule is Map
              ? NovelChapterRule.fromJson(Map<String, dynamic>.from(rawRule))
              : null,
      isTxt: json['isTxt'] == true,
      canManage: json['canManage'] == true,
      canEditGlobalRules: json['canEditGlobalRules'] == true,
    );
  }
}

class NovelChapterRulePreview {
  final int matchCount;
  final List<String> chapters;
  final String? warning;

  const NovelChapterRulePreview({
    required this.matchCount,
    required this.chapters,
    this.warning,
  });

  factory NovelChapterRulePreview.fromJson(Map<String, dynamic> json) {
    return NovelChapterRulePreview(
      matchCount: (json['matchCount'] as num?)?.toInt() ?? 0,
      chapters: (json['chapters'] as List<dynamic>? ?? const [])
          .map((item) => item.toString())
          .toList(),
      warning: json['warning']?.toString(),
    );
  }
}

class NovelChapterRuleApi {
  final Dio _dio;

  NovelChapterRuleApi(this._dio);

  Future<List<NovelChapterRule>> listRules() async {
    final response = await _dio.get('/novel/chapter-rules');
    final list = response.data['rules'] as List<dynamic>? ?? const [];
    return list
        .whereType<Map>()
        .map((item) => NovelChapterRule.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  Future<ComicChapterRuleInfo> getComicRule(String comicId) async {
    final response = await _dio.get('/comics/$comicId/chapter-rule');
    return ComicChapterRuleInfo.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  Future<int> setComicRule(String comicId, String ruleId) async {
    final response = await _dio.put(
      '/comics/$comicId/chapter-rule',
      data: {'ruleId': ruleId},
    );
    return (response.data['chapterCount'] as num?)?.toInt() ?? 0;
  }

  Future<NovelChapterRulePreview> preview(
    String comicId, {
    String? regex,
    String? ruleId,
  }) async {
    final response = await _dio.post('/novel/chapter-rules/preview', data: {
      'comicId': comicId,
      if (regex != null && regex.trim().isNotEmpty) 'regex': regex.trim(),
      if (ruleId != null && ruleId.trim().isNotEmpty) 'ruleId': ruleId.trim(),
    });
    return NovelChapterRulePreview.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  Future<NovelChapterRule> createRule(String name, String pattern) async {
    final response = await _dio.post('/novel/chapter-rules', data: {
      'name': name,
      'pattern': pattern,
    });
    return NovelChapterRule.fromJson(
      Map<String, dynamic>.from(response.data['rule'] as Map),
    );
  }

  Future<NovelChapterRule> updateRule(
    String ruleId,
    String name,
    String pattern,
  ) async {
    final response = await _dio.put('/novel/chapter-rules/$ruleId', data: {
      'name': name,
      'pattern': pattern,
    });
    return NovelChapterRule.fromJson(
      Map<String, dynamic>.from(response.data['rule'] as Map),
    );
  }

  Future<void> deleteRule(String ruleId) async {
    await _dio.delete('/novel/chapter-rules/$ruleId');
  }
}

final novelChapterRuleApiProvider = Provider<NovelChapterRuleApi>((ref) {
  return NovelChapterRuleApi(ref.watch(dioProvider));
});
