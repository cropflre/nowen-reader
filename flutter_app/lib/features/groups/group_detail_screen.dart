import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../data/api/api_client.dart';
import '../../widgets/authenticated_image.dart';
import '../../data/api/comic_api.dart';
import '../../data/models/comic.dart';
import '../../data/providers/auth_provider.dart';

/// 系列详情页面（Kavita 风格）
class GroupDetailScreen extends ConsumerStatefulWidget {
  final int groupId;
  const GroupDetailScreen({super.key, required this.groupId});

  @override
  ConsumerState<GroupDetailScreen> createState() => _GroupDetailScreenState();
}

class _GroupDetailScreenState extends ConsumerState<GroupDetailScreen> {
  Map<String, dynamic>? _detail;
  bool _loading = true;
  bool _isGridView = true; // 默认网格视图

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.getGroupDetail(widget.groupId);
      setState(() {
        _detail = data;
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  /// 格式化文件大小
  String _formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }

  /// 格式化时长
  String _formatDuration(int seconds) {
    if (seconds < 60) return '${seconds}s';
    if (seconds < 3600) return '${(seconds / 60).round()}分钟';
    final hours = seconds ~/ 3600;
    final mins = (seconds % 3600) ~/ 60;
    return mins > 0 ? '$hours小时${mins}分钟' : '$hours小时';
  }

  /// 获取状态标签文本和颜色
  (String, Color) _getStatusInfo(String status) {
    switch (status) {
      case 'ongoing':
        return ('连载中', Colors.blue);
      case 'completed':
        return ('已完结', Colors.green);
      case 'hiatus':
        return ('休刊中', Colors.amber);
      default:
        return (status, Colors.grey);
    }
  }

  @override
  Widget build(BuildContext context) {
    final serverUrl = ref.watch(authProvider).serverUrl;
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_detail == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: Text('加载失败')),
      );
    }

    final name = _detail!['name'] ?? '系列';
    final author = _detail!['author'] ?? '';
    final description = _detail!['description'] ?? '';
    final tags = _detail!['tags'] ?? '';
    final year = _detail!['year'];
    final publisher = _detail!['publisher'] ?? '';
    final language = _detail!['language'] ?? '';
    final genre = _detail!['genre'] ?? '';
    final status = _detail!['status'] ?? '';
    final coverUrl = _detail!['coverUrl'] ?? '';
    final comicCount = _detail!['comicCount'] ?? 0;
    final comics = (_detail!['comics'] as List<dynamic>?)
            ?.map((e) => Comic.fromJson(e))
            .toList() ??
        [];

    // 计算统计数据
    int totalPages = 0;
    int totalSize = 0;
    int totalReadTime = 0;
    for (final c in comics) {
      totalPages += c.pageCount;
      totalSize += c.fileSize;
      totalReadTime += c.totalReadTime;
    }

    // 解析标签列表
    final tagsList = tags.isNotEmpty
        ? tags.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList()
        : <String>[];

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _loadDetail,
        child: CustomScrollView(
          slivers: [
            // ═══════════════════════════════════════════════════════
            // 顶部 AppBar（带封面背景模糊效果）
            // ═══════════════════════════════════════════════════════
            SliverAppBar(
              expandedHeight: 0,
              pinned: true,
              title: Text(name),
              actions: [
                // 视图切换按钮
                IconButton(
                  icon: Icon(_isGridView ? Icons.view_list : Icons.grid_view),
                  tooltip: _isGridView ? '列表视图' : '网格视图',
                  onPressed: () => setState(() => _isGridView = !_isGridView),
                ),
              ],
            ),

            // ═══════════════════════════════════════════════════════
            // 系列元数据区域（类似 Kavita 的布局）
            // ═══════════════════════════════════════════════════════
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // 系列封面
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: SizedBox(
                        width: 120,
                        height: 168,
                        child: _buildCoverImage(serverUrl, coverUrl, comics, cs),
                      ),
                    ),
                    const SizedBox(width: 16),

                    // 系列信息
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // 系列名称
                          Text(
                            name,
                            style: tt.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 8),

                          // 状态 + 语言 + 年份标签行
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            children: [
                              if (status.isNotEmpty) ...[
                                _buildChip(
                                  _getStatusInfo(status).$1,
                                  _getStatusInfo(status).$2,
                                ),
                              ],
                              if (language.isNotEmpty)
                                _buildChip(language, Colors.purple),
                              if (year != null)
                                _buildChip('${year}年', cs.onSurfaceVariant,
                                    outlined: true),
                            ],
                          ),
                          const SizedBox(height: 8),

                          // 统计信息
                          Wrap(
                            spacing: 12,
                            runSpacing: 4,
                            children: [
                              _buildStatItem(Icons.menu_book, '$comicCount 卷'),
                              _buildStatItem(
                                  Icons.description, '$totalPages 页'),
                              _buildStatItem(
                                  Icons.storage, _formatFileSize(totalSize)),
                              if (totalReadTime > 0)
                                _buildStatItem(Icons.access_time,
                                    _formatDuration(totalReadTime)),
                            ],
                          ),
                          const SizedBox(height: 8),

                          // 作者 / 出版商
                          if (author.isNotEmpty)
                            _buildInfoRow('作者', author, cs),
                          if (publisher.isNotEmpty)
                            _buildInfoRow('出版商', publisher, cs),
                          if (genre.isNotEmpty)
                            _buildInfoRow('类型', genre, cs),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // 简介
            if (description.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        description,
                        style: tt.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant,
                          height: 1.5,
                        ),
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ),

            // 标签
            if (tagsList.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: tagsList
                        .map((tag) => Chip(
                              label: Text(tag,
                                  style: TextStyle(
                                      fontSize: 11, color: cs.primary)),
                              backgroundColor:
                                  cs.primary.withOpacity(0.08),
                              side: BorderSide.none,
                              padding: EdgeInsets.zero,
                              materialTapTargetSize:
                                  MaterialTapTargetSize.shrinkWrap,
                              visualDensity: VisualDensity.compact,
                            ))
                        .toList(),
                  ),
                ),
              ),

            // 分隔线
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Divider(height: 1),
              ),
            ),

            // ═══════════════════════════════════════════════════════
            // 卷标题栏
            // ═══════════════════════════════════════════════════════
            SliverToBoxAdapter(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    Text(
                      '卷 ($comicCount)',
                      style: tt.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const Spacer(),
                  ],
                ),
              ),
            ),

            // ═══════════════════════════════════════════════════════
            // 卷列表 / 网格
            // ═══════════════════════════════════════════════════════
            if (comics.isEmpty)
              const SliverFillRemaining(
                child: Center(child: Text('此系列暂无漫画')),
              )
            else if (_isGridView)
              _buildGridView(comics, serverUrl, cs, tt)
            else
              _buildListView(comics, serverUrl, cs, tt),

            // 底部间距
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        ),
      ),
    );
  }

  /// 构建封面图片
  Widget _buildCoverImage(
      String serverUrl, String coverUrl, List<Comic> comics, ColorScheme cs) {
    // 优先使用系列封面，其次使用第一本漫画的缩略图
    String? imageUrl;
    if (coverUrl.isNotEmpty) {
      imageUrl = coverUrl.startsWith('http') ? coverUrl : '$serverUrl$coverUrl';
    } else if (comics.isNotEmpty) {
      imageUrl = getImageUrl(serverUrl, comics.first.id, thumbnail: true);
    }

    if (imageUrl != null) {
      return AuthenticatedImage(
        imageUrl: imageUrl,
        fit: BoxFit.cover,
        errorWidget: _buildPlaceholderCover(cs),
      );
    }
    return _buildPlaceholderCover(cs);
  }

  Widget _buildPlaceholderCover(ColorScheme cs) {
    return Container(
      color: cs.surfaceContainerHighest,
      child: Center(
        child: Icon(Icons.collections_bookmark,
            size: 40, color: cs.onSurfaceVariant.withOpacity(0.4)),
      ),
    );
  }

  /// 构建状态/语言标签
  Widget _buildChip(String label, Color color, {bool outlined = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: outlined ? Colors.transparent : color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: outlined ? Border.all(color: color.withOpacity(0.3)) : null,
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: outlined ? color : color.withOpacity(0.9),
        ),
      ),
    );
  }

  /// 构建统计项
  Widget _buildStatItem(IconData icon, String text) {
    final cs = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: cs.onSurfaceVariant),
        const SizedBox(width: 3),
        Text(text,
            style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
      ],
    );
  }

  /// 构建信息行（作者、出版商等）
  Widget _buildInfoRow(String label, String value, ColorScheme cs) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Row(
        children: [
          SizedBox(
            width: 48,
            child: Text(label,
                style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(fontSize: 12),
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }

  /// 网格视图（类似 Kavita 的卷封面网格）
  Widget _buildGridView(
      List<Comic> comics, String serverUrl, ColorScheme cs, TextTheme tt) {
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      sliver: SliverGrid(
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: _getGridColumns(context),
          childAspectRatio: 0.6,
          crossAxisSpacing: 8,
          mainAxisSpacing: 8,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final comic = comics[index];
            final thumbUrl =
                getImageUrl(serverUrl, comic.id, thumbnail: true);
            final progress = comic.progress;

            return GestureDetector(
              onTap: () => context.push('/comic/${comic.id}'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 封面
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          AuthenticatedImage(
                            imageUrl: thumbUrl,
                            fit: BoxFit.cover,
                            errorWidget: Container(
                              color: cs.surfaceContainerHighest,
                              child: const Icon(Icons.image, size: 24),
                            ),
                          ),
                          // 进度条
                          if (progress > 0)
                            Positioned(
                              bottom: 0,
                              left: 0,
                              right: 0,
                              child: LinearProgressIndicator(
                                value: progress / 100,
                                minHeight: 3,
                                backgroundColor: Colors.black38,
                                valueColor: AlwaysStoppedAnimation(
                                  progress >= 100
                                      ? Colors.green
                                      : cs.primary,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  // 标题
                  Text(
                    comic.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: tt.bodySmall?.copyWith(
                      fontWeight: FontWeight.w500,
                      fontSize: 11,
                    ),
                  ),
                  // 页数
                  if (comic.pageCount > 0)
                    Text(
                      comic.isNovel
                          ? '${comic.pageCount} 章'
                          : '${comic.pageCount} 页',
                      style: TextStyle(
                          fontSize: 10, color: cs.onSurfaceVariant),
                    ),
                ],
              ),
            );
          },
          childCount: comics.length,
        ),
      ),
    );
  }

  /// 列表视图
  Widget _buildListView(
      List<Comic> comics, String serverUrl, ColorScheme cs, TextTheme tt) {
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final comic = comics[index];
            final thumbUrl =
                getImageUrl(serverUrl, comic.id, thumbnail: true);
            final progress = comic.progress;

            return Card(
              margin: const EdgeInsets.only(bottom: 6),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => context.push('/comic/${comic.id}'),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    children: [
                      // 卷号
                      Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: cs.primary.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          '${index + 1}',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: cs.primary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      // 封面缩略图
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: SizedBox(
                          width: 40,
                          height: 56,
                          child: AuthenticatedImage(
                            imageUrl: thumbUrl,
                            fit: BoxFit.cover,
                            errorWidget: Container(
                              color: cs.surfaceContainerHighest,
                              child: const Icon(Icons.image, size: 16),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      // 信息
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              comic.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: tt.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                Text(
                                  comic.pageCount > 0
                                      ? (comic.isNovel
                                          ? '${comic.pageCount}章'
                                          : '${comic.pageCount}页')
                                      : '',
                                  style: TextStyle(
                                      fontSize: 11,
                                      color: cs.onSurfaceVariant),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  _formatFileSize(comic.fileSize),
                                  style: TextStyle(
                                      fontSize: 11,
                                      color: cs.onSurfaceVariant),
                                ),
                                if (comic.totalReadTime > 0) ...[
                                  const SizedBox(width: 8),
                                  Icon(Icons.access_time,
                                      size: 11,
                                      color: cs.onSurfaceVariant),
                                  const SizedBox(width: 2),
                                  Text(
                                    _formatDuration(comic.totalReadTime),
                                    style: TextStyle(
                                        fontSize: 11,
                                        color: cs.onSurfaceVariant),
                                  ),
                                ],
                              ],
                            ),
                          ],
                        ),
                      ),
                      // 进度
                      if (progress > 0) ...[
                        SizedBox(
                          width: 48,
                          child: Column(
                            children: [
                              SizedBox(
                                height: 4,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(2),
                                  child: LinearProgressIndicator(
                                    value: progress / 100,
                                    backgroundColor:
                                        cs.surfaceContainerHighest,
                                    valueColor: AlwaysStoppedAnimation(
                                      progress >= 100
                                          ? Colors.green
                                          : cs.primary,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '$progress%',
                                style: TextStyle(
                                    fontSize: 10,
                                    color: cs.onSurfaceVariant),
                              ),
                            ],
                          ),
                        ),
                      ],
                      // 箭头
                      Icon(Icons.chevron_right,
                          size: 18, color: cs.onSurfaceVariant),
                    ],
                  ),
                ),
              ),
            );
          },
          childCount: comics.length,
        ),
      ),
    );
  }

  /// 根据屏幕宽度计算网格列数
  int _getGridColumns(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    if (width > 900) return 6;
    if (width > 600) return 4;
    if (width > 400) return 3;
    return 2;
  }
}
