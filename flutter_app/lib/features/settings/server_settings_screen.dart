import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api/api_client.dart';
import '../../data/providers/auth_provider.dart';
import '../../data/providers/server_route_provider.dart';
import '../../data/providers/server_branding_provider.dart';
import '../../widgets/server_logo.dart';
import '../../l10n/app_localizations.dart';
import 'server_route_settings.dart';

class ServerSettingsScreen extends ConsumerWidget {
  const ServerSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final branding = ref.watch(currentServerBrandingProvider);
    final activeUrl = ref.watch(serverUrlProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('服务器设置')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: ServerLogo(branding: branding),
            title: Text(branding.name,
                maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle:
                Text(activeUrl, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          const ServerRouteSettings(),
          const SizedBox(height: 16),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: Icon(Icons.history_rounded, color: colors.primary),
                  title: const Text('服务器列表'),
                  subtitle: const Text('管理之前登录过的服务器'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => const _ServerHistorySheet(),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                ListTile(
                  leading:
                      Icon(Icons.swap_horiz_rounded, color: colors.primary),
                  title: Text(l10n.switchServer),
                  subtitle: const Text('连接其他服务器'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () async {
                    await ref.read(authProvider.notifier).logout();
                    await saveServerUrl('');
                    ref.invalidate(serverUrlProvider);
                    if (context.mounted) context.go('/server');
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 服务器历史列表 BottomSheet
class _ServerHistorySheet extends ConsumerStatefulWidget {
  const _ServerHistorySheet();

  @override
  ConsumerState<_ServerHistorySheet> createState() =>
      _ServerHistorySheetState();
}

class _ServerHistorySheetState extends ConsumerState<_ServerHistorySheet> {
  List<ServerRecord> _history = [];
  bool _loading = true;
  bool _switching = false;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    final history = await loadServerHistory();
    if (!mounted) return;
    await ref
        .read(serverBrandingProvider.notifier)
        .loadCached(history.map((record) => record.url));
    if (mounted) {
      setState(() {
        _history = history;
        _loading = false;
      });
    }
  }

  Future<void> _switchToServer(ServerRecord record) async {
    final currentUrl = ref.read(serverRouteProvider).config.primaryUrl;
    if (record.url == currentUrl) {
      Navigator.pop(context);
      return;
    }

    setState(() => _switching = true);
    await ref.read(authProvider.notifier).logout();
    final ok = await ref.read(authProvider.notifier).setServerUrl(record.url);

    if (!mounted) return;
    setState(() => _switching = false);

    if (ok) {
      Navigator.pop(context);
      if (context.mounted) context.go('/login');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('无法连接到 ${record.url}')),
      );
    }
  }

  Future<void> _removeRecord(ServerRecord record) async {
    await removeServerRecord(record.url);
    await _loadHistory();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final currentUrl = ref.watch(serverRouteProvider).config.primaryUrl;

    return DraggableScrollableSheet(
      initialChildSize: 0.5,
      minChildSize: 0.3,
      maxChildSize: 0.8,
      expand: false,
      builder: (context, scrollController) {
        return Column(
          children: [
            // 标题
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 16, 8),
              child: Row(
                children: [
                  Text(
                    '服务器列表',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: cs.onSurface,
                    ),
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      context.go('/server');
                    },
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: const Text('添加'),
                  ),
                ],
              ),
            ),
            Divider(height: 0.5, color: cs.outlineVariant.withOpacity(0.3)),
            // 列表
            Expanded(
              child: _loading
                  ? const Center(
                      child: SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(strokeWidth: 2.5),
                      ),
                    )
                  : _history.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.dns_outlined,
                                  size: 40,
                                  color: cs.onSurfaceVariant.withOpacity(0.3)),
                              const SizedBox(height: 12),
                              Text(
                                '暂无服务器记录',
                                style: TextStyle(
                                  color: cs.onSurfaceVariant.withOpacity(0.5),
                                  fontSize: 14,
                                ),
                              ),
                            ],
                          ),
                        )
                      : ListView.builder(
                          controller: scrollController,
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          itemCount: _history.length,
                          itemBuilder: (context, index) {
                            final record = _history[index];
                            final isCurrent = record.url == currentUrl;
                            return _ServerRecordTile(
                              record: record,
                              isCurrent: isCurrent,
                              switching: _switching,
                              onTap: () => _switchToServer(record),
                              onDelete: () => _removeRecord(record),
                            );
                          },
                        ),
            ),
          ],
        );
      },
    );
  }
}

/// 服务器记录列表项
class _ServerRecordTile extends ConsumerWidget {
  final ServerRecord record;
  final bool isCurrent;
  final bool switching;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _ServerRecordTile({
    required this.record,
    required this.isCurrent,
    required this.switching,
    required this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = Theme.of(context).colorScheme;
    final branding = ref.watch(cachedServerBrandingProvider(record.url));

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Material(
        color: isCurrent ? cs.primary.withOpacity(0.06) : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: switching ? null : onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: isCurrent
                        ? cs.primary.withOpacity(0.15)
                        : cs.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: ServerLogo(branding: branding, size: 38),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        branding.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight:
                              isCurrent ? FontWeight.w600 : FontWeight.w500,
                          color: isCurrent ? cs.primary : cs.onSurface,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(record.url,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 12, color: cs.onSurfaceVariant)),
                      const SizedBox(height: 2),
                      Text(
                        [
                          if (record.username != null) '@${record.username}',
                          if (record.nickname != null &&
                              record.nickname!.isNotEmpty)
                            record.nickname!,
                          _formatTime(record.lastUsed),
                        ].join(' · '),
                        style: TextStyle(
                          fontSize: 11,
                          color: cs.onSurfaceVariant.withOpacity(0.5),
                        ),
                      ),
                    ],
                  ),
                ),
                if (isCurrent)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: cs.primary.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '当前',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: cs.primary,
                      ),
                    ),
                  )
                else
                  IconButton(
                    icon: Icon(Icons.delete_outline_rounded,
                        size: 18, color: cs.onSurfaceVariant.withOpacity(0.3)),
                    onPressed: onDelete,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _formatTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);
    if (diff.inMinutes < 1) return '刚刚';
    if (diff.inHours < 1) return '${diff.inMinutes}分钟前';
    if (diff.inDays < 1) return '${diff.inHours}小时前';
    if (diff.inDays < 30) return '${diff.inDays}天前';
    return '${time.month}/${time.day}';
  }
}
