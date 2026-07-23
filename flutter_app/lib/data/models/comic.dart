int _asInt(dynamic value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

double? _asDouble(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '');
}

/// 漫画/小说数据模型
class Comic {
  final String id;
  final String filename;
  final String title;
  final String titleSortKey;
  final String author;
  final String publisher;
  final String description;
  final String genre;
  final String language;
  final int? year;
  final int pageCount;
  final int fileSize;
  final String addedAt;
  final String updatedAt;
  final int sortOrder;
  final int lastReadPage;
  final int totalReadTime;
  final String readingStatus; // '' | want | reading | finished | shelved
  final String? lastReadAt;
  final String metadataSource;
  final String? coverImageUrl;
  final double coverAspectRatio;
  final double? rating;
  final bool isFavorite;
  final String comicType; // comic | novel
  final String libraryId;
  final double? externalRating;
  final double externalRatingMax;
  final String externalRatingSource;
  final String externalRatingUpdatedAt;
  final bool canManage;
  final int comicCount;
  final List<Tag> tags;
  final List<Category> categories;

  /// 阅读进度百分比 (0-100)
  int get progress {
    if (pageCount <= 0 || !hasReadingProgress) return 0;
    final percent = ((displayPage / pageCount) * 100).round();
    if (percent < 0) return 0;
    if (percent > 100) return 100;
    return percent;
  }

  /// 用于显示的 1-based 页码，始终不超过总页数。
  int get displayPage {
    final current = lastReadPage + 1;
    if (current < 0) return 0;
    if (pageCount > 0 && current > pageCount) return pageCount;
    return current;
  }

  bool get hasReadingProgress =>
      lastReadAt != null && lastReadAt!.trim().isNotEmpty;

  bool get isFinished => pageCount > 0 && lastReadPage >= pageCount - 1;

  Comic({
    required this.id,
    required this.filename,
    required this.title,
    this.titleSortKey = '',
    this.author = '',
    this.publisher = '',
    this.description = '',
    this.genre = '',
    this.language = '',
    this.year,
    this.pageCount = 0,
    this.fileSize = 0,
    this.addedAt = '',
    this.updatedAt = '',
    this.sortOrder = 0,
    this.lastReadPage = 0,
    this.totalReadTime = 0,
    this.readingStatus = '',
    this.lastReadAt,
    this.metadataSource = '',
    this.coverImageUrl,
    this.coverAspectRatio = 0,
    this.rating,
    this.isFavorite = false,
    this.comicType = 'comic',
    this.libraryId = '',
    this.externalRating,
    this.externalRatingMax = 0,
    this.externalRatingSource = '',
    this.externalRatingUpdatedAt = '',
    this.canManage = false,
    this.comicCount = 0,
    this.tags = const [],
    this.categories = const [],
  });

