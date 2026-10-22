import 'dart:async';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';

enum ServerRouteMode { automatic, primary, backup }

enum ServerRouteVerification {
  notConfigured,
  unverified,
  verified,
  mismatch,
  authenticationRequired,
  authenticationFailed,
  deferred,
  unavailable,
}

String normalizeServerUrl(String value) =>
    value.trim().replaceFirst(RegExp(r'/+$'), '');

String? validateServerUrl(String value, {bool optional = false}) {
  if (value.trim().isEmpty) return optional ? null : '请输入服务器地址';
  final uri = Uri.tryParse(value.trim());
  if (uri == null || !['http', 'https'].contains(uri.scheme)) {
    return '地址必须以 http:// 或 https:// 开头';
  }
  if (uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment) {
    return '地址格式不正确，请勿包含账号、查询参数或片段';
  }
  return null;
}

class ServerRouteConfig {
  final String primaryUrl;
  final String backupUrl;
  final ServerRouteMode mode;

  const ServerRouteConfig({
    required this.primaryUrl,
    this.backupUrl = '',
    this.mode = ServerRouteMode.automatic,
  });

  List<String> get urls => [primaryUrl, if (backupUrl.isNotEmpty) backupUrl];

  String canonicalUrl(String url) {
    final normalized = normalizeServerUrl(url);
    return urls.contains(normalized) ? primaryUrl : normalized;
  }

  Map<String, dynamic> toJson() => {
        'primaryUrl': primaryUrl,
        'backupUrl': backupUrl,
        'mode': mode.name,
      };

  factory ServerRouteConfig.fromJson(Map<String, dynamic> json) {
    final primary = normalizeServerUrl(json['primaryUrl'] as String);
    final backup = normalizeServerUrl(json['backupUrl'] as String? ?? '');
    return ServerRouteConfig(
      primaryUrl: primary,
      backupUrl: backup == primary ? '' : backup,
      mode: ServerRouteMode.values.firstWhere(
        (mode) => mode.name == json['mode'],
        orElse: () => ServerRouteMode.automatic,
      ),
    );
  }
}

/// Null latency means unreachable. Measurements always use real HTTP requests.
class ServerRouteSelection {
  final String? selectedUrl;
  final Map<String, double?> latencies;
  final ServerRouteVerification verification;

  const ServerRouteSelection(
      this.selectedUrl, this.latencies, this.verification);
}

/// Matches NowenReaderLite: concurrent probes, 20 ms / 20% hysteresis and a
/// 30-second cooldown. A failed current route bypasses the cooldown.
Future<ServerRouteSelection> selectServerRoute({
  required ServerRouteConfig config,
  required String currentUrl,
  required ServerRouteVerification verification,
  required Future<double?> Function(String) measure,
  required Future<ServerRouteVerification> Function() verifyPair,
  bool allowsLatencySwitch = true,
  bool forceVerification = false,
}) async {
  final measured = await Future.wait(config.urls.map(measure));
  final latencies = <String, double?>{
    for (var i = 0; i < config.urls.length; i++)
      config.urls[i]:
          measured[i] != null && measured[i]!.isFinite && measured[i]! >= 0
              ? measured[i]
              : null,
  };
  var identity = verification;
  if (config.backupUrl.isNotEmpty &&
      latencies.values.every((ms) => ms != null) &&
      (forceVerification ||
          (identity != ServerRouteVerification.verified &&
              identity != ServerRouteVerification.mismatch))) {
    identity = await verifyPair();
  }
  final reachable = config.urls.where((url) => latencies[url] != null).toList();
  String? selected;
  if (config.mode != ServerRouteMode.automatic) {
    final target = config.mode == ServerRouteMode.primary
        ? config.primaryUrl
        : config.backupUrl;
    selected = latencies[target] != null ? target : null;
  } else if (identity == ServerRouteVerification.mismatch) {
    selected = latencies[config.primaryUrl] != null ? config.primaryUrl : null;
  } else if (reachable.isNotEmpty) {
    final current = reachable.contains(currentUrl) ? currentUrl : null;
    if (identity == ServerRouteVerification.verified) {
      final fastest =
          reachable.reduce((a, b) => latencies[a]! <= latencies[b]! ? a : b);
      if (current == null) {
        selected = fastest;
      } else {
        final improvement = latencies[current]! - latencies[fastest]!;
        selected = allowsLatencySwitch &&
                improvement >= 20 &&
                improvement >= latencies[current]! * 0.2
            ? fastest
            : current;
      }
    } else {
      selected = current ?? reachable.first;
    }
  }
  return ServerRouteSelection(selected, latencies, identity);
}

class ServerRouteService {
  final CookieJar cookieJar;
  final Dio probeDio;
  final Dio verificationDio;

  ServerRouteService(this.cookieJar, {Dio? probeDio, Dio? verificationDio})
      : probeDio = probeDio ?? Dio(),
        verificationDio = verificationDio ?? Dio();

