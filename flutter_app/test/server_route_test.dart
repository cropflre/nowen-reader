import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nowen_reader/app/router.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/data/providers/server_route_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const primary = 'https://reader.example/nowen';
const backup = 'http://192.168.1.2:8080/reader';
const pair = ServerRouteConfig(primaryUrl: primary, backupUrl: backup);

class _Adapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions) respond;
  _Adapter(this.respond);

  @override
  Future<ResponseBody> fetch(RequestOptions options,
          Stream<Uint8List>? requestStream, Future<void>? cancelFuture) =>
      respond(options);

  @override
  void close({bool force = false}) {}
}

Dio _dio(Future<ResponseBody> Function(RequestOptions) respond) =>
    Dio()..httpClientAdapter = _Adapter(respond);

ResponseBody _json(Object? data, {int status = 200}) =>
    ResponseBody.fromString(jsonEncode(data), status, headers: {
      Headers.contentTypeHeader: ['application/json']
    });

class _Routes extends ServerRouteService {
  final latencies = <String, double?>{primary: 200, backup: 20};
  final pending = <String, Completer<double?>>{};
  var identity = ServerRouteVerification.verified;
  int measurements = 0;
  int verifications = 0;
  _Routes() : super(persistCookieJar);

  @override
  Future<double?> measure(String url) async {
    measurements++;
    return pending[url]?.future ?? latencies[url];
  }

  @override
  Future<ServerRouteVerification> verify(ServerRouteConfig config) async {
    verifications++;
    return identity;
  }
}

