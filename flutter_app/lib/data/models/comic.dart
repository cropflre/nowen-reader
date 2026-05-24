/// 漫画/小说数据模型
class Comic {
  final String id;
  final String filename;
  final String title;
  final String author;
  final String publisher;
  final String description;
  final String genre;
  final String language;
  final int? year;
  final int pageCount;
  final int fileSize;
  final int lastReadPage;
  final int totalReadTime;
  final String readingStatus; // "unread" | "reading" | "read" | "shelved" | "want_to_read"
  final String? lastReadAt;
  final String metadataSource;
  final String? coverImageUrl;
  final double? rating;
  final bool isFavorite;
  final String comicType; // "comic" | "novel"
  final List<Tag> tags;
  final List<Category> categories;

  /// 阅读进度百分比 (0-100)
  int get progress {
    if (pageCount <= 0) return 0;
    return ((lastReadPage / pageCount) * 100).round().clamp(0, 100);
  }

  Comic({
    required this.id,
    required this.filename,
    required this.title,
    this.author = '',
    this.publisher = '',
    this.description = '',
    this.genre = '',
    this.language = '',
    this.year,
    this.pageCount = 0,
    this.fileSize = 0,
    this.lastReadPage = 0,
    this.totalReadTime = 0,
    this.readingStatus = 'unread',
    this.lastReadAt,
    this.metadataSource = '',
    this.coverImageUrl,
    this.rating,
    this.isFavorite = false,
    this.comicType = 'comic',
    this.tags = const [],
    this.categories = const [],
  });

  factory Comic.fromJson(Map<String, dynamic> json) {
    return Comic(
      id: json['id'] ?? '',
      filename: json['filename'] ?? '',
      title: json['title'] ?? '',
      author: json['author'] ?? '',
      publisher: json['publisher'] ?? '',
      description: json['description'] ?? '',
      genre: json['genre'] ?? '',
      language: json['language'] ?? '',
      year: json['year'],
      pageCount: (json['pageCount'] ?? 0) < 0 ? 0 : (json['pageCount'] ?? 0),
      fileSize: json['fileSize'] ?? 0,
      lastReadPage: json['lastReadPage'] ?? 0,
      totalReadTime: json['totalReadTime'] ?? 0,
      readingStatus: json['readingStatus'] ?? 'unread',
      lastReadAt: json['lastReadAt'],
      metadataSource: json['metadataSource'] ?? '',
      coverImageUrl: json['coverUrl'] ?? json['coverImageUrl'],
      rating: (json['rating'] as num?)?.toDouble(),
      isFavorite: json['isFavorite'] ?? false,
      comicType: json['type'] ?? json['comicType'] ?? 'comic',
      tags: (json['tags'] as List?)?.map((t) => Tag.fromJson(t)).toList() ?? [],
      categories: (json['categories'] as List?)?.map((c) => Category.fromJson(c)).toList() ?? [],
    );
  }

  /// 封面缩略图 URL（相对于服务器）
  String thumbnailUrl(String serverUrl) => '$serverUrl/api/comics/$id/thumbnail';

  /// 是否为小说（严格按后端 type 字段判断，不再依赖文件扩展名）
  bool get isNovel => comicType == 'novel';

  /// 是否为图片文件夹漫画（filename 以 "/" 结尾）
  bool get isImageFolder => filename.endsWith('/');

