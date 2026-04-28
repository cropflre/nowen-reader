import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../data/api/api_client.dart';
import '../../widgets/authenticated_image.dart';
import '../../data/api/comic_api.dart';
import '../../data/models/comic.dart';
import '../../data/providers/auth_provider.dart';
import '../reader/novel_reader_screen.dart';
import '../../widgets/animations.dart';

/// 漫画详情页 — 沉浸式优雅设计
class ComicDetailScreen extends ConsumerStatefulWidget {
  final String comicId;
  const ComicDetailScreen({super.key, required this.comicId});

  @override
  ConsumerState<ComicDetailScreen> createState() => _ComicDetailScreenState();
}

class _ComicDetailScreenState extends ConsumerState<ComicDetailScreen> {
  Comic? _comic;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.getComic(widget.comicId);
      setState(() {
        _comic = Comic.fromJson(data);
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  Future<void> _toggleFavorite() async {
    if (_comic == null) return;
    HapticFeedback.lightImpact();
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.toggleFavorite(widget.comicId);
      setState(() {
        _comic = _comic!.copyWith(isFavorite: data['isFavorite'] ?? false);
      });
    } catch (_) {}
  }

  Future<void> _updateRating(int rating) async {
    if (_comic == null) return;
    HapticFeedback.selectionClick();
    try {
      final api = ref.read(comicApiProvider);
      await api.updateRating(widget.comicId, rating);
      setState(() {
        _comic = _comic!.copyWith(rating: rating.toDouble());
      });
    } catch (_) {}
  }

  Future<void> _setReadingStatus(String status) async {
    if (_comic == null) return;
    HapticFeedback.selectionClick();
    try {
      final api = ref.read(comicApiProvider);
      await api.setReadingStatus(widget.comicId, status);
      setState(() {
        _comic = _comic!.copyWith(readingStatus: status);
      });
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final serverUrl = ref.watch(authProvider).serverUrl;
    final cs = Theme.of(context).colorScheme;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(
          child: SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(strokeWidth: 2.5),
          ),
        ),
      );
    }