  factory Comic.fromJson(Map<String, dynamic> json) {
    final rawPageCount = _asInt(json['pageCount']);
    return Comic(
      id: json['id']?.toString() ?? '',
      filename: json['filename']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      titleSortKey: json['titleSortKey']?.toString() ?? '',
      author: json['author']?.toString() ?? '',
      publisher: json['publisher']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      genre: json['genre']?.toString() ?? '',
      language: json['language']?.toString() ?? '',
      year: json['year'] == null ? null : _asInt(json['year']),
      pageCount: rawPageCount < 0 ? 0 : rawPageCount,
      fileSize: _asInt(json['fileSize']),
      addedAt: json['addedAt']?.toString() ?? '',
      updatedAt: json['updatedAt']?.toString() ?? '',
      sortOrder: _asInt(json['sortOrder']),
      lastReadPage: _asInt(json['lastReadPage']),
      totalReadTime: _asInt(json['totalReadTime']),
      readingStatus: json['readingStatus']?.toString() ?? '',
      lastReadAt: json['lastReadAt']?.toString(),
      metadataSource: json['metadataSource']?.toString() ?? '',
      coverImageUrl:
          (json['coverUrl'] ?? json['coverImageUrl'])?.toString(),
      coverAspectRatio: _asDouble(json['coverAspectRatio']) ?? 0,
      rating: _asDouble(json['rating']),
      isFavorite: json['isFavorite'] == true,
      comicType:
          (json['type'] ?? json['comicType'])?.toString() ?? 'comic',
      libraryId: json['libraryId']?.toString() ?? '',
      externalRating: _asDouble(json['externalRating']),
      externalRatingMax: _asDouble(json['externalRatingMax']) ?? 0,
      externalRatingSource:
          json['externalRatingSource']?.toString() ?? '',
      externalRatingUpdatedAt:
          json['externalRatingUpdatedAt']?.toString() ?? '',
      canManage: json['canManage'] == true,
      comicCount: _asInt(json['comicCount']),
      tags: (json['tags'] as List?)
              ?.whereType<Map>()
              .map((item) => Tag.fromJson(Map<String, dynamic>.from(item)))
              .toList() ??
          const [],
      categories: (json['categories'] as List?)
              ?.whereType<Map>()
              .map((item) =>
                  Category.fromJson(Map<String, dynamic>.from(item)))
              .toList() ??
          const [],
    );
  }

  /// 封面缩略图 URL（相对于服务器）
  String thumbnailUrl(String serverUrl) =>
      '$serverUrl/api/comics/$id/thumbnail';

  /// 是否为小说（严格按后端 type 字段判断，不再依赖文件扩展名）
  bool get isNovel => comicType == 'novel';

  /// 是否为图片文件夹漫画（filename 以 "/" 结尾）
  bool get isImageFolder => filename.endsWith('/');

  /// 是否为 PDF 文件
  bool get isPdf => filename.toLowerCase().endsWith('.pdf');

  /// 复制并修改部分字段
  Comic copyWith({
    String? id,
    String? filename,
    String? title,
    String? titleSortKey,
    String? author,
    String? publisher,
    String? description,
    String? genre,
    String? language,
    int? year,
    int? pageCount,
    int? fileSize,
    String? addedAt,
    String? updatedAt,
    int? sortOrder,
    int? lastReadPage,
    int? totalReadTime,
    String? readingStatus,
    String? lastReadAt,
    String? metadataSource,
    String? coverImageUrl,
    double? coverAspectRatio,
    double? rating,
    bool? isFavorite,
    String? comicType,
    String? libraryId,
    double? externalRating,
    double? externalRatingMax,
    String? externalRatingSource,
    String? externalRatingUpdatedAt,
    bool? canManage,
    int? comicCount,
    List<Tag>? tags,
    List<Category>? categories,
  }) {
    return Comic(
      id: id ?? this.id,
      filename: filename ?? this.filename,
      title: title ?? this.title,
      titleSortKey: titleSortKey ?? this.titleSortKey,
      author: author ?? this.author,
      publisher: publisher ?? this.publisher,
      description: description ?? this.description,
      genre: genre ?? this.genre,
      language: language ?? this.language,
      year: year ?? this.year,
      pageCount: pageCount ?? this.pageCount,
      fileSize: fileSize ?? this.fileSize,
      addedAt: addedAt ?? this.addedAt,
      updatedAt: updatedAt ?? this.updatedAt,
      sortOrder: sortOrder ?? this.sortOrder,
      lastReadPage: lastReadPage ?? this.lastReadPage,
      totalReadTime: totalReadTime ?? this.totalReadTime,
      readingStatus: readingStatus ?? this.readingStatus,
      lastReadAt: lastReadAt ?? this.lastReadAt,
      metadataSource: metadataSource ?? this.metadataSource,
      coverImageUrl: coverImageUrl ?? this.coverImageUrl,
      coverAspectRatio: coverAspectRatio ?? this.coverAspectRatio,
      rating: rating ?? this.rating,
      isFavorite: isFavorite ?? this.isFavorite,
      comicType: comicType ?? this.comicType,
      libraryId: libraryId ?? this.libraryId,
      externalRating: externalRating ?? this.externalRating,
      externalRatingMax: externalRatingMax ?? this.externalRatingMax,
      externalRatingSource:
          externalRatingSource ?? this.externalRatingSource,
      externalRatingUpdatedAt:
          externalRatingUpdatedAt ?? this.externalRatingUpdatedAt,
      canManage: canManage ?? this.canManage,
      comicCount: comicCount ?? this.comicCount,
      tags: tags ?? this.tags,
      categories: categories ?? this.categories,
    );
  }
}

