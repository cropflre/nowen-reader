import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers/auth_provider.dart';
import '../../data/api/api_client.dart';
import '../../data/api/comic_api.dart';
import '../../l10n/app_localizations.dart';
import '../metadata/metadata_screen.dart';
import '../../widgets/animations.dart';

/// 设置页面 — 极简优雅风格
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
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          const SizedBox(height: 8),

          // ─── 用户信息卡片 ───
          if (user != null)
            SlideAndFade(
              delay: const Duration(milliseconds: 100),
              child: Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    cs.primary,
                    cs.primary.withOpacity(0.75),
                  ],
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
                  // 头像
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Center(
                      child: Text(
                        user.nickname.isNotEmpty
                            ? user.nickname[0].toUpperCase()
                            : user.username[0].toUpperCase(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user.nickname.isNotEmpty ? user.nickname : user.username,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '@${user.username} · ${user.isAdmin ? l10n.admin : l10n.user}',
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.75),
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 24),

          // ─── 服务器 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 200),
            child: _SectionHeader(title: l10n.serverInfo),
          ),
          const SizedBox(height: 8),
          SlideAndFade(
            delay: const Duration(milliseconds: 250),
            child: _SettingsGroup(
              children: [
                _SettingsTile(
                  icon: Icons.dns_outlined,
                  iconColor: cs.primary,
                  title: l10n.serverAddress,
                  subtitle: authState.serverUrl,
                  onTap: () => _showServerInfo(context, ref),
                ),
                _SettingsTile(
                  icon: Icons.history_rounded,
                  iconColor: cs.secondary,
                  title: '服务器列表',
                  subtitle: '切换到之前登录过的服务器',
                  onTap: () => _showServerHistory(context, ref),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // ─── 数据管理 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 300),
            child: _SectionHeader(title: l10n.dataManagement),
          ),
          const SizedBox(height: 8),
          SlideAndFade(
            delay: const Duration(milliseconds: 350),
            child: _SettingsGroup(
              children: [
                _SettingsTile(
                  icon: Icons.favorite_rounded,
                  iconColor: const Color(0xFFFF6B6B),
                  title: l10n.favorites,
                  subtitle: '查看和管理收藏的书籍',
                  onTap: () => context.push('/favorites'),
                ),
                _SettingsTile(
                  icon: Icons.collections_bookmark_rounded,
                  iconColor: cs.tertiary,
                  title: '合集管理',
                  subtitle: '管理系列分组与合集',
                  onTap: () => context.push('/collections'),
                ),
                if (isAdmin)
                  _SettingsTile(
                    icon: Icons.label_outlined,
                    iconColor: Colors.orange,
                    title: l10n.tagManager,
                    subtitle: '管理标签和分类',
                    onTap: () => context.push('/tag-manager'),
                  ),
              ],
            ),
          ),

          // ─── 管理员工具 ───
          if (isAdmin) ...[
            const SizedBox(height: 24),
            _SectionHeader(title: '管理工具'),
            const SizedBox(height: 8),
            _SettingsGroup(
              children: [
                _ScanLibraryTile(ref: ref),
                _SettingsTile(
                  icon: Icons.auto_fix_high_rounded,
                  iconColor: Colors.purple,
                  title: l10n.batchScrapeMetadata,
                  subtitle: l10n.batchScrapeDesc,
                  onTap: () {
                    showDialog(
                      context: context,
                      builder: (_) => const BatchMetadataDialog(),
                    );
                  },
                ),
                _SettingsTile(
                  icon: Icons.cloud_upload_rounded,
                  iconColor: Colors.blue,
                  title: '上传文件',
                  subtitle: '上传漫画/小说到书库',
                  onTap: () => context.push('/upload'),
                ),
                _SettingsTile(
                  icon: Icons.auto_awesome_rounded,
                  iconColor: Colors.deepPurple,
                  title: '扫描规则',
                  subtitle: 'AI 智能识别 + 虚拟归类',
                  onTap: () => context.push('/scan-rules'),
                ),
                _SettingsTile(
                  icon: Icons.account_tree_rounded,
                  iconColor: Colors.teal,
                  title: '文件夹统计',
                  subtitle: '查看文件夹层级结构与统计',
                  onTap: () => context.push('/folder-tree-stats'),
                ),
                _SettingsTile(
                  icon: Icons.settings_applications_rounded,
                  iconColor: Colors.indigo,
                  title: '站点设置',
                  subtitle: '电子书类型识别策略等',
                  onTap: () => context.push('/site-settings'),
                ),
              ],
            ),
          ],

          const SizedBox(height: 24),

          // ─── 关于 ───
          _SectionHeader(title: l10n.about),
          const SizedBox(height: 8),
          _SettingsGroup(
            children: [
              _SettingsTile(
                icon: Icons.info_outline_rounded,
                iconColor: cs.onSurfaceVariant,
                title: l10n.version,
                subtitle: '1.0.0',
                showArrow: false,
              ),
              _SettingsTile(
                icon: Icons.auto_stories_rounded,
                iconColor: cs.primary,
                title: 'NowenReader',
                subtitle: '漫画/小说阅读器',
                showArrow: false,
              ),
            ],
          ),

          const SizedBox(height: 24),

          // ─── 账户操作 ───
          _SettingsGroup(
            children: [
              _SettingsTile(
                icon: Icons.logout_rounded,
                iconColor: cs.error,
                title: l10n.logout,
                titleColor: cs.error,
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
                          style: FilledButton.styleFrom(
                            backgroundColor: cs.error,
                          ),
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
              _SettingsTile(
                icon: Icons.swap_horiz_rounded,
                iconColor: cs.onSurfaceVariant,
                title: l10n.switchServer,
                onTap: () async {
                  await ref.read(authProvider.notifier).logout();
                  await saveServerUrl('');
                  ref.invalidate(serverUrlProvider);
                  if (context.mounted) context.go('/server');
                },
              ),
            ],
          ),

          const SizedBox(height: 40),
        ],
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

  void _showServerHistory(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _ServerHistorySheet(parentRef: ref),
    );
  }
}

/// 区域标题
class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.onSurfaceVariant.withOpacity(0.6),
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

/// 设置项分组容器
class _SettingsGroup extends StatelessWidget {
  final List<Widget> children;
  const _SettingsGroup({required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(16),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (int i = 0; i < children.length; i++) ...[
            children[i],
            if (i < children.length - 1)
              Divider(
                height: 0.5,
                indent: 56,
                color: Theme.of(context).dividerTheme.color?.withOpacity(0.3),
              ),
          ],
        ],
      ),
    );
  }
}

