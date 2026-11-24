import 'dart:async';
import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/features/reader/reader_dispatch_screen.dart';
import 'package:nowen_reader/features/reader/webtoon_view.dart';
import 'package:nowen_reader/widgets/reader_settings_panel.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _ComicApi extends ComicApi {
  _ComicApi() : super(Dio());

  final details = <String>[];
  final progress = <({String id, int page, bool finalize})>[];
  final firstFinish = Completer<void>();
  int seriesLookups = 0;

  @override
  Future<Map<String, dynamic>> getComic(String id) async {
    details.add(id);
    return {
      'id': id,
      'title': id,
      'filename': '重生之超级战神/$id.cbz',
      'libraryId': 'comics',
      'lastReadPage': 2,
    };
  }

  @override
  Future<List<ComicSeriesChapter>> getComicSeriesReadingOrder({
    required String comicId,
    required String libraryId,
    required String relativePath,
  }) async {
    seriesLookups++;
    expect(comicId, '9');
    expect(libraryId, 'comics');
    expect(relativePath, '重生之超级战神/9.cbz');
    if (seriesLookups == 1) throw StateError('temporary outage');
    return const [
      ComicSeriesChapter(comicId: '9'),
      ComicSeriesChapter(comicId: '10'),
      ComicSeriesChapter(comicId: '12'),
    ];
  }

  @override
  Future<Map<String, dynamic>> getPages(String comicId) async =>
      {'totalPages': 3};

  @override
  Future<void> warmupPages(String comicId, String sessionId,
      {required int startPage, required int count}) async {}

  @override
  Future<void> endWarmup(String comicId, String sessionId) async {}

  @override
  Future<void> recordReadingActivity({
    required String comicId,
    required String clientSessionId,
    required int page,
    required int totalPages,
    double? positionRatio,
    required int activeSeconds,
    required int sequence,
    bool finalize = false,
    bool trackProgress = true,
  }) async {
    progress.add((id: comicId, page: page, finalize: finalize));
    if (comicId == '9' && finalize) await firstFinish.future;
  }
}

void main() {
  late Directory cookies;
  setUp(() async {
    cookies = await Directory.systemTemp.createTemp('comic-chapter-cookies-');
    persistCookieJar = PersistCookieJar(storage: FileStorage(cookies.path));
  });
  tearDown(() => cookies.delete(recursive: true));

  testWidgets('continues at page one, saves each tail and preserves Back',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'reader_mode': ComicReadingMode.webtoon.index,
      'reader_settings_version': ReaderSettings.settingsVersion,
    });
    for (final id in ['9', '10', '12']) {
      for (var page = 0; page < 3; page++) {
        unawaited(readerImageLoader.load(getImageUrl('', id, page: page),
            readLocal: () => Completer<Never>().future));
      }
    }
    final api = _ComicApi();
    final router = GoRouter(routes: [
      GoRoute(path: '/', builder: (_, __) => const Text('作品章节列表')),
      GoRoute(
        path: '/reader/:id',
        builder: (_, state) {
          final id = state.pathParameters['id']!;
          final extra = state.extra;
          return ReaderDispatchScreen(
            key: ValueKey(id),
            comicId: id,
            initialPosition: int.tryParse(state.uri.queryParameters['page']!),
            nextChapterIds:
                extra is List ? extra.whereType<String>().toList() : null,
          );
        },
      ),
    ]);
    addTearDown(router.dispose);
    addTearDown(readerImageLoader.clear);
    await tester.pumpWidget(ProviderScope(
      overrides: [comicApiProvider.overrideWithValue(api)],
      child: MaterialApp.router(routerConfig: router),
    ));
    unawaited(router.push<void>('/reader/9?page=1'));

    Future<void> pumpRoute() async {
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump();
    }

    await pumpRoute();

    WebtoonView current() => tester.widget(find.byType(WebtoonView));

    Future<void> advance() async {
      final controller = current().controller;
      controller.jumpTo(controller.position.maxScrollExtent);
      await tester.pump();
      expect(controller.position.extentAfter, 0);
      current().onNextChapter!();
      await tester.pump();
    }

    expect(current().comicId, '9');
    await advance();
    expect(find.text('无法加载下一章，请再试一次'), findsOneWidget);
    expect(current().comicId, '9');
    expect(api.progress.where((event) => event.finalize), isEmpty);
    await tester.pump(const Duration(seconds: 5));
    await pumpRoute();

    await advance();
    expect(api.progress.last, (id: '9', page: 2, finalize: true));
    expect(current().comicId, '9');
    expect(current().onNextChapter, isNull);
    api.firstFinish.complete();
    await pumpRoute();
    expect(current().comicId, '10');
    expect(current().controller.page, 0);
    expect(api.progress.last, (id: '10', page: 0, finalize: false));

    await advance();
    await pumpRoute();
    expect(current().comicId, '12');
    expect(current().controller.page, 0);
    expect(current().onNextChapter, isNull);
    expect(api.progress, contains((id: '10', page: 2, finalize: true)));
    expect(api.details, ['9', '10', '12']);
    expect(api.seriesLookups, 2);

    await tester.tap(find.byType(WebtoonView));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.arrow_back));
    await pumpRoute();
    expect(find.text('作品章节列表'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
