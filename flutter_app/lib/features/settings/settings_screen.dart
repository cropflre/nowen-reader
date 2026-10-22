import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers/auth_provider.dart';
import '../../data/providers/app_version_provider.dart';
import '../../data/api/comic_api.dart';
import '../../data/providers/cache_provider.dart';
import '../../data/services/cache_service.dart';
import '../../l10n/app_localizations.dart';
import '../metadata/metadata_screen.dart';
import '../../widgets/animations.dart';
import '../../data/providers/server_route_provider.dart';

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
    final routes = ref.watch(serverRouteProvider);
    final latency = routes.latencies[routes.activeUrl];
    final routeLabel = routes.activeUrl == routes.config.backupUrl
        ? '备用线路'
        : '主线路';
    final latencyLabel = routes.measuring
        ? '测速中…'
        : latency != null
            ? '${latency.ceil().clamp(1, 999999)} ms'
            : routes.latencies.containsKey(routes.activeUrl)
                ? '不可达'
                : '未检测';
    final serverSubtitle = routes.activeUrl.isEmpty
        ? '地址、线路与服务器列表'
        : '$routeLabel · $latencyLabel';

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
            child: _SettingsGroup(
              children: [
                _SettingsTile(
                  icon: Icons.dns_outlined,
                  iconColor: cs.primary,
                  title: '服务器设置',
                  subtitle: serverSubtitle,
                  onTap: () => context.push('/settings/server'),
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
                const _OfflineCacheTile(),
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
                subtitle: ref.watch(appVersionProvider).when(
                  data: (version) => version,
                  loading: () => '…',
                  error: (_, __) => '暂时无法读取版本',
                ),
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
            ],
          ),

          const SizedBox(height: 40),
        ],
      ),
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

// ============================================================
// 离线缓存入口
// ============================================================

class _OfflineCacheTile extends ConsumerWidget {
  const _OfflineCacheTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entries = ref.watch(cacheEntriesProvider);
    final cachedCount = entries.where((e) => e.isComplete).length;
    final downloadingCount =
        entries.where((e) => e.status == CacheStatus.downloading).length;

    String subtitle;
    if (downloadingCount > 0) {
      subtitle = '下载中 $downloadingCount 本';
    } else if (cachedCount > 0) {
      subtitle = '已缓存 $cachedCount 本 · ${cacheService.totalCacheSizeStr}';
    } else {
      subtitle = '下载书籍到本地，离线也能阅读';
    }

    return _SettingsTile(
      icon: Icons.download_rounded,
      iconColor: Colors.teal,
      title: '离线缓存',
      subtitle: subtitle,
      onTap: () => context.push('/cache'),
    );
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