/// 设置项
class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String? subtitle;
  final Color? titleColor;
  final VoidCallback? onTap;
  final bool showArrow;

  const _SettingsTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    this.subtitle,
    this.titleColor,
    this.onTap,
    this.showArrow = true,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              // 图标
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: iconColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(icon, size: 18, color: iconColor),
              ),
              const SizedBox(width: 14),
              // 文字
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                        color: titleColor ?? cs.onSurface,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: TextStyle(
                          fontSize: 12,
                          color: cs.onSurfaceVariant.withOpacity(0.6),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              // 箭头
              if (showArrow && onTap != null)
                Icon(
                  Icons.chevron_right_rounded,
                  size: 20,
                  color: cs.onSurfaceVariant.withOpacity(0.3),
                ),
            ],
          ),
        ),
      ),
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
    final currentUrl = ref.watch(authProvider).serverUrl;

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
                                  size: 40, color: cs.onSurfaceVariant.withOpacity(0.3)),
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

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Material(
        color: isCurrent
            ? cs.primary.withOpacity(0.06)
            : Colors.transparent,
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
                  child: Icon(
                    isCurrent ? Icons.check_rounded : Icons.dns_outlined,
                    color: isCurrent ? cs.primary : cs.onSurfaceVariant.withOpacity(0.5),
                    size: 18,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        record.url,
                        style: TextStyle(
                          fontWeight: isCurrent ? FontWeight.w600 : FontWeight.w500,
                          color: isCurrent ? cs.primary : cs.onSurface,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          if (record.username != null) '@${record.username}',
                          if (record.nickname != null && record.nickname!.isNotEmpty)
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
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
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

/// 扫描文库按钮
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
          const SnackBar(content: Text('扫描文库已触发，后台正在同步...')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('扫描失败: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _SettingsTile(
      icon: _scanning ? Icons.sync_rounded : Icons.refresh_rounded,
      iconColor: Colors.teal,
      title: '扫描文库',
      subtitle: '重新扫描漫画和电子书目录',
      onTap: _scanning ? null : _triggerScan,
    );
  }
}
