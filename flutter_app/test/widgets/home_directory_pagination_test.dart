import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/data/models/comic.dart';
import 'package:nowen_reader/data/providers/comic_provider.dart';
import 'package:nowen_reader/data/models/server_branding.dart';
import 'package:nowen_reader/data/providers/server_branding_provider.dart';
import 'package:nowen_reader/features/home/home_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _DirectoryApi extends ComicApi {
  _DirectoryApi() : super(Dio());
  final requestedPages = <int>[];
  final requestedParents = <String>[];

  @override
  Future<Map<String, dynamic>> listComics({
    int page = 1,
    int limit = 20,
    String sort = 'addedAt',
    String order = 'desc',
    String? search,
    String? tag,
    String? category,
    String? type,
    String? readingStatus,
    bool? favoritesOnly,
    bool seriesView = false,
    String? libraryId,
    String? directoryPath,
  }) async =>
      {'comics': [], 'total': 0};

  @override
  Future<Map<String, dynamic>> getLibraryDirectories(
    String libraryId, {
    String parent = '',
    int page = 1,
    int pageSize = 100,
  }) async {
    requestedPages.add(page);
    requestedParents.add(parent);
    return {
      'libraryId': libraryId,
      'parent': parent,
      'seriesDepth': 2,
      'maxDirectoryDepth': 1,
      'directories': [
        if (parent.isEmpty)
          for (var i = (page - 1) * pageSize;
              i < 101 && i < page * pageSize;
              i++)
            {'name': '分类${i + 1}', 'path': '分类${i + 1}', 'workCount': 1},
      ],
      'total': parent.isEmpty ? 101 : 0,
      'page': page,
      'pageSize': pageSize,
      'totalPages': parent.isEmpty ? 2 : 1,
    };
  }
}

void main() {
  late Directory cookies;
  setUpAll(() async {
    cookies = await Directory.systemTemp.createTemp('nowen-directory-test-');
    persistCookieJar = PersistCookieJar(storage: FileStorage(cookies.path));
  });
  tearDownAll(() => cookies.delete(recursive: true));

  testWidgets('server title fits narrow shelves with large text',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(320, 760);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        comicApiProvider.overrideWithValue(_DirectoryApi()),
        comicListScopeProvider.overrideWithValue('server:alice:user'),
        accessibleLibrariesProvider.overrideWith((ref) async => const []),
        currentServerBrandingProvider
            .overrideWithValue(const ServerBranding(name: '这是一个很长的漫画服务器名称')),
      ],
      child: MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: const TextScaler.linear(2)),
          child: child!,
        ),
        home: const HomeScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('这是一个很长的漫画服务器名称'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });

  testWidgets(
      'directory controls reach category 101 and retain page on reader return',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final api = _DirectoryApi();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        currentServerBrandingProvider
            .overrideWithValue(const ServerBranding(name: '我的漫画服务器')),
        comicApiProvider.overrideWithValue(api),
        comicListScopeProvider.overrideWithValue('server:alice:user'),
        accessibleLibrariesProvider.overrideWith((ref) async => const [
              AccessibleLibrary(id: 'library', name: '漫画', seriesDepth: 2),
            ]),
      ],
      child: const MaterialApp(home: HomeScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.text('我的漫画服务器'), findsOneWidget);
    expect(find.text('1 / 2'), findsOneWidget);
    expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, '上一页'))
            .onPressed,
        isNull);
    await tester.tap(find.text('下一页'));
    await tester.pumpAndSettle();
    expect(find.text('分类101'), findsOneWidget);
    expect(find.text('2 / 2'), findsOneWidget);
    expect(api.requestedPages, [1, 2]);
    expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, '下一页'))
            .onPressed,
        isNull);

    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    navigator.push(MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: Text('reader'))));
    await tester.pumpAndSettle();
    navigator.pop();
    await tester.pumpAndSettle();
    expect(find.text('分类101'), findsOneWidget);
    expect(find.text('2 / 2'), findsOneWidget);
    expect(api.requestedPages, [1, 2]);

    await tester.tap(find.text('分类101'));
    await tester.pumpAndSettle();
    expect(api.requestedParents.last, '分类101');
    expect(api.requestedPages.last, 1);
    expect(find.text('2 / 2'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}
