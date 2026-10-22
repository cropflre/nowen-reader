import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../services/server_route_service.dart';

export '../services/server_route_service.dart';

const _configKey = 'server_route_configs';
const _identityKey = 'server_route_identities';
const _activeKey = 'server_route_active';

Future<Map<String, dynamic>> _loadMap(String key) async {
  final prefs = await SharedPreferences.getInstance();
  try {
    return jsonDecode(prefs.getString(key) ?? '{}') as Map<String, dynamic>;
  } catch (_) {
    return {};
  }
}

Future<ServerRouteConfig> loadServerRouteConfig(String primaryUrl) async {
  final configs = await _loadMap(_configKey);
  try {
    if (configs[primaryUrl] is Map<String, dynamic>) {
      return ServerRouteConfig.fromJson(configs[primaryUrl]);
    }
  } catch (_) {
    // Older installations only have server_url; retain it as a single route.
  }
  return ServerRouteConfig(primaryUrl: primaryUrl);
}

class ServerRouteState {
  final ServerRouteConfig config;
  final String activeUrl;
  final Map<String, double?> latencies;
  final ServerRouteVerification verification;
  final bool measuring;
  final DateTime? measuredAt;

  const ServerRouteState({
    this.config = const ServerRouteConfig(primaryUrl: ''),
    this.activeUrl = '',
    this.latencies = const {},
    this.verification = ServerRouteVerification.notConfigured,
    this.measuring = false,
    this.measuredAt,
  });

  ServerRouteState copyWith({
    String? activeUrl,
    Map<String, double?>? latencies,
    ServerRouteVerification? verification,
    bool? measuring,
    DateTime? measuredAt,
  }) =>
      ServerRouteState(
        config: config,
        activeUrl: activeUrl ?? this.activeUrl,
        latencies: latencies ?? this.latencies,
        verification: verification ?? this.verification,
        measuring: measuring ?? this.measuring,
        measuredAt: measuredAt ?? this.measuredAt,
      );
}

class ServerRouteNotifier extends StateNotifier<ServerRouteState> {
  final ApiClient client;
  final ServerRouteService service;
  final void Function(String) onActivate;
  Timer? _timer;
  Future<bool>? _pending;
  Future<String?>? _failoverPending;
  int _generation = 0;
  bool _foreground = true;
  bool _authenticating = false;
  DateTime? _lastSwitch;

  ServerRouteNotifier({
    required this.client,
    required this.service,
    required this.onActivate,
  }) : super(const ServerRouteState()) {
    client.onConnectionFailure = failover;
  }

  String _pairKey(ServerRouteConfig config) =>
      jsonEncode([config.primaryUrl, config.backupUrl]);

