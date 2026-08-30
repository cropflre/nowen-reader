import 'dart:async';

import 'package:flutter/material.dart';
import 'novel_settings.dart';

// ============================================================
// 目录 + 书签 面板（左侧抽屉）
// ============================================================

class TOCBookmarkPanel extends StatefulWidget {
  final NovelSettings settings;
  final List<Map<String, dynamic>> chapters;
  final int currentChapter;
  final List<NovelBookmark> bookmarks;
  final ValueChanged<int> onGoToChapter;
  final ValueChanged<NovelBookmark> onGoToBookmark;
  final VoidCallback onClose;
  final VoidCallback onAddBookmark;
  final ValueChanged<NovelBookmark> onEditBookmark;
  final ValueChanged<String> onRemoveBookmark;
  final int initialTabIndex;

  const TOCBookmarkPanel({
    super.key,
    required this.settings,
    required this.chapters,
    required this.currentChapter,
    required this.bookmarks,
    required this.onGoToChapter,
    required this.onGoToBookmark,
    required this.onClose,
    required this.onAddBookmark,
    required this.onEditBookmark,
    required this.onRemoveBookmark,
    this.initialTabIndex = 0,
  });

  @override
  State<TOCBookmarkPanel> createState() => _TOCBookmarkPanelState();
}

