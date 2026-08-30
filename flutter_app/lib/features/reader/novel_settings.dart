import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 小说阅读主题
enum NovelTheme { night, day, green, gray, white }

/// 字体
enum NovelFont { system, serif, sans, kai, mono }

/// 页边距
enum NovelPadding { compact, standard, wide }

/// 翻页模式
enum NovelPageMode { scroll, swipe }

/// 自动滚动速度
enum AutoScrollSpeed { slow, medium, fast }

/// 点击区域动作
enum NovelTapAction { previousPage, menu, nextPage, none }

/// 点击区域
enum NovelTapZone { left, center, right }

/// 将阅读区域的横向点击位置映射为左 / 中 / 右三个等宽区域。
NovelTapZone resolveNovelTapZone(double fraction) {
  final normalized = fraction.clamp(0.0, 1.0);
  if (normalized < 1 / 3) return NovelTapZone.left;
  if (normalized < 2 / 3) return NovelTapZone.center;
  return NovelTapZone.right;
}

/// 书签
class NovelBookmark {
  final String id;
  final int chapterIndex;
  final String chapterTitle;
  final String name;
  final String note;
  final double positionRatio;
  final int timestamp;
  final int updatedAt;

  const NovelBookmark({
    required this.id,
    required this.chapterIndex,
    required this.chapterTitle,
    this.name = '',
    this.note = '',
    this.positionRatio = 0,
    required this.timestamp,
    required this.updatedAt,
  });

  String get displayTitle => name.trim().isNotEmpty ? name.trim() : chapterTitle;

  NovelBookmark copyWith({
    String? name,
    String? note,
    double? positionRatio,
    int? updatedAt,
  }) {
    return NovelBookmark(
      id: id,
      chapterIndex: chapterIndex,
      chapterTitle: chapterTitle,
      name: name ?? this.name,
      note: note ?? this.note,
      positionRatio:
          (positionRatio ?? this.positionRatio).clamp(0.0, 1.0).toDouble(),
      timestamp: timestamp,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'chapterIndex': chapterIndex,
        'chapterTitle': chapterTitle,
        'name': name,
        'note': note,
        'positionRatio': positionRatio,
        'timestamp': timestamp,
        'updatedAt': updatedAt,
      };

  factory NovelBookmark.fromJson(Map<String, dynamic> json) {
    final chapterIndex = (json['chapterIndex'] as num).toInt();
    final timestamp = (json['timestamp'] as num?)?.toInt() ??
        DateTime.now().millisecondsSinceEpoch;
    final rawPosition = (json['positionRatio'] as num?)?.toDouble() ?? 0;
    final legacyID = 'legacy-$chapterIndex-$timestamp';
    return NovelBookmark(
      id: (json['id'] as String?)?.trim().isNotEmpty == true
          ? (json['id'] as String).trim()
          : legacyID,
      chapterIndex: chapterIndex,
      chapterTitle: (json['chapterTitle'] as String?)?.trim().isNotEmpty == true
          ? (json['chapterTitle'] as String).trim()
          : '第${chapterIndex + 1}章',
      name: (json['name'] as String?)?.trim() ?? '',
      note: (json['note'] as String?)?.trim() ?? '',
      positionRatio: rawPosition.clamp(0.0, 1.0).toDouble(),
      timestamp: timestamp,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? timestamp,
    );
  }
}

/// 小说阅读设置
class NovelSettings {
  final double fontSize;
  final double lineHeight;
  final NovelTheme theme;
  final NovelFont font;
  final NovelPadding padding;
  final NovelPageMode pageMode;
  final int autoScrollSpeed; // 1=慢 2=中 3=快
  final NovelTapAction leftTapAction;
  final NovelTapAction centerTapAction;
  final NovelTapAction rightTapAction;

  /// 默认关闭，保持原有“上下滚动模式点击任意位置呼出菜单”的行为。
  /// 开启后，滚动模式也按左 / 中 / 右点击区域执行配置动作。
  final bool tapZonesInScrollMode;

  const NovelSettings({
    this.fontSize = 18,
    this.lineHeight = 1.8,
    this.theme = NovelTheme.night,
    this.font = NovelFont.system,
    this.padding = NovelPadding.standard,
    this.pageMode = NovelPageMode.scroll,
    this.autoScrollSpeed = 2,
    this.leftTapAction = NovelTapAction.previousPage,
    this.centerTapAction = NovelTapAction.menu,
    this.rightTapAction = NovelTapAction.nextPage,
    this.tapZonesInScrollMode = false,
  });

  NovelSettings copyWith({
    double? fontSize,
    double? lineHeight,
    NovelTheme? theme,
    NovelFont? font,
    NovelPadding? padding,
    NovelPageMode? pageMode,
    int? autoScrollSpeed,
    NovelTapAction? leftTapAction,
    NovelTapAction? centerTapAction,
    NovelTapAction? rightTapAction,
    bool? tapZonesInScrollMode,
  }) {
    return NovelSettings(
      fontSize: fontSize ?? this.fontSize,
      lineHeight: lineHeight ?? this.lineHeight,
      theme: theme ?? this.theme,
      font: font ?? this.font,
      padding: padding ?? this.padding,
      pageMode: pageMode ?? this.pageMode,
      autoScrollSpeed: autoScrollSpeed ?? this.autoScrollSpeed,
      leftTapAction: leftTapAction ?? this.leftTapAction,
      centerTapAction: centerTapAction ?? this.centerTapAction,
      rightTapAction: rightTapAction ?? this.rightTapAction,
      tapZonesInScrollMode: tapZonesInScrollMode ?? this.tapZonesInScrollMode,
    );
  }

