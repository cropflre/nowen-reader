import 'package:flutter/material.dart';
import '../data/api/api_client.dart';
import '../data/models/comic.dart';
import 'authenticated_image.dart';
import 'animations.dart';

/// 漫画列表项组件 — 精致的列表模式卡片
class ComicListTile extends StatelessWidget {
  final Comic comic;
  final String serverUrl;
  final VoidCallback onTap;
  final VoidCallback? onFavoriteToggle;

  const ComicListTile({
    super.key,
    required this.comic,
    required this.serverUrl,
    required this.onTap,
    this.onFavoriteToggle,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final thumbUrl = getImageUrl(serverUrl, comic.id, thumbnail: true);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      child: Material(
        color: Theme.of(context).cardTheme.color ?? cs.surface,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                // 封面缩略图
                Container(
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
                    child: SizedBox(
                      width: 58,
                      height: 82,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          AuthenticatedImage(
                            imageUrl: thumbUrl,
                            fit: BoxFit.cover,
                            placeholder: Container(
                              color: cs.surfaceContainerHighest,
                              child: Icon(Icons.image_outlined,
                                  size: 22, color: cs.onSurfaceVariant.withOpacity(0.3)),
                            ),
                            errorWidget: Container(
                              color: cs.surfaceContainerHighest,
                              child: Icon(Icons.broken_image_outlined,
                                  size: 22, color: cs.onSurfaceVariant.withOpacity(0.3)),
                            ),
                          ),
                          // 阅读进度条
                          if (comic.progress > 0)
                            Positioned(
                              bottom: 0,
                              left: 0,
                              right: 0,
                              child: Container(
                                height: 2.5,
                                color: Colors.black26,
                                child: FractionallySizedBox(
                                  alignment: Alignment.centerLeft,
                                  widthFactor: comic.progress / 100,
                                  child: Container(color: cs.primary),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                // 信息区域
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // 标题行
                      Row(
                        children: [
                          if (comic.isNovel)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              margin: const EdgeInsets.only(right: 8),
                              decoration: BoxDecoration(
                                color: cs.tertiaryContainer.withOpacity(0.6),
                                borderRadius: BorderRadius.circular(5),
                              ),
                              child: Text(
                                '小说',
                                style: TextStyle(
                                  color: cs.onTertiaryContainer,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          Expanded(
                            child: Text(
                              comic.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                color: cs.onSurface,
                                letterSpacing: -0.2,
                              ),
                            ),
                          ),
                        ],
                      ),
                      // 作者
                      if (comic.author.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          comic.author,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: cs.onSurfaceVariant.withOpacity(0.7),
                            fontSize: 12,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                      ],
                      const SizedBox(height: 6),
                      // 元信息行
                      Row(
                        children: [
                          if (comic.progress > 0) ...[
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: cs.primary.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                '${comic.progress}%',
                                style: TextStyle(
                                  color: cs.primary,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                          ],
                          if (comic.pageCount > 0)
                            Text(
                              comic.isNovel
                                  ? '${comic.pageCount}章'
                                  : '${comic.pageCount}页',
                              style: TextStyle(
                                color: cs.onSurfaceVariant.withOpacity(0.5),
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          if (comic.rating != null && comic.rating! > 0) ...[
                            const SizedBox(width: 8),
                            Icon(Icons.star_rounded,
                                size: 13, color: Colors.amber.shade600),
                            const SizedBox(width: 2),
                            Text(
                              comic.rating!.toStringAsFixed(1),
                              style: TextStyle(
                                color: cs.onSurfaceVariant.withOpacity(0.6),
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                // 收藏按钮
                if (onFavoriteToggle != null)
                  GestureDetector(
                    onTap: onFavoriteToggle,
                    child: Padding(
                      padding: const EdgeInsets.all(6),
                      child: HeartBounce(
                        trigger: comic.isFavorite,
                        child: Icon(
                          comic.isFavorite
                              ? Icons.favorite_rounded
                              : Icons.favorite_border_rounded,
                          color: comic.isFavorite
                              ? const Color(0xFFFF6B6B)
                              : cs.onSurfaceVariant.withOpacity(0.3),
                          size: 20,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
