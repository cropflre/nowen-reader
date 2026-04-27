import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers/auth_provider.dart';
import '../../data/api/api_client.dart';
import '../../data/api/comic_api.dart';
import '../../l10n/app_localizations.dart';
import '../metadata/metadata_screen.dart';

/// 设置页面
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final cs = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final isAdmin = user?.isAdmin ?? false;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settings)),
      body: ListView(
        children: [
          // 用户信息
          if (user != null) ...[
            _buildSectionTitle(context, l10n.account),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: cs.primaryContainer,
                child: Text(
                  user.nickname.isNotEmpty
                      ? user.nickname[0].toUpperCase()
                      : user.username[0].toUpperCase(),
                  style: TextStyle(color: cs.onPrimaryContainer),
                ),
              ),
              title: Text(user.nickname.isNotEmpty ? user.nickname : user.username),
              subtitle: Text(
                [
                  '@${user.username}',
                  user.isAdmin ? l10n.admin : l10n.user,
                ].join(' · '),
              ),
            ),
          ],

          const Divider(),
          _buildSectionTitle(context, l10n.serverInfo),

          // 服务器信息
          ListTile(
            leading: const Icon(Icons.dns_outlined),
            title: Text(l10n.serverAddress),
            subtitle: Text(authState.serverUrl),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showServerInfo(context, ref),
          ),

          // 服务器历史列表
          ListTile(
            leading: const Icon(Icons.history),
            title: const Text('服务器列表'),
            subtitle: const Text('切换到之前登录过的服务器'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showServerHistory(context, ref),
          ),

          const Divider(),
          _buildSectionTitle(context, l10n.dataManagement),

          // 收藏管理
          ListTile(
            leading: const Icon(Icons.favorite_outlined),
            title: Text(l10n.favorites),
            subtitle: const Text('查看和管理收藏的书籍'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/favorites'),
          ),

          // 合集管理
          ListTile(
            leading: const Icon(Icons.layers_outlined),
            title: const Text('合集管理'),
            subtitle: const Text('管理系列分组与合集'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/collections'),
          ),

          // 标签与分类管理（管理员可见）
          if (isAdmin)
            ListTile(
              leading: const Icon(Icons.label_outlined),
              title: Text(l10n.tagManager),
              subtitle: const Text('管理标签和分类'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/tag-manager'),
            ),

          // 扫描文库（管理员可见）
          if (isAdmin)
            _ScanLibraryTile(ref: ref),

          // 批量刮削元数据（管理员可见）
          if (isAdmin)
            ListTile(
              leading: const Icon(Icons.auto_fix_high),
              title: Text(l10n.batchScrapeMetadata),
              subtitle: Text(l10n.batchScrapeDesc),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                showDialog(
                  context: context,
                  builder: (_) => const BatchMetadataDialog(),
                );
              },
            ),

          const Divider(),
          _buildSectionTitle(context, l10n.about),

          ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text(l10n.version),
            subtitle: const Text('1.0.0'),
          ),

          ListTile(
            leading: const Icon(Icons.code_outlined),
            title: const Text('NowenReader'),
            subtitle: const Text('漫画/小说阅读器'),
          ),

          const Divider(),

          // 退出登录
          ListTile(
            leading: Icon(Icons.logout, color: cs.error),
            title: Text(l10n.logout, style: TextStyle(color: cs.error)),
            onTap: () async {
              final confirm = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: Text(l10n.logout),
                  content: Text(l10n.logoutConfirm),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: Text(l10n.cancel),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: Text(l10n.logout),
                    ),
                  ],
                ),
              );
              if (confirm == true) {
                await ref.read(authProvider.notifier).logout();
                if (context.mounted) context.go('/login');
              }
            },
          ),

          // 切换服务器
          ListTile(
            leading: Icon(Icons.swap_horiz, color: cs.onSurfaceVariant),
            title: Text(l10n.switchServer),
            onTap: () async {
              await ref.read(authProvider.notifier).logout();
              await saveServerUrl('');
              ref.invalidate(serverUrlProvider);
              if (context.mounted) context.go('/server');
            },
          ),

          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(BuildContext context, String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }

  void _showServerInfo(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    showDialog(
      context: context,
      builder: (ctx) {
        final serverUrl = ref.read(authProvider).serverUrl;
        return AlertDialog(
          title: Text(l10n.serverInfo),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${l10n.serverAddress}: $serverUrl'),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(l10n.close),
            ),
          ],
        );
      },
    );
  }

  /// 显示服务器历史列表弹窗
  void _showServerHistory(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _ServerHistorySheet(parentRef: ref),
    );
  }
}

