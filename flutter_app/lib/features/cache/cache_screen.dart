import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers/auth_provider.dart';
import '../../data/providers/cache_provider.dart';
import '../../data/services/cache_service.dart';

class CacheScreen extends ConsumerStatefulWidget {
  const CacheScreen({super.key});

  @override
  ConsumerState<CacheScreen> createState() => _CacheScreenState();
}

class _CacheScreenState extends ConsumerState<CacheScreen> {
  Timer? _reconnectTimer;
  bool _checkingConnection = false;

  @override
  void initState() {
    super.initState();
    cacheService.init().then((_) {
      if (!mounted) return;
      ref.read(cacheEntriesProvider.notifier).refresh();
    });

    _reconnectTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _retryConnection(silent: true),
    );
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final entries = ref.watch(cacheEntriesProvider);
    final totalSize = ref.watch(totalCacheSizeProvider);
    final completed = entries.where((entry) => entry.isComplete).length;
    final downloading = entries
        .where((entry) => entry.status == CacheStatus.downloading)
        .length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('离线书架'),
        actions: [
          IconButton(
            tooltip: '服务器设置',
            onPressed: () => context.go('/server'),
            icon: const Icon(Icons.dns_rounded),
          ),
          if (entries.isNotEmpty)
            IconButton(
              tooltip: '清空所有缓存',
              onPressed: _confirmClearAll,
              icon: const Icon(Icons.delete_sweep_rounded),
            ),
        ],
      ),
      body: Column(
        children: [
          if (auth.isOffline) _buildOfflineBanner(auth),
          _buildSummary(
            completed: completed,
            downloading: downloading,
            totalSize: totalSize,
          ),
          const _CacheSettingsCard(),
          Expanded(
            child: entries.isEmpty
                ? _buildEmptyState(auth.isOffline)
                : RefreshIndicator(
                    onRefresh: () async {
                      await cacheService.init();
                      ref.read(cacheEntriesProvider.notifier).refresh();
                      if (auth.isOffline) {
                        await _retryConnection(silent: true);
                      }
                    },
                    child: ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      itemCount: entries.length,
                      itemBuilder: (context, index) {
                        final entry = entries[index];
                        return _CacheEntryCard(
                          entry: entry,
                          offline: auth.isOffline,
                          onOpen: entry.isNovel && entry.cachedPages > 0
                              ? () => _openNovel(entry)
                              : null,
                          onDelete: () => _deleteEntry(entry.comicId),
                          onPause: () => _pauseEntry(entry.comicId),
                          onResume: () => _resumeEntry(entry.comicId),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildOfflineBanner(AuthState auth) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
      color: colors.errorContainer,
      child: Row(
        children: [
          Icon(
            Icons.cloud_off_rounded,
            color: colors.onErrorContainer,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '当前离线，已缓存小说仍可阅读。'
              '${auth.serverUrl.isEmpty ? '' : '\n${auth.serverUrl}'}',
              style: TextStyle(color: colors.onErrorContainer),
            ),
          ),
          TextButton(
            onPressed: _checkingConnection
                ? null
                : () => _retryConnection(silent: false),
            child: Text(_checkingConnection ? '检测中…' : '重新连接'),
          ),
        ],
      ),
    );
  }

  Widget _buildSummary({
    required int completed,
    required int downloading,
    required String totalSize,
  }) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colors.primaryContainer,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          _SummaryItem(
            icon: Icons.download_done_rounded,
            label: '可离线',
            value: '$completed 本',
          ),
          const _SummaryDivider(),
          _SummaryItem(
            icon: Icons.downloading_rounded,
            label: '下载中',
            value: '$downloading 本',
          ),
          const _SummaryDivider(),
          _SummaryItem(
            icon: Icons.storage_rounded,
            label: '占用空间',
            value: totalSize,
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(bool offline) {
    final colors = Theme.of(context).colorScheme;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.16),
        Icon(
          offline
              ? Icons.cloud_off_rounded
              : Icons.cloud_download_outlined,
          size: 72,
          color: colors.onSurfaceVariant.withOpacity(0.25),
        ),
        const SizedBox(height: 16),
        Text(
          '暂无离线缓存',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        Text(
          offline
              ? '联网后在书籍详情页点击“缓存离线”'
              : '在书籍详情页点击“缓存离线”即可下载',
          textAlign: TextAlign.center,
          style: TextStyle(color: colors.onSurfaceVariant),
        ),
        if (offline) ...[
          const SizedBox(height: 20),
          Center(
            child: OutlinedButton.icon(
              onPressed: () => context.go('/server'),
              icon: const Icon(Icons.settings_ethernet_rounded),
              label: const Text('检查服务器地址'),
            ),
          ),
        ],
      ],
    );
  }

  void _openNovel(CacheEntry entry) {
    context.push(
      '/offline/novel/${Uri.encodeComponent(entry.comicId)}',
    );
  }

  Future<void> _retryConnection({required bool silent}) async {
    if (_checkingConnection || !mounted) return;
    final auth = ref.read(authProvider);
    if (!auth.isOffline || auth.serverUrl.isEmpty) return;

    setState(() => _checkingConnection = true);
    await ref.read(authProvider.notifier).checkAuth();
    if (!mounted) return;
    setState(() => _checkingConnection = false);

    final latest = ref.read(authProvider);
    if (latest.connectionStatus == ServerConnectionStatus.online) {
      if (latest.user != null) {
        context.go('/');
      } else {
        context.go('/login');
      }
      return;
    }

    if (!silent) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('服务器仍不可达，继续使用离线模式')),
      );
    }
  }

  Future<void> _deleteEntry(String comicId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('删除缓存'),
        content: const Text('确定删除这本书的离线缓存吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await ref.read(cacheEntriesProvider.notifier).deleteCache(comicId);
    }
  }

  Future<void> _pauseEntry(String comicId) async {
    await ref.read(cacheEntriesProvider.notifier).pauseDownload(comicId);
  }

  Future<void> _resumeEntry(String comicId) async {
    final auth = ref.read(authProvider);
    if (auth.isOffline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('恢复下载需要连接服务器')),
      );
      return;
    }

    await ref.read(cacheEntriesProvider.notifier).resumeDownload(
          comicId: comicId,
          serverUrl: auth.serverUrl,
        );
  }

  Future<void> _confirmClearAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('清空所有缓存'),
        content: const Text('此操作会删除所有离线书籍和本地阅读进度，且不可恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('清空'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await ref.read(cacheEntriesProvider.notifier).clearAll();
    }
  }
}

