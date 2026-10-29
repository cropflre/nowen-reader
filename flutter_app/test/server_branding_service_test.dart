import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/models/server_branding.dart';
import 'package:nowen_reader/data/services/server_branding_service.dart';

final png = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQyDvxHwAEfgJe2Svy2gAAAABJRU5ErkJggg==');

class _Adapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  int status = 200;
  bool invalidImage = false;

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    if (options.uri.path.endsWith('/icon')) {
      return ResponseBody.fromBytes(invalidImage ? [1, 2, 3] : png, status);
    }
    return ResponseBody.fromString(
      jsonEncode({'siteName': '服务器', 'siteIcon': '/data/site-icon.png'}),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json']
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory directory;
  late ServerBrandingService service;
  late _Adapter adapter;
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('nowen-branding-test-');
    adapter = _Adapter();
    service = ServerBrandingService(
      dio: Dio()..httpClientAdapter = adapter,
      supportDirectory: () async => directory,
    );
  });
  tearDown(() async {
    service.dispose();
    await directory.delete(recursive: true);
  });

  test('public URLs preserve subpaths and refresh versions bypass old icons',
      () async {
    final settings = await service.fetchSettings(
        'https://reader.example/reader', CancelToken());
    expect(settings['siteName'], '服务器');
    expect(
        await service.fetchIcon(
            'https://reader.example/reader', 'v1', CancelToken()),
        png);
    await service.fetchIcon(
        'https://reader.example/reader', 'v2', CancelToken());
    expect(adapter.requests.first.uri.path, '/reader/api/site-settings');
    expect(adapter.requests[1].uri.path, '/reader/api/site-settings/icon');
    expect(adapter.requests[1].uri.queryParameters['v'], 'v1');
    expect(adapter.requests.last.uri.queryParameters['v'], 'v2');
    expect(adapter.requests.every((r) => !r.headers.containsKey('Cookie')),
        isTrue);
  });

  test('404 and undecodable images request the default logo', () async {
    adapter.status = 404;
    expect(
        await service.fetchIcon('https://reader', 'v1', CancelToken()), isNull);
    adapter.status = 200;
    adapter.invalidImage = true;
    expect(
        await service.fetchIcon('https://reader', 'v2', CancelToken()), isNull);
  });

  test('cache persists per server, survives service restart, and deletes logos',
      () async {
    final now = DateTime.utc(2026, 10, 29);
    await service.writeCached('https://a/reader',
        ServerBranding(name: 'A', iconBytes: png, fetchedAt: now));
    await service.writeCached(
        'https://b/reader', const ServerBranding(name: 'B'));
    final restarted =
        ServerBrandingService(supportDirectory: () async => directory);
    addTearDown(restarted.dispose);
    final a = await restarted.readCached('https://a/reader');
    expect(a?.name, 'A');
    expect(a?.iconBytes, png);
    expect(a?.fetchedAt, now);
    expect((await restarted.readCached('https://b/reader'))?.name, 'B');
    expect(await restarted.readCached('https://unknown'), isNull);
    await service.writeCached(
        'https://a/reader', const ServerBranding(name: 'A2'));
    expect((await restarted.readCached('https://a/reader'))?.iconBytes, isNull);
    expect(
        directory
            .listSync(recursive: true)
            .whereType<File>()
            .where((file) => file.path.endsWith('icon.bin')),
        isEmpty);
  });

  test('concurrent writes retain newest data and long URLs are supported',
      () async {
    final key = 'https://reader.example/${'subpath/' * 100}';
    await Future.wait([
      service.writeCached(key, ServerBranding(name: '旧', iconBytes: png)),
      service.writeCached(key, const ServerBranding(name: '新')),
    ]);
    expect((await service.readCached(key))?.name, '新');
    expect((await service.readCached(key))?.iconBytes, isNull);
  });
}
