import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

/// 元数据搜索结果
class MetadataResult {
  final String? title;
  final String? author;
  final String? publisher;
  final int? year;
  final String? description;
  final String? language;
  final String? genre;
  final String? coverUrl;
  final String source;

  const MetadataResult({
    this.title,
    this.author,
    this.publisher,
    this.year,
    this.description,
    this.language,
    this.genre,
    this.coverUrl,
    required this.source,
  });

  factory MetadataResult.fromJson(Map<String, dynamic> json) {
    return MetadataResult(
      title: json['title'],
      author: json['author'],
      publisher: json['publisher'],
      year: json['year'],
      description: json['description'],
      language: json['language'],
      genre: json['genre'],
      coverUrl: json['coverUrl'],
      source: json['source'] ?? 'unknown',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (title != null) 'title': title,
      if (author != null) 'author': author,
      if (publisher != null) 'publisher': publisher,
      if (year != null) 'year': year,
      if (description != null) 'description': description,
      if (language != null) 'language': language,
      if (genre != null) 'genre': genre,
      if (coverUrl != null) 'coverUrl': coverUrl,
      'source': source,
    };
  }
}

/// 批量刮削进度事件
class BatchProgressEvent {
  final String type; // "start" | "progress" | "complete"
  final int? total;
  final int? current;
  final String? comicId;
  final String? filename;
  final String? status; // "success" | "failed" | "skipped"
  final String? source;
  final String? message;
  final int? success;
  final int? failed;

  const BatchProgressEvent({
    required this.type,
    this.total,
    this.current,
    this.comicId,
    this.filename,
    this.status,
    this.source,
    this.message,
    this.success,
    this.failed,
  });

  factory BatchProgressEvent.fromJson(Map<String, dynamic> json) {
    return BatchProgressEvent(
      type: json['type'] ?? '',
      total: json['total'],
      current: json['current'],
      comicId: json['comicId'],
      filename: json['filename'],
      status: json['status'],
      source: json['source'],
      message: json['message'],
      success: json['success'],
      failed: json['failed'],
    );
  }
}

/// 元数据 API
class MetadataApi {
  final Dio _dio;
  MetadataApi(this._dio);

  /// 搜索元数据
  /// [query] 搜索关键词
  /// [sources] 数据源列表 (anilist, bangumi, mangadex, ...)
  /// [lang] 语言 (en, zh, ja, ...)
  /// [contentType] 内容类型 (comic, novel)
  Future<List<MetadataResult>> searchMetadata({
    required String query,
    List<String>? sources,
    String lang = 'zh',
    String? contentType,
  }) async {
    final params = <String, dynamic>{
      'q': query,
      'lang': lang,
    };
    if (sources != null && sources.isNotEmpty) {
      params['sources'] = sources.join(',');
    }
    if (contentType != null) {
      params['contentType'] = contentType;
    }

    final res = await _dio.get('/metadata/search', queryParameters: params);
    final data = res.data;
    final results = (data['results'] as List<dynamic>?) ?? [];
    return results
        .map((e) => MetadataResult.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// 应用元数据到指定漫画
  Future<Map<String, dynamic>> applyMetadata({
    required String comicId,
    required MetadataResult metadata,
    String lang = 'zh',
    bool overwrite = true,
    bool skipCover = false,
  }) async {
    final res = await _dio.post('/metadata/apply', data: {
      'comicId': comicId,
      'metadata': metadata.toJson(),
      'lang': lang,
      'overwrite': overwrite,
      'skipCover': skipCover,
    });
    return res.data;
  }

  /// 扫描漫画元数据（从 ComicInfo.xml 提取 + 在线搜索兆底）
  Future<Map<String, dynamic>> scanMetadata({
    required String comicId,
    String lang = 'zh',
    bool skipCover = false,
  }) async {
    final res = await _dio.post('/metadata/scan', data: {
      'comicId': comicId,
      'lang': lang,
      'skipCover': skipCover,
    });
    return res.data;
  }
  /// 扫描小说元数据（从 EPUB OPF 提取 + 在线搜索兜底）
  Future<Map<String, dynamic>> scanNovelMetadata({
    required String comicId,
    String lang = 'zh',
  }) async {
    final res = await _dio.post('/metadata/novel-scan', data: {
      'comicId': comicId,
      'lang': lang,
    });
    return res.data;
  }

  /// 手动编辑元数据
  Future<Map<String, dynamic>> updateMetadata({
    required String comicId,
    String? author,
    String? publisher,
    int? year,
    String? description,
    String? language,
    String? genre,
  }) async {
    final data = <String, dynamic>{};
    if (author != null) data['author'] = author;
    if (publisher != null) data['publisher'] = publisher;
    if (year != null) data['year'] = year;
    if (description != null) data['description'] = description;
    if (language != null) data['language'] = language;
    if (genre != null) data['genre'] = genre;

    final res = await _dio.put('/comics/$comicId/metadata', data: data);
    return res.data;
  }

  /// 批量刮削元数据（SSE 流）
  /// [mode] "all" 全部重新刮削 | "missing" 只刮削缺少元数据的
  /// [skipCover] 不替换书籍封面
  /// 返回 Stream<BatchProgressEvent>
  Stream<BatchProgressEvent> batchScrape({
    String mode = 'missing',
    String lang = 'zh',
    bool skipCover = false,
  }) async* {
    final res = await _dio.post(
      '/metadata/batch',
      data: {'mode': mode, 'lang': lang, 'skipCover': skipCover},
      options: Options(responseType: ResponseType.stream),
    );

    final stream = (res.data as ResponseBody).stream;
    String buffer = '';

    await for (final chunk in stream) {
      buffer += String.fromCharCodes(chunk);

      // 解析 SSE 数据行
      while (buffer.contains('\n\n')) {
        final idx = buffer.indexOf('\n\n');
        final block = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);

        for (final line in block.split('\n')) {
          if (line.startsWith('data: ')) {
            final jsonStr = line.substring(6);
            try {
              final json = _parseJson(jsonStr);
              if (json != null) {
                yield BatchProgressEvent.fromJson(json);
              }
            } catch (_) {}
          }
        }
      }
    }
  }

  /// 批量翻译元数据（SSE 流）
  Stream<BatchProgressEvent> batchTranslate({
    String mode = 'missing',
    String lang = 'zh',
  }) async* {
    final res = await _dio.post(
      '/metadata/translate-batch',
      data: {'mode': mode, 'lang': lang},
      options: Options(responseType: ResponseType.stream),
    );

    final stream = (res.data as ResponseBody).stream;
    String buffer = '';

    await for (final chunk in stream) {
      buffer += String.fromCharCodes(chunk);

      while (buffer.contains('\n\n')) {
        final idx = buffer.indexOf('\n\n');
        final block = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);

        for (final line in block.split('\n')) {
          if (line.startsWith('data: ')) {
            final jsonStr = line.substring(6);
            try {
              final json = _parseJson(jsonStr);
              if (json != null) {
                yield BatchProgressEvent.fromJson(json);
              }
            } catch (_) {}
          }
        }
      }
    }
  }

  Map<String, dynamic>? _parseJson(String str) {
    try {
      return Map<String, dynamic>.from(jsonDecode(str) as Map);
    } catch (_) {
      return null;
    }
  }
}

final metadataApiProvider = Provider<MetadataApi>((ref) {
  return MetadataApi(ref.watch(dioProvider));
});
