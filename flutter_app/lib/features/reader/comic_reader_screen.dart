import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:photo_view/photo_view.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/api/api_client.dart';
import '../../data/api/comic_api.dart';
import '../../data/providers/auth_provider.dart';
import '../../data/providers/comic_provider.dart';
import '../../data/services/reading_activity_tracker.dart';
import '../../data/services/reader_warmup_session.dart';
import '../../widgets/authenticated_image.dart';
import '../../widgets/reader_settings_panel.dart';
import 'novel_reader_screen.dart';
import 'webtoon_view.dart';

/// 漫画阅读器
class ComicReaderScreen extends ConsumerStatefulWidget {
  final String comicId;
  final int initialPage;
  final Future<List<String>> Function()? loadNextChapterIds;

  const ComicReaderScreen({
    super.key,
    required this.comicId,
    this.initialPage = 0,
    this.loadNextChapterIds,
  });

  @override
  ConsumerState<ComicReaderScreen> createState() => _ComicReaderScreenState();
}

class _ComicReaderScreenState extends ConsumerState<ComicReaderScreen> {
  late PageController _pageController;
  final WebtoonController _scrollController = WebtoonController();
  int _currentPage = 0;
  int _totalPages = 0;
  bool _showOverlay = false;
  bool _loading = true;
  bool _openingNextChapter = false;
  bool _noNextChapter = false;
  bool _closing = false;
  Future<void>? _finishReadingFuture;

  late final ComicApi _api;
  late final ReadingActivityTracker _activity;
  late final ReaderWarmupSession _warmup;

  // 设置与云端分作用域同步
  ReaderSettings _settings = const ReaderSettings();
  ReaderSettings _globalSettings = const ReaderSettings();
  bool _hasComicOverride = false;
  String _settingsScope = 'global';
  final Map<String, Timer> _prefsSaveTimers = {};
  String _userId = '';

  // 漫画书签
  Map<int, String> _bookmarkIdsByPage = {};

  // 自动翻页
  Timer? _autoPageTimer;
  bool _autoPage = false;

  @override
  void initState() {
    super.initState();
    _currentPage = widget.initialPage;
    _pageController = PageController(initialPage: _currentPage);
    // 提前缓存 API 引用
    _api = ref.read(comicApiProvider);
    _userId = ref.read(authProvider).user?.id ?? '';
    _activity = ReadingActivityTracker(api: _api, comicId: widget.comicId);
    _warmup = ReaderWarmupSession(api: _api, comicId: widget.comicId);
    // 全屏沉浸模式
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _loadSettings();
    _loadBookmarks();
    _loadPages();
  }

