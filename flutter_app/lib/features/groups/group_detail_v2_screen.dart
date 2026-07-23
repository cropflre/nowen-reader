import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api/api_client.dart';
import '../../data/api/comic_api.dart';
import '../../data/models/comic.dart';
import '../../data/providers/auth_provider.dart';
import '../../widgets/authenticated_image.dart';

/// 合集详情页。
///
/// 后端合集可以同时包含直接加入的散本（comics）和目录系列
///（seriesList）。旧版页面只读取 comics，导致合集数量正确但内容为空。
class GroupDetailV2Screen extends ConsumerStatefulWidget {
  final int groupId;

  const GroupDetailV2Screen({super.key, required this.groupId});

  @override
  ConsumerState<GroupDetailV2Screen> createState() =>
      _GroupDetailV2ScreenState();
}

class _GroupDetailV2ScreenState
    extends ConsumerState<GroupDetailV2Screen> {
  Map<String, dynamic>? _detail;
  bool _loading = true;
  bool _gridView = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final detail =
          await ref.read(comicApiProvider).getGroupDetail(widget.groupId);
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

  List<Comic> _parseComics(dynamic value) {
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((item) => Comic.fromJson(Map<String, dynamic>.from(item)))
        .where((comic) => comic.id.isNotEmpty)
        .toList();
  }

  List<_GroupSection> _parseSections(Map<String, dynamic> detail) {
    final sections = <_GroupSection>[];
    final directComics = _parseComics(detail['comics']);
    if (directComics.isNotEmpty) {
      sections.add(_GroupSection(
        title: '散本',
        icon: Icons.menu_book_outlined,
        comics: directComics,
      ));
    }

    final rawSeries = detail['seriesList'];
    if (rawSeries is List) {
      for (final raw in rawSeries.whereType<Map>()) {
        final data = Map<String, dynamic>.from(raw);
        final comics = _parseComics(data['comics']);
        if (comics.isEmpty) continue;
        sections.add(_GroupSection(
          id: data['id']?.toString() ?? '',
          title: data['title']?.toString().trim().isNotEmpty == true
              ? data['title'].toString()
              : '目录系列',
          subtitle: data['rootRelativePath']?.toString() ?? '',
          icon: Icons.folder_copy_outlined,
          comics: comics,
        ));
      }
    }
    return sections;
  }

  List<Comic> _uniqueComics(List<_GroupSection> sections) {
    final result = <Comic>[];
    final seen = <String>{};
    for (final section in sections) {
      for (final comic in section.comics) {
        if (seen.add(comic.id)) result.add(comic);
      }
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
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
                Icon(Icons.error_outline_rounded,
                    size: 48, color: colorScheme.error),
                const SizedBox(height: 12),
                const Text('合集加载失败'),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      color: colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _loadDetail,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('重试'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final sections = _parseSections(detail);
    final allComics = _uniqueComics(sections);
    final name = detail['name']?.toString() ?? '合集';
    final serverCount = detail['comicCount'];
    final comicCount = serverCount is num
        ? serverCount.toInt()
        : allComics.length;
    final totalPages =
        allComics.fold<int>(0, (sum, comic) => sum + comic.pageCount);
    final totalSize =
        allComics.fold<int>(0, (sum, comic) => sum + comic.fileSize);
    final totalReadTime = allComics.fold<int>(
        0, (sum, comic) => sum + comic.totalReadTime);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _loadDetail,
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              title: Text(name),
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
              child: _buildOverview(
                detail: detail,
                comics: allComics,
                serverUrl: serverUrl,
                comicCount: comicCount,
                totalPages: totalPages,
                totalSize: totalSize,
                totalReadTime: totalReadTime,
              ),
            ),
            if (sections.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(child: Text('此合集暂无可显示内容')),
              )
            else
              for (final section in sections) ...
                _buildSectionSlivers(
                  section,
                  serverUrl,
                  colorScheme,
                ),
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
          ],
        ),
      ),
    );
  }

  Widget _buildOverview({
    required Map<String, dynamic> detail,
    required List<Comic> comics,
    required String serverUrl,
    required int comicCount,
    required int totalPages,
    required int totalSize,
    required int totalReadTime,
  }) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final coverUrl = detail['coverUrl']?.toString() ?? '';
    final author = detail['author']?.toString() ?? '';
    final publisher = detail['publisher']?.toString() ?? '';
    final description = detail['description']?.toString() ?? '';
    final genre = detail['genre']?.toString() ?? '';
    final language = detail['language']?.toString() ?? '';
    final status = detail['status']?.toString() ?? '';
    final year = detail['year'];
    final tags = (detail['tags']?.toString() ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .where((tag) => tag.isNotEmpty)
        .toList();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  width: 112,
                  height: 158,
                  child: _buildCover(
                    coverUrl,
                    comics,
                    serverUrl,
                    colorScheme,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      detail['name']?.toString() ?? '合集',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (status.isNotEmpty) _chip(status),
                        if (language.isNotEmpty) _chip(language),
                        if (year != null) _chip('$year 年'),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 12,
                      runSpacing: 8,
                      children: [
                        _stat(Icons.menu_book_outlined, '$comicCount 本'),
                        _stat(Icons.description_outlined, '$totalPages 页'),
                        _stat(Icons.storage_outlined,
                            _formatFileSize(totalSize)),
                        if (totalReadTime > 0)
                          _stat(Icons.schedule_outlined,
                              _formatDuration(totalReadTime)),
                      ],
                    ),
                    if (author.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text('作者：$author',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    ],
                    if (publisher.isNotEmpty)
                      Text('出版：$publisher',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    if (genre.isNotEmpty)
                      Text('类型：$genre',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
            ],
          ),
          if (description.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
              description,
              maxLines: 5,
              overflow: TextOverflow.ellipsis,
              style: textTheme.bodyMedium?.copyWith(
                height: 1.5,
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          if (tags.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: tags.map(_chip).toList(),
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _buildSectionSlivers(
    _GroupSection section,
    String serverUrl,
    ColorScheme colorScheme,
  ) {
    return [
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
          child: Row(
            children: [
              Icon(section.icon, size: 19, color: colorScheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${section.title} (${section.comics.length})',
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
                          color: colorScheme.onSurfaceVariant,
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
              (context, index) => _comicGridCard(
                section.comics[index],
                serverUrl,
                colorScheme,
              ),
              childCount: section.comics.length,
            ),
          ),
        )
      else
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          sliver: SliverList(
            delegate: SliverChildBuilderDelegate(
              (context, index) => _comicListCard(
                section.comics[index],
                serverUrl,
                colorScheme,
              ),
              childCount: section.comics.length,
            ),
          ),
        ),
      const SliverToBoxAdapter(child: SizedBox(height: 16)),
    ];
  }

  Widget _comicGridCard(
    Comic comic,
    String serverUrl,
    ColorScheme colorScheme,
  ) {
    final imageUrl = getImageUrl(serverUrl, comic.id, thumbnail: true);
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
                    imageUrl: imageUrl,
                    fit: BoxFit.cover,
                    errorWidget: _placeholder(colorScheme),
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
            comic.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
          ),
          if (comic.pageCount > 0)
            Text(
              comic.isNovel
                  ? '${comic.pageCount} 章'
                  : '${comic.pageCount} 页',
              style: TextStyle(
                fontSize: 10,
                color: colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }

  Widget _comicListCard(
    Comic comic,
    String serverUrl,
    ColorScheme colorScheme,
  ) {
    final imageUrl = getImageUrl(serverUrl, comic.id, thumbnail: true);
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
                    imageUrl: imageUrl,
                    fit: BoxFit.cover,
                    errorWidget: _placeholder(colorScheme),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      comic.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        if (comic.pageCount > 0)
                          comic.isNovel
                              ? '${comic.pageCount} 章'
                              : '${comic.pageCount} 页',
                        if (comic.fileSize > 0)
                          _formatFileSize(comic.fileSize),
                      ].join(' · '),
                      style: TextStyle(
                        fontSize: 11,
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (comic.progress > 0) ...[
                      const SizedBox(height: 7),
                      LinearProgressIndicator(
                        minHeight: 4,
                        value: comic.progress / 100,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right_rounded,
                  color: colorScheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCover(
    String coverUrl,
    List<Comic> comics,
    String serverUrl,
    ColorScheme colorScheme,
  ) {
    String? imageUrl;
    if (coverUrl.isNotEmpty) {
      imageUrl = coverUrl.startsWith('http')
          ? coverUrl
          : '$serverUrl$coverUrl';
    } else if (comics.isNotEmpty) {
      imageUrl = getImageUrl(serverUrl, comics.first.id, thumbnail: true);
    }
    if (imageUrl == null) return _placeholder(colorScheme);
    return AuthenticatedImage(
      imageUrl: imageUrl,
      fit: BoxFit.cover,
      errorWidget: _placeholder(colorScheme),
    );
  }

  Widget _placeholder(ColorScheme colorScheme) {
    return Container(
      color: colorScheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(
        Icons.collections_bookmark_outlined,
        color: colorScheme.onSurfaceVariant.withOpacity(0.45),
      ),
    );
  }

  Widget _chip(String label) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer.withOpacity(0.55),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, color: colorScheme.onPrimaryContainer),
      ),
    );
  }

  Widget _stat(IconData icon, String label) {
    final colorScheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: colorScheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(fontSize: 12, color: colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }

  int _gridColumns(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    if (width > 900) return 6;
    if (width > 600) return 4;
    if (width > 400) return 3;
    return 2;
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

class _GroupSection {
  final String id;
  final String title;
  final String subtitle;
  final IconData icon;
  final List<Comic> comics;

  const _GroupSection({
    this.id = '',
    required this.title,
    this.subtitle = '',
    required this.icon,
    required this.comics,
  });
}
