import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../data/api/api_client.dart';
import '../../widgets/authenticated_image.dart';
import '../../widgets/continue_reading.dart';
import '../../widgets/comic_list_tile.dart';
import '../../widgets/group_card.dart';
import '../../data/models/comic.dart';
import '../../data/providers/auth_provider.dart';
import '../../data/providers/comic_provider.dart';
import '../../widgets/animations.dart';

/// 首页 — 极简优雅的书库浏览，支持合集优先展示
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  static const _groupByFolderPreferenceKey = 'home_group_by_folder';

  final _scrollController = ScrollController();
  bool _groupByFolder = true; // 首次使用默认按文件夹收起，之后记住用户选择

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _loadGroupByFolderPreference();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final currentParams = ref.read(comicListProvider).params;
      if (currentParams.search != null ||
          currentParams.tag != null ||
          currentParams.category != null) {
        ref.read(comicListProvider.notifier).loadComics(
              params: ComicListParams(
                sort: currentParams.sort,
                order: currentParams.order,
                type: currentParams.type,
                favoritesOnly: currentParams.favoritesOnly,
              ),
            );
      } else {
        ref.read(comicListProvider.notifier).loadComics();
      }
    });
  }

  Future<void> _loadGroupByFolderPreference() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getBool(_groupByFolderPreferenceKey);
    if (!mounted || saved == null) return;
    setState(() => _groupByFolder = saved);
  }

  Future<void> _toggleGroupByFolder() async {
    final next = !_groupByFolder;
    setState(() => _groupByFolder = next);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_groupByFolderPreferenceKey, next);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 300) {
      ref.read(comicListProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(comicListProvider);
    final authState = ref.watch(authProvider);
    final viewMode = ref.watch(viewModeProvider);
    final cs = Theme.of(context).colorScheme;

    // 合集数据
    final groupsAsync = ref.watch(groupsProvider);
    // 已分组漫画 ID 映射
    final groupedMapAsync = ref.watch(groupedComicMapProvider);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(comicListProvider.notifier).loadComics();
          ref.invalidate(groupsProvider);
          ref.invalidate(groupedComicMapProvider);
        },
        color: cs.primary,
        child: CustomScrollView(
          controller: _scrollController,
          slivers: [
            // ─── 优雅的顶部区域 ───
            SliverAppBar(
              floating: true,
              snap: true,
              title: const Text('书库'),
              actions: [
                // 合集入口
                _ActionIcon(
                  icon: Icons.collections_bookmark_outlined,
                  tooltip: '合集',
                  onTap: () => context.push('/collections'),
                ),
                // 视图模式切换
                _ActionIcon(
                  icon: viewMode == ViewMode.grid
                      ? Icons.view_agenda_outlined
                      : Icons.grid_view_rounded,
                  tooltip: viewMode == ViewMode.grid ? '列表视图' : '网格视图',
                  onTap: () {
                    HapticFeedback.lightImpact();
                    ref.read(viewModeProvider.notifier).state =
                        viewMode == ViewMode.grid ? ViewMode.list : ViewMode.grid;
                  },
                ),
                // 排序
                PopupMenuButton<String>(
                  icon: const Icon(Icons.swap_vert_rounded),
                  tooltip: '排序',
                  position: PopupMenuPosition.under,
                  onSelected: (sort) {
                    final current = state.params;
                    String order = 'desc';
                    if (sort == 'title') order = 'asc';
                    ref.read(comicListProvider.notifier).updateParams(
                          current.copyWith(sort: sort, order: order, page: 1),
                        );
                  },
                  itemBuilder: (_) => [
                    _buildSortItem('addedAt', '最近添加', Icons.schedule_rounded, state.params.sort),
                    _buildSortItem('title', '标题', Icons.sort_by_alpha_rounded, state.params.sort),
                    _buildSortItem('lastReadAt', '最近阅读', Icons.auto_stories_outlined, state.params.sort),
                    _buildSortItem('rating', '评分', Icons.star_outline_rounded, state.params.sort),
                    _buildSortItem('pageCount', '页数', Icons.description_outlined, state.params.sort),
                  ],
                ),
                // 筛选
                PopupMenuButton<String>(
                  icon: Icon(
                    Icons.tune_rounded,
                    color: (state.params.type != null || (state.params.favoritesOnly == true))
                        ? cs.primary
                        : null,
                  ),
                  tooltip: '筛选',
                  position: PopupMenuPosition.under,
                  onSelected: (filter) {
                    final current = state.params;
                    if (filter == 'all') {
                      ref.read(comicListProvider.notifier).updateParams(
                            current.copyWith(
                              clearType: true,
                              favoritesOnly: false,
                              page: 1,
                            ),
                          );
                    } else if (filter == 'favorites') {
                      ref.read(comicListProvider.notifier).updateParams(
                            current.copyWith(favoritesOnly: true, page: 1),
                          );
                    } else {
                      ref.read(comicListProvider.notifier).updateParams(
                            current.copyWith(type: filter, favoritesOnly: false, page: 1),
                          );
                    }
                  },
                  itemBuilder: (_) => [
                    _buildFilterItem('all', '全部', Icons.apps_rounded, state.params),
                    _buildFilterItem('comic', '漫画', Icons.photo_library_outlined, state.params),
                    _buildFilterItem('novel', '小说', Icons.menu_book_outlined, state.params),
                    _buildFilterItem('favorites', '收藏', Icons.favorite_rounded, state.params),
                  ],
                ),
                const SizedBox(width: 4),
              ],
            ),

            // ─── 继续阅读 ───
            const SliverToBoxAdapter(
              child: ContinueReading(),
            ),

            // ─── 合集收起开关 ───
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: _buildGroupToggle(cs, groupsAsync, groupedMapAsync),
              ),
            ),

            // ─── 内容区域 ───
            if (state.comics.isEmpty && state.isLoading)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: _LoadingIndicator(),
                ),
              )
            else if (state.comics.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: _EmptyState(),
              )
            else
              _buildContent(context, state, authState, viewMode, groupsAsync, groupedMapAsync),
          ],
        ),
      ),
    );
  }

  /// 合集收起开关
  Widget _buildGroupToggle(
    ColorScheme cs,
    AsyncValue<List<ComicGroup>> groupsAsync,
    AsyncValue<Map<String, List<int>>> groupedMapAsync,
  ) {
    final groupCount = groupsAsync.whenOrNull(data: (groups) => groups.length) ?? 0;

    return GestureDetector(
      onTap: () {
        HapticFeedback.lightImpact();
        _toggleGroupByFolder();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: _groupByFolder
              ? cs.primaryContainer.withOpacity(0.3)
              : cs.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: _groupByFolder
                ? cs.primary.withOpacity(0.3)
                : cs.outlineVariant.withOpacity(0.3),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _groupByFolder
                  ? Icons.folder_outlined
                  : Icons.folder_open_outlined,
              size: 18,
              color: _groupByFolder ? cs.primary : cs.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Text(
              _groupByFolder ? '按文件夹收起' : '全部展开',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: _groupByFolder ? cs.primary : cs.onSurfaceVariant,
              ),
            ),
            if (groupCount > 0) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: _groupByFolder
                      ? cs.primary.withOpacity(0.15)
                      : cs.onSurfaceVariant.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '$groupCount',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: _groupByFolder ? cs.primary : cs.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// 构建内容区域（支持合集优先或全部展开）
  Widget _buildContent(
    BuildContext context,
    ComicListState state,
    AuthState authState,
    ViewMode viewMode,
    AsyncValue<List<ComicGroup>> groupsAsync,
    AsyncValue<Map<String, List<int>>> groupedMapAsync,
  ) {
    // 如果不按文件夹收起，直接显示原始漫画列表
    if (!_groupByFolder) {
      return viewMode == ViewMode.grid
          ? _buildGrid(context, state, authState)
          : _buildList(context, state, authState);
    }

    // 合集优先模式：混合展示合集卡片和未分组的漫画
    return groupsAsync.when(
      loading: () => viewMode == ViewMode.grid
          ? _buildGrid(context, state, authState)
          : _buildList(context, state, authState),
      error: (_, __) => viewMode == ViewMode.grid
          ? _buildGrid(context, state, authState)
          : _buildList(context, state, authState),
      data: (groups) {
        return groupedMapAsync.when(
          loading: () => viewMode == ViewMode.grid
              ? _buildGrid(context, state, authState)
              : _buildList(context, state, authState),
          error: (_, __) => viewMode == ViewMode.grid
              ? _buildGrid(context, state, authState)
              : _buildList(context, state, authState),
          data: (groupedMap) {
            // 过滤掉已分组的漫画
            final looseComics = state.comics
                .where((c) => !groupedMap.containsKey(c.id))
                .toList();

            // 构建混合列表：合集 + 散本
            final items = <_UnifiedItem>[
              ...groups
                  .where((g) => g.comicCount > 0)
                  .map((g) => _UnifiedItem.group(g)),
              ...looseComics.map((c) => _UnifiedItem.comic(c)),
            ];

            if (items.isEmpty) {
              return SliverFillRemaining(
                hasScrollBody: false,
                child: _EmptyState(),
              );
            }

            return viewMode == ViewMode.grid
                ? _buildUnifiedGrid(context, items, authState)
                : _buildUnifiedList(context, items, authState);
          },
        );
      },
    );
  }

  /// 混合网格视图 — mini 紧凑风格
  Widget _buildUnifiedGrid(
    BuildContext context,
    List<_UnifiedItem> items,
    AuthState authState,
  ) {
    final serverUrl = authState.serverUrl;
    final width = MediaQuery.of(context).size.width;
    // 更多列数，更小卡片
    final crossAxisCount = width > 900
        ? 8
        : width > 600
            ? 5
            : width > 400
                ? 4
                : 3;

    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
      sliver: SliverGrid(
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: crossAxisCount,
          childAspectRatio: 0.75, // 更紧凑的宽高比
          crossAxisSpacing: 8,
          mainAxisSpacing: 10,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            if (index >= items.length) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: _LoadingIndicator(),
                ),
              );
            }

            final item = items[index];
            return StaggeredFadeSlide(
              index: index,
              child: item.when(
                group: (group) => GroupCard(group: group, isGrid: true),
                comic: (comic) => _ComicCard(
                  comic: comic,
                  serverUrl: serverUrl,
                  onTap: () => context.push('/comic/${comic.id}'),
                  onFavoriteToggle: () => ref
                      .read(comicListProvider.notifier)
                      .toggleFavorite(comic.id),
                ),
              ),
            );
          },
          childCount: items.length,
        ),
      ),
    );
  }

  /// 混合列表视图
  Widget _buildUnifiedList(
    BuildContext context,
    List<_UnifiedItem> items,
    AuthState authState,
  ) {
    final serverUrl = authState.serverUrl;

    return SliverPadding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            if (index >= items.length) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: _LoadingIndicator(),
                ),
              );
            }

            final item = items[index];
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: item.when(
                group: (group) => GroupCard(group: group, isGrid: false),
                comic: (comic) => ComicListTile(
                  comic: comic,
                  serverUrl: serverUrl,
                  onTap: () => context.push('/comic/${comic.id}'),
                  onFavoriteToggle: () => ref
                      .read(comicListProvider.notifier)
                      .toggleFavorite(comic.id),
                ),
              ),
            );
          },
          childCount: items.length,
        ),
      ),
    );
  }

  PopupMenuItem<String> _buildSortItem(
      String value, String label, IconData icon, String? currentSort) {
    final isSelected = currentSort == value;
    final cs = Theme.of(context).colorScheme;
    return PopupMenuItem(
      value: value,
      child: Row(
        children: [
          Icon(icon, size: 20, color: isSelected ? cs.primary : cs.onSurfaceVariant),
          const SizedBox(width: 12),
          Text(
            label,
            style: TextStyle(
              fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
              color: isSelected ? cs.primary : null,
            ),
          ),
          if (isSelected) ...[
            const Spacer(),
            Icon(Icons.check_rounded, size: 18, color: cs.primary),
          ],
        ],
      ),
    );
  }

  PopupMenuItem<String> _buildFilterItem(
      String value, String label, IconData icon, ComicListParams params) {
    final isSelected = (value == 'all' && params.type == null && params.favoritesOnly != true) ||
        (value == 'favorites' && params.favoritesOnly == true) ||
        (value != 'all' && value != 'favorites' && params.type == value);
    final cs = Theme.of(context).colorScheme;
    return PopupMenuItem(
      value: value,
      child: Row(
        children: [
          Icon(
            icon,
            size: 20,
            color: isSelected
                ? (value == 'favorites' ? Colors.redAccent : cs.primary)
                : cs.onSurfaceVariant,
          ),
          const SizedBox(width: 12),
          Text(
            label,
            style: TextStyle(
              fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
              color: isSelected ? cs.primary : null,
            ),
          ),
          if (isSelected) ...[
            const Spacer(),
            Icon(Icons.check_rounded, size: 18, color: cs.primary),
          ],
        ],
      ),
    );
  }

  Widget _buildGrid(
      BuildContext context, ComicListState state, AuthState authState) {
    final serverUrl = authState.serverUrl;
    final width = MediaQuery.of(context).size.width;
    // 更多列数，更小卡片
    final crossAxisCount = width > 900
        ? 8
        : width > 600
            ? 5
            : width > 400
                ? 4
                : 3;

    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
      sliver: SliverGrid(
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: crossAxisCount,
          childAspectRatio: 0.75, // 更紧凑的宽高比
          crossAxisSpacing: 8,
          mainAxisSpacing: 10,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            if (index >= state.comics.length) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: _LoadingIndicator(),
                ),
              );
            }
            return StaggeredFadeSlide(
              index: index,
              child: _ComicCard(
                comic: state.comics[index],
                serverUrl: serverUrl,
                onTap: () => context.push('/comic/${state.comics[index].id}'),
                onFavoriteToggle: () => ref
                    .read(comicListProvider.notifier)
                    .toggleFavorite(state.comics[index].id),
              ),
            );
          },
          childCount: state.comics.length + (state.hasMore ? 1 : 0),
        ),
      ),
    );
  }

  Widget _buildList(
      BuildContext context, ComicListState state, AuthState authState) {
    final serverUrl = authState.serverUrl;

    return SliverPadding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            if (index >= state.comics.length) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: _LoadingIndicator(),
                ),
              );
            }
            return ComicListTile(
              comic: state.comics[index],
              serverUrl: serverUrl,
              onTap: () => context.push('/comic/${state.comics[index].id}'),
              onFavoriteToggle: () => ref
                  .read(comicListProvider.notifier)
                  .toggleFavorite(state.comics[index].id),
            );
          },
          childCount: state.comics.length + (state.hasMore ? 1 : 0),
        ),
      ),
    );
  }
}

