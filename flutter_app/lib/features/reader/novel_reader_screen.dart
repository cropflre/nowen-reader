import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../utils/tts_service.dart';

import '../../data/api/comic_api.dart';
import 'novel_settings.dart';
import 'novel_panels.dart';

/// 小说阅读器
class NovelReaderScreen extends ConsumerStatefulWidget {
  final String comicId;
  final int initialChapter;

  const NovelReaderScreen({
    super.key,
    required this.comicId,
    this.initialChapter = 0,
  });

  @override
  ConsumerState<NovelReaderScreen> createState() => _NovelReaderScreenState();
}

class _NovelReaderScreenState extends ConsumerState<NovelReaderScreen> {
  bool _loading = true;
  bool _chapterLoading = false;
  int _currentChapter = 0;
  int _totalChapters = 0;
  String _title = '';
  String _chapterContent = '';
  String _chapterTitle = '';
  String? _chapterMimeType;
  bool _showOverlay = false;
  bool _showTOC = false;
  bool _showSettings = false;
  bool _showSearch = false;
  final ScrollController _scrollController = ScrollController();

  // 左右翻页(swipe)模式状态
  int _swipePage = 0;
  int _swipeTotalPages = 1;
  final GlobalKey _contentKey = GlobalKey();

  // 章节目录列表
  List<Map<String, dynamic>> _chapters = [];

  // 初始Tab索引（用于书签按钮直接打开书签Tab）
  int _tocInitialTab = 0;

  // 错误状态
  String? _loadError;

  // 设置
  NovelSettings _settings = const NovelSettings();

  // 书签
  List<NovelBookmark> _bookmarks = [];

  // TTS 听书
  final TtsService _tts = TtsService();
  bool _ttsPlaying = false;
  bool _ttsPaused = false;
  double _ttsRate = 1.0;
  bool _showTtsPanel = false;

  // 自动滚动
  bool _autoScrolling = false;
  Timer? _autoScrollTimer;

  // 底部状态栏时间
  String _currentTime = '';
  Timer? _timeTimer;

  // 阅读会话
  late final ComicApi _api;
  int? _sessionId;
  DateTime? _sessionStart;
  bool _sessionEnded = false;

  // 搜索用：缓存章节内容
  final Map<int, String> _chapterCache = {};

  @override
  void initState() {
    super.initState();
    _currentChapter = widget.initialChapter;
    _api = ref.read(comicApiProvider);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _initTTS();
    _loadSettings();
    _loadBookmarks();
    _loadPages();
    _startTimeTimer();
    // 注册键盘快捷键
    ServicesBinding.instance.keyboard.addHandler(_handleKeyEvent);
  }

  @override
  void dispose() {
    ServicesBinding.instance.keyboard.removeHandler(_handleKeyEvent);
    _autoScrollTimer?.cancel();
    _timeTimer?.cancel();
    _tts.stop();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    _saveProgressDirect();
    _endSessionDirect();
    _scrollController.dispose();
    super.dispose();
  }

  // ============================================================
  // 键盘快捷键
  // ============================================================

