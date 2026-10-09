import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// 服务器记录章节，本机补充章内位置；按服务器、账户和作品隔离。
class NovelReadingPosition {
  final int chapter;
  final int page;
  final int totalPages;
  final bool swipe;
  final double ratio;
  final DateTime updatedAt;

  const NovelReadingPosition({
    required this.chapter,
    required this.page,
    required this.totalPages,
    required this.swipe,
    required this.ratio,
    required this.updatedAt,
  });

  int pageFor(int pages) =>
      (swipe && pages == totalPages ? page : (ratio * (pages - 1)).round())
          .clamp(0, pages - 1);

  Map<String, dynamic> toJson() => {
        'chapter': chapter,
        'page': page,
        'totalPages': totalPages,
        'swipe': swipe,
        'ratio': ratio,
        'updatedAt': updatedAt.toUtc().toIso8601String(),
      };

  factory NovelReadingPosition.fromJson(Map<String, dynamic> json) =>
      NovelReadingPosition(
        chapter: (json['chapter'] as num).toInt(),
        page: (json['page'] as num).toInt(),
        totalPages: (json['totalPages'] as num).toInt(),
        swipe: json['swipe'] as bool,
        ratio: (json['ratio'] as num).toDouble().clamp(0, 1),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );
}

class NovelReadingPositionStore {
  final String serverUrl;
  final String userId;
  final String comicId;
  Future<void> _writes = Future.value();

  NovelReadingPositionStore({
    required this.serverUrl,
    required this.userId,
    required this.comicId,
  });

  String get _key => 'novel_position_${jsonEncode([
            serverUrl.replaceFirst(RegExp(r'/+$'), ''),
            userId,
            comicId,
          ])}';

  Future<NovelReadingPosition?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    try {
      final position = NovelReadingPosition.fromJson(
          jsonDecode(raw) as Map<String, dynamic>);
      if (position.chapter < 0 ||
          position.page < 0 ||
          position.totalPages < 1) {
        return null;
      }
      return position;
    } catch (_) {
      return null;
    }
  }

  Future<void> save(NovelReadingPosition position) {
    // 保持写入顺序，快速翻页时旧位置不能覆盖新位置。
    return _writes = _writes.catchError((_) {}).then((_) async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, jsonEncode(position.toJson()));
    });
  }
}
