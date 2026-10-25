import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/features/reader/comic_reader_screen.dart';
import 'package:nowen_reader/features/reader/webtoon_view.dart';
import 'package:nowen_reader/widgets/reader_settings_panel.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _server = 'https://reader.test';

Future<Uint8List> _png(WidgetTester tester, int height) async {
  return (await tester.runAsync(() async {
    final image = await createTestImage(width: 100, height: height);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    return data!.buffer.asUint8List();
  }))!;
}

List<Completer<Uint8List?>> _pendingPages(int count,
    {String server = _server}) {
  return List.generate(count, (index) {
    final gate = Completer<Uint8List?>();
    unawaited(readerImageLoader.load(getImageUrl(server, 'book', page: index),
        readLocal: () => gate.future));
    return gate;
  });
}

Future<void> _frames(WidgetTester tester) async {
  // Let the engine parse headers and decode outside the fake test clock.
  for (var i = 0; i < 5; i++) {
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
  }
}

Widget _view(WebtoonController controller, List<int> pages,
        {int initialPage = 0, double width = 800, String server = _server}) =>
    MaterialApp(
        home: Scaffold(
            body: Center(
                child: SizedBox(
      width: width,
      height: 600,
      child: WebtoonView(
        controller: controller,
        comicId: 'book',
        serverUrl: server,
        pageCount: 30,
        initialPage: initialPage,
        onPageChanged: pages.add,
      ),
    ))));

Future<void> _cleanup(WidgetTester tester, WebtoonController controller) async {
  await tester.pumpWidget(const SizedBox());
  controller.dispose();
  readerImageLoader.clear();
}

class _ComicApi extends ComicApi {
  _ComicApi() : super(Dio());
  final savedPages = <int>[];

  @override
  Future<Map<String, dynamic>> getPages(String comicId) async =>
      {'totalPages': 30};

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
    required int activeSeconds,
    required int sequence,
    bool finalize = false,
    bool trackProgress = true,
  }) async {
    savedPages.add(page);
  }
}

