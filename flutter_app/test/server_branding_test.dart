import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/models/server_branding.dart';
import 'package:nowen_reader/data/providers/server_branding_provider.dart';
import 'package:nowen_reader/data/providers/server_route_provider.dart';
import 'package:nowen_reader/data/services/server_branding_service.dart';

const primary = 'https://reader.example/nowen';
const backup = 'http://192.168.1.2/reader';
const other = 'https://other.example/books';
const target = ServerBrandingTarget(key: primary, baseUrl: primary);

class _SettingsRequest {
  final String url;
  final CancelToken token;
  final response = Completer<Map<String, dynamic>>();
  _SettingsRequest(this.url, this.token);
}

class _BrandingService extends ServerBrandingService {
  final cached = <String, ServerBranding>{};
  final requests = <_SettingsRequest>[];
  final writes = <String>[];
  final iconVersions = <String>[];
  Uint8List? icon = Uint8List.fromList([1, 2, 3]);
  Completer<Uint8List?>? pendingIcon;
  bool iconOffline = false;

  @override
  Future<ServerBranding?> readCached(String key) async => cached[key];

  @override
  Future<void> writeCached(String key, ServerBranding branding) async {
    writes.add(key);
    cached[key] = branding;
  }

  @override
  Future<Map<String, dynamic>> fetchSettings(String url, CancelToken token) {
    final request = _SettingsRequest(url, token);
    requests.add(request);
    // Intentionally ignore cancellation to exercise stale response protection.
    return request.response.future;
  }

  @override
  Future<Uint8List?> fetchIcon(
      String url, String version, CancelToken token) async {
    iconVersions.add(version);
    if (iconOffline) throw Exception('offline');
    return pendingIcon == null ? icon : await pendingIcon!.future;
  }
}

