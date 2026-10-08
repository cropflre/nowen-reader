/// Keeps rich chapter data for nearby navigation and shares pending requests
/// between foreground reading, search and read-ahead.
class ReaderChapterLoader {
  final Future<Map<String, dynamic>> Function(int) fetch;
  final int maxChapters;
  final int maxCharacters;
  final _cache = <int, Map<String, dynamic>>{};
  final _pending = <int, Future<Map<String, dynamic>>>{};
  int _characters = 0;

  ReaderChapterLoader({
    required this.fetch,
    this.maxChapters = 6,
    this.maxCharacters = 2 * 1024 * 1024,
  });

  Future<Map<String, dynamic>> load(int index) {
    final cached = _cache.remove(index);
    if (cached != null) {
      _cache[index] = cached;
      return Future.value(cached);
    }
    final pending = _pending[index];
    if (pending != null) return pending;
    final future = _load(index).whenComplete(() {
      _pending.remove(index);
    });
    _pending[index] = future;
    return future;
  }

  Future<Map<String, dynamic>> _load(int index) async {
    final data = await fetch(index);
    final length = (data['content'] as String? ?? '').length;
    if (length <= maxCharacters) {
      while (_cache.isNotEmpty &&
          (_cache.length >= maxChapters ||
              _characters + length > maxCharacters)) {
        final removed = _cache.remove(_cache.keys.first)!;
        _characters -= (removed['content'] as String? ?? '').length;
      }
      _cache[index] = data;
      _characters += length;
    }
    return data;
  }
}