class _TOCBookmarkPanelState extends State<TOCBookmarkPanel>
    with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(
      length: 2,
      vsync: this,
      initialIndex: widget.initialTabIndex.clamp(0, 1),
    );
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.settings;
    final primary = Theme.of(context).colorScheme.primary;

    return GestureDetector(
      onTap: () {}, // 防止穿透
      child: Material(
        color: s.backgroundColor,
        elevation: 8,
        child: SafeArea(
          child: Column(
            children: [
              // Tab 头部
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 8, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: TabBar(
                        controller: _tabCtrl,
                        labelColor: primary,
                        unselectedLabelColor: s.secondaryTextColor,
                        indicatorColor: primary,
                        indicatorSize: TabBarIndicatorSize.label,
                        labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                        unselectedLabelStyle: const TextStyle(fontSize: 13),
                        tabs: [
                          Tab(text: '目录 (${widget.chapters.length})'),
                          Tab(text: '书签 (${widget.bookmarks.length})'),
                        ],
                      ),
                    ),
                    // 添加当前阅读位置书签
                    IconButton(
                      icon: Icon(Icons.bookmark_add_outlined,
                          color: s.secondaryTextColor, size: 20),
                      onPressed: widget.onAddBookmark,
                      tooltip: '添加书签',
                    ),
                    IconButton(
                      icon: Icon(Icons.close, color: s.secondaryTextColor, size: 20),
                      onPressed: widget.onClose,
                    ),
                  ],
                ),
              ),
              Divider(color: s.secondaryTextColor.withAlpha(40)),
              // Tab 内容
              Expanded(
                child: TabBarView(
                  controller: _tabCtrl,
                  children: [
                    _buildTOCList(s, primary),
                    _buildBookmarkList(s, primary),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTOCList(NovelSettings s, Color primary) {
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      itemCount: widget.chapters.length,
      itemBuilder: (context, index) {
        final chapter = widget.chapters[index];
        final isActive = index == widget.currentChapter;
        final title = chapter['title'] as String? ??
            chapter['name'] as String? ??
            '第${index + 1}章';
        final hasBookmark =
            widget.bookmarks.any((b) => b.chapterIndex == index);
        return ListTile(
          dense: true,
          selected: isActive,
          selectedTileColor: primary.withAlpha(20),
          contentPadding: const EdgeInsets.symmetric(horizontal: 12),
          title: Row(
            children: [
              Text(
                '${index + 1}. ',
                style: TextStyle(
                  color: s.secondaryTextColor.withAlpha(120),
                  fontSize: 11,
                ),
              ),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: isActive ? primary : s.textColor,
                    fontSize: 13,
                    fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (hasBookmark)
                const Icon(Icons.bookmark, size: 14, color: Colors.amber),
            ],
          ),
          onTap: () => widget.onGoToChapter(index),
        );
      },
    );
  }

  Widget _buildBookmarkList(NovelSettings s, Color primary) {
    if (widget.bookmarks.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bookmark_border, size: 40, color: s.secondaryTextColor.withAlpha(80)),
            const SizedBox(height: 8),
            Text('暂无书签', style: TextStyle(color: s.secondaryTextColor, fontSize: 13)),
            const SizedBox(height: 4),
            Text('点击标题栏的书签图标添加',
                style: TextStyle(color: s.secondaryTextColor.withAlpha(120), fontSize: 11)),
          ],
        ),
      );
    }

    final sorted = List<NovelBookmark>.from(widget.bookmarks)
      ..sort((a, b) {
        final chapterOrder = a.chapterIndex.compareTo(b.chapterIndex);
        if (chapterOrder != 0) return chapterOrder;
        final positionOrder = a.positionRatio.compareTo(b.positionRatio);
        if (positionOrder != 0) return positionOrder;
        return a.timestamp.compareTo(b.timestamp);
      });

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      itemCount: sorted.length,
      itemBuilder: (context, index) {
        final bm = sorted[index];
        final isActive = bm.chapterIndex == widget.currentChapter;
        return Dismissible(
          key: ValueKey(bm.id),
          direction: DismissDirection.endToStart,
          background: Container(
            alignment: Alignment.centerRight,
            padding: const EdgeInsets.only(right: 16),
            color: Colors.red.withAlpha(40),
            child: const Icon(Icons.delete, color: Colors.red, size: 20),
          ),
          onDismissed: (_) => widget.onRemoveBookmark(bm.id),
          child: ListTile(
            dense: true,
            selected: isActive,
            selectedTileColor: primary.withAlpha(20),
            leading: const Icon(Icons.bookmark, color: Colors.amber, size: 18),
            title: Text(
              bm.displayTitle,
              style: TextStyle(
                color: isActive ? primary : s.textColor,
                fontSize: 13,
                fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (bm.note.trim().isNotEmpty)
                  Text(
                    bm.note.trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: s.secondaryTextColor, fontSize: 11),
                  ),
                Text(
                  '${bm.chapterTitle} · 章内 ${(bm.positionRatio * 100).round()}% · ${_formatDate(bm.timestamp)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: s.secondaryTextColor, fontSize: 10),
                ),
              ],
            ),
            trailing: IconButton(
              icon: Icon(Icons.edit_outlined,
                  size: 17, color: s.secondaryTextColor),
              tooltip: '编辑书签',
              onPressed: () => widget.onEditBookmark(bm),
            ),
            onTap: () => widget.onGoToBookmark(bm),
          ),
        );
      },
    );
  }

  String _formatDate(int ts) {
    final d = DateTime.fromMillisecondsSinceEpoch(ts);
    return '${d.month}/${d.day} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}

// ============================================================
// 排版设置面板（底部弹出）
// ============================================================

class SettingsPanel extends StatelessWidget {
  final NovelSettings settings;
  final ValueChanged<NovelSettings> onChanged;
  final VoidCallback onClose;

  const SettingsPanel({
    super.key,
    required this.settings,
    required this.onChanged,
    required this.onClose,
  });

  static const _themeOptions = [
    (NovelTheme.night, '深色', Color(0xFF18181B)),
    (NovelTheme.day, '米黄', Color(0xFFFFFBEB)),
    (NovelTheme.green, '豆沙绿', Color(0xFFC7EDCC)),
    (NovelTheme.gray, '浅灰', Color(0xFFE0E0E0)),
    (NovelTheme.white, '纯白', Color(0xFFFFFFFF)),
  ];

  static const _fontOptions = [
    (NovelFont.system, '系统'),
    (NovelFont.serif, '宋体'),
    (NovelFont.sans, '黑体'),
    (NovelFont.kai, '楷体'),
    (NovelFont.mono, '等宽'),
  ];

  static const _paddingOptions = [
    (NovelPadding.compact, '紧凑'),
    (NovelPadding.standard, '标准'),
    (NovelPadding.wide, '宽松'),
  ];

  static const _pageModeOptions = [
    (NovelPageMode.scroll, '上下滚动'),
    (NovelPageMode.swipe, '左右翻页'),
  ];

  @override
  Widget build(BuildContext context) {
    final isDark = settings.isDark;
    final panelBg = isDark ? const Color(0xFF27272A) : const Color(0xFFF5F5F5);
    final textColor = isDark ? Colors.white70 : Colors.black87;
    final labelColor = isDark ? Colors.white54 : Colors.black54;
    final primary = Theme.of(context).colorScheme.primary;

    return GestureDetector(
      onTap: () {}, // 防止穿透
      child: Material(
        color: panelBg,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        elevation: 8,
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 拖拽把手
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: isDark ? Colors.white24 : Colors.black12,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // 主题色
                _buildLabel('主题', labelColor),
                const SizedBox(height: 8),
                Row(
                  children: _themeOptions.map((t) {
                    final isSelected = settings.theme == t.$1;
                    return Padding(
                      padding: const EdgeInsets.only(right: 12),
                      child: GestureDetector(
                        onTap: () => onChanged(settings.copyWith(theme: t.$1)),
                        child: Column(
                          children: [
                            Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: t.$3,
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: isSelected ? primary : (isDark ? Colors.white24 : Colors.black12),
                                  width: isSelected ? 2.5 : 1,
                                ),
                                boxShadow: isSelected
                                    ? [BoxShadow(color: primary.withAlpha(60), blurRadius: 6)]
                                    : null,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              t.$2,
                              style: TextStyle(
                                fontSize: 10,
                                color: isSelected ? primary : labelColor,
                                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 16),

                // 字号
                _buildLabel('字号: ${settings.fontSize.toInt()}px', labelColor),
                const SizedBox(height: 4),
                Row(
                  children: [
                    _buildIconBtn(Icons.remove, textColor, isDark,
                        settings.fontSize > 12
                            ? () => onChanged(settings.copyWith(fontSize: settings.fontSize - 1))
                            : null),
                    Expanded(
                      child: Slider(
                        value: settings.fontSize,
                        min: 12,
                        max: 32,
                        onChanged: (v) => onChanged(settings.copyWith(fontSize: v)),
                      ),
                    ),
                    _buildIconBtn(Icons.add, textColor, isDark,
                        settings.fontSize < 32
                            ? () => onChanged(settings.copyWith(fontSize: settings.fontSize + 1))
                            : null),
                  ],
                ),

                // 行距
                _buildLabel('行距: ${settings.lineHeight.toStringAsFixed(1)}', labelColor),
                const SizedBox(height: 4),
                Row(
                  children: [
                    _buildIconBtn(Icons.remove, textColor, isDark,
                        settings.lineHeight > 1.2
                            ? () => onChanged(settings.copyWith(lineHeight: settings.lineHeight - 0.2))
                            : null),
                    Expanded(
                      child: Slider(
                        value: settings.lineHeight,
                        min: 1.2,
                        max: 3.0,
                        divisions: 9,
                        onChanged: (v) => onChanged(settings.copyWith(lineHeight: v)),
                      ),
                    ),
                    _buildIconBtn(Icons.add, textColor, isDark,
                        settings.lineHeight < 3.0
                            ? () => onChanged(settings.copyWith(lineHeight: settings.lineHeight + 0.2))
                            : null),
                  ],
                ),
                const SizedBox(height: 12),

                // 页边距
                _buildLabel('页边距', labelColor),
                const SizedBox(height: 8),
                _buildChips<NovelPadding>(
                  _paddingOptions, settings.padding, primary, textColor, isDark,
                  (v) => onChanged(settings.copyWith(padding: v)),
                ),
                const SizedBox(height: 12),

                // 翻页模式
                _buildLabel('翻页模式', labelColor),
                const SizedBox(height: 8),
                _buildChips<NovelPageMode>(
                  _pageModeOptions, settings.pageMode, primary, textColor, isDark,
                  (v) => onChanged(settings.copyWith(pageMode: v)),
                ),
                const SizedBox(height: 12),

                // 自动滚动速度
                _buildLabel('自动翻页速度', labelColor),
                const SizedBox(height: 8),
                _buildChips<int>(
                  [(1, '慢速'), (2, '中速'), (3, '快速')],
                  settings.autoScrollSpeed, primary, textColor, isDark,
                  (v) => onChanged(settings.copyWith(autoScrollSpeed: v)),
                ),
                const SizedBox(height: 12),

                // 字体
                _buildLabel('字体', labelColor),
                const SizedBox(height: 8),
                _buildChips<NovelFont>(
                  _fontOptions, settings.font, primary, textColor, isDark,
                  (v) => onChanged(settings.copyWith(font: v)),
                ),
                const SizedBox(height: 16),

                // 完成按钮
                Center(
                  child: TextButton(
                    onPressed: onClose,
                    child: const Text('完成'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLabel(String text, Color color) {
    return Text(text, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w500));
  }

  Widget _buildIconBtn(IconData icon, Color color, bool isDark, VoidCallback? onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: isDark ? Colors.white10 : Colors.black.withAlpha(8),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, size: 18, color: onTap != null ? color : color.withAlpha(60)),
      ),
    );
  }

  Widget _buildChips<T>(
    List<(T, String)> options,
    T selected,
    Color primary,
    Color textColor,
    bool isDark,
    ValueChanged<T> onSelected,
  ) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: options.map((opt) {
        final isActive = opt.$1 == selected;
        return GestureDetector(
          onTap: () => onSelected(opt.$1),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(
              color: isActive
                  ? primary.withAlpha(30)
                  : (isDark ? Colors.white10 : Colors.black.withAlpha(8)),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: isActive ? primary.withAlpha(100) : Colors.transparent,
              ),
            ),
            child: Text(
              opt.$2,
              style: TextStyle(
                fontSize: 12,
                color: isActive ? primary : textColor,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

// ============================================================
// 全书搜索面板（右侧抽屉）
// ============================================================

class SearchPanel extends StatefulWidget {
  final NovelSettings settings;
  final List<Map<String, dynamic>> chapters;
  final int currentChapter;
  final String comicId;
  final ValueChanged<int> onGoToChapter;
  final VoidCallback onClose;
  final Future<String> Function(int chapterIndex) getChapterContent;

  const SearchPanel({
    super.key,
    required this.settings,
    required this.chapters,
    required this.currentChapter,
    required this.comicId,
    required this.onGoToChapter,
    required this.onClose,
    required this.getChapterContent,
  });

  @override
  State<SearchPanel> createState() => _SearchPanelState();
}

class _SearchPanelState extends State<SearchPanel> {
  final _ctrl = TextEditingController();
  final _focusNode = FocusNode();
  List<SearchResult> _results = [];
  bool _loading = false;
  double _progress = 0;
  bool _cancelled = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focusNode.dispose();
    _cancelled = true;
    super.dispose();
  }

  Future<void> _doSearch(String query) async {
    if (query.trim().isEmpty) return;
    setState(() {
      _loading = true;
      _progress = 0;
      _results = [];
      _cancelled = false;
    });

    final q = query.trim().toLowerCase();
    final results = <SearchResult>[];

    for (int i = 0; i < widget.chapters.length; i++) {
      if (_cancelled) break;
      setState(() => _progress = (i + 1) / widget.chapters.length);

      try {
        final content = await widget.getChapterContent(i);
        final lower = content.toLowerCase();
        int count = 0;
        int pos = 0;
        String? firstMatch;
        while ((pos = lower.indexOf(q, pos)) != -1) {
          if (firstMatch == null) {
            // 取匹配上下文
            final start = (pos - 30).clamp(0, content.length);
            final end = (pos + q.length + 50).clamp(0, content.length);
            firstMatch = '...${content.substring(start, end)}...';
          }
          count++;
          pos += q.length;
        }
        if (count > 0) {
          final title = widget.chapters[i]['title'] as String? ??
              widget.chapters[i]['name'] as String? ??
              '第${i + 1}章';
          results.add(SearchResult(
            chapterIndex: i,
            chapterTitle: title,
            matchText: firstMatch ?? '',
            matchCount: count,
          ));
        }
      } catch (_) {}
    }

    if (mounted && !_cancelled) {
      setState(() {
        _results = results;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.settings;
    final primary = Theme.of(context).colorScheme.primary;

    return GestureDetector(
      onTap: () {}, // 防止穿透
      child: Material(
        color: s.backgroundColor,
        elevation: 8,
        child: SafeArea(
          child: Column(
            children: [
              // 搜索头部
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 8, 8),
                child: Row(
                  children: [
                    // 搜索框
                    Expanded(
                      child: Container(
                        height: 40,
                        decoration: BoxDecoration(
                          color: s.isDark ? Colors.white10 : Colors.black.withAlpha(8),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        child: Row(
                          children: [
                            Icon(Icons.search, size: 18, color: s.secondaryTextColor),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextField(
                                controller: _ctrl,
                                focusNode: _focusNode,
                                style: TextStyle(
                                    color: s.textColor, fontSize: 14),
                                decoration: InputDecoration(
                                  hintText: '搜索全书内容...',
                                  hintStyle: TextStyle(
                                      color: s.secondaryTextColor, fontSize: 13),
                                  border: InputBorder.none,
                                  isDense: true,
                                  contentPadding: EdgeInsets.zero,
                                ),
                                onSubmitted: _doSearch,
                              ),
                            ),
                            if (_ctrl.text.isNotEmpty)
                              GestureDetector(
                                onTap: () {
                                  _ctrl.clear();
                                  setState(() => _results = []);
                                },
                                child: Icon(Icons.close,
                                    size: 16, color: s.secondaryTextColor),
                              ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // 搜索/取消按钮
                    GestureDetector(
                      onTap: () {
                        if (_loading) {
                          setState(() => _cancelled = true);
                        } else {
                          _doSearch(_ctrl.text);
                        }
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: _loading ? Colors.red : primary,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          _loading ? '取消' : '搜索',
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12),
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    IconButton(
                      icon: Icon(Icons.close,
                          size: 20, color: s.secondaryTextColor),
                      onPressed: widget.onClose,
                    ),
                  ],
                ),
              ),
              // 进度条
              if (_loading)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Column(
                    children: [
                      LinearProgressIndicator(value: _progress),
                      const SizedBox(height: 4),
                      Text(
                        '正在搜索全书内容... ${(_progress * 100).toInt()}%',
                        style: TextStyle(
                            fontSize: 10, color: s.secondaryTextColor),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 4),
              // 结果列表
              Expanded(
                child: _buildResultList(s, primary),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildResultList(NovelSettings s, Color primary) {
    if (_loading) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: primary),
            const SizedBox(height: 12),
            Text('共 ${widget.chapters.length} 章',
                style: TextStyle(fontSize: 11, color: s.secondaryTextColor)),
          ],
        ),
      );
    }

    if (_results.isEmpty && _ctrl.text.isNotEmpty && !_loading) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off, size: 40,
                color: s.secondaryTextColor.withAlpha(80)),
            const SizedBox(height: 8),
            Text('未找到匹配结果',
                style: TextStyle(fontSize: 13, color: s.secondaryTextColor)),
          ],
        ),
      );
    }

    if (_results.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search, size: 40,
                color: s.secondaryTextColor.withAlpha(60)),
            const SizedBox(height: 8),
            Text('输入关键词搜索全书内容',
                style: TextStyle(fontSize: 12, color: s.secondaryTextColor.withAlpha(120))),
          ],
        ),
      );
    }

    final totalMatches =
        _results.fold<int>(0, (sum, r) => sum + r.matchCount);
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      children: [
        Padding(
          padding: const EdgeInsets.all(8),
          child: Text(
            '找到 $totalMatches 处匹配，分布在 ${_results.length} 个章节',
            style: TextStyle(fontSize: 10, color: s.secondaryTextColor),
          ),
        ),
        ..._results.map((r) {
          final isActive = r.chapterIndex == widget.currentChapter;
          return ListTile(
            dense: true,
            selected: isActive,
            selectedTileColor: primary.withAlpha(20),
            title: Row(
              children: [
                Expanded(
                  child: Text(
                    r.chapterTitle,
                    style: TextStyle(
                      fontSize: 13,
                      color: isActive ? primary : s.textColor,
                      fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: primary.withAlpha(25),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${r.matchCount}处',
                    style: TextStyle(fontSize: 9, color: primary),
                  ),
                ),
              ],
            ),
            subtitle: Text(
              r.matchText,
              style: TextStyle(fontSize: 11, color: s.secondaryTextColor),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            onTap: () => widget.onGoToChapter(r.chapterIndex),
          );
        }),
      ],
    );
  }
}

// ============================================================
// TTS 听书控制面板
// ============================================================

class TTSControlPanel extends StatelessWidget {
  final NovelSettings settings;
  final bool isPaused;
  final double rate;
  final VoidCallback onTogglePause;
  final VoidCallback onStop;
  final ValueChanged<double> onRateChanged;
  final VoidCallback onClose;

  const TTSControlPanel({
    super.key,
    required this.settings,
    required this.isPaused,
    required this.rate,
    required this.onTogglePause,
    required this.onStop,
    required this.onRateChanged,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = settings.isDark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: isDark
            ? const Color(0xFF27272A).withAlpha(240)
            : Colors.white.withAlpha(240),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark ? Colors.white10 : Colors.black12,
        ),
        boxShadow: const [
          BoxShadow(color: Colors.black26, blurRadius: 12, offset: Offset(0, 4)),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 播放/暂停
          _circleBtn(
            isPaused ? Icons.play_arrow : Icons.pause,
            isDark ? Colors.white : Colors.black87,
            isDark,
            onTogglePause,
          ),
          const SizedBox(width: 4),
          // 停止
          _circleBtn(Icons.stop, Colors.red, isDark, onStop),
          Container(
            width: 1,
            height: 24,
            margin: const EdgeInsets.symmetric(horizontal: 8),
            color: isDark ? Colors.white12 : Colors.black12,
          ),
          // 语速
          Text('语速',
              style: TextStyle(
                  fontSize: 10,
                  color: isDark ? Colors.white38 : Colors.black38)),
          const SizedBox(width: 4),
          ...[0.5, 0.8, 1.0, 1.5, 2.0].map((r) {
            final isActive = rate == r;
            return GestureDetector(
              onTap: () => onRateChanged(r),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                margin: const EdgeInsets.only(right: 2),
                decoration: BoxDecoration(
                  color: isActive
                      ? Theme.of(context).colorScheme.primary.withAlpha(30)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '${r}x',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                    color: isActive
                        ? Theme.of(context).colorScheme.primary
                        : (isDark ? Colors.white54 : Colors.black54),
                  ),
                ),
              ),
            );
          }),
          const SizedBox(width: 4),
          GestureDetector(
            onTap: onClose,
            child: Icon(Icons.close,
                size: 16, color: isDark ? Colors.white38 : Colors.black38),
          ),
        ],
      ),
    );
  }

  Widget _circleBtn(
      IconData icon, Color color, bool isDark, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: isDark ? Colors.white10 : Colors.black.withAlpha(8),
        ),
        child: Icon(icon, size: 18, color: color),
      ),
    );
  }
}
