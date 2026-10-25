import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/comic_api.dart';
import 'package:nowen_reader/data/providers/comic_provider.dart';

class _Request {
  final int page;
  final int limit;
  final String? search;
  final result = Completer<Map<String, dynamic>>();
  _Request(this.page, this.limit, this.search);
}

class _Api extends ComicApi {
  _Api() : super(Dio());
  final requests = <_Request>[];

  @override
  Future<Map<String, dynamic>> listComics({
    int page = 1,
    int limit = 20,
    String sort = 'addedAt',
    String order = 'desc',
    String? search,
    String? tag,
    String? category,
    String? type,
    String? readingStatus,
    bool? favoritesOnly,
    bool seriesView = false,
  }) {
    final request = _Request(page, limit, search);
    requests.add(request);
    return request.result.future;
  }
}

Map<String, dynamic> _page(
  int start,
  int count, {
  int progress = 0,
  int total = 100,
}) =>
    {
      'total': total,
      'comics': List.generate(
        count,
        (i) => {
          'id': 'book-${start + i}',
          'title': 'Book ${start + i}',
          'filename': 'book.cbz',
          'pageCount': 10,
          'lastReadPage': progress,
        },
      ),
    };

void main() {
  late _Api api;
  late ProviderContainer container;
  final scope = StateProvider<String>((ref) => 'server:alice:user');
  setUp(() {
    api = _Api();
    container = ProviderContainer(
      overrides: [
        comicApiProvider.overrideWithValue(api),
        comicListScopeProvider.overrideWith((ref) => ref.watch(scope)),
      ],
    );
  });
  tearDown(() => container.dispose());

  Future<void> loadTwoPages() async {
    final notifier = container.read(comicListProvider.notifier);
    var load = notifier.loadComics();
    api.requests.last.result.complete(_page(0, 20));
    await load;
    load = notifier.loadMore();
    api.requests.last.result.complete(_page(20, 20));
    await load;
  }

  test('reading return retains two pages while progress refreshes', () async {
    await loadTwoPages();
    final notifier = container.read(comicListProvider.notifier);
    final old = container.read(comicListProvider);
    final refresh = notifier.refreshVisible();
    final pending = container.read(comicListProvider);
    expect(pending.comics, same(old.comics));
    expect(pending.params.page, 2);
    expect(pending.isLoading, isFalse);
    expect(api.requests.last.page, 1);
    expect(api.requests.last.limit, 40);
    api.requests.last.result.complete(_page(0, 40, progress: 8));
    await refresh;
    final updated = container.read(comicListProvider);
    expect(updated.comics.length, 40);
    expect(updated.comics.first.lastReadPage, 8);
    expect(updated.params.page, 2);
    final more = notifier.loadMore();
    expect(api.requests.last.page, 3);
    expect(api.requests.last.limit, 20);
    api.requests.last.result.complete(_page(40, 20));
    await more;
    expect(container.read(comicListProvider).comics.length, 60);
  });

  test('failed background refresh preserves usable pages', () async {
    await loadTwoPages();
    final old = container.read(comicListProvider);
    final refresh = container.read(comicListProvider.notifier).refreshVisible();
    api.requests.last.result.completeError(Exception('offline'));
    await refresh;
    expect(container.read(comicListProvider), same(old));
  });

  test('revoked access clears cached pages', () async {
    await loadTwoPages();
    final refresh = container.read(comicListProvider.notifier).refreshVisible();
    final options = RequestOptions(path: '/comics');
    api.requests.last.result.completeError(DioException(
        requestOptions: options,
        response: Response(requestOptions: options, statusCode: 403)));
    await refresh;
    expect(container.read(comicListProvider).comics, isEmpty);
    expect(container.read(comicListProvider).error, isNotNull);
  });

  test('empty filtered shelf is a loaded state that can be restored', () async {
    final load = container
        .read(comicListProvider.notifier)
        .loadComics(params: const ComicListParams(search: 'no matches'));
    api.requests.last.result.complete(_page(0, 0, total: 0));
    await load;
    final state = container.read(comicListProvider);
    expect(state.hasLoaded, isTrue);
    expect(state.comics, isEmpty);
    expect(state.params.search, 'no matches');
  });

  test('old refresh cannot overwrite a newer filter', () async {
    await loadTwoPages();
    final notifier = container.read(comicListProvider.notifier);
    final refresh = notifier.refreshVisible();
    final stale = api.requests.last;
    final filtered = notifier.updateParams(
      const ComicListParams(search: 'new'),
    );
    api.requests.last.result.complete(_page(80, 1, total: 1));
    await filtered;
    stale.result.complete(_page(0, 40));
    await refresh;
    final state = container.read(comicListProvider);
    expect(state.params.search, 'new');
    expect(state.params.page, 1);
    expect(state.comics.single.id, 'book-80');
    expect(state.hasMore, isFalse);
  });

  test('filter change supersedes pending load-more', () async {
    await loadTwoPages();
    final notifier = container.read(comicListProvider.notifier);
    final more = notifier.loadMore();
    final stale = api.requests.last;
    final filtered = notifier.updateParams(
      const ComicListParams(search: 'new'),
    );
    api.requests.last.result.complete(_page(90, 1, total: 1));
    await filtered;
    stale.result.complete(_page(40, 20));
    await more;
    expect(container.read(comicListProvider).comics.single.id, 'book-90');
  });

  test('account change drops cached pages and late responses', () async {
    await loadTwoPages();
    final notifier = container.read(comicListProvider.notifier);
    final refresh = notifier.refreshVisible();
    container.read(scope.notifier).state = 'other-server:bob:user';
    expect(container.read(comicListProvider).comics, isEmpty);
    api.requests.last.result.complete(_page(0, 40));
    await refresh;
    expect(container.read(comicListProvider).comics, isEmpty);
  });

  test('shortened shelf clamps page cursor and stops pagination', () async {
    await loadTwoPages();
    final refresh = container.read(comicListProvider.notifier).refreshVisible();
    api.requests.last.result.complete(_page(0, 5, total: 5));
    await refresh;
    final state = container.read(comicListProvider);
    expect(state.params.page, 1);
    expect(state.hasMore, isFalse);
  });
}
