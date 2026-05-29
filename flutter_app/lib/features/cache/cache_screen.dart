import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/providers/cache_provider.dart';
import '../../data/services/cache_service.dart';
import '../../data/api/api_client.dart';
import '../../widgets/animations.dart';

/// 离线缓存管理页面
class CacheScreen extends ConsumerStatefulWidget {
  const CacheScreen({super.key});

  @override
  ConsumerState<CacheScreen> createState() => _CacheScreenState();
}

class _CacheScreenState extends ConsumerState<CacheScreen> {
  @override
  void initState() {
    super.initState();
    // 初始化缓存服务
    cacheService.init().then((_) {
      ref.read(cacheEntriesProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final entries = ref.watch(cacheEntriesProvider);
    final totalSize = ref.watch(totalCacheSizeProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('离线缓存'),
        actions: [
          if (entries.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_sweep_rounded),
              tooltip: '清空所有缓存',
              onPressed: () => _confirmClearAll(context),
            ),
        ],
      ),
      body: Column(
        children: [
          // ─── 顶部统计卡片 ───
          _buildSummaryCard(context, cs, entries, totalSize),

          // ─── 缓存设置 ───
          _CacheSettingsCard(),

          // ─── 缓存列表 ───
          Expanded(
            child: entries.isEmpty
                ? _buildEmptyState(context, cs)
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    itemCount: entries.length,
                    itemBuilder: (context, index) {
                      return SlideAndFade(
                        delay: Duration(milliseconds: index * 50),
                        child: _CacheEntryCard(
                          entry: entries[index],
                          onDelete: () => _deleteEntry(entries[index].comicId),
                          onPause: () => _pauseEntry(entries[index].comicId),
                          onResume: () =>
                              _resumeEntry(entries[index].comicId),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryCard(BuildContext context, ColorScheme cs,
      List<CacheEntry> entries, String totalSize) {
    final cachedCount = entries.where((e) => e.isComplete).length;
    final downloadingCount =
        entries.where((e) => e.status == CacheStatus.downloading).length;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [cs.primary, cs.primary.withOpacity(0.75)],
        ),
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: cs.primary.withOpacity(0.2),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          _StatItem(
            icon: Icons.download_done_rounded,
            label: '已缓存',
            value: '$cachedCount 本',
            color: Colors.white,
          ),
          _Divider(),
          _StatItem(
            icon: Icons.downloading_rounded,
            label: '下载中',
            value: '$downloadingCount 本',
            color: Colors.white,
          ),
          _Divider(),
          _StatItem(
            icon: Icons.storage_rounded,
            label: '占用空间',
            value: totalSize,
            color: Colors.white,
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context, ColorScheme cs) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_download_outlined,
            size: 72,
            color: cs.onSurfaceVariant.withOpacity(0.2),
          ),
          const SizedBox(height: 16),
          Text(
            '暂无离线缓存',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: cs.onSurfaceVariant.withOpacity(0.5),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '在书籍详情页点击"缓存离线"即可下载',
            style: TextStyle(
              fontSize: 13,
              color: cs.onSurfaceVariant.withOpacity(0.4),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteEntry(String comicId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除缓存'),
        content: const Text('确定要删除该书籍的离线缓存吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirm == true) {
      await ref.read(cacheEntriesProvider.notifier).deleteCache(comicId);
    }
  }

  Future<void> _pauseEntry(String comicId) async {
    await ref.read(cacheEntriesProvider.notifier).pauseDownload(comicId);
  }

  Future<void> _resumeEntry(String comicId) async {
    final serverUrl = ref.read(apiClientProvider).serverUrl;
    await ref.read(cacheEntriesProvider.notifier).resumeDownload(
          comicId: comicId,
          serverUrl: serverUrl,
        );
  }

  Future<void> _confirmClearAll(BuildContext context) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('清空所有缓存'),
        content: const Text('确定要删除所有离线缓存吗？此操作不可恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('清空'),
          ),
        ],
      ),
    );
    if (confirm == true) {
      await ref.read(cacheEntriesProvider.notifier).clearAll();
    }
  }
}

// ─── 缓存设置卡片 ───

class _CacheSettingsCard extends ConsumerStatefulWidget {
  @override
  ConsumerState<_CacheSettingsCard> createState() => _CacheSettingsCardState();
}

class _CacheSettingsCardState extends ConsumerState<_CacheSettingsCard> {
  bool _wifiOnly = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    await cacheService.init();
    if (mounted) {
      setState(() {
        _wifiOnly = cacheService.wifiOnly;
        _loaded = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (!_loaded) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: Colors.blue.withOpacity(0.1),
              borderRadius: BorderRadius.circular(9),
            ),
            child: const Icon(Icons.wifi_rounded, size: 18, color: Colors.blue),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '仅 Wi-Fi 下载',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: cs.onSurface,
                  ),
                ),
                Text(
                  '开启后仅在 Wi-Fi 环境下自动缓存',
                  style: TextStyle(
                    fontSize: 12,
                    color: cs.onSurfaceVariant.withOpacity(0.6),
                  ),
                ),
              ],
            ),
          ),
          Switch(
            value: _wifiOnly,
            onChanged: (v) async {
              setState(() => _wifiOnly = v);
              await cacheService.saveSettings(wifiOnly: v);
            },
          ),
        ],
      ),
    );
  }
}

