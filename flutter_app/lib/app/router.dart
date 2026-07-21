import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/providers/auth_provider.dart';
import '../features/auth/login_screen.dart';
import '../features/cache/cache_screen.dart';
import '../features/collections/collections_screen.dart';
import '../features/detail/comic_detail_screen.dart';
import '../features/favorites/favorites_screen.dart';
import '../features/groups/group_detail_screen.dart';
import '../features/home/home_screen.dart';
import '../features/metadata/metadata_screen.dart';
import '../features/reader/comic_reader_screen.dart';
import '../features/reader/novel_reader_screen.dart';
import '../features/reader/offline_novel_reader_screen.dart';
import '../features/reader/pdf_reader_screen.dart';
import '../features/scan_rules/scan_rules_screen.dart';
import '../features/search/search_screen.dart';
import '../features/server/server_config_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/settings/site_settings_screen.dart';
import '../features/shell/app_shell.dart';
import '../features/stats/folder_tree_stats_screen.dart';
import '../features/stats/stats_screen.dart';
import '../features/tag_manager/tag_manager_screen.dart';
import '../features/upload/upload_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final location = state.matchedLocation;
      final isLoggedIn = authState.user != null;
      final hasServer = authState.serverUrl.isNotEmpty;
      final isServerPage = location == '/server';
      final isLoginPage = location == '/login';
      final isCachePage = location == '/cache';
      final isOfflineReader = location.startsWith('/offline/novel/');

      if (!hasServer && !isServerPage) return '/server';

      if (authState.connectionStatus == ServerConnectionStatus.offline) {
        if (isServerPage || isCachePage || isOfflineReader) return null;
        return '/cache';
      }

      if (authState.isLoading ||
          authState.connectionStatus == ServerConnectionStatus.checking) {
        return null;
      }

      if (hasServer && !isLoggedIn && !isLoginPage && !isServerPage) {
        return '/login';
      }

      if (isLoggedIn && isLoginPage) return '/';
      return null;
    },
    routes: [
      GoRoute(
        path: '/server',
        builder: (_, __) => const ServerConfigScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: '/reader/:id',
        builder: (_, state) {
          final comicId = state.pathParameters['id']!;
          final pageStr = state.uri.queryParameters['page'];
          final initialPage = pageStr != null ? int.tryParse(pageStr) ?? 0 : 0;
          return ComicReaderScreen(
            comicId: comicId,
            initialPage: initialPage,
          );
        },
      ),
      GoRoute(
        path: '/novel/:id',
        builder: (_, state) {
          final comicId = state.pathParameters['id']!;
          final chapterStr = state.uri.queryParameters['chapter'];
          final initialChapter =
              chapterStr != null ? int.tryParse(chapterStr) ?? 0 : 0;
          return NovelReaderScreen(
            comicId: comicId,
            initialChapter: initialChapter,
          );
        },
      ),
      GoRoute(
        path: '/offline/novel/:id',
        builder: (_, state) {
          final comicId = state.pathParameters['id']!;
          final chapterStr = state.uri.queryParameters['chapter'];
          final initialChapter =
              chapterStr != null ? int.tryParse(chapterStr) : null;
          return OfflineNovelReaderScreen(
            comicId: comicId,
            initialChapter: initialChapter,
          );
        },
      ),
      GoRoute(
        path: '/pdf/:id',
        builder: (_, state) {
          final comicId = state.pathParameters['id']!;
          final pageStr = state.uri.queryParameters['page'];
          final initialPage = pageStr != null ? int.tryParse(pageStr) ?? 0 : 0;
          return PdfReaderScreen(comicId: comicId, initialPage: initialPage);
        },
      ),
      ShellRoute(
        builder: (_, __, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (_, __) =>
                const NoTransitionPage(child: HomeScreen()),
          ),
          GoRoute(
            path: '/search',
            pageBuilder: (_, __) =>
                const NoTransitionPage(child: SearchScreen()),
          ),
          GoRoute(
            path: '/stats',
            pageBuilder: (_, __) =>
                const NoTransitionPage(child: StatsScreen()),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (_, __) =>
                const NoTransitionPage(child: SettingsScreen()),
          ),
        ],
      ),
      GoRoute(
        path: '/comic/:id',
        builder: (_, state) =>
            ComicDetailScreen(comicId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/collections',
        builder: (_, __) => const CollectionsScreen(),
      ),
      GoRoute(
        path: '/group/:id',
        builder: (_, state) => GroupDetailScreen(
          groupId: int.parse(state.pathParameters['id']!),
        ),
      ),
      GoRoute(
        path: '/metadata/:id',
        builder: (_, state) =>
            MetadataScreen(comicId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/tag-manager',
        builder: (_, __) => const TagManagerScreen(),
      ),
      GoRoute(
        path: '/favorites',
        builder: (_, __) => const FavoritesScreen(),
      ),
      GoRoute(
        path: '/upload',
        builder: (_, __) => const UploadScreen(),
      ),
      GoRoute(
        path: '/scan-rules',
        builder: (_, __) => const ScanRulesScreen(),
      ),
      GoRoute(
        path: '/folder-tree-stats',
        builder: (_, __) => const FolderTreeStatsScreen(),
      ),
      GoRoute(
        path: '/site-settings',
        builder: (_, __) => const SiteSettingsScreen(),
      ),
      GoRoute(
        path: '/cache',
        builder: (_, __) => const CacheScreen(),
      ),
    ],
  );
});