/// 标签
class Tag {
  final int id;
  final String name;
  final String color;

  const Tag({required this.id, required this.name, this.color = ''});

  factory Tag.fromJson(Map<String, dynamic> json) {
    return Tag(
      id: _asInt(json['id']),
      name: json['name']?.toString() ?? '',
      color: json['color']?.toString() ?? '',
    );
  }
}

/// 分类
class Category {
  final int id;
  final String name;
  final String slug;
  final String icon;
  final int sortOrder;
  final int comicCount;

  const Category({
    required this.id,
    required this.name,
    this.slug = '',
    this.icon = '',
    this.sortOrder = 0,
    this.comicCount = 0,
  });

  factory Category.fromJson(Map<String, dynamic> json) {
    return Category(
      id: _asInt(json['id']),
      name: json['name']?.toString() ?? '',
      slug: (json['slug'] ?? json['name'])?.toString() ?? '',
      icon: json['icon']?.toString() ?? '',
      sortOrder: _asInt(json['sortOrder']),
      comicCount: _asInt(json['comicCount']),
    );
  }
}

/// 认证用户
class AuthUser {
  final String id;
  final String username;
  final String nickname;
  final String role;
  final bool aiEnabled;

  const AuthUser({
    required this.id,
    required this.username,
    this.nickname = '',
    required this.role,
    this.aiEnabled = false,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id']?.toString() ?? '',
      username: json['username']?.toString() ?? '',
      nickname: json['nickname']?.toString() ?? '',
      role: json['role']?.toString() ?? 'user',
      aiEnabled: json['aiEnabled'] == true,
    );
  }

  bool get isAdmin => role == 'admin';
  bool get canUseAI => isAdmin || aiEnabled;
}

/// 系列（分组）
class ComicGroup {
  final int id;
  final String name;
  final String coverUrl;
  final int sortOrder;
  final String author;
  final String description;
  final String tags;
  final int? year;
  final String publisher;
  final String language;
  final String genre;
  final String status;
  final String createdAt;
  final String updatedAt;
  final int comicCount;
  final String contentType;

  const ComicGroup({
    required this.id,
    required this.name,
    this.coverUrl = '',
    this.sortOrder = 0,
    this.author = '',
    this.description = '',
    this.tags = '',
    this.year,
    this.publisher = '',
    this.language = '',
    this.genre = '',
    this.status = '',
    this.createdAt = '',
    this.updatedAt = '',
    this.comicCount = 0,
    this.contentType = '',
  });

  factory ComicGroup.fromJson(Map<String, dynamic> json) {
    return ComicGroup(
      id: _asInt(json['id']),
      name: json['name']?.toString() ?? '',
      coverUrl: json['coverUrl']?.toString() ?? '',
      sortOrder: _asInt(json['sortOrder']),
      author: json['author']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      tags: json['tags']?.toString() ?? '',
      year: json['year'] == null ? null : _asInt(json['year']),
      publisher: json['publisher']?.toString() ?? '',
      language: json['language']?.toString() ?? '',
      genre: json['genre']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      createdAt: json['createdAt']?.toString() ?? '',
      updatedAt: json['updatedAt']?.toString() ?? '',
      comicCount: _asInt(json['comicCount']),
      contentType: json['contentType']?.toString() ?? '',
    );
  }
}