  Future<void> configure(ServerRouteConfig config) async {
    final generation = ++_generation;
    _pending = null;
    _failoverPending = null;
    _lastSwitch = null;
    final identities = await _loadMap(_identityKey);
    final active = await _loadMap(_activeKey);
    if (!mounted || generation != _generation) return;
    final known = identities[_pairKey(config)];
    final verification = config.backupUrl.isEmpty
        ? ServerRouteVerification.notConfigured
        : known == 'verified'
            ? ServerRouteVerification.verified
            : known == 'mismatch'
                ? ServerRouteVerification.mismatch
                : ServerRouteVerification.unverified;
    var url = config.urls.contains(active[config.primaryUrl])
        ? active[config.primaryUrl] as String
        : config.primaryUrl;
    if (config.mode == ServerRouteMode.primary ||
        verification == ServerRouteVerification.mismatch) {
      url = config.primaryUrl;
    }
    if (config.mode == ServerRouteMode.backup && config.backupUrl.isNotEmpty) {
      url = config.backupUrl;
    }
    if (verification == ServerRouteVerification.verified &&
        config.urls.contains(client.baseUrl) &&
        client.baseUrl != url) {
      await service.copySession(client.baseUrl, url);
      if (!mounted || generation != _generation) return;
    }
    state = ServerRouteState(
        config: config, activeUrl: url, verification: verification);
    client.libraryServerUrl = config.primaryUrl;
    client.setBaseUrl(url);
    onActivate(url);
    final configs = await _loadMap(_configKey);
    if (!mounted || generation != _generation) return;
    configs[config.primaryUrl] = config.toJson();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_configKey, jsonEncode(configs));
    _startTimer();
  }

  void _startTimer() {
    _timer?.cancel();
    if (_foreground && state.config.primaryUrl.isNotEmpty) {
      _timer = Timer.periodic(const Duration(seconds: 30), (_) {
        unawaited(refresh());
      });
    }
  }

  void setForeground(bool foreground) {
    _foreground = foreground;
    _startTimer();
    if (foreground && state.config.primaryUrl.isNotEmpty) {
      unawaited(refresh());
    }
  }

  void setAuthenticating(bool value) {
    _authenticating = value;
    if (value) {
      ++_generation;
      _pending = null;
      _failoverPending = null;
      state = state.copyWith(measuring: false);
    }
  }

  Future<bool> refresh({bool verify = false}) {
    if (_authenticating || state.config.primaryUrl.isEmpty) {
      return Future.value(false);
    }
    return _pending ??= _refresh(verify: verify);
  }

  Future<bool> _refresh({required bool verify}) async {
    final generation = _generation;
    final config = state.config;
    state = state.copyWith(measuring: true);
    try {
      final selection = await selectServerRoute(
        config: config,
        currentUrl: state.activeUrl,
        verification: state.verification,
        forceVerification: verify,
        allowsLatencySwitch: _lastSwitch == null ||
            DateTime.now().difference(_lastSwitch!) >=
                const Duration(seconds: 30),
        measure: service.measure,
        verifyPair: () async {
          final result = await service.verify(config);
          if (!mounted || generation != _generation) {
            return ServerRouteVerification.unverified;
          }
          return result == ServerRouteVerification.deferred &&
                  [
                    ServerRouteVerification.verified,
                    ServerRouteVerification.mismatch
                  ].contains(state.verification)
              ? state.verification
              : result;
        },
      );
      if (!mounted || generation != _generation) return false;
      var verification = selection.verification;
      // Being outside the LAN cannot invalidate a previously confirmed pair.
      if (verification == ServerRouteVerification.deferred &&
          [ServerRouteVerification.verified, ServerRouteVerification.mismatch]
              .contains(state.verification)) {
        verification = state.verification;
      }
      if ([ServerRouteVerification.verified, ServerRouteVerification.mismatch]
          .contains(verification)) {
        final identities = await _loadMap(_identityKey);
        if (!mounted || generation != _generation) return false;
        identities[_pairKey(config)] = verification.name;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_identityKey, jsonEncode(identities));
      }
      if (!mounted || generation != _generation) return false;
      state = state.copyWith(
          latencies: selection.latencies,
          verification: verification,
          measuredAt: DateTime.now());
      final selected = selection.selectedUrl;
      if (selected != null) await _activate(selected, generation);
      return selected != null;
    } finally {
      if (mounted && generation == _generation) {
        state = state.copyWith(measuring: false);
        _pending = null;
      }
    }
  }

  Future<void> _activate(String url, int generation) async {
    if (url != state.activeUrl &&
        state.verification == ServerRouteVerification.verified) {
      await service.copySession(state.activeUrl, url);
    }
    if (!mounted || generation != _generation) return;
    if (url != state.activeUrl) {
      _lastSwitch = DateTime.now();
      client.setBaseUrl(url);
      state = state.copyWith(activeUrl: url);
      onActivate(url);
    }
    final active = await _loadMap(_activeKey);
    if (!mounted || generation != _generation) return;
    active[state.config.primaryUrl] = url;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_activeKey, jsonEncode(active));
  }

  Future<String?> failover(String failedUrl) {
    if (_failoverPending != null) return _failoverPending!;
    late final Future<String?> pending;
    pending = _failover(failedUrl).whenComplete(() {
      if (identical(_failoverPending, pending)) _failoverPending = null;
    });
    return _failoverPending = pending;
  }

  Future<String?> _failover(String failedUrl) async {
    var generation = _generation;
    if (_authenticating ||
        state.config.mode != ServerRouteMode.automatic ||
        state.config.backupUrl.isEmpty ||
        state.verification == ServerRouteVerification.mismatch ||
        !state.config.urls.contains(failedUrl)) {
      return null;
    }
    if (state.activeUrl != failedUrl) return state.activeUrl;
    final config = state.config;
    final alternate =
        failedUrl == config.primaryUrl ? config.backupUrl : config.primaryUrl;
    final latency = await service.measure(alternate);
    if (!mounted || generation != _generation || latency == null) return null;
    if (state.activeUrl != failedUrl) return state.activeUrl;
    // A previous periodic result must not undo this failure-driven switch.
    generation = ++_generation;
    _pending = null;
    state = state.copyWith(
        latencies: {...state.latencies, failedUrl: null, alternate: latency},
        measuredAt: DateTime.now(),
        measuring: false);
    await _activate(alternate, generation);
    return state.activeUrl == alternate ? alternate : null;
  }

  @override
  void dispose() {
    ++_generation;
    _timer?.cancel();
    client.onConnectionFailure = null;
    service.dispose();
    super.dispose();
  }
}

final serverRouteProvider =
    StateNotifierProvider<ServerRouteNotifier, ServerRouteState>((ref) {
  final client = ref.read(apiClientProvider);
  return ServerRouteNotifier(
    client: client,
    service: ServerRouteService(client.cookieJar),
    onActivate: (url) => ref.read(serverUrlProvider.notifier).state = url,
  );
});
