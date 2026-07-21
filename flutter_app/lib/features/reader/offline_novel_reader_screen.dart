import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/services/cache_service.dart';
import '../../data/services/offline_library_service.dart';

class OfflineNovelReaderScreen extends StatefulWidget {
  final String comicId;
  final int? initialChapter;

  const OfflineNovelReaderScreen({
    super.key,
    required this.comicId,
    this.initialChapter,
  });

  @override
  State<OfflineNovelReaderScreen> createState() =>
      _OfflineNovelReaderScreenState();
}

class _OfflineNovelReaderScreenState
    extends State<OfflineNovelReaderScreen> {
  final ScrollController _scrollController = ScrollController();

  CacheEntry? _entry;
  OfflineBookManifest? _manifest;
  final Map<int, String> _chapterTitles = {};

  bool _loading = true;
  bool _chapterLoading = false;
  String? _error;
  int _currentChapter = 0;
  int _totalChapters = 0;
  String _chapterTitle = '';
  String _chapterContent = '';

  String get _serverUrl => _manifest?.serverUrl ?? '';

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  @override
  void dispose() {
    if (_entry != null) {
      unawaited(
        offlineLibraryService.saveProgress(
          widget.comicId,
          _serverUrl,
          _currentChapter,
        ),
      );
    }
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    await cacheService.init();
    final entry = cacheService.getEntry(widget.comicId);
    final manifest =
        await offlineLibraryService.getManifest(widget.comicId);

    if (!mounted) return;
    if (entry == null || !entry.isNovel || entry.cachedPages <= 0) {
      setState(() {
        _loading = false;
        _error = '本机没有可阅读的小说缓存';
      });
      return;
    }

    final total = manifest?.totalChapters ?? entry.totalPages;
    if (total <= 0) {
      setState(() {
        _loading = false;
        _error = '离线缓存缺少章节信息，请联网后重新缓存';
      });
      return;
    }

    _entry = entry;
    _manifest = manifest;
    _totalChapters = total;
    _chapterTitles.addAll(manifest?.chapterTitles ?? const {});

    final requestedChapter = widget.initialChapter ??
        await offlineLibraryService.loadProgress(
          widget.comicId,
          manifest?.serverUrl ?? '',
        );
    final startChapter = requestedChapter.clamp(0, total - 1).toInt();

    final available = _findAvailableChapter(startChapter);
    if (available == null) {
      setState(() {
        _loading = false;
        _error = '缓存记录存在，但没有找到可读取的章节文件';
      });
      return;
    }

    setState(() {
      _loading = false;
      _currentChapter = available;
    });

    await _loadChapter(available);
    unawaited(_loadCachedChapterTitles());
  }

  int? _findAvailableChapter(int preferred) {
    if (cacheService.isChapterCached(widget.comicId, preferred)) {
      return preferred;
    }

    for (var distance = 1; distance < _totalChapters; distance++) {
      final next = preferred + distance;
      if (next < _totalChapters &&
          cacheService.isChapterCached(widget.comicId, next)) {
        return next;
      }

      final previous = preferred - distance;
      if (previous >= 0 &&
          cacheService.isChapterCached(widget.comicId, previous)) {
        return previous;
      }
    }
    return null;
  }

  Future<void> _loadCachedChapterTitles() async {
    final discovered = <int, String>{};
    for (var i = 0; i < _totalChapters; i++) {
      if (_chapterTitles.containsKey(i) ||
          !cacheService.isChapterCached(widget.comicId, i)) {
        continue;
      }
      final data = await cacheService.readCachedChapter(widget.comicId, i);
      final title = data?['title']?.toString().trim() ?? '';
      if (title.isNotEmpty) discovered[i] = title;
    }

    if (!mounted || discovered.isEmpty) return;
    setState(() => _chapterTitles.addAll(discovered));

    for (final item in discovered.entries) {
      await offlineLibraryService.updateChapterTitle(
        widget.comicId,
        item.key,
        item.value,
      );
    }
  }

  Future<void> _loadChapter(int index) async {
    if (index < 0 || index >= _totalChapters) return;

    setState(() {
      _chapterLoading = true;
      _error = null;
      _currentChapter = index;
    });

    final data =
        await cacheService.readCachedChapter(widget.comicId, index);
    if (!mounted) return;

    if (data == null) {
      setState(() {
        _chapterLoading = false;
        _chapterContent = '';
        _chapterTitle = _displayChapterTitle(index);
        _error = '该章节未下载，请联网后补充缓存';
      });
      return;
    }

    final title = data['title']?.toString().trim();
    final content = data['content']?.toString() ?? '';

    setState(() {
      _chapterTitle =
          title != null && title.isNotEmpty ? title : _displayChapterTitle(index);
      _chapterContent = _stripHtml(content);
      _chapterLoading = false;
      if (title != null && title.isNotEmpty) {
        _chapterTitles[index] = title;
      }
    });

    if (title != null && title.isNotEmpty) {
      unawaited(
        offlineLibraryService.updateChapterTitle(
          widget.comicId,
          index,
          title,
        ),
      );
    }
    unawaited(
      offlineLibraryService.saveProgress(
        widget.comicId,
        _serverUrl,
        index,
      ),
    );

    if (_scrollController.hasClients) {
      _scrollController.jumpTo(0);
    }
  }

  String _displayChapterTitle(int index) {
    return _chapterTitles[index] ?? '第 ${index + 1} 章';
  }

  String _stripHtml(String html) {
    var text = html.replaceAll(
      RegExp(
        r'<style[^>]*>[\s\S]*?</style>',
        caseSensitive: false,
      ),
      '',
    );
    text = text.replaceAll(
      RegExp(
        r'<script[^>]*>[\s\S]*?</script>',
        caseSensitive: false,
      ),
      '',
    );
    text = text.replaceAll(
      RegExp(r'<br\s*/?>', caseSensitive: false),
      '\n',
    );
    text = text.replaceAll(
      RegExp(r'</p>', caseSensitive: false),
      '\n\n',
    );
    text = text.replaceAll(
      RegExp(r'</div>', caseSensitive: false),
      '\n',
    );
    text = text.replaceAll(RegExp(r'<[^>]*>'), '');
    text = text
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'");
    text = text.replaceAll(RegExp(r'\n{3,}'), '\n\n');
    return text.trim();
  }

  Future<void> _previousChapter() async {
    for (var i = _currentChapter - 1; i >= 0; i--) {
      if (cacheService.isChapterCached(widget.comicId, i)) {
        await _loadChapter(i);
        return;
      }
    }
    _showMessage('前面没有已缓存章节');
  }

  Future<void> _nextChapter() async {
    for (var i = _currentChapter + 1; i < _totalChapters; i++) {
      if (cacheService.isChapterCached(widget.comicId, i)) {
        await _loadChapter(i);
        return;
      }
    }
    _showMessage('后面没有已缓存章节');
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_entry == null || (_error != null && _chapterContent.isEmpty)) {
      return Scaffold(
        appBar: AppBar(title: const Text('离线小说阅读')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_rounded, size: 56),
                const SizedBox(height: 16),
                Text(
                  _error ?? '无法打开离线缓存',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('返回离线书架'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _manifest?.title.isNotEmpty == true
              ? _manifest!.title
              : _entry!.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: 12),
            child: Chip(
              avatar: Icon(Icons.cloud_off_rounded, size: 16),
              label: Text('离线'),
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.menu_book_rounded),
                title: Text(
                  _manifest?.title.isNotEmpty == true
                      ? _manifest!.title
                      : _entry!.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  '已缓存 ${_entry!.cachedPages}/$_totalChapters 章',
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.builder(
                  itemCount: _totalChapters,
                  itemBuilder: (context, index) {
                    final cached =
                        cacheService.isChapterCached(widget.comicId, index);
                    return ListTile(
                      selected: index == _currentChapter,
                      enabled: cached,
                      leading: Icon(
                        cached
                            ? Icons.download_done_rounded
                            : Icons.cloud_download_outlined,
                        size: 20,
                      ),
                      title: Text(
                        _displayChapterTitle(index),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: cached ? null : const Text('未下载'),
                      onTap: cached
                          ? () {
                              Navigator.of(context).pop();
                              _loadChapter(index);
                            }
                          : null,
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
      body: Column(
        children: [
          if (_error != null)
            MaterialBanner(
              content: Text(_error!),
              leading: const Icon(Icons.info_outline_rounded),
              actions: [
                TextButton(
                  onPressed: () => setState(() => _error = null),
                  child: const Text('知道了'),
                ),
              ],
            ),
          Expanded(
            child: _chapterLoading
                ? const Center(child: CircularProgressIndicator())
                : SelectionArea(
                    child: ListView(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(24, 24, 24, 48),
                      children: [
                        Text(
                          _chapterTitle,
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 24),
                        Text(
                          _chapterContent,
                          style:
                              Theme.of(context).textTheme.bodyLarge?.copyWith(
                                    height: 1.9,
                                    letterSpacing: 0.3,
                                  ),
                        ),
                      ],
                    ),
                  ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border(
              top: BorderSide(
                color: Theme.of(context).dividerColor.withOpacity(0.4),
              ),
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed:
                      _chapterLoading ? null : _previousChapter,
                  icon: const Icon(Icons.chevron_left_rounded),
                  label: const Text('上一章'),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  '${_currentChapter + 1}/$_totalChapters',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _chapterLoading ? null : _nextChapter,
                  icon: const Icon(Icons.chevron_right_rounded),
                  label: const Text('下一章'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