/// 统一项类型：合集或漫画
class _UnifiedItem {
  final ComicGroup? _group;
  final Comic? _comic;

  _UnifiedItem.group(ComicGroup group) : _group = group, _comic = null;
  _UnifiedItem.comic(Comic comic) : _group = null, _comic = comic;

  T when<T>({
    required T Function(ComicGroup group) group,
    required T Function(Comic comic) comic,
  }) {
    if (_group != null) return group(_group!);
    return comic(_comic!);
  }
}

/// 顶部操作图标按钮
class _ActionIcon extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  const _ActionIcon({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(icon),
      tooltip: tooltip,
      onPressed: onTap,
      style: IconButton.styleFrom(
        padding: const EdgeInsets.all(8),
      ),
    );
  }
}

/// 精致的加载指示器
class _LoadingIndicator extends StatelessWidget {
  const _LoadingIndicator();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 28,
      height: 28,
      child: CircularProgressIndicator(
        strokeWidth: 2.5,
        color: Theme.of(context).colorScheme.primary.withOpacity(0.6),
      ),
    );
  }
}

/// 空状态
class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: cs.primaryContainer.withOpacity(0.3),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Icon(
              Icons.library_books_outlined,
              size: 36,
              color: cs.primary.withOpacity(0.6),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            '书库空空如也',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: cs.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            '添加一些漫画或小说开始阅读吧',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: cs.onSurfaceVariant.withOpacity(0.6),
                ),
          ),
        ],
      ),
    );
  }
}