  @override
  void dispose() {
    _autoPageTimer?.cancel();
    for (final timer in _prefsSaveTimers.values) {
      timer.cancel();
    }
    _prefsSaveTimers.clear();
    // 恢复系统UI
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    _activity.dispose();
    _warmup.dispose();
    _pageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// 拦截返回操作，尽量在退出前完成最后一次活动同步
  Future<void> _onWillPop() async {
    if (_closing) return;
    _closing = true;
    await (_finishReadingFuture ??= _finishReading());
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _finishReading() async {
    _warmup.dispose();
    await _activity.finish();
    if (mounted) notifyReadingProgress(ref, widget.comicId);
  }

  Future<void> _openNextChapter() async {
    final load = widget.loadNextChapterIds;
    if (load == null || _openingNextChapter || _noNextChapter || _closing) {
      return;
    }
    setState(() => _openingNextChapter = true);
    final List<String> nextChapterIds;
    try {
      nextChapterIds = await load();
    } catch (_) {
      if (!mounted || _closing) return;
      setState(() => _openingNextChapter = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('无法加载下一章，请再试一次')),
      );
      return;
    }
    if (!mounted || _closing) return;

    if (nextChapterIds.isEmpty) {
      setState(() {
        _noNextChapter = true;
        _openingNextChapter = false;
      });
      return;
    }
    if (_settings.mode != ComicReadingMode.webtoon ||
        !_scrollController.hasClients ||
        _scrollController.position.extentAfter > 1) {
      setState(() => _openingNextChapter = false);
      return;
    }

    _autoPageTimer?.cancel();
    // The top of the viewport may still show the preceding page at the tail.
    _activity.updatePage(_totalPages - 1, _totalPages);
    await (_finishReadingFuture ??= _finishReading());
    if (!mounted || _closing) return;
    context.replace(
      '/reader/${Uri.encodeComponent(nextChapterIds.first)}?page=0',
      extra: nextChapterIds.sublist(1),
    );
  }

  Future<void> _loadSettings() async {
    final local = await ReaderSettings.load();
    if (mounted) {
      setState(() {
        _globalSettings = local;
        _settings = local;
      });
    }
    if (_userId.isEmpty) return;

    try {
      final res = await _api.getReaderPreferences(comicId: widget.comicId);
      final prefs = await SharedPreferences.getInstance();
      final migKey = 'migrated_comic_prefs_$_userId';

      final rawGlobal = res['globalComic'];
      var nextGlobal = local;
      if (rawGlobal is Map && rawGlobal.isNotEmpty) {
        nextGlobal = local.mergeCloudJson(Map<String, dynamic>.from(rawGlobal));
        unawaited(nextGlobal.save());
      } else if (prefs.getBool(migKey) != true) {
        await _api.saveReaderPreference(
          'global_comic',
          local.toGlobalCloudJson(),
        );
        await prefs.setBool(migKey, true);
      }

      var effective = nextGlobal;
      final rawSeries = res['seriesOverride'];
      if (rawSeries is Map && rawSeries.isNotEmpty) {
        effective =
            effective.mergeCloudJson(Map<String, dynamic>.from(rawSeries));
      }

      final rawComic = res['comicOverride'];
      final hasOverride = rawComic is Map && rawComic.isNotEmpty;
      if (hasOverride) {
        effective =
            effective.mergeCloudJson(Map<String, dynamic>.from(rawComic));
      }

      if (mounted) {
        final modeChanged = effective.mode != _settings.mode;
        setState(() {
          _globalSettings = nextGlobal;
          _settings = effective;
          _hasComicOverride = hasOverride;
          _settingsScope = hasOverride ? 'comic' : 'global';
        });
        if (modeChanged && effective.mode != ComicReadingMode.webtoon) {
          _pageController.dispose();
          _pageController = PageController(initialPage: _currentPage);
        }
      }
    } catch (_) {
      // 离线或服务端异常时保留本机设置。
    }
  }

  String get _bookmarkCacheKey => _userId.isNotEmpty
      ? 'comic_bookmarks_${_userId}_${widget.comicId}'
      : 'comic_bookmarks_${widget.comicId}';

  Future<void> _saveBookmarksCache(Map<int, String> map) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final encoded = map.entries
          .map((e) => {'id': e.value, 'pageIndex': e.key})
          .toList();
      await prefs.setString(_bookmarkCacheKey, jsonEncode(encoded));
    } catch (_) {}
  }

  Future<void> _loadBookmarks() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cachedRaw = prefs.getString(_bookmarkCacheKey);
      if (cachedRaw != null) {
        final list = jsonDecode(cachedRaw) as List;
        final map = <int, String>{};
        for (final item in list) {
          if (item is Map) {
            final page = (item['pageIndex'] as num?)?.toInt();
            final id = item['id']?.toString() ?? '';
            if (page != null && page >= 0 && id.isNotEmpty) {
              map[page] = id;
            }
          }
        }
        if (mounted) setState(() => _bookmarkIdsByPage = map);
      }
    } catch (_) {}

    if (_userId.isEmpty) return;
    try {
      final remote = await _api.getBookmarks(widget.comicId);
      final map = <int, String>{};
      for (final item in remote) {
        final page = (item['pageIndex'] as num?)?.toInt();
        final id = item['id']?.toString() ?? '';
        if (page != null && page >= 0 && id.isNotEmpty) {
          map[page] = id;
        }
      }
      await _saveBookmarksCache(map);
      if (mounted) setState(() => _bookmarkIdsByPage = map);
    } catch (_) {
      // 离线保留本地缓存。
    }
  }

  void _toggleCurrentPageBookmark() {
    final page = _currentPage;
    final existingId = _bookmarkIdsByPage[page];
    final next = Map<int, String>.from(_bookmarkIdsByPage);
    if (existingId != null) {
      next.remove(page);
      setState(() => _bookmarkIdsByPage = next);
      unawaited(_saveBookmarksCache(next));
      if (_userId.isNotEmpty) {
        unawaited(
          _api.deleteBookmark(widget.comicId, existingId).catchError((_) {}),
        );
      }
      return;
    }

    final id = 'comic-page-$page';
    next[page] = id;
    setState(() => _bookmarkIdsByPage = next);
    unawaited(_saveBookmarksCache(next));
    if (_userId.isNotEmpty) {
      unawaited(
        _api.upsertBookmark(widget.comicId, {
          'id': id,
          'pageIndex': page,
          'createdAt': DateTime.now().millisecondsSinceEpoch,
        }).catchError((_) => null),
      );
    }
  }

  void _removeBookmarkAtPage(int page) {
    final existingId = _bookmarkIdsByPage[page];
    if (existingId == null) return;
    final next = Map<int, String>.from(_bookmarkIdsByPage)..remove(page);
    setState(() => _bookmarkIdsByPage = next);
    unawaited(_saveBookmarksCache(next));
    if (_userId.isNotEmpty) {
      unawaited(
        _api.deleteBookmark(widget.comicId, existingId).catchError((_) {}),
      );
    }
  }

  void _jumpToBookmarkedPage(int page) {
    final target = page.clamp(0, (_totalPages - 1).clamp(0, 1 << 30));
    if (_settings.mode == ComicReadingMode.webtoon) {
      _scrollController.jumpToPage(target);
    } else {
      _pageController.jumpToPage(target);
    }
  }

  void _showBookmarksSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.grey[900],
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetCtx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            final pages = _bookmarkIdsByPage.keys.toList()..sort();
            return SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
                    child: Row(
                      children: [
                        const Icon(Icons.bookmark,
                            color: Colors.amber, size: 18),
                        const SizedBox(width: 8),
                        Text(
                          '书签 (${pages.length})',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const Spacer(),
                        IconButton(
                          icon: const Icon(Icons.close,
                              color: Colors.white54, size: 20),
                          onPressed: () => Navigator.of(sheetCtx).pop(),
                        ),
                      ],
                    ),
                  ),
                  const Divider(color: Colors.white12, height: 1),
                  if (pages.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 36),
                      child: Text(
                        '暂无书签',
                        style: TextStyle(color: Colors.white38, fontSize: 13),
                      ),
                    )
                  else
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 320),
                      child: ListView.builder(
                        shrinkWrap: true,
                        itemCount: pages.length,
                        itemBuilder: (_, idx) {
                          final p = pages[idx];
                          final isCurrent = p == _currentPage;
                          return ListTile(
                            leading: Icon(
                              Icons.bookmark,
                              color: isCurrent
                                  ? Colors.amber
                                  : Colors.amber.withAlpha(140),
                              size: 20,
                            ),
                            title: Text(
                              '第 ${p + 1} 页',
                              style: TextStyle(
                                color: isCurrent ? Colors.amber : Colors.white,
                                fontWeight: isCurrent
                                    ? FontWeight.w600
                                    : FontWeight.normal,
                              ),
                            ),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline,
                                  color: Colors.white38, size: 20),
                              onPressed: () {
                                _removeBookmarkAtPage(p);
                                setSheetState(() {});
                              },
                            ),
                            onTap: () {
                              Navigator.of(sheetCtx).pop();
                              _jumpToBookmarkedPage(p);
                            },
                          );
                        },
                      ),
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _loadPages() async {
    try {
      final data = await _api.getPages(widget.comicId);
      if (!mounted) return;

      // 如果是小说类型，自动跳转到小说阅读器
      final isNovel = data['isNovel'] == true;
      if (isNovel) {
        // 恢复系统UI后跳转（使用 Navigator 直接跳转，绕过 GoRouter）
        SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
        if (mounted) {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(
              builder: (_) => NovelReaderScreen(
                comicId: widget.comicId,
              ),
            ),
          );
        }
        return;
      }

      setState(() {
        _totalPages = data['totalPages'] ?? 0;
        _loading = false;
      });
      _activity.start(_currentPage, _totalPages);
      _warmup.start(_currentPage, _totalPages);
      unawaited(_prefetchPages(_currentPage));
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onPageChanged(int page) {
    setState(() => _currentPage = page);
    _activity.updatePage(page, _totalPages);
    unawaited(_prefetchPages(page));
  }

  Future<void> _prefetchPages(int page) async {
    final serverUrl = ref.read(authProvider).serverUrl;
    // Keep read-ahead small and sequential so it does not flood the server.
    for (final next in [page, page + 1, page + 2, page - 1]) {
      if (!mounted || _currentPage != page) return;
      if (next < 0 || next >= _totalPages) continue;
      try {
        await loadAuthenticatedImageBytes(
          getImageUrl(serverUrl, widget.comicId, page: next),
          comicId: widget.comicId,
          pageIndex: next,
        );
        if (next == page && mounted && _currentPage == page) {
          _warmup.prefetch(page);
        }
      } catch (_) {
        // A failed speculative load must not interrupt the visible page.
      }
    }
  }

  void _toggleOverlay() {
    setState(() => _showOverlay = !_showOverlay);
  }

  void _toggleAutoPage() {
    setState(() => _autoPage = !_autoPage);
    if (_autoPage) {
      final interval =
          _settings.autoPageInterval > 0 ? _settings.autoPageInterval : 10;
      _autoPageTimer = Timer.periodic(Duration(seconds: interval), (_) {
        if (_settings.mode == ComicReadingMode.webtoon) {
          if (_scrollController.hasClients &&
              _scrollController.position.extentAfter > 0) {
            _scrollController.animateTo(
              (_scrollController.offset + 500)
                  .clamp(0.0, _scrollController.position.maxScrollExtent),
              duration: const Duration(milliseconds: 400),
              curve: Curves.easeInOut,
            );
          } else {
            _autoPageTimer?.cancel();
            setState(() => _autoPage = false);
          }
          return;
        }
        if (_currentPage < _totalPages - 1) {
          if (_settings.mode == ComicReadingMode.doublePage) {
            // 双页模式 — 翻两页
            _pageController.nextPage(
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeInOut,
            );
          } else {
            _pageController.nextPage(
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeInOut,
            );
          }
        } else {
          _autoPageTimer?.cancel();
          setState(() => _autoPage = false);
        }
      });
    } else {
      _autoPageTimer?.cancel();
    }
  }

  void _scheduleCloudPrefsSave(String scope, Map<String, dynamic> prefs) {
    if (_userId.isEmpty) return;
    _prefsSaveTimers[scope]?.cancel();
    _prefsSaveTimers[scope] = Timer(const Duration(milliseconds: 300), () {
      _prefsSaveTimers.remove(scope);
      unawaited(_api.saveReaderPreference(scope, prefs).catchError((_) {}));
    });
  }

  void _onSettingsChanged(ReaderSettings s) {
    final prev = _settings;
    // 如果模式变了，需要重置自动翻页
    if (s.mode != prev.mode) {
      _autoPageTimer?.cancel();
      _autoPage = false;
      if (s.mode == ComicReadingMode.webtoon) {
        if (_scrollController.page != _currentPage) {
          _scrollController.jumpToPage(_currentPage);
        }
      } else if (prev.mode == ComicReadingMode.webtoon) {
        _pageController.dispose();
        _pageController = PageController(initialPage: _currentPage);
      }
    }

    final layoutChanged = s.mode != prev.mode ||
        s.direction != prev.direction ||
        s.fitMode != prev.fitMode ||
        s.doubleCoverAlone != prev.doubleCoverAlone ||
        s.doublePageNoGap != prev.doublePageNoGap;
    final behaviorChanged = s.showPageNumber != prev.showPageNumber ||
        s.autoPageInterval != prev.autoPageInterval;

    if (_settingsScope == 'comic') {
      setState(() {
        _settings = s;
        if (layoutChanged) _hasComicOverride = true;
      });
      if (layoutChanged) {
        _scheduleCloudPrefsSave(
          'comic:${widget.comicId}',
          s.toLayoutOverrideJson(),
        );
      }
      if (behaviorChanged) {
        final nextGlobal = _globalSettings.copyWith(
          showPageNumber: s.showPageNumber,
          autoPageInterval: s.autoPageInterval,
        );
        _globalSettings = nextGlobal;
        unawaited(nextGlobal.save());
        _scheduleCloudPrefsSave('global_comic', nextGlobal.toGlobalCloudJson());
      }
    } else {
      setState(() {
        _globalSettings = s;
        _settings = s;
      });
      unawaited(s.save());
      _scheduleCloudPrefsSave('global_comic', s.toGlobalCloudJson());
    }
  }

  void _resetComicOverride() {
    final prevMode = _settings.mode;
    final target = _globalSettings;
    if (target.mode != prevMode) {
      _autoPageTimer?.cancel();
      _autoPage = false;
      if (target.mode == ComicReadingMode.webtoon) {
        if (_scrollController.page != _currentPage) {
          _scrollController.jumpToPage(_currentPage);
        }
      } else if (prevMode == ComicReadingMode.webtoon) {
        _pageController.dispose();
        _pageController = PageController(initialPage: _currentPage);
      }
    }
    _prefsSaveTimers['comic:${widget.comicId}']?.cancel();
    _prefsSaveTimers.remove('comic:${widget.comicId}');
    setState(() {
      _hasComicOverride = false;
      _settingsScope = 'global';
      _settings = target;
    });
    if (_userId.isNotEmpty) {
      unawaited(
        _api
            .deleteReaderPreference('comic:${widget.comicId}')
            .catchError((_) {}),
      );
    }
  }

  void _showSettings() {
    ReaderSettingsPanel.show(
      context,
      settings: _settings,
      onChanged: _onSettingsChanged,
      scope: _settingsScope,
      hasComicOverride: _hasComicOverride,
      globalSettings: _globalSettings,
      onScopeChanged: (scope) => setState(() => _settingsScope = scope),
      onResetOverride: _resetComicOverride,
      autoSaveLocal: false,
    );
  }

  PhotoViewComputedScale _getInitialScale() {
    switch (_settings.fitMode) {
      case FitMode.width:
        return PhotoViewComputedScale.covered;
      case FitMode.height:
        return PhotoViewComputedScale.contained;
      case FitMode.contain:
        return PhotoViewComputedScale.contained;
    }
  }

  @override
  Widget build(BuildContext context) {
    final serverUrl = ref.watch(authProvider).serverUrl;

    if (_loading) {
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _onWillPop();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            // 主体 — 根据阅读模式切换
            GestureDetector(
              onTap: _toggleOverlay,
              child: _settings.mode == ComicReadingMode.webtoon
                  ? _buildWebtoonView(serverUrl)
                  : _settings.mode == ComicReadingMode.doublePage
                      ? _buildDoublePageView(serverUrl)
                      : _buildPageView(serverUrl),
            ),

            // 顶部 & 底部覆盖层
            if (_showOverlay) ...[
              _buildTopOverlay(),
              _buildBottomOverlay(),
            ],
            if (_openingNextChapter)
              const Positioned.fill(
                child: AbsorbPointer(
                  child: SafeArea(
                    minimum: EdgeInsets.only(bottom: 24),
                    child: Align(
                      alignment: Alignment.bottomCenter,
                      child: SizedBox.square(
                        dimension: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// 单页翻页模式
  Widget _buildPageView(String serverUrl) {
    return PageView.builder(
      controller: _pageController,
      itemCount: _totalPages,
      onPageChanged: _onPageChanged,
      reverse: _settings.direction == ReadingDirection.rtl,
      scrollDirection: _settings.direction == ReadingDirection.ttb
          ? Axis.vertical
          : Axis.horizontal,
      itemBuilder: (context, index) {
        final imageUrl =
            getImageUrl(serverUrl, widget.comicId, page: index);
        return PhotoView(
          imageProvider: AuthenticatedImageProvider(
            imageUrl,
            comicId: widget.comicId,
            pageIndex: index,
          ),
          minScale: PhotoViewComputedScale.contained,
          maxScale: PhotoViewComputedScale.covered * 3,
          initialScale: _getInitialScale(),
          backgroundDecoration:
              const BoxDecoration(color: Colors.black),
          loadingBuilder: (_, event) => Center(
            child: CircularProgressIndicator(
              value: event?.expectedTotalBytes != null
                  ? event!.cumulativeBytesLoaded /
                      event.expectedTotalBytes!
                  : null,
            ),
          ),
          errorBuilder: (_, __, ___) => const Center(
            child: Icon(Icons.broken_image,
                color: Colors.white54, size: 48),
          ),
        );
      },
    );
  }

  /// 双页模式 — 横屏时左右各显示一页，竖屏时自动回退到单页
  Widget _buildDoublePageView(String serverUrl) {
    // 计算双页对：根据 doubleCoverAlone 决定第 1 页是否单独显示
    final isLandscape = MediaQuery.of(context).orientation == Orientation.landscape;
    if (!isLandscape) {
      // 竖屏回退到单页模式
      return _buildPageView(serverUrl);
    }

    // 构建双页列表
    //  - doubleCoverAlone=true : [0], [1,2], [3,4], ...   （封面单页，日漫见开页对齐）
    //  - doubleCoverAlone=false: [0,1], [2,3], [4,5], ... （首页起两两配对，欧美漫合适）
    final List<List<int>> pageGroups = [];
    if (_settings.doubleCoverAlone) {
      if (_totalPages > 0) {
        pageGroups.add([0]); // 封面单独一页
      }
      for (int i = 1; i < _totalPages; i += 2) {
        if (i + 1 < _totalPages) {
          pageGroups.add([i, i + 1]);
        } else {
          pageGroups.add([i]);
        }
      }
    } else {
      for (int i = 0; i < _totalPages; i += 2) {
        if (i + 1 < _totalPages) {
          pageGroups.add([i, i + 1]);
        } else {
          pageGroups.add([i]);
        }
      }
    }

    // 找到当前页对应的 group index
    int currentGroupIndex = 0;
    for (int g = 0; g < pageGroups.length; g++) {
      if (pageGroups[g].contains(_currentPage)) {
        currentGroupIndex = g;
        break;
      }
    }

    final doublePageController = PageController(initialPage: currentGroupIndex);

    return PageView.builder(
      controller: doublePageController,
      itemCount: pageGroups.length,
      reverse: _settings.direction == ReadingDirection.rtl,
      onPageChanged: (groupIndex) {
        final firstPage = pageGroups[groupIndex].first;
        _onPageChanged(firstPage);
      },
      itemBuilder: (context, groupIndex) {
        final pages = pageGroups[groupIndex];
        if (pages.length == 1) {
          // 单页（封面或最后一页）
          final imageUrl = getImageUrl(serverUrl, widget.comicId, page: pages[0]);
          return PhotoView(
            imageProvider: AuthenticatedImageProvider(
              imageUrl,
              comicId: widget.comicId,
              pageIndex: pages[0],
            ),
            minScale: PhotoViewComputedScale.contained,
            maxScale: PhotoViewComputedScale.covered * 3,
            initialScale: PhotoViewComputedScale.contained,
            backgroundDecoration: const BoxDecoration(color: Colors.black),
            loadingBuilder: (_, event) => Center(
              child: CircularProgressIndicator(
                value: event?.expectedTotalBytes != null
                    ? event!.cumulativeBytesLoaded / event.expectedTotalBytes!
                    : null,
              ),
            ),
            errorBuilder: (_, __, ___) => const Center(
              child: Icon(Icons.broken_image, color: Colors.white54, size: 48),
            ),
          );
        }

        // 双页并排
        final leftPage = _settings.direction == ReadingDirection.rtl ? pages[1] : pages[0];
        final rightPage = _settings.direction == ReadingDirection.rtl ? pages[0] : pages[1];
        final leftUrl = getImageUrl(serverUrl, widget.comicId, page: leftPage);
        final rightUrl = getImageUrl(serverUrl, widget.comicId, page: rightPage);

        // 双页贴合：把左页右对齐、右页左对齐，让两张图在屏幕正中央拼合，去除中间缝
        final noGap = _settings.doublePageNoGap;
        return Row(
          children: [
            Expanded(
              child: AuthenticatedImage(
                imageUrl: leftUrl,
                comicId: widget.comicId,
                pageIndex: leftPage,
                fit: BoxFit.contain,
                alignment: noGap ? Alignment.centerRight : Alignment.center,
                placeholder: const Center(child: CircularProgressIndicator()),
                errorWidget: const Center(
                  child: Icon(Icons.broken_image, color: Colors.white54, size: 48),
                ),
              ),
            ),
            Expanded(
              child: AuthenticatedImage(
                imageUrl: rightUrl,
                comicId: widget.comicId,
                pageIndex: rightPage,
                fit: BoxFit.contain,
                alignment: noGap ? Alignment.centerLeft : Alignment.center,
                placeholder: const Center(child: CircularProgressIndicator()),
                errorWidget: const Center(
                  child: Icon(Icons.broken_image, color: Colors.white54, size: 48),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  /// 长条滚动模式（Webtoon）
  Widget _buildWebtoonView(String serverUrl) {
    return WebtoonView(
      controller: _scrollController,
      comicId: widget.comicId,
      serverUrl: serverUrl,
      pageCount: _totalPages,
      initialPage: _currentPage,
      onPageChanged: (page) {
        if (page != _currentPage) _onPageChanged(page);
      },
      onNextChapter: widget.loadNextChapterIds != null &&
              !_noNextChapter &&
              !_openingNextChapter
          ? _openNextChapter
          : null,
    );
  }

  /// 顶部工具栏
  Widget _buildTopOverlay() {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Colors.black87, Colors.transparent],
          ),
        ),
        child: SafeArea(
          bottom: false,
          child: Row(
            children: [
              // 返回按钮
              IconButton(
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: _onWillPop,
              ),
              // 页码
              Expanded(
                child: _settings.showPageNumber
                    ? Text(
                        '${_currentPage + 1} / $_totalPages',
                        style: const TextStyle(color: Colors.white),
                        textAlign: TextAlign.center,
                      )
                    : const SizedBox.shrink(),
              ),
              // 自动翻页
              if (_settings.autoPageInterval > 0)
                IconButton(
                  icon: Icon(
                    _autoPage ? Icons.pause : Icons.play_arrow,
                    color: Colors.white,
                  ),
                  tooltip: _autoPage ? '停止自动翻页' : '自动翻页',
                  onPressed: _toggleAutoPage,
                ),
              // 书签切换与列表
              IconButton(
                icon: Icon(
                  _bookmarkIdsByPage.containsKey(_currentPage)
                      ? Icons.bookmark
                      : Icons.bookmark_border,
                  color: _bookmarkIdsByPage.containsKey(_currentPage)
                      ? Colors.amber
                      : Colors.white,
                ),
                tooltip: _bookmarkIdsByPage.containsKey(_currentPage)
                    ? '取消书签'
                    : '添加书签',
                onPressed: _toggleCurrentPageBookmark,
              ),
              IconButton(
                icon: const Icon(Icons.bookmarks_outlined, color: Colors.white),
                tooltip: '书签列表',
                onPressed: _showBookmarksSheet,
              ),
              // 设置按钮
              IconButton(
                icon: const Icon(Icons.settings, color: Colors.white),
                tooltip: '阅读设置',
                onPressed: _showSettings,
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 底部进度条
  Widget _buildBottomOverlay() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.bottomCenter,
            end: Alignment.topCenter,
            colors: [Colors.black87, Colors.transparent],
          ),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text('${_currentPage + 1}',
                    style: const TextStyle(color: Colors.white)),
                Expanded(
                  child: Slider(
                    value: _currentPage.toDouble(),
                    min: 0,
                    max: (_totalPages - 1).toDouble().clamp(0, double.infinity),
                    onChanged: (v) {
                      final page = v.toInt();
                      if (_settings.mode == ComicReadingMode.webtoon) {
                        _scrollController.jumpToPage(page);
                      } else {
                        _pageController.jumpToPage(page);
                      }
                    },
                  ),
                ),
                Text('$_totalPages',
                    style: const TextStyle(color: Colors.white)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
