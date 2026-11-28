import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/data/models/comic.dart';
import 'package:nowen_reader/data/providers/ai_provider.dart';
import 'package:nowen_reader/data/providers/auth_provider.dart';
import 'package:nowen_reader/features/reader/novel_reader_screen.dart';
import 'package:nowen_reader/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _server = 'https://reader.example/nowen';

class _StubAuthNotifier extends AuthNotifier {
  _StubAuthNotifier(super.ref, AuthState initialState)
      : super(initialState: initialState, autoInit: false);
}

class _RecapReaderApi extends ComicApi {
  _RecapReaderApi({
    this.aiConfigured = true,
    this.recapHandler,
  }) : super(Dio());

  final bool aiConfigured;
  int aiStatusCalls = 0;
  final recapRequests = <({String comicId, int chapterIndex, String targetLang})>[];
  Future<ChapterRecap?> Function(
    String comicId,
    int chapterIndex,
    String targetLang,
    CancelToken? cancelToken,
  )? recapHandler;

  @override
  Future<bool> isAIConfigured() async {
    aiStatusCalls++;
    return aiConfigured;
  }

  @override
  Future<ChapterRecap?> getChapterRecap(
    String comicId, {
    required int chapterIndex,
    String targetLang = 'zh-CN',
    CancelToken? cancelToken,
  }) async {
    recapRequests.add((
      comicId: comicId,
      chapterIndex: chapterIndex,
      targetLang: targetLang,
    ));
    if (recapHandler != null) {
      return recapHandler!(comicId, chapterIndex, targetLang, cancelToken);
    }
    return const ChapterRecap(
      summary: '上一章中主角潜入古塔，发现了尘封的星图。',
      keyCharacters: '林岚（主角）、沈青（向导）',
      lastCliffhanger: '塔顶突然传来不明脚步声，来者身份成谜。',
    );
  }

  @override
  Future<Map<String, dynamic>> getPages(String comicId) async => {
        'title': '测试小说',
        'pages': List.generate(5, (i) => {'title': '第${i + 1}章'}),
      };

  @override
  Future<Map<String, dynamic>> getComic(String id) async => {
        'lastReadPage': 0,
      };

  @override
  Future<Map<String, dynamic>> getChapterContent(String id, int index) async => {
        'title': '第${index + 1}章',
        'mimeType': 'text/plain',
        'content': List.generate(
          20,
          (i) => '这是第${index + 1}章的第${i + 1}段正文内容，用于测试前情提要展示。',
        ).join('\n'),
      };

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
  }) async {}
}

class _FakeHttpAdapter implements HttpClientAdapter {
  _FakeHttpAdapter(this.handler);

  final Future<ResponseBody> Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) =>
      handler(options);

  @override
  void close({bool force = false}) {}
}

