import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/features/reader/novel_html_content.dart';
import 'package:nowen_reader/features/reader/novel_reader_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=';
const _image = 'data:image/png;base64,$_png';

class _ReaderApi extends ComicApi {
  _ReaderApi() : super(Dio());

  @override
  Future<Map<String, dynamic>> getPages(String comicId) async => {
        'title': '图文小说',
        'pages': [
          {'index': 0, 'title': '第一章'},
          {'index': 1, 'title': '第二章'},
        ],
      };

  @override
  Future<Map<String, dynamic>> getComic(String id) async => {'lastReadPage': 0};

  @override
  Future<Map<String, dynamic>> getChapterContent(
          String comicId, int chapterIndex) async =>
      {
        'title': chapterIndex == 0 ? '第一章' : '第二章',
        'mimeType': 'text/html; charset=utf-8',
        'content': chapterIndex == 0
            ? '<p>插图之前</p><img src="$_image" width="240" height="240">${List.generate(30, (i) => '<p>正文第$i段，保留章节图文阅读顺序。</p>').join()}<p>章节结尾</p>'
            : '<h2>第二章标题</h2><p>第二章内容</p><img src="$_image">',
      };

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
  }) async {}
}

void main() {
  late Directory cookies;
  setUpAll(() async {
    cookies = await Directory.systemTemp.createTemp('nowen-reader-cookies-');
    persistCookieJar = PersistCookieJar(storage: FileStorage(cookies.path));
  });
  tearDownAll(() async => cookies.delete(recursive: true));

  testWidgets('renders rich prose, inline images and vector SVG',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: NovelHtmlContent(
            content:
                '<h2>章标题</h2><p>前文<strong>强调</strong></p><img src="$_image" width="120" height="120"><p>后文</p><svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg>',
            serverUrl: 'https://reader.example/nowen',
            textStyle: TextStyle(fontSize: 18),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('前文', findRichText: true), findsOneWidget);
    expect(find.textContaining('后文', findRichText: true), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
    expect(find.byType(SvgPicture), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('protected EPUB images carry the session cookie', () async {
    HttpOverrides.global = null;
    final served = Completer<String?>();
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    try {
      final url = 'http://127.0.0.1:${server.port}/nowen/api/image.png';
      await persistCookieJar.saveFromResponse(
          Uri.parse(url), [Cookie('session', 'reader')..path = '/nowen/api']);
      server.listen((request) async {
        served.complete(request.headers.value('cookie'));
        request.response.headers.contentType = ContentType('image', 'png');
        request.response.add(base64Decode(_png));
        await request.response.close();
      });
      final bytes = await loadNovelImageBytes(url);
      expect(bytes, base64Decode(_png));
      expect(await served.future.timeout(const Duration(seconds: 10)),
          'session=reader');
    } finally {
      await server.close(force: true);
    }
  });

  for (final swipe in [false, true]) {
    testWidgets('reader retains images in ${swipe ? 'swipe' : 'scroll'} mode',
        (tester) async {
      SharedPreferences.setMockInitialValues({'novel_pageMode': swipe ? 1 : 0});
      final client = ApiClient()..setBaseUrl('https://reader.example/nowen');
      await tester.pumpWidget(ProviderScope(
        overrides: [
          comicApiProvider.overrideWithValue(_ReaderApi()),
          apiClientProvider.overrideWithValue(client),
        ],
        child: const MaterialApp(home: NovelReaderScreen(comicId: 'book')),
      ));
      await tester.pumpAndSettle();
      expect(find.byType(NovelHtmlContent), findsOneWidget);
      expect(find.byType(Image), findsOneWidget);
      if (swipe) {
        final scroll = tester
            .widget<SingleChildScrollView>(find.byType(SingleChildScrollView));
        final controller = scroll.controller!;
        expect(controller.position.maxScrollExtent, greaterThan(600));
        final pages = ((controller.position.maxScrollExtent +
                    controller.position.viewportDimension) /
                controller.position.viewportDimension)
            .ceil();
        expect(find.text('1 / $pages'), findsOneWidget);
        await tester.drag(
            find.byType(SingleChildScrollView), const Offset(-250, 0));
        await tester.pumpAndSettle();
        expect(controller.offset, greaterThan(0));
        expect(tester.takeException(), isNull);
        await tester.drag(
            find.byType(SingleChildScrollView), const Offset(250, 0));
        await tester.pumpAndSettle();
        expect(controller.offset, 0);
        // 视口变化后，图文章节必须按新布局重算页数。
        tester.view.physicalSize = const Size(390, 844) * tester.view.devicePixelRatio;
        addTearDown(tester.view.resetPhysicalSize);
        await tester.pumpAndSettle();
        final resizedPages = ((controller.position.maxScrollExtent +
                    controller.position.viewportDimension) /
                controller.position.viewportDimension)
            .ceil();
        expect(find.text('1 / $resizedPages'), findsOneWidget);
        for (var page = 0; page < resizedPages; page++) {
          await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
          await tester.pumpAndSettle();
        }
        expect(
            tester
                .widget<NovelHtmlContent>(find.byType(NovelHtmlContent))
                .content,
            contains('第二章内容'));
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    });
  }
}