  /// 复制并修改部分字段
  Comic copyWith({
    String? id,
    String? filename,
    String? title,
    String? author,
    String? publisher,
    String? description,
    String? genre,
    String? language,
    int? year,
    int? pageCount,
    int? fileSize,
    int? lastReadPage,
    int? totalReadTime,
    String? readingStatus,
    String? lastReadAt,
    String? metadataSource,
    String? coverImageUrl,
    double? rating,
    bool? isFavorite,
    String? comicType,
    List<Tag>? tags,
    List<Category>? categories,
  }) {
    return Comic(
      id: id ?? this.id,
      filename: filename ?? this.filename,
      title: title ?? this.title,
      author: author ?? this.author,
      publisher: publisher ?? this.publisher,
      description: description ?? this.description,
      genre: genre ?? this.genre,
      language: language ?? this.language,
      year: year ?? this.year,
      pageCount: pageCount ?? this.pageCount,
      fileSize: fileSize ?? this.fileSize,
      lastReadPage: lastReadPage ?? this.lastReadPage,
      totalReadTime: totalReadTime ?? this.totalReadTime,
      readingStatus: readingStatus ?? this.readingStatus,
      lastReadAt: lastReadAt ?? this.lastReadAt,
      metadataSource: metadataSource ?? this.metadataSource,
      coverImageUrl: coverImageUrl ?? this.coverImageUrl,
      rating: rating ?? this.rating,
      isFavorite: isFavorite ?? this.isFavorite,
      comicType: comicType ?? this.comicType,
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

  Tag({required this.id, required this.name, this.color = ''});

  factory Tag.fromJson(Map<String, dynamic> json) {
    return Tag(
      id: json['id'] ?? 0,
      name: json['name'] ?? '',
      color: json['color'] ?? '',
    );
  }
}

/// 分类
class Category {
  final int id;
  final String name;
  final String slug;

  Category({required this.id, required this.name, this.slug = ''});

  factory Category.fromJson(Map<String, dynamic> json) {
    return Category(
      id: json['id'] ?? 0,
      name: json['name'] ?? '',
      slug: json['slug'] ?? json['name'] ?? '',
    );
  }
}

/// 认证用户
class AuthUser {
  final String id;
  final String username;
  final String nickname;
  final String role;

  AuthUser({
    required this.id,
    required this.username,
    this.nickname = '',
    required this.role,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] ?? '',
      username: json['username'] ?? '',
      nickname: json['nickname'] ?? '',
      role: json['role'] ?? 'user',
    );
  }

  bool get isAdmin => role == 'admin';
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

  ComicGroup({
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
  });

  factory ComicGroup.fromJson(Map<String, dynamic> json) {
    return ComicGroup(
      id: json['id'] ?? 0,
      name: json['name'] ?? '',
      coverUrl: json['coverUrl'] ?? '',
      sortOrder: json['sortOrder'] ?? 0,
      author: json['author'] ?? '',
      description: json['description'] ?? '',
      tags: json['tags'] ?? '',
      year: json['year'],
      publisher: json['publisher'] ?? '',
      language: json['language'] ?? '',
      genre: json['genre'] ?? '',
      status: json['status'] ?? '',
      createdAt: json['createdAt'] ?? '',
      updatedAt: json['updatedAt'] ?? '',
      comicCount: json['comicCount'] ?? 0,
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

  ReadingStats({
    this.totalReadTime = 0,
    this.totalSessions = 0,
    this.totalBooksRead = 0,
    this.totalPagesRead = 0,
    this.totalComicsRead = 0,
    this.dailyStats = const [],
    this.recentSessions = const [],
  });

  /// 安全访问 dailyStats（避免空列表异常）
  List<DailyStats> get safeDailyStats => dailyStats;

  /// 安全访问 recentSessions（避免空列表异常）
  List<RecentSession> get safeRecentSessions => recentSessions;

  factory ReadingStats.fromJson(Map<String, dynamic> json) {
    return ReadingStats(
      totalReadTime: json['totalReadTime'] ?? 0,
      totalSessions: json['totalSessions'] ?? 0,
      totalBooksRead: json['totalBooksRead'] ?? 0,
      totalPagesRead: json['totalPagesRead'] ?? 0,
      totalComicsRead: json['totalComicsRead'] ?? json['totalBooksRead'] ?? 0,
      dailyStats: (json['dailyStats'] as List?)?.map((d) => DailyStats.fromJson(d)).toList() ?? [],
      recentSessions: (json['recentSessions'] as List?)?.map((s) => RecentSession.fromJson(s)).toList() ?? [],
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

  DailyStats({
    required this.date,
    this.readTime = 0,
    this.duration = 0,
    this.sessions = 0,
    this.pagesRead = 0,
  });

  factory DailyStats.fromJson(Map<String, dynamic> json) {
    final readTime = json['readTime'] ?? 0;
    return DailyStats(
      date: json['date'] ?? '',
      readTime: readTime,
      duration: json['duration'] ?? readTime,
      sessions: json['sessions'] ?? 0,
      pagesRead: json['pagesRead'] ?? 0,
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

  RecentSession({
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
      id: json['id'] ?? 0,
      comicId: json['comicId'] ?? '',
      comicTitle: json['comicTitle'] ?? json['title'] ?? '',
      startPage: json['startPage'] ?? 0,
      endPage: json['endPage'] ?? 0,
      duration: json['duration'] ?? 0,
      startedAt: json['startedAt'] ?? json['createdAt'] ?? '',
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

  ComicListResponse({
    required this.comics,
    required this.total,
    required this.page,
    required this.pageSize,
    required this.totalPages,
  });

  factory ComicListResponse.fromJson(Map<String, dynamic> json) {
    return ComicListResponse(
      comics: (json['comics'] as List?)?.map((c) => Comic.fromJson(c)).toList() ?? [],
      total: json['total'] ?? 0,
      page: json['page'] ?? 1,
      pageSize: json['pageSize'] ?? 20,
      totalPages: json['totalPages'] ?? 1,
    );
  }
}
