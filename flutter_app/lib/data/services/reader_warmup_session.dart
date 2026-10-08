import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart';

import '../api/comic_api.dart';

/// Server read-ahead and the scanner pause share one expiring reading lease.
class ReaderWarmupSession with WidgetsBindingObserver {
  ReaderWarmupSession({required ComicApi api, required this.comicId})
      : _api = api;

  final ComicApi _api;
  final String comicId;
  String? _sessionId;
  Timer? _heartbeat;
  int _page = 0;
  int _total = 0;
  int? _bucket;
  bool _started = false;
  bool _disposed = false;

  void start(int page, int total) {
    if (_started || _disposed || total <= 0) return;
    _started = true;
    _page = page;
    _total = total;
    WidgetsBinding.instance.addObserver(this);
    final state = WidgetsBinding.instance.lifecycleState;
    if (state == null || state == AppLifecycleState.resumed) _resume();
  }

  void _resume() {
    if (_sessionId != null || _disposed) return;
    _sessionId =
        'flutter-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';
    _bucket = null;
    _renew();
    _heartbeat = Timer.periodic(const Duration(seconds: 30), (_) => _renew());
  }

  void _renew() {
    final id = _sessionId;
    if (id == null) return;
    unawaited(_api
        .warmupPages(comicId, id, startPage: _page, count: -1)
        .catchError((_) {}));
  }

  /// Called once the visible page has loaded, so it gets the first request.
  void prefetch(int page) {
    _page = page;
    final id = _sessionId;
    if (id == null || page + 1 >= _total) return;
    final bucket = page ~/ 4;
    if (_bucket == bucket) return;
    _bucket = bucket;
    unawaited(_api
        .warmupPages(comicId, id,
            startPage: page + 1, count: min(8, _total - page - 1))
        .catchError((_) {
      if (_sessionId == id && _bucket == bucket) _bucket = null;
    }));
  }

  void _pause() {
    _heartbeat?.cancel();
    final id = _sessionId;
    _sessionId = null;
    _bucket = null;
    if (id != null) {
      unawaited(_api.endWarmup(comicId, id).catchError((_) {}));
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _pause();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_started || _disposed) return;
    if (state == AppLifecycleState.resumed) {
      _resume();
      prefetch(_page);
    } else {
      _pause();
    }
  }
}