/// 漫画卡片组件 — mini 紧凑风格
class _ComicCard extends StatelessWidget {
  final Comic comic;
  final String serverUrl;
  final VoidCallback onTap;
  final VoidCallback onFavoriteToggle;

  const _ComicCard({
    required this.comic,
    required this.serverUrl,
    required this.onTap,
    required this.onFavoriteToggle,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final thumbUrl = getImageUrl(serverUrl, comic.id, thumbnail: true);

    return PressableScale(
      onTap: onTap,
      scaleDown: 0.95,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 封面
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.06),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    // 封面图片
                    AuthenticatedImage(
                      imageUrl: thumbUrl,
                      fit: BoxFit.cover,
                      placeholder: Container(
                        color: cs.surfaceContainerHighest,
                        child: Center(
                          child: Icon(Icons.image_outlined,
                              size: 24, color: cs.onSurfaceVariant.withOpacity(0.3)),
                        ),
                      ),
                      errorWidget: Container(
                        color: cs.surfaceContainerHighest,
                        child: Center(
                          child: Icon(Icons.broken_image_outlined,
                              size: 24, color: cs.onSurfaceVariant.withOpacity(0.3)),
                        ),
                      ),
                    ),

                    // 底部渐变
                    Positioned(
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 40,
                      child: Container(
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.bottomCenter,
                            end: Alignment.topCenter,
                            colors: [Colors.black54, Colors.transparent],
                          ),
                        ),
                      ),
                    ),

