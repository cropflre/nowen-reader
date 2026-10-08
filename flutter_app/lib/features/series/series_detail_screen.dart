import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api/api_client.dart';
import '../../data/api/comic_api.dart';
import '../../data/api/tag_api.dart';
import '../../data/models/comic.dart';
import '../../data/providers/auth_provider.dart';
import '../../widgets/authenticated_image.dart';
import '../../widgets/work_tags.dart';

/// 目录作品详情页。
///
/// Web 与移动端的“系列”书架都由服务端 ComicSeries 模型驱动；
/// 本页展示 seriesView=true 返回的虚拟系列项对应的真实单册。
class SeriesDetailScreen extends ConsumerStatefulWidget {
  final String seriesId;

  const SeriesDetailScreen({super.key, required this.seriesId});

  @override
  ConsumerState<SeriesDetailScreen> createState() =>
      _SeriesDetailScreenState();
}

class _SeriesDetailScreenState extends ConsumerState<SeriesDetailScreen> {
  Map<String, dynamic>? _detail;
  bool _loading = true;
  bool _gridView = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final detail =
          await ref.read(comicApiProvider).getSeriesDetail(widget.seriesId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  List<_SeriesSectionView> _sections(Map<String, dynamic> detail) {
    final result = <_SeriesSectionView>[];
    final rawSections = detail['sections'];
    if (rawSections is List) {
      for (final raw in rawSections.whereType<Map>()) {
        final map = Map<String, dynamic>.from(raw);
        final items = _items(map['items']);
        if (items.isEmpty) continue;
        result.add(_SeriesSectionView(
          title: map['title']?.toString().trim().isNotEmpty == true
              ? map['title'].toString()
              : '篇章',
          subtitle: map['relativePath']?.toString() ?? '',
          items: items,
        ));
      }
    }

    final unsectioned = _items(detail['unsectioned']);
    if (unsectioned.isNotEmpty) {
      result.add(_SeriesSectionView(
        title: result.isEmpty ? '单册' : '未分篇',
        items: unsectioned,
      ));
    }
    return result;
  }

  List<_SeriesItemView> _items(dynamic rawItems) {
    if (rawItems is! List) return const [];
    final result = <_SeriesItemView>[];
    for (final raw in rawItems.whereType<Map>()) {
      final map = Map<String, dynamic>.from(raw);
      final comicRaw = map['comic'];
      if (comicRaw is! Map) continue;
      final comic = Comic.fromJson(Map<String, dynamic>.from(comicRaw));
      if (comic.id.isEmpty) continue;
      result.add(_SeriesItemView(
        comic: comic,
        displayLabel: map['displayLabel']?.toString() ?? '',
      ));
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final serverUrl = ref.watch(authProvider).serverUrl;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final detail = _detail;
    if (detail == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline_rounded, size: 48, color: cs.error),
                const SizedBox(height: 12),
                const Text('系列加载失败'),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      color: cs.onSurfaceVariant,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('重试'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final summaryRaw = detail['series'];
    final summary = summaryRaw is Map
        ? Map<String, dynamic>.from(summaryRaw)
        : <String, dynamic>{};
    final sections = _sections(detail);
    final title = summary['title']?.toString().trim().isNotEmpty == true
        ? summary['title'].toString()
        : '系列';

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              title: Text(title),
              actions: [
                IconButton(
                  tooltip: _gridView ? '列表视图' : '网格视图',
                  icon: Icon(_gridView
                      ? Icons.view_list_rounded
                      : Icons.grid_view_rounded),
                  onPressed: () => setState(() => _gridView = !_gridView),
                ),
              ],
            ),
            SliverToBoxAdapter(
              child: _overview(summary, serverUrl, cs),
            ),
            if (sections.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(child: Text('此系列暂无可显示单册')),
              )
            else
              for (final section in sections)
                ..._sectionSlivers(section, serverUrl, cs),
            const SliverToBoxAdapter(child: SizedBox(height: 28)),
          ],
        ),
      ),
    );
  }

  Widget _overview(
    Map<String, dynamic> summary,
    String serverUrl,
    ColorScheme cs,
  ) {
    final textTheme = Theme.of(context).textTheme;
    final title = summary['title']?.toString() ?? '系列';
    final author = summary['author']?.toString() ?? '';
    final publisher = summary['publisher']?.toString() ?? '';
    final description = summary['description']?.toString() ?? '';
    final status = summary['status']?.toString() ?? '';
    final language = summary['language']?.toString() ?? '';
    final itemCount = _asInt(summary['itemCount']);
    final completed = _asInt(summary['completedItemCount']);
    final sectionCount = _asInt(summary['sectionCount']);
    final totalReadTime = _asInt(summary['totalReadTime']);
    final year = summary['year'];
    final coverUrl = summary['coverUrl']?.toString() ?? '';
    final tags = <String>[
      if (summary['tags'] is List)
        ...(summary['tags'] as List)
            .whereType<Map>()
            .map((tag) => tag['name']?.toString() ?? '')
            .where((name) => name.isNotEmpty),
    ];
    final progress = itemCount > 0
        ? (completed / itemCount).clamp(0.0, 1.0).toDouble()
        : 0.0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  width: 104,
                  height: 146,
                  child: coverUrl.isEmpty
                      ? _placeholder(cs)
                      : AuthenticatedImage(
                          imageUrl: _resolveUrl(serverUrl, coverUrl),
                          fit: BoxFit.cover,
                          errorWidget: _placeholder(cs),
                        ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (author.isNotEmpty) ...[
                      const SizedBox(height: 5),
                      Text(
                        author,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: cs.onSurfaceVariant),
                      ),
                    ],
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        _chip('$itemCount 册', cs),
                        if (sectionCount > 0) _chip('$sectionCount 篇', cs),
                        if (status.isNotEmpty) _chip(status, cs),
                        if (year != null) _chip('$year 年', cs),
                        if (language.isNotEmpty) _chip(language, cs),
                      ],
                    ),
                    if (publisher.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text(
                        '出版：$publisher',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          color: cs.onSurfaceVariant,
                        ),
                      ),
                    ],
                    if (totalReadTime > 0)
                      Text(
                        '阅读：${_formatDuration(totalReadTime)}',
                        style: TextStyle(
                          fontSize: 12,
                          color: cs.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (itemCount > 0) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: LinearProgressIndicator(
                    minHeight: 5,
                    value: progress,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '$completed / $itemCount',
                  style: TextStyle(
                    fontSize: 11,
                    color: cs.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ],
          if (description.isNotEmpty) ...[
            const SizedBox(height: 14),
            Text(
              description,
              maxLines: 5,
              overflow: TextOverflow.ellipsis,
              style: textTheme.bodyMedium?.copyWith(
                height: 1.5,
                color: cs.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 12),
          WorkTags(
            tags: tags,
            canEdit: summary['canManage'] == true,
            onSave: (names) async {
              final saved = await ref.read(tagApiProvider)
                  .setSeriesTags(widget.seriesId, names);
              if (!mounted) return;
              setState(() {
                _detail = {...?_detail, 'series': {...summary, 'tags': saved}};
              });
            },
          ),
        ],
      ),
    );
  }

  List<Widget> _sectionSlivers(
    _SeriesSectionView section,
    String serverUrl,
    ColorScheme cs,
  ) {
    return [
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
          child: Row(
            children: [
              Icon(Icons.folder_copy_outlined, size: 18, color: cs.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${section.title} (${section.items.length})',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    if (section.subtitle.isNotEmpty)
                      Text(
                        section.subtitle,
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
            ],
          ),
        ),
      ),
      if (_gridView)
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          sliver: SliverGrid(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: _gridColumns(context),
              childAspectRatio: 0.62,
              crossAxisSpacing: 8,
              mainAxisSpacing: 10,
            ),
            delegate: SliverChildBuilderDelegate(
              (context, index) =>
                  _gridItem(section.items[index], serverUrl, cs),
              childCount: section.items.length,
            ),
          ),
        )
      else
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          sliver: SliverList(
            delegate: SliverChildBuilderDelegate(
              (context, index) =>
                  _listItem(section.items[index], serverUrl, cs),
              childCount: section.items.length,
            ),
          ),
        ),
      const SliverToBoxAdapter(child: SizedBox(height: 16)),
    ];
  }

  Widget _gridItem(
    _SeriesItemView item,
    String serverUrl,
    ColorScheme cs,
  ) {
    final comic = item.comic;
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () => context.push('/comic/${comic.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(9),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  AuthenticatedImage(
                    imageUrl: _comicCoverUrl(serverUrl, comic),
                    fit: BoxFit.cover,
                    errorWidget: _placeholder(cs),
                  ),
                  if (comic.progress > 0)
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: LinearProgressIndicator(
                        minHeight: 4,
                        value: comic.progress / 100,
                        backgroundColor: Colors.black38,
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 5),
          Text(
            item.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
          ),
          if (comic.pageCount > 0)
            Text(
              '${comic.pageCount} 页',
              style: TextStyle(
                fontSize: 10,
                color: cs.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }

  Widget _listItem(
    _SeriesItemView item,
    String serverUrl,
    ColorScheme cs,
  ) {
    final comic = item.comic;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/comic/${comic.id}'),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: SizedBox(
                  width: 44,
                  height: 62,
                  child: AuthenticatedImage(
                    imageUrl: _comicCoverUrl(serverUrl, comic),
                    fit: BoxFit.cover,
                    errorWidget: _placeholder(cs),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        if (comic.pageCount > 0) '${comic.pageCount} 页',
                        if (comic.fileSize > 0) _formatFileSize(comic.fileSize),
                        if (comic.progress > 0) '${comic.progress}%',
                      ].join(' · '),
                      style: TextStyle(
                        fontSize: 11,
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: cs.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }

  String _comicCoverUrl(String serverUrl, Comic comic) {
    final cover = comic.coverImageUrl?.trim() ?? '';
    if (cover.isNotEmpty) return _resolveUrl(serverUrl, cover);
    return getImageUrl(serverUrl, comic.id, thumbnail: true);
  }

  String _resolveUrl(String serverUrl, String value) {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }
    final clean =
        serverUrl.endsWith('/') ? serverUrl.substring(0, serverUrl.length - 1) : serverUrl;
    return '$clean${value.startsWith('/') ? value : '/$value'}';
  }

  Widget _placeholder(ColorScheme cs) {
    return Container(
      color: cs.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(
        Icons.auto_stories_outlined,
        color: cs.onSurfaceVariant.withOpacity(0.45),
      ),
    );
  }

  Widget _chip(String label, ColorScheme cs) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: cs.primaryContainer.withOpacity(0.55),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, color: cs.onPrimaryContainer),
      ),
    );
  }

  int _gridColumns(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    if (width > 900) return 6;
    if (width > 600) return 4;
    if (width > 400) return 3;
    return 2;
  }

  int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  String _formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    }
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }

  String _formatDuration(int seconds) {
    if (seconds < 60) return '$seconds 秒';
    if (seconds < 3600) return '${seconds ~/ 60} 分钟';
    final hours = seconds ~/ 3600;
    final minutes = (seconds % 3600) ~/ 60;
    return minutes == 0 ? '$hours 小时' : '$hours 小时 $minutes 分钟';
  }
}

class _SeriesSectionView {
  final String title;
  final String subtitle;
  final List<_SeriesItemView> items;

  const _SeriesSectionView({
    required this.title,
    this.subtitle = '',
    required this.items,
  });
}

class _SeriesItemView {
  final Comic comic;
  final String displayLabel;

  const _SeriesItemView({
    required this.comic,
    required this.displayLabel,
  });

  String get title =>
      displayLabel.trim().isNotEmpty ? displayLabel.trim() : comic.title;
}