// ─── 缓存条目卡片 ───

class _CacheEntryCard extends StatelessWidget {
  final CacheEntry entry;
  final VoidCallback onDelete;
  final VoidCallback onPause;
  final VoidCallback onResume;

  const _CacheEntryCard({
    required this.entry,
    required this.onDelete,
    required this.onPause,
    required this.onResume,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final isDownloading = entry.status == CacheStatus.downloading;
    final isPaused = entry.status == CacheStatus.paused;
    final isFailed = entry.status == CacheStatus.failed;
    final isComplete = entry.isComplete;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // 类型图标
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: entry.isNovel
                      ? Colors.orange.withOpacity(0.1)
                      : cs.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  entry.isNovel
                      ? Icons.menu_book_rounded
                      : Icons.auto_stories_rounded,
                  size: 20,
                  color: entry.isNovel ? Colors.orange : cs.primary,
                ),
              ),
              const SizedBox(width: 12),
              // 标题和状态
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entry.title.isNotEmpty ? entry.title : entry.comicId,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: cs.onSurface,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        _StatusBadge(status: entry.status),
                        const SizedBox(width: 8),
                        Text(
                          _formatBytes(entry.totalBytes),
                          style: TextStyle(
                            fontSize: 11,
                            color: cs.onSurfaceVariant.withOpacity(0.5),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              // 操作按钮
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (isDownloading)
                    IconButton(
                      icon: const Icon(Icons.pause_rounded),
                      tooltip: '暂停',
                      onPressed: onPause,
                      iconSize: 20,
                    ),
                  if (isPaused || isFailed)
                    IconButton(
                      icon: const Icon(Icons.play_arrow_rounded),
                      tooltip: '继续',
                      onPressed: onResume,
                      iconSize: 20,
                    ),
                  IconButton(
                    icon: Icon(Icons.delete_outline_rounded,
                        color: cs.error.withOpacity(0.7)),
                    tooltip: '删除',
                    onPressed: onDelete,
                    iconSize: 20,
                  ),
                ],
              ),
            ],
          ),

          // 进度条（下载中或未完成时显示）
          if (!isComplete || isDownloading) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: entry.progress,
                      backgroundColor: cs.surfaceContainerHighest,
                      minHeight: 6,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${entry.cachedPages}/${entry.totalPages}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: cs.onSurfaceVariant.withOpacity(0.6),
                  ),
                ),
              ],
            ),
          ],

          // 错误信息
          if (isFailed && entry.errorMessage != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: cs.errorContainer.withOpacity(0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '下载失败: ${entry.errorMessage}',
                style: TextStyle(fontSize: 11, color: cs.error),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)}KB';
    return '${(bytes / 1024 / 1024).toStringAsFixed(1)}MB';
  }
}

// ─── 状态徽章 ───

class _StatusBadge extends StatelessWidget {
  final CacheStatus status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      CacheStatus.cached => ('已缓存', Colors.green),
      CacheStatus.downloading => ('下载中', Colors.blue),
      CacheStatus.paused => ('已暂停', Colors.orange),
      CacheStatus.failed => ('失败', Colors.red),
      CacheStatus.notCached => ('未缓存', Colors.grey),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

// ─── 辅助组件 ───

class _StatItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _StatItem({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Icon(icon, color: color.withOpacity(0.9), size: 22),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              color: color.withOpacity(0.7),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 0.5,
      height: 40,
      color: Colors.white.withOpacity(0.3),
    );
  }
}