                    // 阅读进度条
                    if (comic.progress > 0)
                      Positioned(
                        bottom: 0,
                        left: 0,
                        right: 0,
                        child: Container(
                          height: 2,
                          decoration: BoxDecoration(
                            color: Colors.black26,
                          ),
                          child: FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: comic.progress / 100,
                            child: Container(
                              decoration: BoxDecoration(
                                color: cs.primary,
                                borderRadius: const BorderRadius.only(
                                  bottomLeft: Radius.circular(10),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),

                    // 收藏图标
                    Positioned(
                      top: 4,
                      right: 4,
                      child: GestureDetector(
                        onTap: () {
                          HapticFeedback.lightImpact();
                          onFavoriteToggle();
                        },
                        child: HeartBounce(
                          trigger: comic.isFavorite,
                          child: Container(
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(
                              color: Colors.black.withOpacity(0.3),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Icon(
                              comic.isFavorite
                                  ? Icons.favorite_rounded
                                  : Icons.favorite_border_rounded,
                              color: comic.isFavorite
                                  ? const Color(0xFFFF6B6B)
                                  : Colors.white70,
                              size: 12,
                            ),
                          ),
                        ),
                      ),
                    ),

                    // 类型标识
                    if (comic.isNovel)
                      Positioned(
                        top: 4,
                        left: 4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 5, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.5),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text(
                            '小说',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),

          // 标题
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 4, 2, 0),
            child: Text(
              comic.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontWeight: FontWeight.w500,
                fontSize: 11,
                height: 1.2,
                color: cs.onSurface,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
