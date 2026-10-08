import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/data/services/reader_warmup_session.dart';

class FakeWarmupApi extends ComicApi {
  FakeWarmupApi() : super(Dio());
  final requests = <({String session, int page, int count})>[];
  final ended = <String>[];

  @override
  Future<void> warmupPages(String comicId, String sessionId,
      {required int startPage, required int count}) async {
    requests.add((session: sessionId, page: startPage, count: count));
  }

  @override
  Future<void> endWarmup(String comicId, String sessionId) async {
    ended.add(sessionId);
  }
}

void main() {
  testWidgets('warmup lease renews, closes, and resumes with a fresh id',
      (tester) async {
    final api = FakeWarmupApi();
    final session = ReaderWarmupSession(api: api, comicId: 'book');
    session.start(20, 100);
    expect(api.requests.single.count, -1);
    final firstId = api.requests.single.session;
    session.prefetch(20);
    session.prefetch(21);
    expect(api.requests.length, 2);
    expect(api.requests.last.page, 21);
    expect(api.requests.last.count, 8);
    await tester.pump(const Duration(seconds: 30));
    expect(api.requests.last.count, -1);
    session.didChangeAppLifecycleState(AppLifecycleState.paused);
    expect(api.ended, [firstId]);
    final count = api.requests.length;
    await tester.pump(const Duration(minutes: 3));
    expect(api.requests.length, count);
    session.didChangeAppLifecycleState(AppLifecycleState.resumed);
    expect(api.requests.last.session, isNot(firstId));
    session.dispose();
    session.dispose();
    expect(api.ended.length, 2);
    final finalCount = api.requests.length;
    await tester.pump(const Duration(minutes: 3));
    expect(api.requests.length, finalCount);
  });
}