  static Future<NovelSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    return NovelSettings(
      fontSize: prefs.getDouble('novel_fontSize') ?? 18,
      lineHeight: prefs.getDouble('novel_lineHeight') ?? 1.8,
      theme: NovelTheme.values[
          (prefs.getInt('novel_theme') ?? 0).clamp(0, NovelTheme.values.length - 1)],
      font: NovelFont.values[
          (prefs.getInt('novel_font') ?? 0).clamp(0, NovelFont.values.length - 1)],
      padding: NovelPadding.values[
          (prefs.getInt('novel_padding') ?? 1).clamp(0, NovelPadding.values.length - 1)],
      pageMode: NovelPageMode.values[
          (prefs.getInt('novel_pageMode') ?? 0).clamp(0, NovelPageMode.values.length - 1)],
      autoScrollSpeed: (prefs.getInt('novel_autoScrollSpeed') ?? 2).clamp(1, 3),
      leftTapAction: _loadTapAction(
        prefs.getInt('novel_leftTapAction'),
        NovelTapAction.previousPage,
      ),
      centerTapAction: _loadTapAction(
        prefs.getInt('novel_centerTapAction'),
        NovelTapAction.menu,
      ),
      rightTapAction: _loadTapAction(
        prefs.getInt('novel_rightTapAction'),
        NovelTapAction.nextPage,
      ),
      tapZonesInScrollMode: prefs.getBool('novel_tapZonesInScrollMode') ?? false,
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble('novel_fontSize', fontSize);
    await prefs.setDouble('novel_lineHeight', lineHeight);
    await prefs.setInt('novel_theme', theme.index);
    await prefs.setInt('novel_font', font.index);
    await prefs.setInt('novel_padding', padding.index);
    await prefs.setInt('novel_pageMode', pageMode.index);
    await prefs.setInt('novel_autoScrollSpeed', autoScrollSpeed);
    await prefs.setInt('novel_leftTapAction', leftTapAction.index);
    await prefs.setInt('novel_centerTapAction', centerTapAction.index);
    await prefs.setInt('novel_rightTapAction', rightTapAction.index);
    await prefs.setBool('novel_tapZonesInScrollMode', tapZonesInScrollMode);
  }

  /// 水平内边距
  double get horizontalPadding {
    switch (padding) {
      case NovelPadding.compact:
        return 12;
      case NovelPadding.standard:
        return 24;
      case NovelPadding.wide:
        return 40;
    }
  }

  /// 字体族
  String? get fontFamily {
    switch (font) {
      case NovelFont.system:
        return null;
      case NovelFont.serif:
        return 'serif';
      case NovelFont.sans:
        return 'sans-serif';
      case NovelFont.kai:
        return 'KaiTi';
      case NovelFont.mono:
        return 'monospace';
    }
  }

  Color get backgroundColor {
    switch (theme) {
      case NovelTheme.night:
        return const Color(0xFF18181B);
      case NovelTheme.day:
        return const Color(0xFFFFFBEB);
      case NovelTheme.green:
        return const Color(0xFFC7EDCC);
      case NovelTheme.gray:
        return const Color(0xFFE0E0E0);
      case NovelTheme.white:
        return const Color(0xFFFFFFFF);
    }
  }

  Color get textColor {
    switch (theme) {
      case NovelTheme.night:
        return const Color(0xFFE0E0E0);
      case NovelTheme.day:
        return const Color(0xFF1A1A1A);
      case NovelTheme.green:
        return const Color(0xFF1A3A1A);
      case NovelTheme.gray:
        return const Color(0xFF1A1A1A);
      case NovelTheme.white:
        return const Color(0xFF333333);
    }
  }

  Color get secondaryTextColor {
    switch (theme) {
      case NovelTheme.night:
        return const Color(0xFF888888);
      case NovelTheme.day:
        return const Color(0xFF666666);
      case NovelTheme.green:
        return const Color(0xFF4A6A4A);
      case NovelTheme.gray:
        return const Color(0xFF555555);
      case NovelTheme.white:
        return const Color(0xFF999999);
    }
  }

  bool get isDark => theme == NovelTheme.night;
}

NovelTapAction _loadTapAction(int? raw, NovelTapAction fallback) {
  if (raw == null || raw < 0 || raw >= NovelTapAction.values.length) {
    return fallback;
  }
  return NovelTapAction.values[raw];
}

/// 搜索结果
class SearchResult {
  final int chapterIndex;
  final String chapterTitle;
  final String matchText;
  final int matchCount;

  const SearchResult({
    required this.chapterIndex,
    required this.chapterTitle,
    required this.matchText,
    required this.matchCount,
  });
}

/// 书签工具类
class BookmarkManager {
  static const _key = 'novel_bookmarks_';

  static Future<List<NovelBookmark>> load(String comicId) async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString('$_key$comicId');
    if (json == null) return [];
    try {
      final list = jsonDecode(json) as List;
      final bookmarks = list
          .map((e) => NovelBookmark.fromJson(
              Map<String, dynamic>.from(e as Map)))
          .toList();
      final needsMigration = list.any((e) =>
          e is Map &&
          (!e.containsKey('id') ||
              !e.containsKey('name') ||
              !e.containsKey('note') ||
              !e.containsKey('positionRatio') ||
              !e.containsKey('updatedAt')));
      if (needsMigration) await save(comicId, bookmarks);
      return bookmarks;
    } catch (_) {
      return [];
    }
  }

  static Future<void> save(String comicId, List<NovelBookmark> bookmarks) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '$_key$comicId',
      jsonEncode(bookmarks.map((b) => b.toJson()).toList()),
    );
  }
}