class _CacheSettingsCard extends StatefulWidget {
  const _CacheSettingsCard();

  @override
  State<_CacheSettingsCard> createState() => _CacheSettingsCardState();
}

class _CacheSettingsCardState extends State<_CacheSettingsCard> {
  bool _wifiOnly = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await cacheService.init();
    if (!mounted) return;
    setState(() {
      _wifiOnly = cacheService.wifiOnly;
      _loaded = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const SizedBox.shrink();
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: SwitchListTile(
        value: _wifiOnly,
        secondary: const Icon(Icons.wifi_rounded),
        title: const Text('仅 Wi-Fi 下载'),
        subtitle: const Text('开启后仅在 Wi-Fi 环境下自动缓存'),
        onChanged: (value) async {
          setState(() => _wifiOnly = value);
          await cacheService.saveSettings(wifiOnly: value);
        },
      ),
    );
  }
}

class _CacheEntryCard extends StatelessWidget {
  final CacheEntry entry;
  final bool offline;
  final VoidCallback? onOpen;
  final VoidCallback onDelete;
  final VoidCallback onPause;
  final VoidCallback onResume;

  const _CacheEntryCard({
    required this.entry,
    required this.offline,
    required this.onOpen,
    required this.onDelete,
    required this.onPause,
    required this.onResume,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final downloading = entry.status == CacheStatus.downloading;
    final paused = entry.status == CacheStatus.paused;
    final failed = entry.status == CacheStatus.failed;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: entry.isNovel
                        ? Colors.orange.withOpacity(0.12)
                        : colors.primaryContainer,
                    child: Icon(
                      entry.isNovel
                          ? Icons.menu_book_rounded
                          : Icons.auto_stories_rounded,
                      color: entry.isNovel ? Colors.orange : colors.primary,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.title.isEmpty ? entry.comicId : entry.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            _StatusBadge(status: entry.status),
                            const SizedBox(width: 8),
                            Text(
                              '${entry.cachedPages}/${entry.totalPages} · '
                              '${_formatBytes(entry.totalBytes)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (downloading)
                    IconButton(
                      tooltip: '暂停',
                      onPressed: onPause,
                      icon: const Icon(Icons.pause_rounded),
                    ),
                  if (paused || failed)
                    IconButton(
                      tooltip: offline ? '联网后继续' : '继续下载',
                      onPressed: offline ? null : onResume,
                      icon: const Icon(Icons.play_arrow_rounded),
                    ),
                  IconButton(
                    tooltip: '删除',
                    onPressed: onDelete,
                    icon: Icon(
                      Icons.delete_outline_rounded,
                      color: colors.error,
                    ),
                  ),
                ],
              ),
              if (!entry.isComplete || downloading) ...[
                const SizedBox(height: 12),
                LinearProgressIndicator(value: entry.progress),
              ],
              if (entry.isNovel && entry.cachedPages > 0) ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.tonalIcon(
                    onPressed: onOpen,
                    icon: const Icon(Icons.menu_book_rounded),
                    label: Text(
                      entry.isComplete ? '离线阅读' : '阅读已缓存章节',
                    ),
                  ),
                ),
              ],
              if (failed && entry.errorMessage != null) ...[
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    entry.errorMessage!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: colors.error, fontSize: 12),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  static String _formatBytes(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)}KB';
    }
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / 1024 / 1024).toStringAsFixed(1)}MB';
    }
    return '${(bytes / 1024 / 1024 / 1024).toStringAsFixed(2)}GB';
  }
}

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
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _SummaryItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _SummaryItem({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(
        children: [
          Icon(icon, color: colors.onPrimaryContainer),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              color: colors.onPrimaryContainer,
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              color: colors.onPrimaryContainer.withOpacity(0.7),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryDivider extends StatelessWidget {
  const _SummaryDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 44,
      color: Theme.of(context)
          .colorScheme
          .onPrimaryContainer
          .withOpacity(0.18),
    );
  }
}
