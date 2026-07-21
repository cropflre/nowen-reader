import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

class OfflineBookManifest {
  final String comicId;
  final String serverUrl;
  final String title;
  final bool isNovel;
  final int totalChapters;
  final Map<int, String> chapterTitles;
  final DateTime cachedAt;

  const OfflineBookManifest({
    required this.comicId,
    required this.serverUrl,
    required this.title,
    required this.isNovel,
    required this.totalChapters,
    this.chapterTitles = const {},
    required this.cachedAt,
  });

  Map<String, dynamic> toJson() => {
        'comicId': comicId,
        'serverUrl': serverUrl,
        'title': title,
        'isNovel': isNovel,
        'totalChapters': totalChapters,
        'chapterTitles': chapterTitles.map(
          (key, value) => MapEntry(key.toString(), value),
        ),
        'cachedAt': cachedAt.toIso8601String(),
      };

  factory OfflineBookManifest.fromJson(Map<String, dynamic> json) {
    final rawTitles = json['chapterTitles'];
    final chapterTitles = <int, String>{};
    if (rawTitles is Map) {
      for (final entry in rawTitles.entries) {
        final index = int.tryParse(entry.key.toString());
        if (index != null && entry.value != null) {
          chapterTitles[index] = entry.value.toString();
        }
      }
    }

    return OfflineBookManifest(
      comicId: json['comicId']?.toString() ?? '',
      serverUrl: json['serverUrl']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      isNovel: json['isNovel'] == true,
      totalChapters: json['totalChapters'] as int? ?? 0,
      chapterTitles: chapterTitles,
      cachedAt:
          DateTime.tryParse(json['cachedAt']?.toString() ?? '') ??
              DateTime.now(),
    );
  }

  OfflineBookManifest copyWith({
    String? title,
    int? totalChapters,
    Map<int, String>? chapterTitles,
    DateTime? cachedAt,
  }) {
    return OfflineBookManifest(
      comicId: comicId,
      serverUrl: serverUrl,
      title: title ?? this.title,
      isNovel: isNovel,
      totalChapters: totalChapters ?? this.totalChapters,
      chapterTitles: chapterTitles ?? this.chapterTitles,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }
}

class OfflineLibraryService {
  static const _manifestKey = 'offline_book_manifests_v1';
  static const _progressKey = 'offline_reading_progress_v1';

  Future<Map<String, dynamic>> _loadMap(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(key);
    if (raw == null || raw.isEmpty) return <String, dynamic>{};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) {
        return decoded.map(
          (key, value) => MapEntry(key.toString(), value),
        );
      }
    } catch (_) {}
    return <String, dynamic>{};
  }

  Future<void> _saveMap(String key, Map<String, dynamic> value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, jsonEncode(value));
  }

  Future<OfflineBookManifest?> getManifest(String comicId) async {
    final manifests = await _loadMap(_manifestKey);
    final raw = manifests[comicId];
    if (raw is Map<String, dynamic>) {
      return OfflineBookManifest.fromJson(raw);
    }
    if (raw is Map) {
      return OfflineBookManifest.fromJson(
        raw.map((key, value) => MapEntry(key.toString(), value)),
      );
    }
    return null;
  }

  Future<void> saveManifest(OfflineBookManifest manifest) async {
    final manifests = await _loadMap(_manifestKey);
    manifests[manifest.comicId] = manifest.toJson();
    await _saveMap(_manifestKey, manifests);
  }

  Future<void> updateChapterTitle(
    String comicId,
    int chapterIndex,
    String title,
  ) async {
    if (title.trim().isEmpty) return;
    final manifest = await getManifest(comicId);
    if (manifest == null) return;

    final titles = Map<int, String>.from(manifest.chapterTitles);
    if (titles[chapterIndex] == title) return;
    titles[chapterIndex] = title;

    await saveManifest(manifest.copyWith(chapterTitles: titles));
  }

  Future<void> deleteManifest(String comicId) async {
    final manifests = await _loadMap(_manifestKey);
    final manifest = await getManifest(comicId);
    manifests.remove(comicId);
    await _saveMap(_manifestKey, manifests);

    if (manifest != null) {
      final progress = await _loadMap(_progressKey);
      progress.remove(_progressId(comicId, manifest.serverUrl));
      await _saveMap(_progressKey, progress);
    }
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_manifestKey);
    await prefs.remove(_progressKey);
  }

  String _progressId(String comicId, String serverUrl) {
    final normalized = serverUrl.trim().replaceAll(RegExp(r'/+$'), '');
    return '$normalized::$comicId';
  }

  Future<int> loadProgress(String comicId, String serverUrl) async {
    final progress = await _loadMap(_progressKey);
    final value = progress[_progressId(comicId, serverUrl)];
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  Future<void> saveProgress(
    String comicId,
    String serverUrl,
    int chapterIndex,
  ) async {
    final progress = await _loadMap(_progressKey);
    progress[_progressId(comicId, serverUrl)] = chapterIndex;
    await _saveMap(_progressKey, progress);
  }
}

final offlineLibraryService = OfflineLibraryService();
