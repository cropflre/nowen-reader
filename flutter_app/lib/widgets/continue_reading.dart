import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/api/api_client.dart';
import '../data/api/comic_api.dart';
import '../data/models/comic.dart';
import '../data/providers/auth_provider.dart';
import 'authenticated_image.dart';
import '../features/reader/novel_reader_screen.dart';
import 'animations.dart';

/// 继续阅读 — 优雅的横向滚动卡片
class ContinueReading extends ConsumerStatefulWidget {
  const ContinueReading({super.key});

  @override
  ConsumerState<ContinueReading> createState() => _ContinueReadingState();
}

class _ContinueReadingState extends ConsumerState<ContinueReading> {
  List<Comic> _recentComics = [];
  bool _loading = true;
  bool _collapsed = false;

  @override
  void initState() {
    super.initState();
    _fetchRecent();
  }

  Future<void> _fetchRecent() async {
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.listComics(
        page: 1,
        limit: 10,
        sort: 'lastReadAt',
        order: 'desc',
      );
      final comics = ((data['comics'] as List<dynamic>?) ?? [])
          .map((e) => Comic.fromJson(e))
          .where((c) =>
              c.lastReadAt != null &&
              c.lastReadAt!.isNotEmpty &&
              c.lastReadPage > 0 &&
              (c.pageCount == 0 || c.lastReadPage < c.pageCount - 1))
          .take(8)
          .toList();
      if (mounted) {
        setState(() {
          _recentComics = comics;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> refresh() => _fetchRecent();

  String _formatTime(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      final now = DateTime.now();
      final diff = now.difference(date);
      if (diff.inMinutes < 1) return '刚刚';
      if (diff.inMinutes < 60) return '${diff.inMinutes}分钟前';
      if (diff.inHours < 24) return '${diff.inHours}小时前';
      if (diff.inDays < 7) return '${diff.inDays}天前';
      return '${date.month}/${date.day}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _recentComics.isEmpty) return const SizedBox.shrink();

    final cs = Theme.of(context).colorScheme;
    final serverUrl = ref.watch(authProvider).serverUrl;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ─── 标题栏 ───
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 16, 0),
          child: GestureDetector(
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _collapsed = !_collapsed);
            },
            behavior: HitTestBehavior.opaque,
            child: Row(
              children: [
                Text(
                  '继续阅读',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: cs.onSurface,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: cs.primary.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '${_recentComics.length}',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: cs.primary,
                    ),
                  ),
                ),
                const Spacer(),
                AnimatedRotation(
                  turns: _collapsed ? 0.5 : 0,
                  duration: const Duration(milliseconds: 200),
                  child: Icon(
                    Icons.keyboard_arrow_up_rounded,
                    size: 22,
                    color: cs.onSurfaceVariant.withOpacity(0.5),
                  ),
                ),
              ],
            ),
          ),
        ),

        // ─── 横向滚动列表 ───
        AnimatedCrossFade(
          firstChild: Padding(
            padding: const EdgeInsets.only(top: 12),
            child: SizedBox(
              height: 190,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 20),
                itemCount: _recentComics.length,
                separatorBuilder: (_, __) => const SizedBox(width: 14),
                itemBuilder: (context, index) {
                  final comic = _recentComics[index];
                  return _ContinueReadingCard(
                    comic: comic,
                    serverUrl: serverUrl,
                    timeStr: _formatTime(comic.lastReadAt!),
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
                  );
                },
              ),
            ),
          ),
          secondChild: const SizedBox(height: 8),
          crossFadeState: _collapsed
              ? CrossFadeState.showSecond
              : CrossFadeState.showFirst,
          duration: const Duration(milliseconds: 250),
          sizeCurve: Curves.easeInOut,
        ),

        // 底部分隔
        if (!_collapsed)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
            child: Divider(
              height: 1,
              color: cs.outlineVariant.withOpacity(0.3),
            ),
          ),
      ],
    );
  }
}

/// 继续阅读卡片 — 精致的封面+进度+按压缩放
class _ContinueReadingCard extends StatelessWidget {
  final Comic comic;
  final String serverUrl;
  final String timeStr;
  final VoidCallback onTap;

  const _ContinueReadingCard({
    required this.comic,
    required this.serverUrl,
    required this.timeStr,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final progress = comic.pageCount > 0
        ? (comic.lastReadPage / comic.pageCount * 100).round()
        : 0;
    final thumbUrl = getImageUrl(serverUrl, comic.id, thumbnail: true);

    return PressableScale(
      onTap: onTap,
      scaleDown: 0.95,
      child: SizedBox(
        width: 120,
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
                      blurRadius: 10,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      AuthenticatedImage(
                        imageUrl: thumbUrl,
                        fit: BoxFit.cover,
                        placeholder: Container(
                          color: cs.surfaceContainerHighest,
                          child: Center(
                            child: Icon(Icons.image_outlined,
                                size: 22, color: cs.onSurfaceVariant.withOpacity(0.3)),
                          ),
                        ),
                        errorWidget: Container(
                          color: cs.surfaceContainerHighest,
                        ),
                      ),

                      // 底部渐变 + 进度
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.fromLTRB(8, 24, 8, 8),
                          decoration: const BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.bottomCenter,
                              end: Alignment.topCenter,
                              colors: [Colors.black87, Colors.transparent],
                            ),
                          ),
                          child: Column(
                            children: [
                              // 进度文字
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    comic.pageCount > 0
                                        ? '${comic.lastReadPage + 1}/${comic.pageCount}'
                                        : '${comic.lastReadPage + 1}',
                                    style: const TextStyle(
                                      color: Colors.white60,
                                      fontSize: 9,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  Text(
                                    '$progress%',
                                    style: TextStyle(
                                      color: cs.primary,
                                      fontSize: 9,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              // 进度条
                              ClipRRect(
                                borderRadius: BorderRadius.circular(2),
                                child: LinearProgressIndicator(
                                  value: progress / 100,
                                  minHeight: 2.5,
                                  backgroundColor: Colors.white.withAlpha(30),
                                  valueColor: AlwaysStoppedAnimation(cs.primary),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      // 播放按钮覆盖层
                      Positioned.fill(
                        child: Center(
                          child: BreathingPulse(
                            minScale: 0.92,
                            maxScale: 1.08,
                            duration: const Duration(milliseconds: 1800),
                            child: Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: Colors.black.withOpacity(0.35),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.play_arrow_rounded,
                                color: Colors.white,
                                size: 22,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            // 标题
            Text(
              comic.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: cs.onSurface,
                height: 1.2,
              ),
            ),
            const SizedBox(height: 3),
            // 时间
            Text(
              timeStr,
              style: TextStyle(
                fontSize: 10,
                color: cs.onSurfaceVariant.withOpacity(0.6),
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
