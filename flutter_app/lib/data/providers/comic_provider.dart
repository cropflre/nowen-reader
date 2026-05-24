import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/comic_api.dart';
import '../models/comic.dart';

/// 漫画列表参数
class ComicListParams {
  final int page;
  final int limit;
  final String sort;
  final String order;
  final String? search;
  final String? tag;
  final String? category;
  final String? type;
  final String? readingStatus;
  final bool? favoritesOnly;

  const ComicListParams({
    this.page = 1,
    this.limit = 20,
    this.sort = 'addedAt',
    this.order = 'desc',
    this.search,
    this.tag,
    this.category,
    this.type,
    this.readingStatus,
    this.favoritesOnly,
  });

  ComicListParams copyWith({
    int? page,
    String? sort,
    String? order,
    String? search,
    String? tag,
    String? category,
    String? type,
    String? readingStatus,
    bool? favoritesOnly,
    bool clearSearch = false,
    bool clearTag = false,
    bool clearCategory = false,
    bool clearType = false,
  }) {
    return ComicListParams(
      page: page ?? this.page,
      limit: limit,
      sort: sort ?? this.sort,
      order: order ?? this.order,
      search: clearSearch ? null : (search ?? this.search),
      tag: clearTag ? null : (tag ?? this.tag),
      category: clearCategory ? null : (category ?? this.category),
      type: clearType ? null : (type ?? this.type),
      readingStatus: readingStatus ?? this.readingStatus,
      favoritesOnly: favoritesOnly ?? this.favoritesOnly,
    );
  }
}

/// 漫画列表状态
class ComicListState {
  final List<Comic> comics;
  final int totalCount;
  final bool isLoading;
  final bool hasMore;
  final ComicListParams params;
  final String? error;

  const ComicListState({
    this.comics = const [],
    this.totalCount = 0,
    this.isLoading = false,
    this.hasMore = true,
    this.params = const ComicListParams(),
    this.error,
  });

  ComicListState copyWith({
    List<Comic>? comics,
    int? totalCount,
    bool? isLoading,
    bool? hasMore,
    ComicListParams? params,
    String? error,
    bool clearError = false,
  }) {
    return ComicListState(
      comics: comics ?? this.comics,
      totalCount: totalCount ?? this.totalCount,
      isLoading: isLoading ?? this.isLoading,
      hasMore: hasMore ?? this.hasMore,
      params: params ?? this.params,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// 漫画列表 Notifier
class ComicListNotifier extends StateNotifier<ComicListState> {
  final Ref _ref;

  ComicListNotifier(this._ref) : super(const ComicListState());

  /// 加载漫画列表（刷新/首次加载）
  Future<void> loadComics({ComicListParams? params}) async {
    final p = params ?? state.params;
    state = state.copyWith(isLoading: true, params: p.copyWith(page: 1), clearError: true);
    try {
      final api = _ref.read(comicApiProvider);
      final data = await api.listComics(
        page: 1,
        limit: p.limit,
        sort: p.sort,
        order: p.order,
        search: p.search,
        tag: p.tag,
        category: p.category,
        type: p.type,
        readingStatus: p.readingStatus,
        favoritesOnly: p.favoritesOnly,
      );
      final list = (data['comics'] as List<dynamic>?)
              ?.map((e) => Comic.fromJson(e))
              .toList() ??
          [];
      final total = data['total'] ?? list.length;
      state = state.copyWith(
        comics: list,
        totalCount: total,
        isLoading: false,
        hasMore: list.length >= p.limit,
        params: p.copyWith(page: 1),
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: '加载失败: $e');
    }
  }

  /// 加载更多（分页）
  Future<void> loadMore() async {
    if (state.isLoading || !state.hasMore) return;
    final nextPage = state.params.page + 1;
    state = state.copyWith(isLoading: true);
    try {
      final api = _ref.read(comicApiProvider);
      final data = await api.listComics(
        page: nextPage,
        limit: state.params.limit,
        sort: state.params.sort,
        order: state.params.order,
        search: state.params.search,
        tag: state.params.tag,
        category: state.params.category,
        type: state.params.type,
        readingStatus: state.params.readingStatus,
        favoritesOnly: state.params.favoritesOnly,
      );
      final newList = (data['comics'] as List<dynamic>?)
              ?.map((e) => Comic.fromJson(e))
              .toList() ??
          [];
      state = state.copyWith(
        comics: [...state.comics, ...newList],
        isLoading: false,
        hasMore: newList.length >= state.params.limit,
        params: state.params.copyWith(page: nextPage),
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: '加载更多失败: $e');
    }
  }

  /// 切换收藏
  Future<void> toggleFavorite(String comicId) async {
    try {
      final api = _ref.read(comicApiProvider);
      final data = await api.toggleFavorite(comicId);
      final isFav = data['isFavorite'] ?? false;
      state = state.copyWith(
        comics: state.comics.map((c) {
          if (c.id == comicId) return c.copyWith(isFavorite: isFav);
          return c;
        }).toList(),
      );
    } catch (_) {}
  }

  /// 更新搜索/筛选参数
  Future<void> updateParams(ComicListParams params) async {
    await loadComics(params: params);
  }
}

final comicListProvider =
    StateNotifierProvider<ComicListNotifier, ComicListState>((ref) {
  return ComicListNotifier(ref);
});

/// 单本漫画详情 Provider
final comicDetailProvider =
    FutureProvider.family<Comic?, String>((ref, comicId) async {
  final api = ref.read(comicApiProvider);
  try {
    final data = await api.getComic(comicId);
    return Comic.fromJson(data);
  } catch (_) {
    return null;
  }
});

/// 标签列表 Provider
final tagsProvider = FutureProvider<List<Tag>>((ref) async {
  final api = ref.read(comicApiProvider);
  final data = await api.getTags();
  return data.map((e) => Tag.fromJson(e)).toList();
});

/// 分类列表 Provider
final categoriesProvider = FutureProvider<List<Category>>((ref) async {
  final api = ref.read(comicApiProvider);
  final data = await api.getCategories();
  return data.map((e) => Category.fromJson(e)).toList();
});

/// 阅读统计 Provider
final statsProvider = FutureProvider<ReadingStats>((ref) async {
  final api = ref.read(comicApiProvider);
  final data = await api.getStats();
  return ReadingStats.fromJson(data);
});

/// 分组列表 Provider
final groupsProvider = FutureProvider<List<ComicGroup>>((ref) async {
  final api = ref.read(comicApiProvider);
  final data = await api.getGroups();
  return data.map((e) => ComicGroup.fromJson(e)).toList();
});

/// 按内容类型过滤的分组列表 Provider
final groupsByTypeProvider = FutureProvider.family<List<ComicGroup>, String?>((ref, contentType) async {
  final api = ref.read(comicApiProvider);
  final data = await api.getGroups(contentType: contentType);
  return data.map((e) => ComicGroup.fromJson(e)).toList();
});

/// 视图模式枚举
enum ViewMode { grid, list }

/// 全局视图模式 Provider（网格 / 列表切换）
final viewModeProvider = StateProvider<ViewMode>((ref) => ViewMode.grid);
