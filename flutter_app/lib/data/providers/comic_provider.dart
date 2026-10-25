import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/comic_api.dart';
import 'auth_provider.dart';
import '../models/comic.dart';

/// 阅读器完成进度同步后，通知仍留在导航栈中的首页和详情页刷新。
final readingProgressRevisionProvider = StateProvider<int>((ref) => 0);

void notifyReadingProgress(WidgetRef ref, String comicId) {
  ref.invalidate(comicDetailProvider(comicId));
  ref.invalidate(statsProvider);
  ref.read(comicListProvider.notifier).refreshVisible();
  ref.read(readingProgressRevisionProvider.notifier).state++;
}

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
  final bool seriesView;

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
    this.seriesView = true,
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
    bool? seriesView,
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
      seriesView: seriesView ?? this.seriesView,
    );
  }
}

/// 漫画列表状态
class ComicListState {
  final List<Comic> comics;
  final int totalCount;
  final bool isLoading;
  final bool hasLoaded;
  final bool hasMore;
  final ComicListParams params;
  final String? error;

  const ComicListState({
    this.comics = const [],
    this.totalCount = 0,
    this.isLoading = false,
    this.hasLoaded = false,
    this.hasMore = true,
    this.params = const ComicListParams(),
    this.error,
  });

  ComicListState copyWith({
    List<Comic>? comics,
    int? totalCount,
    bool? isLoading,
    bool? hasLoaded,
    bool? hasMore,
    ComicListParams? params,
    String? error,
    bool clearError = false,
  }) {
    return ComicListState(
      comics: comics ?? this.comics,
      totalCount: totalCount ?? this.totalCount,
      isLoading: isLoading ?? this.isLoading,
      hasLoaded: hasLoaded ?? this.hasLoaded,
      hasMore: hasMore ?? this.hasMore,
      params: params ?? this.params,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// 漫画列表 Notifier
class ComicListNotifier extends StateNotifier<ComicListState> {
  final Ref _ref;
  int _requestVersion = 0;

  ComicListNotifier(this._ref) : super(const ComicListState());

  /// 加载漫画列表（刷新/首次加载）
  Future<void> loadComics({ComicListParams? params}) async {
    final p = params ?? state.params;
    final version = ++_requestVersion;
    state = state.copyWith(
      isLoading: true,
      params: p.copyWith(page: 1),
      clearError: true,
    );
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
        seriesView: p.seriesView,
      );
      if (!mounted || version != _requestVersion) return;
      final list = (data['comics'] as List<dynamic>?)
              ?.map((e) => Comic.fromJson(e))
              .toList() ??
          [];
      final total = data['total'] ?? list.length;
      state = state.copyWith(
        comics: list,
        totalCount: total,
        isLoading: false,
        hasLoaded: true,
        hasMore: list.length < total,
        params: p.copyWith(page: 1),
      );
    } catch (e) {
      if (!mounted || version != _requestVersion) return;
      state = state.copyWith(isLoading: false, error: '加载失败: $e');
    }
  }

  /// 阅读返回时保留已加载页和滚动布局，在后台更新当前可见的书架范围。
  /// 失败保留原列表；筛选、翻页或账户变化后丢弃过时响应。
  Future<void> refreshVisible() async {
    if (state.comics.isEmpty || state.isLoading) return;
    final p = state.params;
    final version = ++_requestVersion;
    final visibleLimit = p.page * p.limit;
    try {
      final data = await _ref.read(comicApiProvider).listComics(
            page: 1,
            limit: visibleLimit,
            sort: p.sort,
            order: p.order,
            search: p.search,
            tag: p.tag,
            category: p.category,
            type: p.type,
            readingStatus: p.readingStatus,
            favoritesOnly: p.favoritesOnly,
            seriesView: p.seriesView,
          );
      if (!mounted || version != _requestVersion) return;
      final list = (data['comics'] as List<dynamic>?)
              ?.map((e) => Comic.fromJson(e))
              .toList() ??
          [];
      final total = (data['total'] as num?)?.toInt() ?? list.length;
      final pages = (list.length / p.limit).ceil().clamp(1, p.page);
      state = state.copyWith(
        comics: list,
        totalCount: total,
        hasMore: list.length < total,
        params: p.copyWith(page: pages),
      );
    } catch (error) {
      if (!mounted || version != _requestVersion) return;
      if (error is DioException &&
          (error.response?.statusCode == 401 ||
              error.response?.statusCode == 403)) {
        state = ComicListState(
            params: p.copyWith(page: 1),
            hasLoaded: true,
            hasMore: false,
            error: '书库访问权限已变更，请刷新后重试');
      }
      // 暂时的网络错误保留可继续浏览的缓存，用户可下拉重试。
    }
  }

  /// 加载更多（分页）
  Future<void> loadMore() async {
    if (state.isLoading || !state.hasMore) return;
    final p = state.params;
    final version = ++_requestVersion;
    final nextPage = p.page + 1;
    state = state.copyWith(isLoading: true);
    try {
      final api = _ref.read(comicApiProvider);
      final data = await api.listComics(
        page: nextPage,
        limit: p.limit,
        sort: p.sort,
        order: p.order,
        search: p.search,
        tag: p.tag,
        category: p.category,
        type: p.type,
        readingStatus: p.readingStatus,
        favoritesOnly: p.favoritesOnly,
        seriesView: p.seriesView,
      );
      if (!mounted || version != _requestVersion) return;
      final newList = (data['comics'] as List<dynamic>?)
              ?.map((e) => Comic.fromJson(e))
              .toList() ??
          [];
      state = state.copyWith(
        comics: [...state.comics, ...newList],
        isLoading: false,
        totalCount: (data['total'] as num?)?.toInt() ?? state.totalCount,
        hasMore: state.comics.length + newList.length <
            ((data['total'] as num?)?.toInt() ?? state.totalCount),
        params: p.copyWith(page: nextPage),
      );
    } catch (e) {
      if (!mounted || version != _requestVersion) return;
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

final comicListScopeProvider = Provider<String>(
  (ref) => ref.watch(
    authProvider.select((s) => '${s.serverUrl}:${s.user?.id}:${s.user?.role}'),
  ),
);

final comicListProvider =
    StateNotifierProvider<ComicListNotifier, ComicListState>((ref) {
  // Lists belong to one server/account/role and must not survive an identity change.
  ref.watch(comicListScopeProvider);
  return ComicListNotifier(ref);
});

/// 单本漫画详情 Provider
final comicDetailProvider = FutureProvider.family<Comic?, String>((
  ref,
  comicId,
) async {
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

/// 已分组漫画 ID 映射 Provider（漫画ID -> 所属分组ID列表）
final groupedComicMapProvider = FutureProvider<Map<String, List<int>>>((
  ref,
) async {
  final api = ref.read(comicApiProvider);
  return await api.getGroupedComicMap();
});

/// 按内容类型过滤的分组列表 Provider
final groupsByTypeProvider = FutureProvider.family<List<ComicGroup>, String?>((
  ref,
  contentType,
) async {
  final api = ref.read(comicApiProvider);
  final data = await api.getGroups(contentType: contentType);
  return data.map((e) => ComicGroup.fromJson(e)).toList();
});

/// 视图模式枚举
enum ViewMode { grid, list }

/// 全局视图模式 Provider（网格 / 列表切换）
final viewModeProvider = StateProvider<ViewMode>((ref) => ViewMode.grid);