    final comic = _comic;
    if (comic == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline_rounded,
                  size: 48, color: cs.error.withOpacity(0.5)),
              const SizedBox(height: 16),
              Text('加载失败', style: TextStyle(color: cs.onSurfaceVariant)),
            ],
          ),
        ),
      );
    }

    final thumbUrl = getImageUrl(serverUrl, comic.id, thumbnail: true);

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // ─── 沉浸式封面 AppBar ───
          SliverAppBar(
            expandedHeight: 320,
            pinned: true,
            stretch: true,
            backgroundColor: cs.surface,
            leading: Padding(
              padding: const EdgeInsets.all(8),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: IconButton(
                  icon: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 20),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ),
            actions: [
              Padding(
                padding: const EdgeInsets.all(8),
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: IconButton(
                    icon: HeartBounce(
                      trigger: comic.isFavorite,
                      child: Icon(
                        comic.isFavorite
                            ? Icons.favorite_rounded
                            : Icons.favorite_border_rounded,
                        color: comic.isFavorite
                            ? const Color(0xFFFF6B6B)
                            : Colors.white,
                        size: 20,
                      ),
                    ),
                    onPressed: _toggleFavorite,
                  ),
                ),
              ),
            ],
            flexibleSpace: FlexibleSpaceBar(
              background: Stack(
                fit: StackFit.expand,
                children: [
                  // 封面图片
                  AuthenticatedImage(
                    imageUrl: thumbUrl,
                    fit: BoxFit.cover,
                    errorWidget: Container(color: cs.surfaceContainerHighest),
                  ),
                  // 渐变遮罩
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        stops: const [0.0, 0.4, 1.0],
                        colors: [
                          Colors.black.withOpacity(0.3),
                          Colors.transparent,
                          Colors.black.withOpacity(0.85),
                        ],
                      ),
                    ),
                  ),
                  // 底部信息
                  Positioned(
                    bottom: 20,
                    left: 20,
                    right: 20,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // 类型标签
                        if (comic.isNovel)
                          Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: const Text(
                              '小说',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        Text(
                          comic.title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.5,
                            height: 1.2,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (comic.author != null && comic.author!.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              comic.author!,
                              style: TextStyle(
                                color: Colors.white.withOpacity(0.7),
                                fontSize: 14,
                                fontWeight: FontWeight.w400,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // ─── 内容区域 ───
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                // 开始阅读按钮
                SlideAndFade(
                  delay: const Duration(milliseconds: 100),
                  child: Container(
                    height: 52,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [cs.primary, cs.primary.withOpacity(0.8)],
                      ),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                          color: cs.primary.withOpacity(0.25),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Material(
                      color: Colors.transparent,
                      borderRadius: BorderRadius.circular(14),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () {
                          HapticFeedback.lightImpact();
                          if (comic.isNovel) {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => NovelReaderScreen(
                                  comicId: comic.id,
                                  initialChapter: comic.lastReadPage,
                                ),
                              ),
                            );
                          } else {
                            context.push(
                              '/reader/${comic.id}?page=${comic.lastReadPage}',
                            );
                          }
                        },
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              comic.isNovel
                                  ? Icons.menu_book_rounded
                                  : Icons.play_arrow_rounded,
                              color: Colors.white,
                              size: 22,
                            ),
                            const SizedBox(width: 10),
                            Text(
                              comic.lastReadPage > 0
                                  ? '继续阅读 (${comic.lastReadPage + 1}/${comic.pageCount}${comic.isNovel ? "章" : "页"})'
                                  : '开始阅读',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),

                // ─── 元数据信息 ───
                SlideAndFade(
                  delay: const Duration(milliseconds: 200),
                  child: _buildInfoCards(context, comic),
                ),
                const SizedBox(height: 20),

                // ─── 评分 ───
                SlideAndFade(
                  delay: const Duration(milliseconds: 300),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardTheme.color,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '评分',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: cs.onSurfaceVariant.withOpacity(0.6),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: List.generate(5, (i) {
                          final filled = i < (comic.rating ?? 0);
                          return GestureDetector(
                            onTap: () => _updateRating(i + 1),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 6),
                              child: TweenAnimationBuilder<double>(
                                tween: Tween(begin: 0.0, end: 1.0),
                                duration: Duration(milliseconds: 300 + i * 80),
                                curve: Curves.elasticOut,
                                builder: (context, val, child) => Transform.scale(
                                  scale: val,
                                  child: child,
                                ),
                                child: Icon(
                                  filled ? Icons.star_rounded : Icons.star_outline_rounded,
                                  color: filled ? Colors.amber.shade600 : cs.onSurfaceVariant.withOpacity(0.2),
                                  size: 32,
                                ),
                              ),
                            ),
                          );
                        }),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                // ─── 阅读状态 ───
                SlideAndFade(
                  delay: const Duration(milliseconds: 400),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardTheme.color,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '阅读状态',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: cs.onSurfaceVariant.withOpacity(0.6),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            _StatusPill('想读', 'want', comic.readingStatus, _setReadingStatus, cs),
                            const SizedBox(width: 8),
                            _StatusPill('在读', 'reading', comic.readingStatus, _setReadingStatus, cs),
                            const SizedBox(width: 8),
                            _StatusPill('读完', 'finished', comic.readingStatus, _setReadingStatus, cs),
                            const SizedBox(width: 8),
                            _StatusPill('搁置', 'shelved', comic.readingStatus, _setReadingStatus, cs),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                // ─── 元数据刮削入口 ───
                SlideAndFade(
                  delay: const Duration(milliseconds: 500),
                  child: Container(
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardTheme.color,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Material(
                      color: Colors.transparent,
                      borderRadius: BorderRadius.circular(14),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () {
                          context.push('/metadata/${comic.id}').then((_) {
                            _loadDetail();
                          });
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                          child: Row(
                            children: [
                              Container(
                                width: 34,
                                height: 34,
                                decoration: BoxDecoration(
                                  color: Colors.purple.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(9),
                                ),
                                child: const Icon(Icons.auto_fix_high_rounded,
                                    size: 18, color: Colors.purple),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Text(
                                  comic.metadataSource != null && comic.metadataSource!.isNotEmpty
                                      ? '重新刮削元数据'
                                      : '刮削元数据',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w500,
                                    color: cs.onSurface,
                                  ),
                                ),
                              ),
                              Icon(Icons.chevron_right_rounded,
                                  size: 20, color: cs.onSurfaceVariant.withOpacity(0.3)),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),

                // ─── 标签 ───
                if (comic.tags.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text(
                    '标签',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: cs.onSurfaceVariant.withOpacity(0.6),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: comic.tags.map((t) {
                      return Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: cs.primaryContainer.withOpacity(0.3),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          t.name,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: cs.primary,
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],

                // ─── 简介 ───
                if (comic.description != null && comic.description!.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text(
                    '简介',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: cs.onSurfaceVariant.withOpacity(0.6),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    comic.description!,
                    style: TextStyle(
                      color: cs.onSurfaceVariant.withOpacity(0.7),
                      fontSize: 14,
                      height: 1.6,
                    ),
                  ),
                ],
              ]),
            ),
          ),
        ],
      ),
    );
  }

  /// 元数据信息卡片
  Widget _buildInfoCards(BuildContext context, Comic comic) {
    final cs = Theme.of(context).colorScheme;
    final items = <_InfoItem>[];

    if (comic.pageCount > 0) {
      items.add(_InfoItem(
        Icons.description_outlined,
        comic.isNovel ? '章节' : '页数',
        '${comic.pageCount}',
      ));
    }
    if (comic.fileSize > 0) {
      final mb = (comic.fileSize / 1024 / 1024).toStringAsFixed(1);
      items.add(_InfoItem(Icons.folder_outlined, '大小', '${mb}MB'));
    }
    if (comic.publisher != null && comic.publisher!.isNotEmpty) {
      items.add(_InfoItem(Icons.business_outlined, '出版社', comic.publisher!));
    }
    if (comic.year != null) {
      items.add(_InfoItem(Icons.calendar_today_outlined, '年份', '${comic.year}'));
    }
    if (comic.language != null && comic.language!.isNotEmpty) {
      items.add(_InfoItem(Icons.language_rounded, '语言', comic.language!));
    }
    if (comic.totalReadTime > 0) {
      final hours = comic.totalReadTime ~/ 3600;
      final mins = (comic.totalReadTime % 3600) ~/ 60;
      items.add(_InfoItem(
        Icons.timer_outlined,
        '阅读时间',
        hours > 0 ? '${hours}h ${mins}m' : '${mins}m',
      ));
    }

    if (items.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Wrap(
        spacing: 20,
        runSpacing: 14,
        children: items.map((item) {
          return SizedBox(
            width: (MediaQuery.of(context).size.width - 80) / 3,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(item.icon, size: 16, color: cs.primary.withOpacity(0.6)),
                const SizedBox(width: 8),
                Flexible(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.label,
                        style: TextStyle(
                          fontSize: 10,
                          color: cs.onSurfaceVariant.withOpacity(0.5),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      Text(
                        item.value,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: cs.onSurface,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _InfoItem {
  final IconData icon;
  final String label;
  final String value;
  _InfoItem(this.icon, this.label, this.value);
}

/// 阅读状态胶囊
class _StatusPill extends StatelessWidget {
  final String label;
  final String value;
  final String? current;
  final Function(String) onTap;
  final ColorScheme cs;

  const _StatusPill(this.label, this.value, this.current, this.onTap, this.cs);

  @override
  Widget build(BuildContext context) {
    final isSelected = current == value;
    return Expanded(
      child: GestureDetector(
        onTap: () => onTap(isSelected ? '' : value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected
                ? cs.primary.withOpacity(0.12)
                : cs.surfaceContainerHighest.withOpacity(0.5),
            borderRadius: BorderRadius.circular(10),
            border: isSelected
                ? Border.all(color: cs.primary.withOpacity(0.3), width: 1)
                : null,
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                color: isSelected ? cs.primary : cs.onSurfaceVariant.withOpacity(0.6),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
