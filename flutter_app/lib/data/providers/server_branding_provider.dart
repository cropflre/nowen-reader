import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../models/server_branding.dart';
import '../services/server_branding_service.dart';
import 'server_route_provider.dart';

final serverBrandingTargetProvider = Provider<ServerBrandingTarget>((ref) {
  final url = normalizeServerUrl(ref.watch(serverUrlProvider));
  if (url.isEmpty) return const ServerBrandingTarget();
  return resolveServerBrandingTarget(url, ref.watch(serverRouteProvider));
});

ServerBrandingTarget resolveServerBrandingTarget(
    String activeUrl, ServerRouteState routes) {
  final url = normalizeServerUrl(activeUrl);
  if (url.isEmpty) return const ServerBrandingTarget();
  final primary = normalizeServerUrl(routes.config.primaryUrl);
  // Never share the primary cache with an unverified backup server.
  final sameServer = url == primary ||
      (routes.config.urls.contains(url) &&
          routes.verification == ServerRouteVerification.verified);
  return ServerBrandingTarget(key: sameServer ? primary : url, baseUrl: url);
}

final serverBrandingServiceProvider = Provider<ServerBrandingService>((ref) {
  final service = ServerBrandingService();
  ref.onDispose(service.dispose);
  return service;
});

final serverBrandingProvider =
    StateNotifierProvider<ServerBrandingNotifier, Map<String, ServerBranding>>(
        (ref) {
  final notifier =
      ServerBrandingNotifier(ref.watch(serverBrandingServiceProvider));
  ref.listen<ServerBrandingTarget>(serverBrandingTargetProvider, (_, target) {
    notifier.activate(target);
  }, fireImmediately: true);
  return notifier;
});

final currentServerBrandingProvider = Provider<ServerBranding>((ref) {
  final key = ref.watch(serverBrandingTargetProvider).key;
  return ref.watch(serverBrandingProvider)[key] ?? const ServerBranding();
});

final cachedServerBrandingProvider = Provider.family<ServerBranding, String>(
  (ref, url) =>
      ref.watch(serverBrandingProvider)[normalizeServerUrl(url)] ??
      const ServerBranding(),
);

class ServerBrandingNotifier
    extends StateNotifier<Map<String, ServerBranding>> {
  static const refreshInterval = Duration(minutes: 5);
  final ServerBrandingService _service;
  final DateTime Function() _now;
  final Map<String, Future<void>> _cacheLoads = {};
  ServerBrandingTarget _target = const ServerBrandingTarget();
  CancelToken? _cancelToken;
  Future<void>? _pending;
  int _generation = 0;
  int _request = 0;
  int _version = 0;

  ServerBrandingNotifier(this._service, {DateTime Function()? now})
      : _now = now ?? DateTime.now,
        super(const {});

  void activate(ServerBrandingTarget target) {
    if (_target == target) return;
    final previousKey = _target.key;
    _target = target;
    final generation = ++_generation;
    _cancelToken?.cancel();
    _pending = null;
    if (target.key.isEmpty) return;
    unawaited(_activate(target, generation, previousKey != target.key));
  }

  Future<void> _activate(
      ServerBrandingTarget target, int generation, bool changedServer) async {
    await loadCached([target.key]);
    if (!mounted || generation != _generation) return;
    if (_pending != null) {
      await _pending;
      return;
    }
    // Route changes reuse recent data; a new server/startup always revalidates.
    await refresh(force: changedServer);
  }

  Future<void> loadCached(Iterable<String> urls) async {
    await Future.wait(urls.map((url) {
      final key = normalizeServerUrl(url);
      if (key.isEmpty) return Future<void>.value();
      return _cacheLoads.putIfAbsent(key, () async {
        try {
          final cached = await _service.readCached(key);
          if (mounted && cached != null && !state.containsKey(key)) {
            state = {...state, key: cached};
          }
        } catch (_) {
          // A broken local cache cannot prevent a fresh network request.
        }
      });
    }));
  }

  Future<void> refresh({bool force = false}) {
    final target = _target;
    if (target.key.isEmpty || !mounted) return Future.value();
    if (_pending != null && !force) return _pending!;
    final fetchedAt = state[target.key]?.fetchedAt;
    if (!force &&
        fetchedAt != null &&
        _now().difference(fetchedAt) < refreshInterval) {
      return Future.value();
    }
    _cancelToken?.cancel();
    final token = _cancelToken = CancelToken();
    final generation = _generation;
    final request = ++_request;
    final version = '${_now().microsecondsSinceEpoch}-${++_version}';
    final pending =
        _refresh(target, generation, request, version, token).whenComplete(() {
      if (_isCurrent(generation, request)) _pending = null;
    });
    _pending = pending;
    return pending;
  }

  bool _isCurrent(int generation, int request) =>
      mounted && generation == _generation && request == _request;

  Future<void> _refresh(ServerBrandingTarget target, int generation,
      int request, String version, CancelToken token) async {
    try {
      final settings = await _service.fetchSettings(target.baseUrl, token);
      if (!_isCurrent(generation, request)) return;
      final configured = settings['siteIcon'] is String &&
          (settings['siteIcon'] as String).trim().isNotEmpty;
      final previous = state[target.key];
      var branding = ServerBranding(
        name: ServerBranding.normalizeName(settings['siteName']),
        iconBytes: configured ? previous?.iconBytes : null,
        fetchedAt: previous?.fetchedAt,
      );
      state = {...state, target.key: branding};
      if (configured) {
        try {
          final bytes =
              await _service.fetchIcon(target.baseUrl, version, token);
          if (!_isCurrent(generation, request)) return;
          branding = ServerBranding(
            name: branding.name,
            iconBytes: bytes,
            fetchedAt: branding.fetchedAt,
          );
          state = {...state, target.key: branding};
        } catch (_) {
          if (!_isCurrent(generation, request)) return;
          // Temporary network failures retain this server's last working logo.
        }
      }
      branding = ServerBranding(
        name: branding.name,
        iconBytes: branding.iconBytes,
        fetchedAt: _now(),
      );
      state = {...state, target.key: branding};
      await _service.writeCached(target.key, branding);
    } catch (_) {
      // Missing/older endpoints and offline servers retain cached/default data.
    }
  }

  @override
  void dispose() {
    _generation++;
    _cancelToken?.cancel();
    super.dispose();
  }
}