Future<void> _pumpReader(
  WidgetTester tester, {
  required _RecapReaderApi api,
  required int initialChapter,
  AuthUser? user = const AuthUser(
    id: 'u1',
    username: 'admin',
    role: 'admin',
    aiEnabled: true,
  ),
  Locale locale = const Locale('zh'),
}) async {
  final client = ApiClient()..setBaseUrl(_server);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        comicApiProvider.overrideWithValue(api),
        apiClientProvider.overrideWithValue(client),
        authProvider.overrideWith(
          (ref) => _StubAuthNotifier(
            ref,
            AuthState(
              user: user,
              serverUrl: _server,
              isLoading: false,
              connectionStatus: ServerConnectionStatus.online,
            ),
          ),
        ),
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: NovelReaderScreen(
          comicId: 'novel-44',
          initialChapter: initialChapter,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  late Directory cookies;

  setUpAll(() async {
    cookies = await Directory.systemTemp.createTemp('nowen-recap-cookies-');
    persistCookieJar = PersistCookieJar(storage: FileStorage(cookies.path));
  });

  tearDownAll(() async => cookies.delete(recursive: true));

  setUp(() {
    SharedPreferences.setMockInitialValues({
      'novel_pageModeVersion': 1,
      'novel_pageMode': 0, // scroll mode by default
    });
  });

  group('ComicApi AI chapter recap & status', () {
    test('POST /comics/:id/ai-chapter-recap sends chapterIndex & targetLang and parses recap',
        () async {
      RequestOptions? captured;
      final dio = Dio(BaseOptions(baseUrl: '$_server/api'));
      dio.httpClientAdapter = _FakeHttpAdapter((options) async {
        captured = options;
        return ResponseBody.fromString(
          jsonEncode({
            'success': true,
            'recap': {
              'summary': '前几章中主角踏上旅途。',
              'keyCharacters': '林岚（主角）',
              'lastCliffhanger': '神秘信件的署名是谁？',
            },
          }),
          200,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        );
      });

      final api = ComicApi(dio);
      final recap = await api.getChapterRecap(
        'book-1',
        chapterIndex: 3,
        targetLang: 'zh-CN',
      );

      expect(captured?.method, 'POST');
      expect(captured?.path, '/comics/book-1/ai-chapter-recap');
      expect(captured?.data, {'chapterIndex': 3, 'targetLang': 'zh-CN'});
      expect(recap, isNotNull);
      expect(recap!.summary, '前几章中主角踏上旅途。');
      expect(recap.keyCharacters, '林岚（主角）');
      expect(recap.lastCliffhanger, '神秘信件的署名是谁？');
    });

    test('isAIConfigured reads cloudAI and localAI flags from /ai/status',
        () async {
      final dio = Dio(BaseOptions(baseUrl: '$_server/api'));
      dio.httpClientAdapter = _FakeHttpAdapter((options) async {
        expect(options.path, '/ai/status');
        return ResponseBody.fromString(
          jsonEncode({
            'cloudAI': {'configured': true, 'provider': 'compatible'},
            'localAI': {'configured': false},
          }),
          200,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        );
      });

      final api = ComicApi(dio);
      expect(await api.isAIConfigured(), isTrue);
    });
  });

  group('NovelReaderScreen AI chapter recap UI', () {
    testWidgets('hides recap button on first chapter (chapter 0)',
        (tester) async {
      final api = _RecapReaderApi(aiConfigured: true);
      await _pumpReader(tester, api: api, initialChapter: 0);

      expect(find.byKey(const ValueKey('novel-chapter-recap-button')),
          findsNothing);
    });

    testWidgets('hides recap button when AI is not configured', (tester) async {
      final api = _RecapReaderApi(aiConfigured: false);
      await _pumpReader(tester, api: api, initialChapter: 2);

      expect(find.byKey(const ValueKey('novel-chapter-recap-button')),
          findsNothing);
    });

    testWidgets('hides recap button and skips status fetch when user lacks AI access',
        (tester) async {
      final api = _RecapReaderApi(aiConfigured: true);
      await _pumpReader(
        tester,
        api: api,
        initialChapter: 2,
        user: const AuthUser(
          id: 'u2',
          username: 'reader',
          role: 'user',
          aiEnabled: false,
        ),
      );

      expect(find.byKey(const ValueKey('novel-chapter-recap-button')),
          findsNothing);
      expect(api.aiStatusCalls, 0);
    });

    testWidgets(
        'shows below title, loads recap, collapses/re-expands from cache, and refreshes',
        (tester) async {
      final completer = Completer<ChapterRecap?>();
      var callCount = 0;
      final api = _RecapReaderApi(
        aiConfigured: true,
        recapHandler: (_, __, ___, ____) {
          callCount++;
          if (callCount == 1) return completer.future;
          return Future.value(
            const ChapterRecap(
              summary: '重新生成后的前情提要内容。',
              keyCharacters: '林岚',
              lastCliffhanger: '新的伏笔。',
            ),
          );
        },
      );

      await _pumpReader(tester, api: api, initialChapter: 2);

      final buttonFinder =
          find.byKey(const ValueKey('novel-chapter-recap-button'));
      expect(buttonFinder, findsOneWidget);
      expect(find.text('查看前情提要'), findsOneWidget);

      // 位于章节标题下方
      final titleRect = tester.getRect(
        find.descendant(
          of: find.byType(ListView),
          matching: find.text('第3章'),
        ),
      );
      final buttonRect = tester.getRect(buttonFinder);
      expect(buttonRect.top, greaterThanOrEqualTo(titleRect.bottom - 1));

      // 点击展开 -> 进入加载态，且不触发阅读器菜单
      await tester.tap(buttonFinder);
      await tester.pump();
      expect(find.byKey(const ValueKey('novel-chapter-recap-card')),
          findsOneWidget);
      expect(find.text('生成前情提要中...'), findsOneWidget);
      expect(find.byKey(const ValueKey('novel-chapter-slider')), findsNothing);
      expect(api.recapRequests, hasLength(1));
      expect(api.recapRequests.first.comicId, 'novel-44');
      expect(api.recapRequests.first.chapterIndex, 2);
      expect(api.recapRequests.first.targetLang, 'zh-CN');

      // 加载完成 -> 显示摘要、关键角色、上章悬念
      completer.complete(
        const ChapterRecap(
          summary: '主角在第二章解开了机关门。',
          keyCharacters: '林岚（主角）、沈青（向导）',
          lastCliffhanger: '门后传来未知回响。',
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('主角在第二章解开了机关门。'), findsOneWidget);
      expect(find.text('林岚（主角）、沈青（向导）'), findsOneWidget);
      expect(find.text('门后传来未知回响。'), findsOneWidget);

      // 收起 -> 回到按钮态
      await tester.tap(find.byKey(const ValueKey('novel-chapter-recap-close')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('novel-chapter-recap-card')),
          findsNothing);
      expect(buttonFinder, findsOneWidget);

      // 再次展开 -> 命中本章缓存，不重复请求
      await tester.tap(buttonFinder);
      await tester.pumpAndSettle();
      expect(api.recapRequests, hasLength(1));
      expect(find.text('主角在第二章解开了机关门。'), findsOneWidget);

      // 点击重新生成 -> 触发新的请求并更新内容
      await tester.tap(find.byKey(const ValueKey('novel-chapter-recap-refresh')));
      await tester.pumpAndSettle();
      expect(api.recapRequests, hasLength(2));
      expect(find.text('重新生成后的前情提要内容。'), findsOneWidget);
    });

    testWidgets('works in swipe page mode and uses English locale when set',
        (tester) async {
      SharedPreferences.setMockInitialValues({
        'novel_pageModeVersion': 1,
        'novel_pageMode': 1, // swipe mode
      });
      final api = _RecapReaderApi(aiConfigured: true);

      await _pumpReader(
        tester,
        api: api,
        initialChapter: 1,
        locale: const Locale('en'),
      );

      expect(find.text('Previously On...'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('novel-chapter-recap-button')));
      await tester.pumpAndSettle();

      expect(api.recapRequests, hasLength(1));
      expect(api.recapRequests.first.chapterIndex, 1);
      expect(api.recapRequests.first.targetLang, 'en');
      expect(find.byKey(const ValueKey('novel-chapter-recap-card')),
          findsOneWidget);
      expect(find.text('上一章中主角潜入古塔，发现了尘封的星图。'), findsOneWidget);
      // 不应误触翻页菜单
      expect(find.byKey(const ValueKey('novel-chapter-slider')), findsNothing);
    });

    testWidgets('shows error and supports retry', (tester) async {
      var attempts = 0;
      final api = _RecapReaderApi(
        aiConfigured: true,
        recapHandler: (_, __, ___, ____) async {
          attempts++;
          if (attempts == 1) {
            throw DioException(
              requestOptions: RequestOptions(path: '/comics/novel-44/ai-chapter-recap'),
              response: Response(
                requestOptions:
                    RequestOptions(path: '/comics/novel-44/ai-chapter-recap'),
                statusCode: 500,
                data: {'error': 'LLM service unavailable'},
              ),
            );
          }
          return const ChapterRecap(summary: '重试成功后的前情提要。');
        },
      );

      await _pumpReader(tester, api: api, initialChapter: 1);

      await tester.tap(find.byKey(const ValueKey('novel-chapter-recap-button')));
      await tester.pumpAndSettle();
      expect(find.text('LLM service unavailable'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('novel-chapter-recap-retry')));
      await tester.pumpAndSettle();
      expect(find.text('重试成功后的前情提要。'), findsOneWidget);
    });

    testWidgets('aiConfiguredProvider returns true for non-admin with aiEnabled',
        (tester) async {
      final api = _RecapReaderApi(aiConfigured: true);
      final container = ProviderContainer(
        overrides: [
          comicApiProvider.overrideWithValue(api),
          authProvider.overrideWith(
            (ref) => _StubAuthNotifier(
              ref,
              const AuthState(
                user: AuthUser(
                  id: 'u3',
                  username: 'vip',
                  role: 'user',
                  aiEnabled: true,
                ),
                serverUrl: _server,
                isLoading: false,
                connectionStatus: ServerConnectionStatus.online,
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      expect(await container.read(aiConfiguredProvider.future), isTrue);
      expect(api.aiStatusCalls, 1);
    });
  });
}
