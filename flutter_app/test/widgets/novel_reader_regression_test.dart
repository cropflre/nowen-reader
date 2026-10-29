import 'dart:async';
import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/data/providers/app_version_provider.dart';
import 'package:nowen_reader/data/services/novel_reading_position.dart';
import 'package:nowen_reader/features/reader/novel_panels.dart';
import 'package:nowen_reader/features/reader/novel_html_pages.dart';
import 'package:nowen_reader/features/reader/novel_reader_screen.dart';
import 'package:nowen_reader/features/reader/novel_settings.dart';
import 'package:nowen_reader/widgets/continue_reading.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _server = 'https://reader.example/nowen';

class _ReaderApi extends ComicApi {
  _ReaderApi({this.html = false, this.lastChapter = 999, this.htmlContent})
      : super(Dio());

  final bool html;
  final String? htmlContent;
  int lastChapter;
  String? lastReadAt;
  final requests = <int>[];
  final pendingChapters = <int, Completer<Map<String, dynamic>>>{};
  int recentFetches = 0;
  Completer<void>? finalize;

  @override
  Future<Map<String, dynamic>> getPages(String comicId) async => {
        'title': '测试小说',
        'pages': List.generate(2100, (i) => {'title': '第${i + 1}章'}),
      };

  @override
  Future<Map<String, dynamic>> getComic(String id) async => {
        'lastReadPage': lastChapter,
        'lastReadAt': lastReadAt,
      };

  Map<String, dynamic> chapter(int index) => {
        'title': '第${index + 1}章',
        'mimeType': html ? 'text/html' : 'text/plain',
        'content': htmlContent ??
            List.generate(
                100,
                (i) => html
                    ? '<p>章节${index + 1}，第$i段正文。</p>'
                    : '章节${index + 1}，第$i段正文。').join('\n'),
      };

  @override
  Future<Map<String, dynamic>> getChapterContent(String id, int index) async {
    requests.add(index);
    return pendingChapters[index]?.future ?? chapter(index);
  }

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
  }) async {
    if (sort == 'lastReadAt') recentFetches++;
    return {
      'comics': [
        {
          'id': 'book',
          'filename': 'book.epub',
          'title': '测试小说',
          'type': 'novel',
          'pageCount': 2100,
          'lastReadPage': lastChapter,
          'lastReadAt': DateTime.now().toUtc().toIso8601String(),
        }
      ],
    };
  }

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
    if (finalize) await this.finalize?.future;
    lastChapter = page;
  }
}

NovelReadingPositionStore _store({String server = _server, String user = ''}) =>
    NovelReadingPositionStore(serverUrl: server, userId: user, comicId: 'book');

Future<void> _mount(WidgetTester tester, _ReaderApi api,
    {bool recent = false}) async {
  final client = ApiClient()..setBaseUrl(_server);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      comicApiProvider.overrideWithValue(api),
      apiClientProvider.overrideWithValue(client),
    ],
    child: MaterialApp(
        home: Scaffold(
      body: recent ? const ContinueReading() : const Text('首页'),
    )),
  ));
  if (recent) {
    // 首页的播放按钮持续呼吸，不能等待所有动画静止。
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
  } else {
    await tester.pumpAndSettle();
  }
}

Future<void> _open(WidgetTester tester, {int? initialChapter}) async {
  final navigator = tester.state<NavigatorState>(find.byType(Navigator));
  unawaited(navigator.push(MaterialPageRoute<void>(
      builder: (_) =>
          NovelReaderScreen(comicId: 'book', initialChapter: initialChapter))));
  await tester.pumpAndSettle();
}

Future<void> _close(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await tester.pumpAndSettle();
}

Future<void> _cleanup(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pumpAndSettle();
}