  bool _handleKeyEvent(KeyEvent event) {
    if (event is! KeyDownEvent) return false;
    final key = event.logicalKey;

    // ← / A: 上一章
    if (key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.keyA) {
      if (_settings.pageMode == NovelPageMode.swipe) {
        _swipePrevPage();
      } else {
        _prevChapter();
      }
      return true;
    }
    // → / D: 下一章
    if (key == LogicalKeyboardKey.arrowRight || key == LogicalKeyboardKey.keyD) {
      if (_settings.pageMode == NovelPageMode.swipe) {
        _swipeNextPage();
      } else {
        _nextChapter();
      }
      return true;
    }
    // ↑ / ↓: 滚动
    if (key == LogicalKeyboardKey.arrowUp) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          (_scrollController.offset - 200).clamp(0.0, _scrollController.position.maxScrollExtent),
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
      return true;
    }
    if (key == LogicalKeyboardKey.arrowDown) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          (_scrollController.offset + 200).clamp(0.0, _scrollController.position.maxScrollExtent),
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
      return true;
    }
    // Space: 翻页（swipe模式下一页，scroll模式滚动一屏）
    if (key == LogicalKeyboardKey.space) {
      if (_settings.pageMode == NovelPageMode.swipe) {
        _swipeNextPage();
      } else if (_scrollController.hasClients) {
        _scrollController.animateTo(
          (_scrollController.offset + MediaQuery.of(context).size.height * 0.8)
              .clamp(0.0, _scrollController.position.maxScrollExtent),
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
      return true;
    }
    // Escape: 返回
    if (key == LogicalKeyboardKey.escape) {
      _onWillPop();
      return true;
    }
    return false;
  }

  void _startTimeTimer() {
    _updateTime();
    _timeTimer = Timer.periodic(const Duration(seconds: 30), (_) => _updateTime());
  }

  void _updateTime() {
    final now = DateTime.now();
    if (mounted) {
      setState(() {
        _currentTime =
            '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      });
    }
  }

  // ============================================================
  // TTS 初始化
  // ============================================================

  Future<void> _initTTS() async {
    if (!_tts.isSupported) return;
    try {
      await _tts.setLanguage('zh-CN');
      await _tts.setSpeechRate(_ttsRate);
      await _tts.setPitch(1.0);
      _tts.setCompletionHandler(() {
        // 当前章朗读完毕，自动播放下一章
        if (_ttsPlaying && _currentChapter < _totalChapters - 1) {
          _loadChapter(_currentChapter + 1).then((_) {
            Future.delayed(const Duration(milliseconds: 500), () {
              if (mounted && _ttsPlaying) _startTTS();
            });
          });
        } else {
          if (mounted) {
            setState(() {
              _ttsPlaying = false;
              _ttsPaused = false;
            });
          }
        }
      });
      _tts.setErrorHandler(() {
        if (mounted) {
          setState(() {
            _ttsPlaying = false;
            _ttsPaused = false;
          });
        }
      });
    } catch (_) {}
  }

  void _startTTS() {
    if (!_tts.isSupported) return;
    final text = _stripHtml(_chapterContent);
    if (text.trim().isEmpty) return;
    _tts.setSpeechRate(_ttsRate);
    _tts.speak(text);
    setState(() {
      _ttsPlaying = true;
      _ttsPaused = false;
      _showTtsPanel = true;
    });
  }

  void _stopTTS() {
    _tts.stop();
    setState(() {
      _ttsPlaying = false;
      _ttsPaused = false;
      _showTtsPanel = false;
    });
  }

  void _toggleTTSPause() {
    if (!_ttsPlaying) return;
    if (_ttsPaused) {
      _tts.resume();
      setState(() => _ttsPaused = false);
    } else {
      _tts.pause();
      setState(() => _ttsPaused = true);
    }
  }

  void _setTTSRate(double rate) {
    _ttsRate = rate;
    _tts.setSpeechRate(rate);
    setState(() {});
    // 如果正在播放，重新开始以应用新语速
    if (_ttsPlaying && !_ttsPaused) {
      _tts.stop();
      Future.delayed(const Duration(milliseconds: 100), () {
        if (mounted) _startTTS();
      });
    }
  }

  // ============================================================
  // 自动滚动
  // ============================================================

  void _toggleAutoScroll() {
    setState(() => _autoScrolling = !_autoScrolling);
    if (_autoScrolling) {
      _startAutoScrollTimer();
    } else {
      _autoScrollTimer?.cancel();
    }
  }

  void _startAutoScrollTimer() {
    _autoScrollTimer?.cancel();
    // 速度映射：1=慢(1px/50ms), 2=中(2px/50ms), 3=快(4px/50ms)
    final speedPx =
        _settings.autoScrollSpeed == 1 ? 1.0 : _settings.autoScrollSpeed == 2 ? 2.0 : 4.0;
    _autoScrollTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      if (!_scrollController.hasClients) return;
      final maxScroll = _scrollController.position.maxScrollExtent;
      if (_scrollController.offset >= maxScroll - 2) {
        // 到底了，自动翻到下一章
        if (_currentChapter < _totalChapters - 1) {
          _loadChapter(_currentChapter + 1);
        } else {
          _autoScrollTimer?.cancel();
          setState(() => _autoScrolling = false);
        }
      } else {
        _scrollController.jumpTo(_scrollController.offset + speedPx);
      }
    });
  }

  // ============================================================
  // 书签
  // ============================================================

  Future<void> _loadBookmarks() async {
    final bms = await BookmarkManager.load(widget.comicId);
    if (mounted) setState(() => _bookmarks = bms);
  }

  bool get _isCurrentBookmarked =>
      _bookmarks.any((b) => b.chapterIndex == _currentChapter);

  void _toggleBookmark() {
    if (_isCurrentBookmarked) {
      _removeBookmark(_currentChapter);
    } else {
      _addBookmark();
    }
  }

  void _addBookmark() {
    if (_isCurrentBookmarked) return;
    final bm = NovelBookmark(
      chapterIndex: _currentChapter,
      chapterTitle: _chapterTitle.isNotEmpty
          ? _chapterTitle
          : '第${_currentChapter + 1}章',
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );
    setState(() => _bookmarks.add(bm));
    BookmarkManager.save(widget.comicId, _bookmarks);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('📑 已添加书签'),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 1),
        backgroundColor: _settings.isDark ? Colors.white12 : Colors.black87,
      ),
    );
  }

  void _removeBookmark(int chapterIndex) {
    setState(() {
      _bookmarks.removeWhere((b) => b.chapterIndex == chapterIndex);
    });
    BookmarkManager.save(widget.comicId, _bookmarks);
  }

  // ============================================================
  // 数据加载
  // ============================================================

  Future<void> _loadSettings() async {
    final s = await NovelSettings.load();
    if (mounted) setState(() => _settings = s);
  }

  Future<void> _loadPages() async {
    try {
      // 同时获取页面列表和漫画详情（用于恢复阅读进度）
      final results = await Future.wait([
        _api.getPages(widget.comicId),
        _api.getComic(widget.comicId),
      ]);
      if (!mounted) return;
      final data = results[0];
      final comicData = results[1];
      final pages = (data['pages'] as List<dynamic>?) ?? [];

      // 如果没有通过路由指定初始章节，尝试从服务器恢复阅读进度
      int startChapter = _currentChapter;
      if (widget.initialChapter == 0) {
        final lastReadPage = comicData['lastReadPage'] as int? ?? 0;
        if (lastReadPage > 0 && lastReadPage < pages.length) {
          startChapter = lastReadPage;
        }
      }

      setState(() {
        _title = data['title'] ?? '';
        _totalChapters = pages.length;
        _chapters = pages.map((p) => Map<String, dynamic>.from(p)).toList();
        _currentChapter = startChapter;
        _loading = false;
        _loadError = null;
      });
      _startSession();
      _loadChapter(_currentChapter);
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadError = '加载失败：$e';
        });
      }
    }
  }

  Future<void> _loadChapter(int index) async {
    if (index < 0 || index >= _totalChapters) return;
    setState(() {
      _chapterLoading = true;
      _currentChapter = index;
    });
    try {
      final data = await _api.getChapterContent(widget.comicId, index);
      if (!mounted) return;
      final content = data['content'] ?? '';
      setState(() {
        _chapterContent = content;
        _chapterTitle = data['title'] ?? '第${index + 1}章';
        _chapterMimeType = data['mimeType'];
        _chapterLoading = false;
      });
      // 缓存内容用于搜索
      _chapterCache[index] = _stripHtml(content);
      // 重置翻页状态并滚动到顶部
      _swipePage = 0;
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(0);
      }
      // 延迟计算swipe总页数
      _computeSwipePages();
      // 保存进度
      if (index % 3 == 0) _saveProgress();
    } catch (e) {
      if (mounted) {
        setState(() {
          _chapterContent = '';
          _chapterLoading = false;
          _loadError = '章节加载失败：$e';
        });
      }
    }
  }

  // ============================================================
  // 左右翻页(swipe)分页逻辑
  // ============================================================

  void _computeSwipePages() {
    if (_settings.pageMode != NovelPageMode.swipe) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final ctx = _contentKey.currentContext;
      if (ctx == null) return;
      final renderBox = ctx.findRenderObject() as RenderBox?;
      if (renderBox == null || !renderBox.hasSize) return;
      final viewH = renderBox.size.height;
      if (viewH <= 0) {
        setState(() => _swipeTotalPages = 1);
        return;
      }
      // 基于文本内容估算总高度
      final contentH = _estimateContentHeight();
      setState(() {
        _swipeTotalPages = max(1, (contentH / viewH).ceil());
        if (_swipePage >= _swipeTotalPages) {
          _swipePage = _swipeTotalPages - 1;
        }
      });
    });
  }

  double _estimateContentHeight() {
    final isHtml = _chapterMimeType == 'text/html' ||
        _chapterContent.trimLeft().startsWith('<');
    final displayText = isHtml ? _stripHtml(_chapterContent) : _chapterContent;
    final paragraphs = displayText
        .split('\n')
        .where((line) => line.trim().isNotEmpty)
        .toList();
    final screenWidth = MediaQuery.of(context).size.width - _settings.horizontalPadding * 2;
    final charsPerLine = max(1, (screenWidth / _settings.fontSize).floor());
    double totalH = (_settings.fontSize + 4) * 1.4 + 24; // 章节标题高度
    for (final p in paragraphs) {
      final lineCount = max(1, ((p.trim().length + 2) / charsPerLine).ceil());
      totalH += lineCount * _settings.fontSize * _settings.lineHeight + 16;
    }
    return totalH;
  }

  void _swipePrevPage() {
    if (_swipePage > 0) {
      setState(() => _swipePage--);
    } else if (_currentChapter > 0) {
      _loadChapter(_currentChapter - 1).then((_) {
        // 跳到上一章最后一页
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            setState(() => _swipePage = max(0, _swipeTotalPages - 1));
          }
        });
      });
    }
  }

  void _swipeNextPage() {
    if (_swipePage < _swipeTotalPages - 1) {
      setState(() => _swipePage++);
    } else if (_currentChapter < _totalChapters - 1) {
      _loadChapter(_currentChapter + 1);
    }
  }

  /// 搜索用：获取章节纯文本内容
  Future<String> _getChapterText(int index) async {
    if (_chapterCache.containsKey(index)) return _chapterCache[index]!;
    try {
      final data = await _api.getChapterContent(widget.comicId, index);
      final content = data['content'] ?? '';
      final text = _stripHtml(content);
      _chapterCache[index] = text;
      return text;
    } catch (_) {
      return '';
    }
  }

  // ============================================================
  // 会话管理
  // ============================================================

  Future<void> _startSession() async {
    try {
      _sessionId = await _api.startSession(widget.comicId, _currentChapter);
      _sessionStart = DateTime.now();
    } catch (_) {}
  }

  Future<void> _endSession() async {
    if (_sessionId == null || _sessionStart == null || _sessionEnded) return;
    _sessionEnded = true;
    final duration = DateTime.now().difference(_sessionStart!).inSeconds;
    try {
      await _api.endSession(_sessionId!, _currentChapter, duration);
    } catch (_) {}
  }

  void _endSessionDirect() {
    if (_sessionId == null || _sessionStart == null || _sessionEnded) return;
    _sessionEnded = true;
    final duration = DateTime.now().difference(_sessionStart!).inSeconds;
    _api.endSession(_sessionId!, _currentChapter, duration).catchError((_) {});
  }

  Future<void> _saveProgress() async {
    try {
      await _api.updateProgress(widget.comicId, _currentChapter);
    } catch (_) {}
  }

  void _saveProgressDirect() {
    _api.updateProgress(widget.comicId, _currentChapter).catchError((_) {});
  }

  // ============================================================
  // 导航
  // ============================================================

  Future<void> _onWillPop() async {
    _stopTTS();
    _autoScrollTimer?.cancel();
    await _saveProgress();
    await _endSession();
    if (mounted) Navigator.of(context).pop();
  }

  void _toggleOverlay() {
    setState(() {
      _showOverlay = !_showOverlay;
      if (!_showOverlay) {
        _showTOC = false;
        _showSettings = false;
        _showSearch = false;
      }
    });
  }

  void _goToChapter(int index) {
    setState(() {
      _showTOC = false;
      _showSearch = false;
      _showOverlay = false;
    });
    // 章节切换时停止 TTS
    if (_ttsPlaying) _stopTTS();
    _loadChapter(index);
  }

  void _prevChapter() {
    if (_currentChapter > 0) _loadChapter(_currentChapter - 1);
  }

  void _nextChapter() {
    if (_currentChapter < _totalChapters - 1) {
      _loadChapter(_currentChapter + 1);
    }
  }

  void _updateSettings(NovelSettings s) {
    final oldSpeed = _settings.autoScrollSpeed;
    final oldPageMode = _settings.pageMode;
    setState(() => _settings = s);
    s.save();
    // 自动滚动速度变更时，动态更新定时器
    if (_autoScrolling && s.autoScrollSpeed != oldSpeed) {
      _startAutoScrollTimer();
    }
    // 翻页模式变更时重新计算页数
    if (s.pageMode != oldPageMode) {
      _swipePage = 0;
      if (s.pageMode == NovelPageMode.swipe) {
        _computeSwipePages();
      }
    }
  }

  /// 简单的 HTML 标签剥离
  String _stripHtml(String html) {
    var text = html.replaceAll(RegExp(r'<style[^>]*>[\s\S]*?</style>', caseSensitive: false), '');
    text = text.replaceAll(RegExp(r'<script[^>]*>[\s\S]*?</script>', caseSensitive: false), '');
    text = text.replaceAll(RegExp(r'<br\s*/?>'), '\n');
    text = text.replaceAll(RegExp(r'</p>'), '\n\n');
    text = text.replaceAll(RegExp(r'</div>'), '\n');
    text = text.replaceAll(RegExp(r'</h[1-6]>'), '\n\n');
    text = text.replaceAll(RegExp(r'<[^>]*>'), '');
    text = text.replaceAll('&nbsp;', ' ');
    text = text.replaceAll('&lt;', '<');
    text = text.replaceAll('&gt;', '>');
    text = text.replaceAll('&amp;', '&');
    text = text.replaceAll('&quot;', '"');
    text = text.replaceAll('&#39;', "'");
    text = text.replaceAll(RegExp(r'\n{3,}'), '\n\n');
    return text.trim();
  }

  // ============================================================
  // UI 构建
  // ============================================================

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        backgroundColor: _settings.backgroundColor,
        body: Center(
          child: CircularProgressIndicator(color: _settings.textColor),
        ),
      );
    }

    // 加载失败时显示错误+重试
    if (_loadError != null && _chapters.isEmpty) {
      return Scaffold(
        backgroundColor: _settings.backgroundColor,
        appBar: AppBar(
          backgroundColor: _settings.backgroundColor,
          foregroundColor: _settings.textColor,
          elevation: 0,
          title: Text(_title.isNotEmpty ? _title : '小说阅读器'),
        ),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 48, color: _settings.secondaryTextColor),
              const SizedBox(height: 16),
              Text(
                _loadError!,
                style: TextStyle(color: _settings.secondaryTextColor, fontSize: 14),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () {
                  setState(() {
                    _loading = true;
                    _loadError = null;
                  });
                  _loadPages();
                },
                icon: const Icon(Icons.refresh),
                label: const Text('重试'),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text('返回', style: TextStyle(color: _settings.secondaryTextColor)),
              ),
            ],
          ),
        ),
      );
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _onWillPop();
      },
      child: Scaffold(
        backgroundColor: _settings.backgroundColor,
        body: Stack(
          children: [
            // 主体内容
            Column(
              children: [
                // 顶部章节标题栏
                _buildHeaderBar(),
                // 文本内容
                Expanded(
                  child: GestureDetector(
                    onTap: _toggleOverlay,
                    child: _buildContentView(),
                  ),
                ),
                // 底部状态栏
                _buildStatusBar(),
              ],
            ),

            // 顶部工具栏覆盖层
            if (_showOverlay) _buildTopOverlay(),

            // 底部工具栏覆盖层
            if (_showOverlay) _buildBottomOverlay(),

            // 目录/书签面板（左侧抽屉）
            if (_showTOC) ...[
              GestureDetector(
                onTap: () => setState(() => _showTOC = false),
                child: Container(color: Colors.black54),
              ),
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: MediaQuery.of(context).size.width * 0.78,
                child: TOCBookmarkPanel(
                  settings: _settings,
                  chapters: _chapters,
                  currentChapter: _currentChapter,
                  bookmarks: _bookmarks,
                  isCurrentBookmarked: _isCurrentBookmarked,
                  onGoToChapter: _goToChapter,
                  onClose: () => setState(() => _showTOC = false),
                  onToggleBookmark: _toggleBookmark,
                  onRemoveBookmark: _removeBookmark,
                  initialTabIndex: _tocInitialTab,
                ),
              ),
            ],

            // 搜索面板（右侧抽屉）
            if (_showSearch) ...[
              GestureDetector(
                onTap: () => setState(() => _showSearch = false),
                child: Container(color: Colors.black54),
              ),
              Positioned(
                right: 0,
                top: 0,
                bottom: 0,
                width: MediaQuery.of(context).size.width * 0.88,
                child: SearchPanel(
                  settings: _settings,
                  chapters: _chapters,
                  currentChapter: _currentChapter,
                  comicId: widget.comicId,
                  onGoToChapter: _goToChapter,
                  onClose: () => setState(() => _showSearch = false),
                  getChapterContent: _getChapterText,
                ),
              ),
            ],

            // 设置面板（底部弹出）
            if (_showSettings) ...[
              GestureDetector(
                onTap: () => setState(() => _showSettings = false),
                child: Container(color: Colors.transparent),
              ),
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: SettingsPanel(
                  settings: _settings,
                  onChanged: _updateSettings,
                  onClose: () => setState(() => _showSettings = false),
                ),
              ),
            ],

            // TTS 控制面板
            if (_showTtsPanel && _ttsPlaying)
              Positioned(
                bottom: 60,
                left: 0,
                right: 0,
                child: Center(
                  child: TTSControlPanel(
                    settings: _settings,
                    isPaused: _ttsPaused,
                    rate: _ttsRate,
                    onTogglePause: _toggleTTSPause,
                    onStop: _stopTTS,
                    onRateChanged: _setTTSRate,
                    onClose: () => setState(() => _showTtsPanel = false),
                  ),
                ),
              ),

            // TTS 播放中迷你指示器
            if (_ttsPlaying && !_showTtsPanel)
              Positioned(
                bottom: 60,
                right: 12,
                child: GestureDetector(
                  onTap: () => setState(() => _showTtsPanel = true),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primary.withAlpha(220),
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: const [
                        BoxShadow(color: Colors.black26, blurRadius: 8),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.volume_up, size: 14, color: Colors.white),
                        const SizedBox(width: 4),
                        Text(
                          _ttsPaused ? '已暂停' : '朗读中...',
                          style: const TextStyle(fontSize: 11, color: Colors.white),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // 自动滚动状态指示条
            if (_autoScrolling)
              Positioned(
                top: MediaQuery.of(context).padding.top + 36,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    decoration: BoxDecoration(
                      color: _settings.isDark
                          ? Colors.green.withAlpha(25)
                          : Colors.green.withAlpha(30),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: Colors.green.withAlpha(60)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: const BoxDecoration(
                            color: Colors.green,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          '自动翻页中 · ${_settings.autoScrollSpeed == 1 ? '慢速' : _settings.autoScrollSpeed == 2 ? '中速' : '快速'}',
                          style: TextStyle(
                            fontSize: 10,
                            color: _settings.isDark
                                ? Colors.green[300]
                                : Colors.green[700],
                          ),
                        ),
                        const SizedBox(width: 6),
                        GestureDetector(
                          onTap: _toggleAutoScroll,
                          child: Icon(Icons.close, size: 14,
                              color: _settings.isDark
                                  ? Colors.green[400]
                                  : Colors.green[600]),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// 顶部章节标题栏（沉浸式）
  Widget _buildHeaderBar() {
    return Container(
      padding: EdgeInsets.fromLTRB(
        12,
        MediaQuery.of(context).padding.top + 4,
        12,
        4,
      ),
      color: _settings.backgroundColor,
      child: Row(
        children: [
          // 目录按钮
          GestureDetector(
            onTap: () => setState(() {
              _showTOC = true;
              _showOverlay = false;
            }),
            child: Icon(Icons.list, size: 16, color: _settings.secondaryTextColor),
          ),
          const SizedBox(width: 8),
          // 章节标题
          Expanded(
            child: Text(
              _chapterTitle.isNotEmpty
                  ? _chapterTitle
                  : '第${_currentChapter + 1}章',
              style: TextStyle(
                color: _settings.secondaryTextColor,
                fontSize: 11,
              ),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 4),
          // 搜索按钮
          GestureDetector(
            onTap: () => setState(() {
              _showSearch = true;
              _showOverlay = false;
            }),
            child: Icon(Icons.search, size: 16, color: _settings.secondaryTextColor),
          ),
          const SizedBox(width: 8),
          // 书签按钮
          GestureDetector(
            onTap: _toggleBookmark,
            child: Icon(
              _isCurrentBookmarked ? Icons.bookmark : Icons.bookmark_border,
              size: 16,
              color: _isCurrentBookmarked ? Colors.amber : _settings.secondaryTextColor,
            ),
          ),
          const SizedBox(width: 8),
          // 排版设置
          GestureDetector(
            onTap: () => setState(() {
              _showSettings = true;
              _showOverlay = false;
            }),
            child: Icon(Icons.text_fields, size: 16, color: _settings.secondaryTextColor),
          ),
        ],
      ),
    );
  }

  /// 底部状态栏（沉浸式微弱显示）
  Widget _buildStatusBar() {
    if (_showTOC || _showSettings || _showSearch) return const SizedBox.shrink();
    final progress = _totalChapters > 0
        ? ((_currentChapter + 1) / _totalChapters * 100).round()
        : 0;
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        2,
        16,
        MediaQuery.of(context).padding.bottom + 2,
      ),
      color: _settings.backgroundColor,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            _chapterTitle.isNotEmpty
                ? _chapterTitle
                : '第${_currentChapter + 1}章',
            style: TextStyle(
                color: _settings.secondaryTextColor.withAlpha(120), fontSize: 10),
          ),
          Row(
            children: [
              Text(
                '$progress%',
                style: TextStyle(
                    color: _settings.secondaryTextColor.withAlpha(120), fontSize: 10),
              ),
              const SizedBox(width: 12),
              Text(
                _currentTime,
                style: TextStyle(
                    color: _settings.secondaryTextColor.withAlpha(120), fontSize: 10),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// 文本内容区域
  Widget _buildContentView() {
    if (_chapterLoading) {
      return Center(
        child: CircularProgressIndicator(
          color: _settings.textColor.withAlpha(128),
        ),
      );
    }

    // 章节加载失败时显示重试
    if (_loadError != null && _chapterContent.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 40, color: _settings.secondaryTextColor),
            const SizedBox(height: 12),
            Text(
              _loadError!,
              style: TextStyle(color: _settings.secondaryTextColor, fontSize: 13),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () {
                setState(() => _loadError = null);
                _loadChapter(_currentChapter);
              },
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('重试'),
            ),
          ],
        ),
      );
    }

    final isHtml = _chapterMimeType == 'text/html' ||
        _chapterContent.trimLeft().startsWith('<');
    final displayText = isHtml ? _stripHtml(_chapterContent) : _chapterContent;

    // 将文本按段落分割
    final paragraphs = displayText
        .split('\n')
        .where((line) => line.trim().isNotEmpty)
        .toList();

    final contentWidgets = <Widget>[
      // 章节标题
      Padding(
        padding: const EdgeInsets.only(bottom: 24),
        child: Text(
          _chapterTitle,
          style: TextStyle(
            color: _settings.textColor,
            fontSize: _settings.fontSize + 4,
            fontWeight: FontWeight.bold,
            height: 1.4,
            fontFamily: _settings.fontFamily,
          ),
          textAlign: TextAlign.center,
        ),
      ),
      // 章节正文（段落）
      ...paragraphs.map((p) => Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: SelectableText(
              '　　${p.trim()}',
              style: TextStyle(
                color: _settings.textColor,
                fontSize: _settings.fontSize,
                height: _settings.lineHeight,
                fontFamily: _settings.fontFamily,
              ),
            ),
          )),
      // 上/下一章按钮
      const SizedBox(height: 20),
      Divider(color: _settings.secondaryTextColor.withAlpha(40)),
      const SizedBox(height: 12),
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          if (_currentChapter > 0)
            TextButton.icon(
              onPressed: _prevChapter,
              icon: Icon(Icons.chevron_left, color: _settings.secondaryTextColor),
              label: Text('上一章',
                  style: TextStyle(color: _settings.secondaryTextColor)),
            ),
          Text(
            '${_currentChapter + 1} / $_totalChapters',
            style: TextStyle(fontSize: 12, color: _settings.secondaryTextColor),
          ),
          if (_currentChapter < _totalChapters - 1)
            TextButton.icon(
              onPressed: _nextChapter,
              icon: Icon(Icons.chevron_right, color: _settings.secondaryTextColor),
              label: Text('下一章',
                  style: TextStyle(color: _settings.secondaryTextColor)),
            ),
        ],
      ),
      const SizedBox(height: 20),
    ];

    // ====== 左右翻页(swipe)模式 ======
    if (_settings.pageMode == NovelPageMode.swipe) {
      return GestureDetector(
        onHorizontalDragEnd: (details) {
          final velocity = details.primaryVelocity ?? 0;
          if (velocity < -200) {
            _swipeNextPage(); // 左滑 → 下一页
          } else if (velocity > 200) {
            _swipePrevPage(); // 右滑 → 上一页
          }
        },
        child: LayoutBuilder(
          builder: (context, constraints) {
            final viewHeight = constraints.maxHeight;
            return ClipRect(
              child: Stack(
                key: _contentKey,
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeOut,
                    transform: Matrix4.translationValues(
                      0,
                      -_swipePage * viewHeight,
                      0,
                    ),
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(
                        _settings.horizontalPadding,
                        16,
                        _settings.horizontalPadding,
                        80,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: contentWidgets,
                      ),
                    ),
                  ),
                  // swipe 页码指示器
                  if (_swipeTotalPages > 1)
                    Positioned(
                      bottom: 8,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: _settings.isDark
                                ? Colors.white.withAlpha(20)
                                : Colors.black.withAlpha(15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            '${_swipePage + 1} / $_swipeTotalPages',
                            style: TextStyle(
                              fontSize: 10,
                              color: _settings.secondaryTextColor,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      );
    }

    // ====== 上下滚动模式（默认） ======
    return ListView(
      controller: _scrollController,
      padding: EdgeInsets.fromLTRB(
        _settings.horizontalPadding,
        16,
        _settings.horizontalPadding,
        80,
      ),
      children: contentWidgets,
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
              IconButton(
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: _onWillPop,
              ),
              Expanded(
                child: Text(
                  _title,
                  style: const TextStyle(
                      color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                ),
              ),
              // 信息按钮
              IconButton(
                icon: const Icon(Icons.info_outline, color: Colors.white, size: 20),
                onPressed: () {}, // TODO: 书籍信息
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// 底部工具栏
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
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 章节进度条
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    IconButton(
                      icon: const Icon(Icons.chevron_left, color: Colors.white70, size: 22),
                      onPressed: _currentChapter > 0 ? _prevChapter : null,
                    ),
                    Expanded(
                      child: Slider(
                        value: _currentChapter.toDouble(),
                        min: 0,
                        max: (_totalChapters - 1).toDouble().clamp(0, double.infinity),
                        onChanged: (v) => _goToChapter(v.toInt()),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.chevron_right, color: Colors.white70, size: 22),
                      onPressed:
                          _currentChapter < _totalChapters - 1 ? _nextChapter : null,
                    ),
                    Text(
                      '${_currentChapter + 1}/$_totalChapters',
                      style: const TextStyle(color: Colors.white70, fontSize: 11, fontFamily: 'monospace'),
                    ),
                  ],
                ),
              ),
              // 功能按钮 + 主题色卡
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                child: Row(
                  children: [
                    // 功能按钮
                    Expanded(
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            _ToolButton(
                              icon: Icons.list,
                              label: '目录',
                              onTap: () => setState(() {
                                _tocInitialTab = 0;
                                _showTOC = true;
                                _showOverlay = false;
                              }),
                            ),
                            _ToolButton(
                              icon: Icons.text_fields,
                              label: '排版',
                              onTap: () => setState(() {
                                _showSettings = true;
                                _showOverlay = false;
                              }),
                            ),
                            _ToolButton(
                              icon: Icons.bookmark,
                              label: '书签',
                              onTap: () => setState(() {
                                _tocInitialTab = 1;
                                _showTOC = true;
                                _showOverlay = false;
                              }),
                            ),
                            _ToolButton(
                              icon: Icons.search,
                              label: '搜索',
                              onTap: () => setState(() {
                                _showSearch = true;
                                _showOverlay = false;
                              }),
                            ),
                            _ToolButton(
                              icon: Icons.volume_up,
                              label: _ttsPlaying ? '停止' : '听书',
                              isActive: _ttsPlaying,
                              onTap: () {
                                if (_ttsPlaying) {
                                  _stopTTS();
                                } else {
                                  _startTTS();
                                }
                                setState(() => _showOverlay = false);
                              },
                            ),
                            _ToolButton(
                              icon: Icons.timer,
                              label: _autoScrolling ? '停止' : '自动',
                              isActive: _autoScrolling,
                              onTap: () {
                                _toggleAutoScroll();
                                setState(() => _showOverlay = false);
                              },
                            ),
                          ],
                        ),
                      ),
                    ),
                    // 主题色卡
                    const SizedBox(width: 8),
                    ...[
                      (NovelTheme.night, const Color(0xFF18181B)),
                      (NovelTheme.day, const Color(0xFFFFFBEB)),
                      (NovelTheme.green, const Color(0xFFC7EDCC)),
                      (NovelTheme.gray, const Color(0xFFE0E0E0)),
                      (NovelTheme.white, const Color(0xFFFFFFFF)),
                    ].map((t) {
                      final isActive = _settings.theme == t.$1;
                      return GestureDetector(
                        onTap: () => _updateSettings(_settings.copyWith(theme: t.$1)),
                        child: Container(
                          width: 22,
                          height: 22,
                          margin: const EdgeInsets.only(left: 4),
                          decoration: BoxDecoration(
                            color: t.$2,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: isActive
                                  ? Theme.of(context).colorScheme.primary
                                  : Colors.white24,
                              width: isActive ? 2 : 1,
                            ),
                            boxShadow: isActive
                                ? [
                                    BoxShadow(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .primary
                                          .withAlpha(60),
                                      blurRadius: 4,
                                    )
                                  ]
                                : null,
                          ),
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 底部工具按钮
class _ToolButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool isActive;

  const _ToolButton({
    required this.icon,
    required this.label,
    this.onTap,
    this.isActive = false,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final activeColor = isActive
        ? Theme.of(context).colorScheme.primary
        : Colors.white;
    return GestureDetector(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon,
                color: enabled ? activeColor : Colors.white30, size: 22),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                color: enabled
                    ? (isActive ? activeColor : Colors.white70)
                    : Colors.white30,
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