void main() {
  late Directory cookies;
  setUpAll(() async {
    cookies = await Directory.systemTemp.createTemp('webtoon-cookies-');
    persistCookieJar = PersistCookieJar(storage: FileStorage(cookies.path));
  });
  tearDownAll(() => cookies.delete(recursive: true));
  setUp(() => readerImageLoader.clear());

  testWidgets(
      'fast flings while images arrive never reset progress to page one',
      (tester) async {
    final bytes = await _png(tester, 150);
    final pending = _pendingPages(30);
    final controller = WebtoonController();
    final pages = <int>[];
    await tester.pumpWidget(_view(controller, pages, initialPage: 10));
    pages.clear();
    await tester.fling(find.byType(ListView), const Offset(0, -700), 2500);
    for (final gate in pending) {
      gate.complete(bytes);
    }
    await _frames(tester);
    await tester.pump(const Duration(seconds: 2));
    expect(controller.page, greaterThanOrEqualTo(10));
    expect(pages, isNot(contains(0)));
    expect(tester.takeException(), isNull);
    await _cleanup(tester, controller);
  });

  testWidgets('reader saves actual page after slider jumps and mode switches',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'reader_mode': ComicReadingMode.webtoon.index,
      'reader_settings_version': ReaderSettings.settingsVersion,
    });
    final bytes = await _png(tester, 150);
    for (final gate in _pendingPages(30, server: '')) {
      gate.complete(bytes);
    }
    final api = _ComicApi();
    await tester.pumpWidget(ProviderScope(
      overrides: [comicApiProvider.overrideWithValue(api)],
      child: const MaterialApp(
          home: ComicReaderScreen(comicId: 'book', initialPage: 8)),
    ));
    await _frames(tester);
    expect(find.byType(WebtoonView), findsOneWidget);
    final controller =
        tester.widget<WebtoonView>(find.byType(WebtoonView)).controller;
    expect(controller.page, 8);
    await tester.tap(find.byType(WebtoonView));
    await tester.pump();
    tester.widget<Slider>(find.byType(Slider)).onChanged!(13);
    await _frames(tester);
    await tester.pump(const Duration(milliseconds: 700));
    expect(controller.page, 13);
    expect(find.text('14 / 30'), findsOneWidget);
    expect(api.savedPages.last, 13);

    Future<void> changeMode(ComicReadingMode mode) async {
      await tester.tap(find.byTooltip('阅读设置'));
      await tester.pump(const Duration(milliseconds: 400));
      final panel =
          tester.widget<ReaderSettingsPanel>(find.byType(ReaderSettingsPanel));
      panel.onChanged(panel.settings.copyWith(mode: mode));
      Navigator.of(tester.element(find.byType(ReaderSettingsPanel))).pop();
      await _frames(tester);
      await tester.pump(const Duration(milliseconds: 400));
    }

    await changeMode(ComicReadingMode.single);
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 13);
    await changeMode(ComicReadingMode.webtoon);
    expect(controller.page, 13);
    expect(find.text('14 / 30'), findsOneWidget);
    expect(api.savedPages, isNot(contains(0)));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    readerImageLoader.clear();
  });

  testWidgets(
      'delayed images preserve the visible page and its relative offset',
      (tester) async {
    final bytes = await _png(tester, 150);
    final pending = _pendingPages(30);
    final controller = WebtoonController();
    final pages = <int>[];
    await tester.pumpWidget(_view(controller, pages));
    controller.jumpTo(3150); // Page 6, one quarter into its placeholder.
    await tester.pump();
    expect(controller.page, 5);
    pages.clear();
    for (final gate in pending) {
      gate.complete(bytes);
    }
    await _frames(tester);
    expect(controller.page, 5);
    expect(
        tester.getTopLeft(find.byKey(const ValueKey(5))).dy, closeTo(-300, 1));
    expect(pages, isNot(contains(0)));
    expect(tester.takeException(), isNull);
    await _cleanup(tester, controller);
  });

  testWidgets('recycled images retain their measured height during loading',
      (tester) async {
    final bytes = await _png(tester, 150);
    for (final gate in _pendingPages(30)) {
      gate.complete(bytes);
    }
    final controller = WebtoonController();
    final pages = <int>[];
    await tester.pumpWidget(_view(controller, pages, initialPage: 6));
    await _frames(tester);
    controller.jumpToPage(6);
    await tester.pump();
    final offset = controller.offset;
    controller.jumpToPage(20);
    await _frames(tester);
    controller.jumpToPage(6);
    await tester.pump();
    expect(controller.offset, closeTo(offset, 1));
    expect(tester.getSize(find.byKey(const ValueKey(6))).height, 1200);
    await _frames(tester);
    expect(controller.page, 6);
    expect(controller.offset, closeTo(offset, 1));
    expect(tester.takeException(), isNull);
    await _cleanup(tester, controller);
  });

  testWidgets(
      'mixed-height pages use real boundaries for page reports and jumps',
      (tester) async {
    final short = await _png(tester, 25);
    final long = await _png(tester, 300);
    final normal = await _png(tester, 100);
    final pending = _pendingPages(30);
    for (var i = 0; i < pending.length; i++) {
      pending[i].complete(i == 0
          ? short
          : i == 1
              ? long
              : normal);
    }
    final controller = WebtoonController();
    final pages = <int>[];
    await tester.pumpWidget(_view(controller, pages));
    await _frames(tester);
    controller.jumpToPage(2);
    await _frames(tester);
    expect(controller.offset, closeTo(200 + 2400, 1));
    controller.jumpTo(2800);
    await tester.pump();
    expect(controller.page, 2);
    expect(pages.last, 2); // Not floor(2800 / 600).
    controller.jumpToPage(1);
    await tester.pump();
    expect(controller.offset, closeTo(200, 1));
    expect(tester.takeException(), isNull);
    await _cleanup(tester, controller);
  });

  testWidgets(
      'initial progress and viewport resize retain the page and fraction',
      (tester) async {
    final bytes = await _png(tester, 150);
    for (final gate in _pendingPages(30)) {
      gate.complete(bytes);
    }
    final controller = WebtoonController();
    final pages = <int>[];
    await tester.pumpWidget(_view(controller, pages, initialPage: 12));
    await _frames(tester);
    expect(controller.page, 12);
    controller.jumpTo(controller.offset + 300);
    await tester.pump();
    expect(
        tester.getTopLeft(find.byKey(const ValueKey(12))).dy, closeTo(-300, 1));
    await tester.pumpWidget(_view(controller, pages, width: 400));
    await _frames(tester);
    expect(controller.page, 12);
    expect(
        tester.getTopLeft(find.byKey(const ValueKey(12))).dy, closeTo(-150, 1));
    expect(tester.takeException(), isNull);
    await _cleanup(tester, controller);
  });

  testWidgets('route changes and failed images cannot collapse a measured page',
      (tester) async {
    final bytes = await _png(tester, 150);
    for (final gate in _pendingPages(30)) {
      gate.complete(bytes);
    }
    final controller = WebtoonController();
    final pages = <int>[];
    await tester.pumpWidget(_view(controller, pages, initialPage: 8));
    await _frames(tester);
    final offset = controller.offset;
    const alternate = 'https://alternate.reader.test';
    final pending = _pendingPages(30, server: alternate);
    await tester.pumpWidget(_view(controller, pages, server: alternate));
    expect(controller.offset, closeTo(offset, 1));
    expect(tester.getSize(find.byKey(const ValueKey(8))).height, 1200);
    for (final gate in pending) {
      gate.complete(Uint8List.fromList([0, 1, 2]));
    }
    await _frames(tester);
    expect(controller.page, 8);
    expect(controller.offset, closeTo(offset, 1));
    expect(tester.getSize(find.byKey(const ValueKey(8))).height, 1200);
    expect(tester.takeException(), isNull);
    await _cleanup(tester, controller);
  });
}
