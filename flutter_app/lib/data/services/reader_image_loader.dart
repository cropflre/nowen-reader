import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Shares connections, in-flight requests and a bounded byte cache across all
/// reader image widgets, including PhotoView and EPUB illustrations.
class ReaderImageLoader {
  final Dio dio;
  final int maxBytes;
  final int maxEntries;
  final _cache = <String, Uint8List>{};
  final _pending = <String, Future<Uint8List>>{};
  int _cachedBytes = 0;
  int _generation = 0;

  ReaderImageLoader({
    required this.dio,
    this.maxBytes = 64 * 1024 * 1024,
    this.maxEntries = 200,
  });

  Future<Uint8List> load(
    String url, {
    Future<Uint8List?> Function()? readLocal,
  }) {
    final cached = _cache.remove(url);
    if (cached != null) {
      _cache[url] = cached;
      return Future.value(cached);
    }
    final pending = _pending[url];
    if (pending != null) return pending;

    final generation = _generation;
    late final Future<Uint8List> future;
    future = _load(url, readLocal).then((bytes) {
      if (generation == _generation && bytes.length <= maxBytes) {
        while (_cache.isNotEmpty &&
            (_cachedBytes + bytes.length > maxBytes ||
                _cache.length >= maxEntries)) {
          _cachedBytes -= _cache.remove(_cache.keys.first)!.length;
        }
        _cache[url] = bytes;
        _cachedBytes += bytes.length;
      }
      return bytes;
    }).whenComplete(() {
      if (identical(_pending[url], future)) _pending.remove(url);
    });
    _pending[url] = future;
    return future;
  }

  Future<Uint8List> _load(
    String url,
    Future<Uint8List?> Function()? readLocal,
  ) async {
    if (readLocal != null) {
      try {
        final bytes = await readLocal();
        if (bytes != null) return bytes;
      } catch (_) {
        // An unavailable offline cache must not block online reading.
      }
    }
    final response = await dio.get<List<int>>(
      url,
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(response.data!);
  }

  void clear() {
    _generation++;
    _cache.clear();
    _pending.clear();
    _cachedBytes = 0;
  }
}