Future<ServerRouteSelection> _select({
  String current = primary,
  Map<String, double?> values = const {primary: 200, backup: 20},
  ServerRouteVerification identity = ServerRouteVerification.verified,
  ServerRouteMode mode = ServerRouteMode.automatic,
  bool allowSwitch = true,
}) =>
    selectServerRoute(
        config: ServerRouteConfig(
            primaryUrl: primary, backupUrl: backup, mode: mode),
        currentUrl: current,
        verification: identity,
        allowsLatencySwitch: allowSwitch,
        measure: (url) async => values[url],
        verifyPair: () async => identity);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory cookieDirectory;
  setUpAll(() async {
    cookieDirectory =
        await Directory.systemTemp.createTemp('nowen-route-test-');
    persistCookieJar =
        PersistCookieJar(storage: FileStorage(cookieDirectory.path));
  });
  tearDownAll(() async => cookieDirectory.delete(recursive: true));
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await persistCookieJar.deleteAll();
  });

  test(
      'lower latency wins in either direction, including a faster public route',
      () async {
    expect((await _select()).selectedUrl, backup);
    expect(
        (await _select(current: backup, values: {primary: 10, backup: 250}))
            .selectedUrl,
        primary);
  });

  test('switch requires both 20ms and 20 percent improvement', () async {
    for (final values in [
      {primary: 30.0, backup: 12.0},
      {primary: 200.0, backup: 170.0},
      {primary: 100.0, backup: 81.0},
    ]) {
      expect((await _select(values: values)).selectedUrl, primary);
    }
    expect((await _select(values: {primary: 100, backup: 80})).selectedUrl,
        backup);
  });

  test('cooldown prevents latency switches but permits failure recovery',
      () async {
    expect((await _select(allowSwitch: false)).selectedUrl, primary);
    expect(
        (await _select(
                allowSwitch: false, values: {primary: null, backup: 100}))
            .selectedUrl,
        backup);
  });

  test('unknown identity does not preempt a reachable current route', () async {
    expect(
        (await _select(identity: ServerRouteVerification.unverified))
            .selectedUrl,
        primary);
    expect(
        (await _select(
                identity: ServerRouteVerification.authenticationRequired,
                values: {primary: null, backup: 100}))
            .selectedUrl,
        backup);
  });

  test('identity mismatch prevents automatic use of backup', () async {
    expect(
        (await _select(
                current: backup, identity: ServerRouteVerification.mismatch))
            .selectedUrl,
        primary);
    expect(
        (await _select(
                identity: ServerRouteVerification.mismatch,
                values: {primary: null, backup: 10}))
            .selectedUrl,
        isNull);
  });

  test('manual modes measure both routes without automatic failover', () async {
    expect((await _select(mode: ServerRouteMode.primary)).selectedUrl, primary);
    final manual = await _select(
        mode: ServerRouteMode.backup, values: {primary: 1, backup: null});
    expect(manual.selectedUrl, isNull);
    expect(manual.latencies.keys, containsAll([primary, backup]));
  });

  test('invalid latency values and both-unreachable do not become successes',
      () async {
    for (final invalid in [double.nan, double.infinity, -1.0, null]) {
      expect(
          (await _select(values: {primary: invalid, backup: null})).selectedUrl,
          isNull);
    }
  });

  test('startup without current route picks fastest even during cooldown',
      () async {
    expect(
        (await _select(
                current: '',
                allowSwitch: false,
                values: {primary: 12, backup: 10}))
            .selectedUrl,
        backup);
  });

  test(
      'route probes start concurrently and skip identity when LAN is unavailable',
      () async {
    final probes = <String, Completer<double?>>{};
    var verificationCount = 0;
    final result = selectServerRoute(
        config: pair,
        currentUrl: backup,
        verification: ServerRouteVerification.unverified,
        measure: (url) => (probes[url] = Completer<double?>()).future,
        verifyPair: () async {
          verificationCount++;
          return ServerRouteVerification.verified;
        });
    expect(probes.keys, containsAll([primary, backup]));
    probes[primary]!.complete(100);
    probes[backup]!.complete(null);
    expect((await result).selectedUrl, primary);
    expect(verificationCount, 0);
  });

  test('old single-address settings migrate and paired settings round trip',
      () async {
    expect((await loadServerRouteConfig(primary)).urls, [primary]);
    final config = ServerRouteConfig.fromJson(pair.toJson());
    expect(config.urls, [primary, backup]);
    expect(config.canonicalUrl('$backup/'), primary);
    expect(config.canonicalUrl('https://another.example'),
        'https://another.example');
    expect(normalizeServerUrl(' $primary/// '), primary);
    expect(validateServerUrl('$primary?token=value'), isNotNull);
    expect(
        validateServerUrl('https://user:password@reader.example'), isNotNull);
    expect(validateServerUrl('https://[fd00::1]:8080/nowen'), isNull);
    expect(validateServerUrl('', optional: true), isNull);
  });

  test(
      'HTTP probe supports health HEAD fallback, auth 401, base paths and no cookie',
      () async {
    final requests = <RequestOptions>[];
    final dio = _dio((options) async {
      requests.add(options);
      if (options.method == 'HEAD') return _json({}, status: 404);
      return _json({}, status: 401);
    });
    final service = ServerRouteService(CookieJar(), probeDio: dio);
    addTearDown(service.dispose);
    expect(await service.measure(primary), isNonNegative);
    expect(requests.map((r) => r.uri.path),
        containsAll(['/nowen/api/health', '/nowen/api/auth/me']));
    expect(requests.every((r) => r.headers['Cookie'] == null), isTrue);
    expect(requests.every((r) => !r.followRedirects), isTrue);
  });

  test('HTTP errors and timeouts are unreachable', () async {
    final dio = _dio((options) async => _json({}, status: 503));
    final service = ServerRouteService(CookieJar(), probeDio: dio);
    addTearDown(service.dispose);
    expect(await service.measure(primary), isNull);
    dio.httpClientAdapter = _Adapter((options) async => throw DioException(
        requestOptions: options, type: DioExceptionType.connectionTimeout));
    expect(await service.measure(primary), isNull);
  });

  test(
      'verification compares user and sorted library identities using the same session',
      () async {
    final jar = CookieJar();
    await jar.saveFromResponse(Uri.parse('$primary/api/auth/me'),
        [Cookie('nowen_session', 'test-session')..path = '/']);
    final requests = <RequestOptions>[];
    final dio = _dio((options) async {
      requests.add(options);
      return options.uri.path.endsWith('/auth/me')
          ? _json({
              'user': {'id': 'user-1'}
            })
          : _json({
              'libraries': [
                {'id': 'library-1', 'type': 'novel'},
              ]
            });
    });
    final service = ServerRouteService(jar, verificationDio: dio);
    addTearDown(service.dispose);
    expect(await service.verify(pair), ServerRouteVerification.verified);
    expect(requests.length, 4);
    expect(
        requests
            .every((r) => r.headers['Cookie'] == 'nowen_session=test-session'),
        isTrue);
    expect(requests.every((r) => !r.followRedirects), isTrue);
    final auth = {
      'user': {'id': 'u'}
    };
    final a = {'id': 'a', 'type': 'comic'};
    final b = {'id': 'b', 'type': 'novel'};
    expect(
        serverRouteFingerprint(auth, {
          'libraries': [a, b]
        }),
        serverRouteFingerprint(auth, {
          'libraries': [b, a]
        }));
  });

  test('malformed and unauthenticated fingerprints never pass identity checks',
      () {
    expect(serverRouteFingerprint({'user': null}, {'libraries': []}), isNull);
    expect(
        () => serverRouteFingerprint({
              'user': {'id': 'u'}
            }, '<html>'),
        throwsFormatException);
    expect(
        () => serverRouteFingerprint({
              'user': {'id': 'u'}
            }, {
              'libraries': [
                {'id': 'book'}
              ]
            }),
        throwsFormatException);
  });

  test(
      'verified cookie copy works from HTTPS to LAN with a different base path',
      () async {
    final jar = CookieJar();
    await jar.saveFromResponse(Uri.parse('$primary/api/auth/me'), [
      Cookie('nowen_session', 'test-session')
        ..secure = true
        ..path = '/nowen/',
      Cookie('other', 'private')..path = '/',
    ]);
    final service = ServerRouteService(jar);
    addTearDown(service.dispose);
    await service.copySession(primary, backup);
    final cookies = await jar.loadForRequest(Uri.parse('$backup/api/comics'));
    expect(cookies.map((c) => c.name), ['nowen_session']);
    expect(cookies.single.value, 'test-session');
    expect(cookies.single.secure, isFalse);
  });

  ServerRouteNotifier notifier(_Routes service) {
    final client = ApiClient();
    final routes = ServerRouteNotifier(
        client: client, service: service, onActivate: (_) {});
    addTearDown(() {
      routes.dispose();
      client.dio.close(force: true);
    });
    return routes;
  }

  test('confirmed identity and active route survive restart outside the LAN',
      () async {
    final firstService = _Routes();
    final first = notifier(firstService);
    await first.configure(pair);
    await first.refresh();
    expect(first.state.activeUrl, backup);
    expect((await loadServerRouteConfig(primary)).backupUrl, backup);
    final service = _Routes()..latencies[backup] = null;
    final second = notifier(service);
    await second.configure(await loadServerRouteConfig(primary));
    expect(second.state.verification, ServerRouteVerification.verified);
    await second.refresh(verify: true);
    expect(second.state.activeUrl, primary);
    expect(second.state.verification, ServerRouteVerification.verified);
    expect(service.verifications, 0);
  });

  test('simultaneous refresh requests share probes', () async {
    final service = _Routes();
    final routes = notifier(service);
    await routes.configure(pair);
    final a = routes.refresh();
    final b = routes.refresh();
    expect(identical(a, b), isTrue);
    await Future.wait([a, b]);
    expect(service.measurements, 2);
  });

  test(
      'manual switching carries the verified session to a route never used before',
      () async {
    await persistCookieJar.saveFromResponse(Uri.parse('$primary/api/auth/me'),
        [Cookie('nowen_session', 'verified-session')..path = '/nowen/']);
    final service = _Routes()
      ..latencies[primary] = 10
      ..latencies[backup] = 200;
    final routes = notifier(service);
    await routes.configure(pair);
    await routes.refresh();
    expect(routes.state.activeUrl, primary);
    expect(
        await persistCookieJar.loadForRequest(Uri.parse('$backup/api/comics')),
        isEmpty);
    await routes.configure(const ServerRouteConfig(
        primaryUrl: primary, backupUrl: backup, mode: ServerRouteMode.backup));
    final cookies =
        await persistCookieJar.loadForRequest(Uri.parse('$backup/api/comics'));
    expect(cookies.single.value, 'verified-session');
    expect(routes.client.baseUrl, backup);
  });

  test('stale probe results cannot replace a newer configuration', () async {
    final service = _Routes();
    final routes = notifier(service);
    await routes.configure(pair);
    service.pending[primary] = Completer<double?>();
    service.pending[backup] = Completer<double?>();
    final old = routes.refresh();
    const next = 'https://another.example';
    await routes.configure(const ServerRouteConfig(primaryUrl: next));
    service.pending[primary]!.complete(200);
    service.pending[backup]!.complete(1);
    await old;
    expect(routes.state.activeUrl, next);
    expect(routes.state.latencies, isEmpty);
  });

  test('failure bypasses cooldown and shares recovery across concurrent reads',
      () async {
    final service = _Routes();
    final routes = notifier(service);
    await routes.configure(pair);
    await routes.refresh();
    expect(routes.state.activeUrl, backup);
    final first = routes.failover(backup);
    final second = routes.failover(backup);
    expect(await first, primary);
    expect(await second, primary);
    expect(routes.state.latencies[backup], isNull);
    expect(routes.client.baseUrl, primary);
    expect(routes.client.libraryServerUrl, primary);
    await routes.refresh();
    expect(routes.state.activeUrl, primary); // 30-second cooldown
  });

  test('mismatch is cached; timeouts retain it and manual retry can repair it',
      () async {
    final service = _Routes()..identity = ServerRouteVerification.mismatch;
    final routes = notifier(service);
    await routes.configure(pair);
    await routes.refresh();
    expect(await routes.failover(primary), isNull);
    service.identity = ServerRouteVerification.deferred;
    await routes.refresh(verify: true);
    expect(routes.state.verification, ServerRouteVerification.mismatch);
    service.identity = ServerRouteVerification.verified;
    await routes.refresh(verify: true);
    expect(routes.state.verification, ServerRouteVerification.verified);
  });

  test(
      'manual mode and authentication operations suspend failure-driven switching',
      () async {
    final service = _Routes();
    final routes = notifier(service);
    await routes.configure(const ServerRouteConfig(
        primaryUrl: primary, backupUrl: backup, mode: ServerRouteMode.primary));
    expect(await routes.failover(primary), isNull);
    await routes.configure(pair);
    routes.setAuthenticating(true);
    expect(await routes.failover(primary), isNull);
    expect(await routes.refresh(), isFalse);
    routes.setAuthenticating(false);
    await routes.refresh();
    expect(routes.state.activeUrl, backup);
  });

  test(
      'open readers retain their API client and navigator during a route switch',
      () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final router = container.read(routerProvider);
    await Future<void>.delayed(Duration.zero);
    final client = container.read(apiClientProvider);
    final api = container.read(comicApiProvider);
    final seen = <Uri>[];
    client.dio.httpClientAdapter = _Adapter((options) async {
      seen.add(options.uri);
      return _json({'id': 'book'});
    });
    container.read(serverUrlProvider.notifier).state = primary;
    await api.getComic('book');
    container.read(serverUrlProvider.notifier).state = backup;
    await api.getComic('book');
    expect(seen.map((uri) => uri.toString()),
        ['$primary/api/comics/book', '$backup/api/comics/book']);
    expect(identical(container.read(routerProvider), router), isTrue);
    expect(identical(container.read(comicApiProvider), api), isTrue);
  });

  test('failed read retries once on the alternate route with its cookie',
      () async {
    final client = ApiClient()..setBaseUrl(primary);
    addTearDown(() => client.dio.close(force: true));
    await persistCookieJar.saveFromResponse(Uri.parse('$backup/api/comics'),
        [Cookie('nowen_session', 'alternate-session')..path = '/']);
    final requests = <RequestOptions>[];
    client.onConnectionFailure = (failedUrl) async {
      expect(failedUrl, primary);
      client.setBaseUrl(backup);
      return backup;
    };
    client.dio.httpClientAdapter = _Adapter((options) async {
      requests.add(options);
      if (options.uri.host == Uri.parse(primary).host) {
        throw DioException(
            requestOptions: options, type: DioExceptionType.connectionError);
      }
      return _json({'ok': true});
    });
    expect((await client.get<dynamic>('/comics/book')).data['ok'], isTrue);
    expect(requests.length, 2);
    expect(requests.last.headers['cookie'],
        contains('nowen_session=alternate-session'));
  });

  test('a timed-out write is not duplicated on the other route', () async {
    final client = ApiClient()..setBaseUrl(primary);
    addTearDown(() => client.dio.close(force: true));
    var failovers = 0;
    client.onConnectionFailure = (_) async {
      failovers++;
      return backup;
    };
    client.dio.httpClientAdapter = _Adapter((options) async =>
        throw DioException(
            requestOptions: options, type: DioExceptionType.receiveTimeout));
    await expectLater(client.post<dynamic>('/reading-activity'),
        throwsA(isA<DioException>()));
    expect(failovers, 0);
  });

  test(
      'late unauthorized response from the old route cannot log out the active route',
      () async {
    var unauthorized = 0;
    final client = ApiClient(onUnauthorized: () => unauthorized++)
      ..setBaseUrl(primary);
    addTearDown(() => client.dio.close(force: true));
    final started = Completer<void>();
    final response = Completer<ResponseBody>();
    client.dio.httpClientAdapter = _Adapter((options) {
      started.complete();
      return response.future;
    });
    final request = client.get<dynamic>('/comics/book');
    final failure = expectLater(request, throwsA(isA<DioException>()));
    await started.future;
    client.setBaseUrl(backup);
    response.complete(_json({}, status: 401));
    await failure;
    expect(unauthorized, 0);
  });
}
