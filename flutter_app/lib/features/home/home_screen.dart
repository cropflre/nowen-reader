import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../data/api/api_client.dart';
import '../../widgets/authenticated_image.dart';
import '../../widgets/continue_reading.dart';
import '../../widgets/comic_list_tile.dart';
import '../../data/models/comic.dart';
import '../../data/providers/auth_provider.dart';
import '../../data/providers/comic_provider.dart';
import '../../data/providers/server_branding_provider.dart';
import '../../widgets/animations.dart';
import '../../widgets/server_logo.dart';

/// 首页 — 极简优雅的书库浏览，支持合集优先展示
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  static const _seriesViewPreferenceKey = 'home_series_view';
  static const _legacyGroupByFolderPreferenceKey = 'home_group_by_folder';

  final _scrollController = ScrollController();
  bool _seriesView = true;
  bool _shelfModeReady = false;
  String? _directoryPageContext;
  int _directoryPage = 1;

  @override
  void initState() {
    super.initState();
    final shelf = ref.read(comicListProvider);
    _seriesView = shelf.params.seriesView;
    _shelfModeReady = shelf.hasLoaded;
    _scrollController.addListener(_onScroll);
    _initializeShelfMode();
  }

  Future<void> _initializeShelfMode() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getBool(_seriesViewPreferenceKey) ??
        prefs.getBool(_legacyGroupByFolderPreferenceKey) ??
        true;
    if (!mounted) return;

    setState(() {
      _seriesView = saved;
      _shelfModeReady = true;
    });

    final shelf = ref.read(comicListProvider);
    // Returning from a reader reuses the account-scoped pages and filters.
    if (shelf.hasLoaded && shelf.params.seriesView == saved) return;
    final current = shelf.params;
    final nextSort =
        saved && current.sort == 'pageCount' ? 'title' : current.sort;
    final nextOrder =
        saved && current.sort == 'pageCount' ? 'asc' : current.order;
    await ref.read(comicListProvider.notifier).loadComics(
          params: current.copyWith(
            page: 1,
            sort: nextSort,
            order: nextOrder,
            seriesView: saved,
            clearSearch: true,
            clearTag: true,
            clearCategory: true,
          ),
        );
  }

  Future<void> _setSeriesView(bool enabled) async {
    if (_seriesView == enabled) return;
    HapticFeedback.lightImpact();

    setState(() => _seriesView = enabled);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_seriesViewPreferenceKey, enabled);

    final current = ref.read(comicListProvider).params;
    final nextSort =
        enabled && current.sort == 'pageCount' ? 'title' : current.sort;
    final nextOrder =
        enabled && current.sort == 'pageCount' ? 'asc' : current.order;
    await ref.read(comicListProvider.notifier).updateParams(
          current.copyWith(
            page: 1,
            sort: nextSort,
            order: nextOrder,
            seriesView: enabled,
          ),
        );
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
    final librariesAsync = ref.watch(accessibleLibrariesProvider);
    final libraries = librariesAsync.valueOrNull ?? const <AccessibleLibrary>[];
    final cs = Theme.of(context).colorScheme;

    final branding = ref.watch(currentServerBrandingProvider);

    final selectedLibId = state.params.libraryId;
    AccessibleLibrary? activeLibrary;
    if (selectedLibId != null && selectedLibId.isNotEmpty) {
      for (final lib in libraries) {
        if (lib.id == selectedLibId) {
          activeLibrary = lib;
          break;
        }
      }
    } else if (libraries.length == 1) {
      activeLibrary = libraries.first;
    }

    final currentDir = state.params.directoryPath ?? '';
    final supportsDirNav =
        activeLibrary != null && activeLibrary.supportsDirectoryCategories;
    final directoryContext =
        '${ref.watch(comicListScopeProvider)}\u0000${activeLibrary?.id}\u0000$currentDir';
    final directoryPage =
        _directoryPageContext == directoryContext ? _directoryPage : 1;
    final dirAsync = supportsDirNav
        ? ref.watch(
            libraryDirectoriesProvider(
              LibraryDirectoryQueryKey(
                libraryId: activeLibrary.id,
                parent: currentDir,
                page: directoryPage,
              ),
            ),
          )
        : null;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          final brandingRefresh =
              ref.read(serverBrandingProvider.notifier).refresh(force: true);
          ref.read(readingProgressRevisionProvider.notifier).state++;
          ref.invalidate(accessibleLibrariesProvider);
          ref.invalidate(libraryDirectoriesProvider);
          await ref.read(comicListProvider.notifier).loadComics();
          await brandingRefresh;
        },
        color: cs.primary,
        child: CustomScrollView(
          key: const PageStorageKey('home-shelf'),
          controller: _scrollController,
          slivers: [
            // ─── 优雅的顶部区域 ───
            SliverAppBar(
              floating: true,
              snap: true,
              toolbarHeight:
                  56 + (MediaQuery.textScalerOf(context).scale(16) - 16) * 2,
              title: Row(
                children: [
                  ServerLogo(branding: branding, size: 30),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(branding.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 16)),
                        Text(activeLibrary?.name ?? '书库',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 11, color: cs.onSurfaceVariant)),
                      ],
                    ),
                  ),
                ],
              ),
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
                        viewMode == ViewMode.grid
                            ? ViewMode.list
                            : ViewMode.grid;
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
                    _buildSortItem('addedAt', '最近添加', Icons.schedule_rounded,
                        state.params.sort),
                    _buildSortItem('title', '标题', Icons.sort_by_alpha_rounded,
                        state.params.sort),
                    _buildSortItem('lastReadAt', '最近阅读',
                        Icons.auto_stories_outlined, state.params.sort),
                    _buildSortItem('rating', '评分', Icons.star_outline_rounded,
                        state.params.sort),
                    if (!_seriesView)
                      _buildSortItem('pageCount', '页数',
                          Icons.description_outlined, state.params.sort),
                  ],
                ),
                // 筛选
                PopupMenuButton<String>(
                  icon: Icon(
                    Icons.tune_rounded,
                    color: (state.params.type != null ||
                            (state.params.favoritesOnly == true))
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
                            current.copyWith(
                                type: filter, favoritesOnly: false, page: 1),
                          );
                    }
                  },
                  itemBuilder: (_) => [
                    _buildFilterItem(
                        'all', '全部', Icons.apps_rounded, state.params),
                    _buildFilterItem('comic', '漫画',
                        Icons.photo_library_outlined, state.params),
                    _buildFilterItem(
                        'novel', '小说', Icons.menu_book_outlined, state.params),
                    _buildFilterItem('favorites', '收藏', Icons.favorite_rounded,
                        state.params),
                  ],
                ),
                const SizedBox(width: 4),
              ],
            ),

            // ─── 继续阅读 ───
            const SliverToBoxAdapter(
              child: ContinueReading(),
            ),

            // ─── 书架模式：作品 / 文件 ───
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: _buildShelfModeToggle(cs),
              ),
            ),

            // ─── 多书库切换栏 ───
            if (libraries.length > 1)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                  child: _buildLibrarySelector(
                      cs, libraries, selectedLibId, state.params),
                ),
              ),

            // ─── 物理目录分类导航（独立于人工 Category） ───
            if (supportsDirNav && dirAsync != null)
              SliverToBoxAdapter(
                child: _buildDirectoryNavigation(
                  cs: cs,
                  serverUrl: authState.serverUrl,
                  library: activeLibrary,
                  currentDir: currentDir,
                  params: state.params,
                  dirAsync: dirAsync,
                  directoryContext: directoryContext,
                  directoryPage: directoryPage,
                ),
              ),

            // ─── 内容区域 ───
            if (!_shelfModeReady || (state.comics.isEmpty && state.isLoading))
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
              _buildContent(context, state, authState, viewMode),
          ],
        ),
      ),
    );
  }

  /// 书架展示模式。系列模式与 Web 一致，由服务端 seriesView=true 统一折叠目录作品。
  Widget _buildShelfModeToggle(ColorScheme cs) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.outlineVariant.withOpacity(0.25)),
      ),
      child: Row(
        children: [
          Expanded(
            child: _buildShelfModeButton(
              cs: cs,
              selected: _seriesView,
              icon: Icons.auto_stories_outlined,
              label: '作品',
              onTap: () => _setSeriesView(true),
            ),
          ),
          Expanded(
            child: _buildShelfModeButton(
              cs: cs,
              selected: !_seriesView,
              icon: Icons.view_module_outlined,
              label: '文件',
              onTap: () => _setSeriesView(false),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildShelfModeButton({
    required ColorScheme cs,
    required bool selected,
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Material(
      color:
          selected ? cs.primaryContainer.withOpacity(0.55) : Colors.transparent,
      borderRadius: BorderRadius.circular(9),
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 9),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 17,
                color: selected ? cs.primary : cs.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected ? cs.primary : cs.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 系列模式下服务端已经把目录作品折叠为虚拟书架项；单册模式返回原始作品。
  Widget _buildContent(
    BuildContext context,
    ComicListState state,
    AuthState authState,
    ViewMode viewMode,
  ) {
    return viewMode == ViewMode.grid
        ? _buildGrid(context, state, authState)
        : _buildList(context, state, authState);
  }

  void _openShelfItem(BuildContext context, Comic comic) {
    final seriesId = comic.seriesId;
    if (seriesId != null) {
      context.push('/series/${Uri.encodeComponent(seriesId)}');
      return;
    }
    context.push('/comic/${comic.id}');
  }

  Widget _buildLibrarySelector(
    ColorScheme cs,
    List<AccessibleLibrary> libraries,
    String? selectedLibId,
    ComicListParams params,
  ) {
    return SizedBox(
      height: 34,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              label: const Text('全部书库'),
              selected: selectedLibId == null || selectedLibId.isEmpty,
              visualDensity: VisualDensity.compact,
              onSelected: (_) {
                HapticFeedback.selectionClick();
                ref.read(comicListProvider.notifier).updateParams(
                      params.copyWith(
                        clearLibraryId: true,
                        clearDirectoryPath: true,
                        page: 1,
                      ),
                    );
              },
            ),
          ),
          for (final lib in libraries)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text('${lib.name} (${lib.logicalCount})'),
                selected: selectedLibId == lib.id,
                visualDensity: VisualDensity.compact,
                onSelected: (_) {
                  HapticFeedback.selectionClick();
                  ref.read(comicListProvider.notifier).updateParams(
                        params.copyWith(
                          libraryId: lib.id,
                          clearDirectoryPath: true,
                          page: 1,
                        ),
                      );
                },
              ),
            ),
        ],
      ),
    );
  }

  void _navigateToDirectory(
    AccessibleLibrary library,
    String nextPath,
    ComicListParams currentParams,
    bool isExplicitSingleLibrary,
  ) {
    HapticFeedback.selectionClick();
    if (nextPath.isEmpty) {
      ref.read(comicListProvider.notifier).updateParams(
            currentParams.copyWith(
              libraryId: isExplicitSingleLibrary ? library.id : null,
              clearLibraryId: !isExplicitSingleLibrary,
              clearDirectoryPath: true,
              page: 1,
            ),
          );
      return;
    }
    ref.read(comicListProvider.notifier).updateParams(
          currentParams.copyWith(
            libraryId: library.id,
            directoryPath: nextPath,
            page: 1,
          ),
        );
  }

  void _setDirectoryPage(String directoryContext, int page) {
    setState(() {
      _directoryPageContext = directoryContext;
      _directoryPage = page;
    });
  }

  Widget _buildDirectoryNavigation({
    required ColorScheme cs,
    required String serverUrl,
    required AccessibleLibrary library,
    required String currentDir,
    required ComicListParams params,
    required AsyncValue<LibraryDirectoryListResponse> dirAsync,
    required String directoryContext,
    required int directoryPage,
  }) {
    final isExplicitSingleLibrary =
        params.libraryId != null && params.libraryId!.isNotEmpty;
    final dirData = dirAsync.valueOrNull;
    final nodes = dirData?.directories ?? const <LibraryDirectoryNode>[];

    List<LibraryDirectoryBreadcrumb> breadcrumbs;
    if (currentDir.isEmpty) {
      breadcrumbs = const [];
    } else if (dirData != null &&
        dirData.parent == currentDir &&
        dirData.breadcrumbs.isNotEmpty) {
      breadcrumbs = dirData.breadcrumbs;
    } else {
      final parts =
          currentDir.split('/').where((seg) => seg.isNotEmpty).toList();
      breadcrumbs = [
        for (var i = 0; i < parts.length; i++)
          LibraryDirectoryBreadcrumb(
            name: parts[i],
            path: parts.sublist(0, i + 1).join('/'),
          ),
      ];
    }

    if (nodes.isEmpty &&
        currentDir.isEmpty &&
        !dirAsync.isLoading &&
        directoryPage <= 1) {
      return const SizedBox.shrink();
    }

    final cleanServerUrl = serverUrl.endsWith('/')
        ? serverUrl.substring(0, serverUrl.length - 1)
        : serverUrl;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(
          color: cs.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: cs.outlineVariant.withOpacity(0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: cs.primaryContainer.withOpacity(0.5),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.account_tree_outlined,
                          size: 13,
                          color: cs.primary,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '目录分类',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: cs.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  InkWell(
                    borderRadius: BorderRadius.circular(6),
                    onTap: () => _navigateToDirectory(
                      library,
                      '',
                      params,
                      isExplicitSingleLibrary,
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: currentDir.isEmpty
                            ? cs.primary
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '全部作品',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: currentDir.isEmpty
                              ? cs.onPrimary
                              : cs.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                  for (var i = 0; i < breadcrumbs.length; i++) ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: Icon(
                        Icons.chevron_right_rounded,
                        size: 16,
                        color: cs.onSurfaceVariant.withOpacity(0.6),
                      ),
                    ),
                    InkWell(
                      borderRadius: BorderRadius.circular(6),
                      onTap: () => _navigateToDirectory(
                        library,
                        breadcrumbs[i].path,
                        params,
                        isExplicitSingleLibrary,
                      ),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: i == breadcrumbs.length - 1
                              ? cs.primaryContainer.withOpacity(0.6)
                              : Colors.transparent,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          breadcrumbs[i].name,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: i == breadcrumbs.length - 1
                                ? FontWeight.w700
                                : FontWeight.w500,
                            color: i == breadcrumbs.length - 1
                                ? cs.primary
                                : cs.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ),
                  ],
                  if (currentDir.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: () {
                        final parentPath = breadcrumbs.length > 1
                            ? breadcrumbs[breadcrumbs.length - 2].path
                            : '';
                        _navigateToDirectory(
                          library,
                          parentPath,
                          params,
                          isExplicitSingleLibrary,
                        );
                      },
                      icon: const Icon(Icons.arrow_upward_rounded, size: 13),
                      label: const Text('返回上级', style: TextStyle(fontSize: 11)),
                      style: OutlinedButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (nodes.isNotEmpty) ...[
              const SizedBox(height: 8),
              SizedBox(
                height: 56,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: nodes.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    final node = nodes[index];
                    final rawCover = node.coverUrl.trim();
                    final coverUrl = rawCover.isEmpty
                        ? ''
                        : (rawCover.startsWith('http://') ||
                                rawCover.startsWith('https://')
                            ? rawCover
                            : '$cleanServerUrl${rawCover.startsWith('/') ? rawCover : '/$rawCover'}');
                    return InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => _navigateToDirectory(
                        library,
                        node.path,
                        params,
                        isExplicitSingleLibrary,
                      ),
                      child: Container(
                        width: 156,
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: cs.surface,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: cs.outlineVariant.withOpacity(0.35),
                          ),
                        ),
                        child: Row(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: SizedBox(
                                width: 34,
                                height: 42,
                                child: coverUrl.isNotEmpty
                                    ? AuthenticatedImage(
                                        imageUrl: coverUrl,
                                        fit: BoxFit.cover,
                                        placeholder: Container(
                                          color: cs.surfaceContainerHighest,
                                          child: Icon(
                                            Icons.folder_outlined,
                                            size: 16,
                                            color: cs.primary,
                                          ),
                                        ),
                                        errorWidget: Container(
                                          color: cs.surfaceContainerHighest,
                                          child: Icon(
                                            Icons.folder_outlined,
                                            size: 16,
                                            color: cs.primary,
                                          ),
                                        ),
                                      )
                                    : Container(
                                        color: cs.surfaceContainerHighest,
                                        child: Icon(
                                          Icons.folder_outlined,
                                          size: 18,
                                          color: cs.primary,
                                        ),
                                      ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    node.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    '${node.workCount} 部作品',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: cs.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (node.hasChildren)
                              Icon(
                                Icons.chevron_right_rounded,
                                size: 16,
                                color: cs.onSurfaceVariant.withOpacity(0.7),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
            if ((dirData?.totalPages ?? 1) > 1 || directoryPage > 1) ...[
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: dirAsync.isLoading || directoryPage <= 1
                        ? null
                        : () => _setDirectoryPage(
                            directoryContext, directoryPage - 1),
                    child: const Text('上一页'),
                  ),
                  Text(
                      '$directoryPage / ${dirData == null || dirData.totalPages < directoryPage ? directoryPage : dirData.totalPages}'),
                  TextButton(
                    onPressed: dirAsync.isLoading ||
                            dirData == null ||
                            directoryPage >= dirData.totalPages
                        ? null
                        : () => _setDirectoryPage(
                            directoryContext, directoryPage + 1),
                    child: const Text('下一页'),
                  ),
                ],
              ),
            ],
          ],
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
          Icon(icon,
              size: 20, color: isSelected ? cs.primary : cs.onSurfaceVariant),
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
    final isSelected = (value == 'all' &&
            params.type == null &&
            params.favoritesOnly != true) ||
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
                onTap: () => _openShelfItem(context, state.comics[index]),
                onFavoriteToggle: state.comics[index].isSeriesShelfItem
                    ? null
                    : () => ref
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
              onTap: () => _openShelfItem(context, state.comics[index]),
              onFavoriteToggle: state.comics[index].isSeriesShelfItem
                  ? null
                  : () => ref
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
  final VoidCallback? onFavoriteToggle;

  const _ComicCard({
    required this.comic,
    required this.serverUrl,
    required this.onTap,
    this.onFavoriteToggle,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final rawCover = comic.coverImageUrl?.trim() ?? '';
    final cleanServerUrl = serverUrl.endsWith('/')
        ? serverUrl.substring(0, serverUrl.length - 1)
        : serverUrl;
    final thumbUrl = rawCover.isNotEmpty
        ? (rawCover.startsWith('http://') || rawCover.startsWith('https://')
            ? rawCover
            : '$cleanServerUrl${rawCover.startsWith('/') ? rawCover : '/$rawCover'}')
        : getImageUrl(serverUrl, comic.id, thumbnail: true);

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
                              size: 24,
                              color: cs.onSurfaceVariant.withOpacity(0.3)),
                        ),
                      ),
                      errorWidget: Container(
                        color: cs.surfaceContainerHighest,
                        child: Center(
                          child: Icon(Icons.broken_image_outlined,
                              size: 24,
                              color: cs.onSurfaceVariant.withOpacity(0.3)),
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

                    // 收藏图标（系列虚拟项不可直接走单册收藏接口）
                    if (onFavoriteToggle != null && !comic.isSeriesShelfItem)
                      Positioned(
                        top: 4,
                        right: 4,
                        child: GestureDetector(
                          onTap: () {
                            HapticFeedback.lightImpact();
                            onFavoriteToggle?.call();
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

                    // 作品 / 类型标识
                    if (comic.isSeriesShelfItem)
                      Positioned(
                        top: 4,
                        left: 4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 5, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.55),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            '${comic.seriesItemCount} 项',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      )
                    else if (comic.isNovel)
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
