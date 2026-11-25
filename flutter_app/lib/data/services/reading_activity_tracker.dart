import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart';

import '../api/comic_api.dart';

/// 将进度与活跃时长写入同一个幂等阅读会话。
class ReadingActivityTracker with WidgetsBindingObserver {
  ReadingActivityTracker({
    required ComicApi api,
    required this.comicId,
  }) : _api = api;

  final ComicApi _api;
  final String comicId;
  late final String _clientSessionId =
      'flutter-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  Timer? _activeTimer;
  Timer? _heartbeatTimer;
  Timer? _pageTimer;
  int _page = 0;
  int _totalPages = 0;
  double? _positionRatio;
  double? _lastFlushedRatio;
  int _activeSeconds = 0;
  int _sequence = 0;
  bool _trackProgress = true;
  bool _started = false;
  bool _finalized = false;
  bool _resumed = true;

  void start(
    int page,
    int totalPages, {
    bool trackProgress = true,
    double? positionRatio,
  }) {
    if (_started || totalPages <= 0) return;
    _started = true;
    _page = page;
    _totalPages = totalPages;
    if (positionRatio != null && positionRatio.isFinite) {
      _positionRatio = positionRatio.clamp(0.0, 1.0).toDouble();
    }
    _trackProgress = trackProgress;
    _resumed = WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
    _activeTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_resumed) _activeSeconds += 1;
    });
    _heartbeatTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => _flushSilently(),
    );
    _flushSilently();
  }

  void updatePosition(int page, int totalPages, {double? positionRatio}) {
    if (!_started || _finalized) return;
    final normalizedRatio = (positionRatio != null && positionRatio.isFinite)
        ? positionRatio.clamp(0.0, 1.0).toDouble()
        : null;
    final pageChanged = page != _page || totalPages != _totalPages;
    final chapterChanged = page != _page;
    final nextRatio = normalizedRatio ??
        (chapterChanged && _positionRatio != null ? 0.0 : _positionRatio);
    final ratioChanged = nextRatio != null &&
        (_lastFlushedRatio == null
            ? nextRatio != _positionRatio
            : (nextRatio - _lastFlushedRatio!).abs() >= 0.01);

    _page = page;
    _totalPages = totalPages;
    _positionRatio = nextRatio;

    if (!pageChanged && !ratioChanged) return;
    _pageTimer?.cancel();
    _pageTimer = Timer(const Duration(milliseconds: 600), () {
      _flushSilently();
    });
  }

  void updatePage(int page, int totalPages) {
    updatePosition(page, totalPages);
  }

  Future<void> flush({bool finalize = false}) async {
    if (!_started || _finalized) return;
    final sequence = ++_sequence;
    final ratioToSend = _positionRatio;
    await _api.recordReadingActivity(
      comicId: comicId,
      clientSessionId: _clientSessionId,
      page: _page,
      totalPages: _totalPages,
      positionRatio: ratioToSend,
      activeSeconds: _activeSeconds,
      sequence: sequence,
      finalize: finalize,
      trackProgress: _trackProgress,
    );
    _lastFlushedRatio = ratioToSend;
    if (finalize) _finalized = true;
  }

  Future<void> finish() async {
    if (!_started || _finalized) return;
    _cancelTimers();
    try {
      await flush(finalize: true);
    } catch (_) {}
    WidgetsBinding.instance.removeObserver(this);
  }

  void dispose() {
    _cancelTimers();
    WidgetsBinding.instance.removeObserver(this);
    if (_started && !_finalized) {
      unawaited(flush(finalize: true).catchError((_) {}));
    }
  }

  void _cancelTimers() {
    _activeTimer?.cancel();
    _heartbeatTimer?.cancel();
    _pageTimer?.cancel();
  }

  void _flushSilently({bool finalize = false}) {
    unawaited(flush(finalize: finalize).catchError((_) {}));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (!_resumed) _flushSilently();
  }
}