void main() {
  late Directory cookies;
  setUpAll(() async {
    cookies =
        await Directory.systemTemp.createTemp('nowen-regression-cookies-');
    persistCookieJar = PersistCookieJar(storage: FileStorage(cookies.path));
  });
  tearDownAll(() async => cookies.delete(recursive: true));
  setUp(() {
    SharedPreferences.setMockInitialValues({'novel_pageMode': 1});
  });

  for (final html in [false, true]) {
    for (final legacy in [false, true]) {
      testWidgets(
          '${html ? 'HTML' : 'text'} ${legacy ? 'upgrade' : 'fresh'} '
          'opens horizontally and resumes after Android back', (tester) async {
        SharedPreferences.setMockInitialValues(
            legacy ? {'novel_pageMode': 0} : {});
        await tester.binding.setSurfaceSize(const Size(400, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await _mount(tester, _ReaderApi(html: html));
        await _open(tester);
        final view = html
            ? find.byKey(const ValueKey('novel-html-pages'))
            : find.byType(PageView);
        expect(view, findsOneWidget);
        for (var i = 0; i < 5; i++) {
          await tester.drag(view, const Offset(-300, 0));
          await tester.pumpAndSettle();
        }
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.text('首页'), findsOneWidget);
        final saved = (await _store().load())!;
        expect(saved.page, 5);
        await _open(tester);
        expect(find.text('6 / ${saved.totalPages}'), findsOneWidget);
        await _close(tester);
        await _cleanup(tester);
      });
    }
  }

  testWidgets('scroll position survives route disposal and immediate reopen',
      (tester) async {
    SharedPreferences.setMockInitialValues(
        {'novel_pageMode': 0, 'novel_pageModeVersion': 1});
    await _mount(tester, _ReaderApi());
    await _open(tester);
    var controller = tester.widget<ListView>(find.byType(ListView)).controller!;
    controller.jumpTo(controller.position.maxScrollExtent * 0.4);
    await tester.pumpAndSettle();
    final before = controller.offset / controller.position.maxScrollExtent;
    expect(before, greaterThan(0.1));
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect((await _store().load())!.ratio, closeTo(before, 0.01));
    await _open(tester);
    controller = tester.widget<ListView>(find.byType(ListView)).controller!;
    expect(controller.offset / controller.position.maxScrollExtent,
        closeTo(before, 0.01));
    await _close(tester);
    await _cleanup(tester);
  });

  for (final html in [false, true]) {
    testWidgets('${html ? 'HTML' : 'text'} resumes chapter 1000 at page six',
        (tester) async {
      final api = _ReaderApi(html: html);
      await _mount(tester, api);
      await _open(tester);
      for (var i = 0; i < 5; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
        await tester.pumpAndSettle();
      }
      await _close(tester);
      final saved = (await _store().load())!;
      expect(saved.chapter, 999);
      expect(saved.page, 5);
      expect(saved.totalPages, greaterThan(5));

      await _open(tester);
      expect(find.text('6 / ${saved.totalPages}'), findsOneWidget);
      expect(api.lastChapter, 999);
      await _close(tester);
      expect((await _store().load())!.page, 5);
      await _cleanup(tester);
    });
  }

  testWidgets('HTML page turn moves horizontally with no vertical animation',
      (tester) async {
    await _mount(tester, _ReaderApi(html: true));
    await _open(tester);
    final view = find.byKey(const ValueKey('novel-html-pages'));
    final viewport = tester.renderObject<RenderNovelHtmlPages>(view);
    final nextStart = viewport.metrics!.pages[1].start;
    await tester.drag(view, const Offset(-250, 0));
    await tester.pump(const Duration(milliseconds: 60));
    // The page content changes immediately; only the horizontal slide animates.
    expect(viewport.visibleSlice.start, nextStart);
    final transition = tester.widget<SlideTransition>(
        find.ancestor(of: view, matching: find.byType(SlideTransition)).first);
    expect(transition.position.value.dx, greaterThan(0));
    expect(transition.position.value.dy, 0);
    await tester.pumpAndSettle();
    await _cleanup(tester);
  });

  testWidgets('HTML reserves a footer and preserves progress after relayout',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _mount(tester, _ReaderApi(html: true));
    await _open(tester);
    final view = find.byType(NovelHtmlPages);
    for (var i = 0; i < 5; i++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pumpAndSettle();
    }
    var viewport = tester.renderObject<RenderNovelHtmlPages>(view);
    final oldPages = viewport.metrics!.pages.length;
    final ratio = 5 / (oldPages - 1);
    expect(tester.getRect(find.text('6 / $oldPages')).top,
        greaterThan(tester.getRect(view).bottom));
    await tester.binding.setSurfaceSize(const Size(800, 400));
    await tester.pumpAndSettle();
    viewport = tester.renderObject<RenderNovelHtmlPages>(view);
    var pages = viewport.metrics!.pages.length;
    final page = (ratio * (pages - 1)).round();
    expect(find.text('${page + 1} / $pages'), findsOneWidget);
    expect(viewport.visibleSlice, viewport.metrics!.pages[page]);
    // Reflowing font size, line height and padding keeps the chapter ratio.
    final beforeSettingsRatio = page / (pages - 1);
    await tester.tap(find.byIcon(Icons.text_fields));
    await tester.pumpAndSettle();
    final panel = tester.widget<SettingsPanel>(find.byType(SettingsPanel));
    panel.onChanged(panel.settings
        .copyWith(fontSize: 25, lineHeight: 2.0, padding: NovelPadding.wide));
    panel.onClose();
    await tester.pumpAndSettle();
    viewport = tester.renderObject<RenderNovelHtmlPages>(view);
    pages = viewport.metrics!.pages.length;
    final resizedPage = (beforeSettingsRatio * (pages - 1)).round();
    expect(find.text('${resizedPage + 1} / $pages'), findsOneWidget);
    await _close(tester);
    expect((await _store().load())!.page, resizedPage);
    await _open(tester);
    expect(find.text('${resizedPage + 1} / $pages'), findsOneWidget);
    await _cleanup(tester);
  });

  testWidgets('long HTML restores page 22 without using loading metrics',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final html = List.generate(
        180, (i) => '<p>第$i段，${'长章节的分页必须保留完整的文字行，并正确恢复阅读位置。' * 8}</p>').join();
    expect(html.length, greaterThan(10000));
    final api = _ReaderApi(html: true, htmlContent: html);
    await _mount(tester, api);
    await _open(tester);
    final pages = tester
        .renderObject<RenderNovelHtmlPages>(find.byType(NovelHtmlPages))
        .metrics!
        .pages
        .length;
    expect(pages, greaterThan(22));
    await _close(tester);
    await _store().save(NovelReadingPosition(
        chapter: 999,
        page: 21,
        totalPages: pages,
        swipe: true,
        ratio: 21 / (pages - 1),
        updatedAt: DateTime.now()));
    await _open(tester);
    expect(find.text('22 / $pages'), findsOneWidget);
    await _close(tester);
    expect((await _store().load())!.page, 21);
    await _cleanup(tester);
  });

  for (final html in [false, true]) {
    testWidgets(
        '${html ? 'HTML' : 'text'} previous chapter opens at its last page',
        (tester) async {
      await _mount(tester, _ReaderApi(html: html));
      await _open(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
      await tester.pumpAndSettle();
      expect(find.text('第999章'), findsWidgets);
      await _close(tester);
      final saved = (await _store().load())!;
      expect(saved.chapter, 998);
      expect(saved.page, saved.totalPages - 1);
      expect(saved.totalPages, greaterThan(1));
      await _open(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pumpAndSettle();
      expect(find.text('第1000章'), findsWidgets);
      await _close(tester);
      expect((await _store().load())!.page, 0);
      await _cleanup(tester);
    });
  }

  testWidgets('backgrounding persists the current page before debounce',
      (tester) async {
    await _mount(tester, _ReaderApi());
    await _open(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect((await _store().load())!.page, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await _cleanup(tester);
  });

  testWidgets('explicit chapter zero starts over instead of resuming',
      (tester) async {
    await _store().save(NovelReadingPosition(
        chapter: 999,
        page: 5,
        totalPages: 10,
        swipe: true,
        ratio: 5 / 9,
        updatedAt: DateTime.now()));
    await _mount(tester, _ReaderApi());
    await _open(tester, initialChapter: 0);
    expect(find.text('第1章'), findsWidgets);
    expect(find.text('第1000章'), findsNothing);
    await _cleanup(tester);
  });

  testWidgets('newer server chapter supersedes a local position',
      (tester) async {
    await _store().save(NovelReadingPosition(
        chapter: 999,
        page: 5,
        totalPages: 10,
        swipe: true,
        ratio: 5 / 9,
        updatedAt: DateTime.utc(2026, 1, 1)));
    final api = _ReaderApi(lastChapter: 1500)
      ..lastReadAt = DateTime.utc(2026, 2, 1).toIso8601String();
    await _mount(tester, api);
    await _open(tester);
    expect(find.text('第1501章'), findsWidgets);
    expect(find.text('第1000章'), findsNothing);
    await _cleanup(tester);
  });

  testWidgets('slider previews until release and keeps the menu open',
      (tester) async {
    final api = _ReaderApi();
    await _mount(tester, api);
    await _open(tester);
    await tester.tapAt(tester.getCenter(find.byType(PageView)));
    await tester.pumpAndSettle();
    final slider = find.byKey(const ValueKey('novel-chapter-slider'));
    expect(slider, findsOneWidget);
    final count = api.requests.length;
    final rect = tester.getRect(slider);
    final gesture = await tester.startGesture(rect.center);
    await gesture.moveTo(Offset(rect.right - 60, rect.center.dy));
    await tester.pump();
    expect(slider, findsOneWidget);
    expect(api.requests.length, count);
    final preview = tester.widget<Slider>(slider).value.round();
    expect(preview, greaterThan(999));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(slider, findsOneWidget);
    expect(tester.widget<Slider>(slider).value.round(), preview);
    expect(find.text('第${preview + 1}章'), findsWidgets);
    await _cleanup(tester);
  });

  testWidgets('returning home refreshes recent progress after final save',
      (tester) async {
    final api = _ReaderApi()..finalize = Completer<void>();
    await _mount(tester, api, recent: true);
    expect(find.text('1000/2100'), findsOneWidget);
    await _open(tester, initialChapter: 1009);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    // 首页在保存完成前不能用旧进度刷新。
    expect(api.recentFetches, 1);
    api.finalize!.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(api.recentFetches, 2);
    expect(find.text('1010/2100'), findsOneWidget);
    await _cleanup(tester);
  });

  testWidgets('a late chapter response cannot undo a newer slider selection',
      (tester) async {
    final api = _ReaderApi();
    final older = Completer<Map<String, dynamic>>();
    final newer = Completer<Map<String, dynamic>>();
    api.pendingChapters.addAll({1600: older, 1700: newer});
    await _mount(tester, api);
    await _open(tester);
    await tester.tapAt(tester.getCenter(find.byType(PageView)));
    await tester.pumpAndSettle();
    final slider = find.byKey(const ValueKey('novel-chapter-slider'));
    for (final chapter in [1600, 1700]) {
      final control = tester.widget<Slider>(slider);
      control.onChanged!(chapter.toDouble());
      control.onChangeEnd!(chapter.toDouble());
      await tester.pump();
    }
    newer.complete(api.chapter(1700));
    await tester.pumpAndSettle();
    older.complete(api.chapter(1600));
    await tester.pumpAndSettle();
    expect(find.text('第1701章'), findsWidgets);
    expect(find.text('第1601章'), findsNothing);
    expect(tester.widget<Slider>(slider).value, 1700);
    await _close(tester);
    expect((await _store().load())!.chapter, 1700);
    await _cleanup(tester);
  });

  testWidgets('TOC opens around chapter 2000 and restores after bookmarks tab',
      (tester) async {
    final chapters = List.generate(2100, (i) => {'title': '第${i + 1}章'});
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SizedBox(
      width: 320,
      child: TOCBookmarkPanel(
        settings: const NovelSettings(),
        chapters: chapters,
        currentChapter: 1999,
        bookmarks: const [],
        onGoToChapter: (_) {},
        onGoToBookmark: (_) {},
        onClose: () {},
        onAddBookmark: () {},
        onEditBookmark: (_) {},
        onRemoveBookmark: (_) {},
      ),
    ))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('toc-chapter-1999')).hitTestable(),
        findsOneWidget);
    expect(find.byKey(const ValueKey('toc-chapter-0')).hitTestable(),
        findsNothing);
    await tester.tap(find.text('书签 (0)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('目录 (2100)'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('toc-chapter-1999')).hitTestable(),
        findsOneWidget);
    await _cleanup(tester);
  });

  test('position writes stay ordered and isolated between servers and users',
      () async {
    final store = _store();
    await Future.wait(List.generate(
        10,
        (i) => store.save(NovelReadingPosition(
              chapter: 999,
              page: i,
              totalPages: 10,
              swipe: true,
              ratio: i / 9,
              updatedAt: DateTime.now(),
            ))));
    expect((await store.load())!.page, 9);
    expect(await _store(server: 'https://other.example').load(), isNull);
    expect(await _store(user: 'other-user').load(), isNull);
    expect((await _store(server: '$_server/').load())!.page, 9);
  });

  test('version reflects installed package including build overrides',
      () async {
    PackageInfo.setMockInitialValues(
        appName: 'NowenReader',
        packageName: 'com.nowen.reader',
        version: '2.3.4',
        buildNumber: '127',
        buildSignature: '');
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(await container.read(appVersionProvider.future), '2.3.4 (127)');
  });
}