  Future<double?> measure(String baseUrl) async {
    if (validateServerUrl(baseUrl) != null) return null;
    final result = Completer<double?>();
    final cancel = CancelToken();
    var remaining = 2;
    Future<void> probe(String path, String method) async {
      final watch = Stopwatch()..start();
      try {
        final response = await probeDio.request<dynamic>(
          '$baseUrl/api$path',
          cancelToken: cancel,
          options: Options(
            method: method,
            sendTimeout: const Duration(seconds: 2),
            receiveTimeout: const Duration(seconds: 2),
            followRedirects: false,
            validateStatus: (_) => true,
            headers: {
              'Accept': 'application/json',
              'Cache-Control': 'no-cache'
            },
          ),
        );
        final status = response.statusCode ?? 0;
        if (!result.isCompleted &&
            ((status >= 200 && status < 300) ||
                (method == 'GET' && (status == 401 || status == 403)))) {
          result.complete(watch.elapsedMicroseconds / 1000);
        }
      } catch (_) {
        // A timed out or failed probe is never a zero-millisecond success.
      } finally {
        if (--remaining == 0 && !result.isCompleted) result.complete(null);
      }
    }

    unawaited(probe('/health', 'HEAD'));
    unawaited(probe('/auth/me', 'GET'));
    try {
      return await result.future
          .timeout(const Duration(seconds: 2), onTimeout: () => null);
    } finally {
      cancel.cancel('Route probe finished');
    }
  }

  Future<ServerRouteVerification> verify(ServerRouteConfig config) async {
    if (config.backupUrl.isEmpty) return ServerRouteVerification.notConfigured;
    // Compare both endpoints with the SAME session, as on iOS. A diagnostic
    // request must never trigger global logout or follow a credential redirect.
    List<Cookie> session = [];
    for (final url in config.urls) {
      session = (await cookieJar.loadForRequest(Uri.parse('$url/api/auth/me')))
          .where((cookie) => cookie.name == 'nowen_session')
          .toList();
      if (session.isNotEmpty) break;
    }
    if (session.isEmpty) return ServerRouteVerification.authenticationRequired;
    final header = session.map((c) => '${c.name}=${c.value}').join('; ');
    try {
      final fingerprints = await Future.wait(config.urls.map((url) async {
        final responses = await Future.wait([
          for (final path in ['/auth/me', '/libraries/accessible'])
            verificationDio
                .get<dynamic>('$url/api$path',
                    options: Options(
                      headers: {'Accept': 'application/json', 'Cookie': header},
                      followRedirects: false,
                      receiveTimeout: const Duration(seconds: 6),
                      sendTimeout: const Duration(seconds: 6),
                    ))
                .timeout(const Duration(seconds: 6)),
        ]);
        return serverRouteFingerprint(responses[0].data, responses[1].data);
      }));
      if (fingerprints.any((value) => value == null)) {
        return ServerRouteVerification.authenticationFailed;
      }
      return fingerprints[0] == fingerprints[1]
          ? ServerRouteVerification.verified
          : ServerRouteVerification.mismatch;
    } on TimeoutException {
      return ServerRouteVerification.deferred;
    } on DioException catch (error) {
      if ([401, 403].contains(error.response?.statusCode)) {
        return ServerRouteVerification.authenticationFailed;
      }
      return isRouteConnectionFailure(error)
          ? ServerRouteVerification.deferred
          : ServerRouteVerification.unavailable;
    } catch (_) {
      return ServerRouteVerification.unavailable;
    }
  }

  /// Only the configured, verified pair may share the session cookie.
  Future<void> copySession(String sourceUrl, String destinationUrl) async {
    final source = Uri.parse('$sourceUrl/api/auth/me');
    final destination = Uri.parse('$destinationUrl/api/auth/me');
    final cookies = await cookieJar.loadForRequest(source);
    await cookieJar.saveFromResponse(destination, [
      for (final original in cookies.where((c) => c.name == 'nowen_session'))
        Cookie(original.name, original.value)
          ..path = Uri.parse(destinationUrl).path.isEmpty
              ? '/'
              : '${Uri.parse(destinationUrl).path}/'
          ..httpOnly = original.httpOnly
          ..secure = destination.scheme == 'https'
          ..expires = original.expires,
    ]);
  }

  void dispose() {
    probeDio.close(force: true);
    verificationDio.close(force: true);
  }
}

String? serverRouteFingerprint(dynamic auth, dynamic libraries) {
  if (auth is! Map || libraries is! Map) throw const FormatException();
  final user = auth['user'];
  if (user == null) return null;
  if (user is! Map ||
      user['id'] is! String ||
      (user['id'] as String).isEmpty ||
      libraries['libraries'] is! List) {
    throw const FormatException();
  }
  final signatures = (libraries['libraries'] as List).map((library) {
    if (library is! Map ||
        library['id'] is! String ||
        library['type'] is! String) {
      throw const FormatException();
    }
    return '${library['id']}|${library['type']}';
  }).toList()
    ..sort();
  return '${user['id']}\n${signatures.join('\n')}';
}

bool isRouteConnectionFailure(DioException error) => [
      DioExceptionType.connectionTimeout,
      DioExceptionType.sendTimeout,
      DioExceptionType.receiveTimeout,
      DioExceptionType.connectionError,
    ].contains(error.type);