/// 服务器历史列表 BottomSheet
class _ServerHistorySheet extends ConsumerStatefulWidget {
  final WidgetRef parentRef;
  const _ServerHistorySheet({required this.parentRef});

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
    if (mounted) {
      setState(() {
        _history = history;
        _loading = false;
      });
    }
  }

  Future<void> _switchToServer(ServerRecord record) async {
    final currentUrl = ref.read(authProvider).serverUrl;
    if (record.url == currentUrl) {
      Navigator.pop(context);
      return;
    }

    setState(() => _switching = true);

    // 先退出当前登录
    await ref.read(authProvider.notifier).logout();
    // 设置新的服务器地址
    final ok = await ref.read(authProvider.notifier).setServerUrl(record.url);

    if (!mounted) return;
    setState(() => _switching = false);

    if (ok) {
      Navigator.pop(context);
      // 跳转到登录页
      if (context.mounted) context.go('/login');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('无法连接到 ${record.url}'),
          behavior: SnackBarBehavior.floating,
        ),
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
    final currentUrl = ref.watch(authProvider).serverUrl;

    return DraggableScrollableSheet(
      initialChildSize: 0.5,
      minChildSize: 0.3,
      maxChildSize: 0.8,
      expand: false,
      builder: (context, scrollController) {
        return Column(
          children: [
            // 拖拽指示条
            Container(
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: cs.onSurfaceVariant.withOpacity(0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            // 标题
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Icon(Icons.dns_outlined, color: cs.primary),
                  const SizedBox(width: 8),
                  Text(
                    '服务器列表',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const Spacer(),
                  // 添加新服务器按钮
                  TextButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      context.go('/server');
                    },
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('添加'),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            // 列表
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _history.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.dns_outlined,
                                  size: 48, color: cs.onSurfaceVariant),
                              const SizedBox(height: 12),
                              Text(
                                '暂无服务器记录',
                                style:
                                    TextStyle(color: cs.onSurfaceVariant),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                '登录后会自动保存服务器记录',
                                style: TextStyle(
                                  color: cs.onSurfaceVariant,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        )
                      : ListView.builder(
                          controller: scrollController,
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
            // 加载遮罩
            if (_switching)
              Container(
                color: Colors.black12,
                child: const Center(
                  child: CircularProgressIndicator(),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// 服务器记录列表项
class _ServerRecordTile extends StatelessWidget {
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
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return ListTile(
      leading: CircleAvatar(
        backgroundColor:
            isCurrent ? cs.primaryContainer : cs.surfaceContainerHighest,
        child: Icon(
          isCurrent ? Icons.check : Icons.dns_outlined,
          color: isCurrent ? cs.onPrimaryContainer : cs.onSurfaceVariant,
          size: 20,
        ),
      ),
      title: Text(
        record.url,
        style: TextStyle(
          fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
          color: isCurrent ? cs.primary : null,
        ),
      ),
      subtitle: Text(
        [
          if (record.username != null) '@${record.username}',
          if (record.nickname != null && record.nickname!.isNotEmpty)
            record.nickname!,
          _formatTime(record.lastUsed),
        ].join(' · '),
        style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
      ),
      trailing: isCurrent
          ? Chip(
              label: const Text('当前', style: TextStyle(fontSize: 11)),
              backgroundColor: cs.primaryContainer,
              side: BorderSide.none,
              padding: EdgeInsets.zero,
              visualDensity: VisualDensity.compact,
            )
          : IconButton(
              icon: Icon(Icons.delete_outline,
                  size: 20, color: cs.onSurfaceVariant),
              onPressed: onDelete,
            ),
      onTap: switching ? null : onTap,
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

/// 扫描文库按钮（带加载状态）
class _ScanLibraryTile extends ConsumerStatefulWidget {
  final WidgetRef ref;
  const _ScanLibraryTile({required this.ref});

  @override
  ConsumerState<_ScanLibraryTile> createState() => _ScanLibraryTileState();
}

class _ScanLibraryTileState extends ConsumerState<_ScanLibraryTile> {
  bool _scanning = false;

  Future<void> _triggerScan() async {
    if (_scanning) return;
    setState(() => _scanning = true);
    try {
      final api = ref.read(comicApiProvider);
      await api.triggerSync();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('扫描文库已触发，后台正在同步...'),
            behavior: SnackBarBehavior.floating,
            duration: Duration(seconds: 3),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('扫描失败: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: _scanning
          ? const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.refresh),
      title: const Text('扫描文库'),
      subtitle: const Text('重新扫描漫画和电子书目录'),
      onTap: _scanning ? null : _triggerScan,
    );
  }
}
