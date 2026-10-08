import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/services/reader_chapter_loader.dart';
import 'package:nowen_reader/data/services/reader_image_loader.dart';

class _ImageAdapter implements HttpClientAdapter {
  final requests = <String>[];
  Completer<void>? gate;
  bool failNext = false;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options.path);
    if (gate != null) await gate!.future;
    if (failNext) {
      failNext = false;
      return ResponseBody.fromString('failed', 500);
    }
    return ResponseBody.fromBytes([1, 2, 3, 4], 200);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late _ImageAdapter adapter;
  late ReaderImageLoader images;
  setUp(() {
    adapter = _ImageAdapter();
    images = ReaderImageLoader(
      dio: Dio()..httpClientAdapter = adapter,
      maxBytes: 8,
    );
  });
  tearDown(() => images.dio.close());

  test('foreground and read-ahead share one download and cached bytes',
      () async {
    adapter.gate = Completer<void>();
    final prefetched = images.load('https://reader/page/1');
    final visible = images.load('https://reader/page/1');
    expect(identical(prefetched, visible), isTrue);
    adapter.gate!.complete();
    final bytes = await prefetched;
    expect(await images.load('https://reader/page/1'), same(bytes));
    expect(adapter.requests, ['https://reader/page/1']);
  });

  test('image eviction respects byte budget and recent use', () async {
    await images.load('https://reader/page/1');
    await images.load('https://reader/page/2');
    await images.load('https://reader/page/1');
    await images.load('https://reader/page/3');
    await images.load('https://reader/page/1');
    expect(adapter.requests.length, 3);
    await images.load('https://reader/page/2');
    expect(adapter.requests.length, 4);
  });

  test('offline bytes bypass the network', () async {
    final bytes = Uint8List.fromList([9, 8]);
    expect(
        await images.load('https://reader/offline',
            readLocal: () async => bytes),
        same(bytes));
    expect(adapter.requests, isEmpty);
  });

  test('failed image requests can be retried', () async {
    adapter.failNext = true;
    await expectLater(
        images.load('https://reader/retry'), throwsA(isA<DioException>()));
    expect(await images.load('https://reader/retry'), [1, 2, 3, 4]);
    expect(adapter.requests.length, 2);
  });

  test('clearing a session prevents pending bytes from repopulating cache',
      () async {
    adapter.gate = Completer<void>();
    final old = images.load('https://reader/session');
    images.clear();
    adapter.gate!.complete();
    await old;
    await images.load('https://reader/session');
    expect(adapter.requests.length, 2);
  });

  test('chapters retain HTML, title and MIME while sharing pending requests',
      () async {
    var requests = 0;
    final response = Completer<Map<String, dynamic>>();
    final chapters = ReaderChapterLoader(fetch: (_) {
      requests++;
      return response.future;
    });
    final next = chapters.load(1);
    final visible = chapters.load(1);
    expect(identical(next, visible), isTrue);
    response.complete({
      'content': '<p>正文</p><img src="/image.png">',
      'title': '第二章',
      'mimeType': 'text/html',
    });
    final data = await next;
    expect(await chapters.load(1), same(data));
    expect(data['mimeType'], 'text/html');
    expect(requests, 1);
  });

  test('chapter cache evicts by size and count and retries failures', () async {
    final requests = <int>[];
    var fail = true;
    final chapters = ReaderChapterLoader(
      maxChapters: 2,
      maxCharacters: 8,
      fetch: (index) async {
        requests.add(index);
        if (index == 4 && fail) {
          fail = false;
          throw StateError('temporary failure');
        }
        return {'content': '1234', 'title': '$index'};
      },
    );
    await chapters.load(0);
    await chapters.load(1);
    await chapters.load(0);
    await chapters.load(2);
    await chapters.load(0);
    expect(requests, [0, 1, 2]);
    await chapters.load(1);
    expect(requests, [0, 1, 2, 1]);
    await expectLater(chapters.load(4), throwsStateError);
    expect((await chapters.load(4))['title'], '4');
  });
}