/// 阅读统计
class ReadingStats {
  final int totalReadTime;
  final int totalSessions;
  final int totalBooksRead;
  final int totalPagesRead;
  final int totalComicsRead;
  final List<DailyStats> dailyStats;
  final List<RecentSession> recentSessions;

  const ReadingStats({
    this.totalReadTime = 0,
    this.totalSessions = 0,
    this.totalBooksRead = 0,
    this.totalPagesRead = 0,
    this.totalComicsRead = 0,
    this.dailyStats = const [],
    this.recentSessions = const [],
  });

  List<DailyStats> get safeDailyStats => dailyStats;
  List<RecentSession> get safeRecentSessions => recentSessions;

  factory ReadingStats.fromJson(Map<String, dynamic> json) {
    return ReadingStats(
      totalReadTime: _asInt(json['totalReadTime']),
      totalSessions: _asInt(json['totalSessions']),
      totalBooksRead: _asInt(json['totalBooksRead']),
      totalPagesRead: _asInt(json['totalPagesRead']),
      totalComicsRead:
          _asInt(json['totalComicsRead'], _asInt(json['totalBooksRead'])),
      dailyStats: (json['dailyStats'] as List?)
              ?.whereType<Map>()
              .map((item) =>
                  DailyStats.fromJson(Map<String, dynamic>.from(item)))
              .toList() ??
          const [],
      recentSessions: (json['recentSessions'] as List?)
              ?.whereType<Map>()
              .map((item) =>
                  RecentSession.fromJson(Map<String, dynamic>.from(item)))
              .toList() ??
          const [],
    );
  }
}

/// 每日统计
class DailyStats {
  final String date;
  final int readTime;
  final int duration;
  final int sessions;
  final int pagesRead;

  const DailyStats({
    required this.date,
    this.readTime = 0,
    this.duration = 0,
    this.sessions = 0,
    this.pagesRead = 0,
  });

  factory DailyStats.fromJson(Map<String, dynamic> json) {
    final readTime = _asInt(json['readTime']);
    return DailyStats(
      date: json['date']?.toString() ?? '',
      readTime: readTime,
      duration: _asInt(json['duration'], readTime),
      sessions: _asInt(json['sessions']),
      pagesRead: _asInt(json['pagesRead']),
    );
  }
}

/// 最近阅读会话
class RecentSession {
  final int id;
  final String comicId;
  final String comicTitle;
  final int startPage;
  final int endPage;
  final int duration;
  final String startedAt;

  const RecentSession({
    this.id = 0,
    required this.comicId,
    this.comicTitle = '',
    this.startPage = 0,
    this.endPage = 0,
    this.duration = 0,
    this.startedAt = '',
  });

  factory RecentSession.fromJson(Map<String, dynamic> json) {
    return RecentSession(
      id: _asInt(json['id']),
      comicId: json['comicId']?.toString() ?? '',
      comicTitle:
          (json['comicTitle'] ?? json['title'])?.toString() ?? '',
      startPage: _asInt(json['startPage']),
      endPage: _asInt(json['endPage']),
      duration: _asInt(json['duration']),
      startedAt:
          (json['startedAt'] ?? json['createdAt'])?.toString() ?? '',
    );
  }
}

/// 漫画列表响应
class ComicListResponse {
  final List<Comic> comics;
  final int total;
  final int page;
  final int pageSize;
  final int totalPages;

  const ComicListResponse({
    required this.comics,
    required this.total,
    required this.page,
    required this.pageSize,
    required this.totalPages,
  });

  factory ComicListResponse.fromJson(Map<String, dynamic> json) {
    return ComicListResponse(
      comics: (json['comics'] as List?)
              ?.whereType<Map>()
              .map((item) => Comic.fromJson(Map<String, dynamic>.from(item)))
              .toList() ??
          const [],
      total: _asInt(json['total']),
      page: _asInt(json['page'], 1),
      pageSize: _asInt(json['pageSize'], 20),
      totalPages: _asInt(json['totalPages'], 1),
    );
  }
}
