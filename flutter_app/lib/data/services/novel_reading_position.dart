import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

class NovelInitialPositionDecision {
  final int startChapter;
  final NovelReadingPosition? positionToRestore;
  final double initialRatio;

  const NovelInitialPositionDecision({
    required this.startChapter,
    required this.positionToRestore,
    required this.initialRatio,
  });
}

/// 解析服务端时间字符串并统一转为 UTC；无时区后缀的时间按 UTC 解释，
/// 避免设备本地时区偏移导致服务端时间被误判为更新。
DateTime? parseServerTimestamp(dynamic raw) {
  final text = raw?.toString().trim() ?? '';
  if (text.isEmpty) return null;
  final goUtc = RegExp(
    r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+([+-]\d{4})\s+[A-Z]+(?:\s+m=[+-]\d+\.\d+)?$',
  ).firstMatch(text);
  if (goUtc != null) {
    final offset = goUtc.group(2)!;
    final isoOffset = '${offset.substring(0, 3)}:${offset.substring(3)}';
    return DateTime.tryParse('${goUtc.group(1)}$isoOffset')?.toUtc();
  }
  final hasZone = RegExp(r'(?:[Zz]|[+-]\d{2}:?\d{2})$').hasMatch(text);
  if (hasZone) {
    return DateTime.tryParse(text)?.toUtc();
  }
  final normalized =
      text.contains('T') ? '${text}Z' : '${text.replaceFirst(' ', 'T')}Z';
  return DateTime.tryParse(normalized)?.toUtc() ??
      DateTime.tryParse(text)?.toUtc();
}

/// 根据服务端进度与本机缓存决定初始章节及章内恢复位置。
///
/// 同章节内若服务端未返回有效的 `positionRatio`（如旧版 API、无用户态、
/// 离线同步或退出上报未完成），或比例与本机一致，则保留本机精确页码与比例。
NovelInitialPositionDecision resolveInitialNovelPosition({
  required int totalChapters,
  required int initialChapter,
  int? requestedChapter,
  required NovelReadingPosition? savedPosition,
  required int serverLastReadPage,
  required double serverPositionRatio,
  required DateTime? serverReadAt,
  required bool defaultSwipe,
}) {
  if (requestedChapter != null) {
    final chapter = totalChapters > 0
        ? requestedChapter.clamp(0, totalChapters - 1).toInt()
        : max(0, requestedChapter);
    return NovelInitialPositionDecision(
      startChapter: chapter,
      positionToRestore: null,
      initialRatio: 0.0,
    );
  }

  final serverRatio = serverPositionRatio.isFinite
      ? serverPositionRatio.clamp(0.0, 1.0).toDouble()
      : 0.0;
  final hasValidServerChapter = totalChapters > 0 &&
      serverLastReadPage >= 0 &&
      serverLastReadPage < totalChapters;
  final serverChapter = hasValidServerChapter ? serverLastReadPage : 0;
  final validSaved = (savedPosition != null &&
          savedPosition.chapter >= 0 &&
          savedPosition.chapter < totalChapters)
      ? savedPosition
      : null;
  final serverReadUtc = serverReadAt?.toUtc();
  final savedUpdatedUtc = validSaved?.updatedAt.toUtc();
  final serverIsNewer = serverReadUtc != null &&
      (savedUpdatedUtc == null || serverReadUtc.isAfter(savedUpdatedUtc));

  if (validSaved != null) {
    final sameChapter = validSaved.chapter == serverChapter;
    if (sameChapter) {
      final matchesSavedRatio =
          (serverRatio - validSaved.ratio).abs() <= 0.01;
      if (serverRatio <= 0 || !serverIsNewer || matchesSavedRatio) {
        return NovelInitialPositionDecision(
          startChapter: validSaved.chapter,
          positionToRestore: validSaved,
          initialRatio: validSaved.ratio,
        );
      }
      return NovelInitialPositionDecision(
        startChapter: validSaved.chapter,
        positionToRestore: NovelReadingPosition(
          chapter: validSaved.chapter,
          page: 0,
          totalPages: 0,
          swipe: defaultSwipe,
          ratio: serverRatio,
          updatedAt: serverReadUtc,
        ),
        initialRatio: serverRatio,
      );
    }

    if (!serverIsNewer) {
      return NovelInitialPositionDecision(
        startChapter: validSaved.chapter,
        positionToRestore: validSaved,
        initialRatio: validSaved.ratio,
      );
    }
  }

  var startChapter = totalChapters > 0
      ? initialChapter.clamp(0, totalChapters - 1).toInt()
      : max(0, initialChapter);
  if (serverIsNewer ||
      (validSaved == null && (serverLastReadPage > 0 || serverRatio > 0))) {
    if (serverLastReadPage > 0 && serverLastReadPage < totalChapters) {
      startChapter = serverLastReadPage;
    } else if (serverIsNewer && hasValidServerChapter) {
      startChapter = serverChapter;
    }
    if (serverRatio > 0) {
      return NovelInitialPositionDecision(
        startChapter: startChapter,
        positionToRestore: NovelReadingPosition(
          chapter: startChapter,
          page: 0,
          totalPages: 0,
          swipe: defaultSwipe,
          ratio: serverRatio,
          updatedAt: serverReadUtc ?? DateTime.now().toUtc(),
        ),
        initialRatio: serverRatio,
      );
    }
    return NovelInitialPositionDecision(
      startChapter: startChapter,
      positionToRestore: null,
      initialRatio: 0.0,
    );
  }

  return NovelInitialPositionDecision(
    startChapter: startChapter,
    positionToRestore: null,
    initialRatio: 0.0,
  );
}

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
