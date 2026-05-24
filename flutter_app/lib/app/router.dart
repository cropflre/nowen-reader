import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/providers/auth_provider.dart';
import '../features/auth/login_screen.dart';
import '../features/detail/comic_detail_screen.dart';
import '../features/favorites/favorites_screen.dart';
import '../features/home/home_screen.dart';
import '../features/reader/comic_reader_screen.dart';
import '../features/reader/novel_reader_screen.dart';
import '../features/search/search_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/server/server_config_screen.dart';
import '../features/shell/app_shell.dart';
import '../features/stats/stats_screen.dart';
import '../features/groups/group_detail_screen.dart';
import '../features/collections/collections_screen.dart';
import '../features/metadata/metadata_screen.dart';
import '../features/tag_manager/tag_manager_screen.dart';
import '../features/upload/upload_screen.dart';
import '../features/scan_rules/scan_rules_screen.dart';
import '../features/stats/folder_tree_stats_screen.dart';
import '../features/settings/site_settings_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final isLoggedIn = authState.user != null;
      final hasServer = authState.serverUrl.isNotEmpty;
      final isServerPage = state.matchedLocation == '/server';
      final isLoginPage = state.matchedLocation == '/login';

      // 没有配置服务器地址 → 去配置页
      if (!hasServer && !isServerPage) return '/server';
      // 有服务器但未登录 → 去登录页（配置页除外）
      if (hasServer && !isLoggedIn && !isLoginPage && !isServerPage) {
        // 如果还在加载中（needsSetup 未确定），不跳转
        if (authState.isLoading) return null;
        return '/login';
      }
      // 已登录但在登录页 → 回首页
      if (isLoggedIn && isLoginPage) return '/';
      return null;
    },
    routes: [
      // 服务器配置（无 Shell）
      GoRoute(
        path: '/server',
        builder: (_, __) => const ServerConfigScreen(),
      ),
      // 登录（无 Shell）
      GoRoute(
        path: '/login',
        builder: (_, __) => const LoginScreen(),
      ),
      // 漫画阅读器（全屏，无 Shell）
      GoRoute(
        path: '/reader/:id',
        builder: (_, state) {
          final comicId = state.pathParameters['id']!;
          final pageStr = state.uri.queryParameters['page'];
          final initialPage = pageStr != null ? int.tryParse(pageStr) ?? 0 : 0;
          return ComicReaderScreen(comicId: comicId, initialPage: initialPage);
        },
      ),
      // 小说阅读器（全屏，无 Shell）
      GoRoute(
        path: '/novel/:id',
        builder: (_, state) {
          final comicId = state.pathParameters['id']!;
          final chapterStr = state.uri.queryParameters['chapter'];
          final initialChapter = chapterStr != null ? int.tryParse(chapterStr) ?? 0 : 0;
          return NovelReaderScreen(comicId: comicId, initialChapter: initialChapter);
        },
      ),
      // 主壳（带底部导航栏）
      ShellRoute(
        builder: (_, __, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (_, __) => const NoTransitionPage(child: HomeScreen()),
          ),
          GoRoute(
            path: '/search',
            pageBuilder: (_, __) => const NoTransitionPage(child: SearchScreen()),
          ),
          GoRoute(
            path: '/stats',
            pageBuilder: (_, __) => const NoTransitionPage(child: StatsScreen()),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (_, __) => const NoTransitionPage(child: SettingsScreen()),
          ),
        ],
      ),
      // 漫画详情
      GoRoute(
        path: '/comic/:id',
        builder: (_, state) => ComicDetailScreen(comicId: state.pathParameters['id']!),
      ),
      // 合集列表
      GoRoute(
        path: '/collections',
        builder: (_, __) => const CollectionsScreen(),
      ),
      // 分组详情
      GoRoute(
        path: '/group/:id',
        builder: (_, state) => GroupDetailScreen(groupId: int.parse(state.pathParameters['id']!)),
      ),
      // 元数据刮削
      GoRoute(
        path: '/metadata/:id',
        builder: (_, state) => MetadataScreen(comicId: state.pathParameters['id']!),
      ),
      // 标签与分类管理
      GoRoute(
        path: '/tag-manager',
        builder: (_, __) => const TagManagerScreen(),
      ),
      // 收藏管理
      GoRoute(
        path: '/favorites',
        builder: (_, __) => const FavoritesScreen(),
      ),
      // 文件上传
      GoRoute(
        path: '/upload',
        builder: (_, __) => const UploadScreen(),
      ),
      // 扫描规则管理
      GoRoute(
        path: '/scan-rules',
        builder: (_, __) => const ScanRulesScreen(),
      ),
      // 文件夹层级统计
      GoRoute(
        path: '/folder-tree-stats',
        builder: (_, __) => const FolderTreeStatsScreen(),
      ),
      // 站点设置
      GoRoute(
        path: '/site-settings',
        builder: (_, __) => const SiteSettingsScreen(),
      ),
    ],
  );
});