Future<void> _settle() async {
  for (var i = 0; i < 8; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  late _BrandingService service;
  late ServerBrandingNotifier notifier;
  late DateTime now;
  setUp(() {
    now = DateTime.utc(2026, 10, 29);
    service = _BrandingService();
    notifier = ServerBrandingNotifier(service, now: () => now);
  });
  tearDown(() {
    notifier.dispose();
    service.dispose();
  });

  Future<void> connect(
      [Map<String, dynamic> settings = const {'siteName': '我的书房'}]) async {
    notifier.activate(target);
    await _settle();
    service.requests.last.response.complete(settings);
    await _settle();
  }

  test('only verified LAN/WAN routes share the primary cache key', () {
    const config = ServerRouteConfig(primaryUrl: primary, backupUrl: backup);
    const unverified = ServerRouteState(config: config, activeUrl: backup);
    const verified = ServerRouteState(
        config: config,
        activeUrl: backup,
        verification: ServerRouteVerification.verified);
    expect(resolveServerBrandingTarget(backup, unverified).key, backup);
    expect(resolveServerBrandingTarget(backup, verified).key, primary);
    expect(resolveServerBrandingTarget(backup, verified).baseUrl, backup);
    expect(resolveServerBrandingTarget(primary, unverified).key, primary);
    expect(resolveServerBrandingTarget(other, verified).key, other);
    expect(resolveServerBrandingTarget('', verified),
        const ServerBrandingTarget());
  });

  test('startup displays cached identity before public settings finish',
      () async {
    service.cached[primary] =
        ServerBranding(name: '离线书房', iconBytes: service.icon, fetchedAt: now);
    notifier.activate(target);
    await _settle();
    expect(notifier.state[primary]?.name, '离线书房');
    expect(notifier.state[primary]?.iconBytes, service.icon);
    expect(service.requests.single.url, primary);
    service.requests.single.response.complete({'siteName': '  新书房  '});
    await _settle();
    expect(notifier.state[primary]?.name, '新书房');
    expect(notifier.state[primary]?.iconBytes, isNull);
  });

  test('older settings and empty names use defaults without downloading a logo',
      () async {
    await connect({'siteName': '  '});
    expect(notifier.state[primary]?.name, ServerBranding.defaultName);
    expect(service.iconVersions, isEmpty);
    final refresh = notifier.refresh(force: true);
    service.requests.last.response.complete({});
    await refresh;
    expect(notifier.state[primary]?.name, ServerBranding.defaultName);
  });

  test('forced refresh replaces same-path logo and removal clears disk cache',
      () async {
    await connect({'siteName': '书房', 'siteIcon': '/data/site-icon.png'});
    expect(notifier.state[primary]?.iconBytes, [1, 2, 3]);
    service.icon = Uint8List.fromList([4, 5, 6]);
    var refresh = notifier.refresh(force: true);
    service.requests.last.response
        .complete({'siteName': '书房', 'siteIcon': '/data/site-icon.png'});
    await refresh;
    expect(notifier.state[primary]?.iconBytes, [4, 5, 6]);
    expect(service.iconVersions.toSet(), hasLength(2));
    refresh = notifier.refresh(force: true);
    service.requests.last.response.complete({'siteName': '书房', 'siteIcon': ''});
    await refresh;
    expect(notifier.state[primary]?.iconBytes, isNull);
    expect(service.cached[primary]?.iconBytes, isNull);
  });

  test('missing or invalid logo falls back, temporary failures retain old logo',
      () async {
    await connect({'siteName': '书房', 'siteIcon': '/data/site-icon.png'});
    service.iconOffline = true;
    var refresh = notifier.refresh(force: true);
    service.requests.last.response
        .complete({'siteName': '改名后', 'siteIcon': '/data/site-icon.png'});
    await refresh;
    expect(notifier.state[primary]?.name, '改名后');
    expect(notifier.state[primary]?.iconBytes, [1, 2, 3]);
    service.iconOffline = false;
    service.icon = null;
    refresh = notifier.refresh(force: true);
    service.requests.last.response
        .complete({'siteName': '改名后', 'siteIcon': '/data/site-icon.png'});
    await refresh;
    expect(notifier.state[primary]?.iconBytes, isNull);
  });

  test('offline restart and public 401 retain the cached identity', () async {
    service.cached[primary] =
        ServerBranding(name: '已缓存', iconBytes: service.icon);
    notifier.activate(target);
    await _settle();
    service.requests.last.response.completeError(DioException(
        requestOptions: RequestOptions(),
        response: Response(requestOptions: RequestOptions(), statusCode: 401)));
    await _settle();
    expect(notifier.state[primary]?.name, '已缓存');
    expect(notifier.state[primary]?.iconBytes, service.icon);
    expect(service.writes, isEmpty);
  });

  test('switching A to B to A ignores both stale name responses', () async {
    notifier.activate(target);
    await _settle();
    final oldA = service.requests.last;
    notifier.activate(const ServerBrandingTarget(key: other, baseUrl: other));
    await _settle();
    final oldB = service.requests.last;
    notifier.activate(target);
    await _settle();
    service.requests.last.response.complete({'siteName': '当前 A'});
    await _settle();
    oldB.response.complete({'siteName': '过期 B'});
    oldA.response.complete({'siteName': '过期 A'});
    await _settle();
    expect(notifier.state[primary]?.name, '当前 A');
    expect(notifier.state[other], isNull);
    expect(service.writes, [primary]);
    expect(oldA.token.isCancelled, isTrue);
  });

  test('late icon cannot overwrite the next server or survive disconnect',
      () async {
    service.pendingIcon = Completer<Uint8List?>();
    notifier.activate(target);
    await _settle();
    service.requests.last.response
        .complete({'siteName': 'A', 'siteIcon': '/data/site-icon.png'});
    await _settle();
    notifier.activate(const ServerBrandingTarget(key: other, baseUrl: other));
    await _settle();
    service.requests.last.response.complete({'siteName': 'B'});
    await _settle();
    service.pendingIcon!.complete(Uint8List.fromList([99]));
    await _settle();
    expect(notifier.state[other]?.name, 'B');
    expect(notifier.state[other]?.iconBytes, isNull);
    expect(service.writes, [other]);
    notifier.activate(const ServerBrandingTarget());
    await notifier.refresh(force: true);
    expect(service.requests, hasLength(2));
  });

  test(
      'verified route switch reuses identity and refreshes on the active route',
      () async {
    await connect({'siteName': '同一个书房', 'siteIcon': '/data/icon.png'});
    notifier
        .activate(const ServerBrandingTarget(key: primary, baseUrl: backup));
    await _settle();
    expect(notifier.state[primary]?.name, '同一个书房');
    expect(service.requests, hasLength(1));
    now = now.add(const Duration(minutes: 6));
    final refresh = notifier.refresh();
    expect(service.requests.last.url, backup);
    service.requests.last.response.complete({'siteName': '同一个书房'});
    await refresh;
    expect(notifier.state.keys, [primary]);
  });

  test('foreground refresh is throttled, pending reads are shared, force wins',
      () async {
    await connect();
    await notifier.refresh();
    expect(service.requests, hasLength(1));
    now = now.add(const Duration(minutes: 5));
    final first = notifier.refresh();
    expect(notifier.refresh(), same(first));
    final oldRequest = service.requests.last;
    final forced = notifier.refresh(force: true);
    service.requests.last.response.complete({'siteName': '最新'});
    await forced;
    oldRequest.response.complete({'siteName': '过期'});
    await first;
    expect(notifier.state[primary]?.name, '最新');
  });

  test(
      'page subscribers update together and immediately reset on server switch',
      () async {
    final selected = StateProvider<ServerBrandingTarget>((ref) => target);
    final container = ProviderContainer(overrides: [
      serverBrandingTargetProvider.overrideWith((ref) => ref.watch(selected)),
      serverBrandingServiceProvider.overrideWithValue(service),
    ]);
    addTearDown(container.dispose);
    expect(container.read(currentServerBrandingProvider).name, 'NowenReader');
    await _settle();
    service.requests.last.response.complete({'siteName': '服务器 A'});
    await _settle();
    expect(container.read(currentServerBrandingProvider).name, '服务器 A');
    expect(container.read(cachedServerBrandingProvider(primary)).name, '服务器 A');
    container.read(selected.notifier).state =
        const ServerBrandingTarget(key: other, baseUrl: other);
    expect(container.read(currentServerBrandingProvider).name, 'NowenReader');
    await _settle();
    service.requests.last.response.complete({'siteName': '服务器 B'});
    await _settle();
    expect(container.read(currentServerBrandingProvider).name, '服务器 B');
    expect(container.read(cachedServerBrandingProvider(primary)).name, '服务器 A');
  });
}
