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
  final String? libraryId;
  final String? directoryPath;
  final result = Completer<Map<String, dynamic>>();
  _Request(
    this.page,
    this.limit,
    this.search, {
    this.libraryId,
    this.directoryPath,
  });
}

class _Api extends ComicApi {
  _Api() : super(Dio());
  final requests = <_Request>[];
  int directoryFetches = 0;
  int directoryTotal = 1;
  final directoryPages = <int>[];

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
    String? libraryId,
    String? directoryPath,
  }) {
    final request = _Request(
      page,
      limit,
      search,
      libraryId: libraryId,
      directoryPath: directoryPath,
    );
    requests.add(request);
    return request.result.future;
  }

  @override
  Future<Map<String, dynamic>> getLibraryDirectories(
    String libraryId, {
    String parent = '',
    int page = 1,
    int pageSize = 100,
  }) async {
    directoryFetches++;
    directoryPages.add(page);
    return {
      'libraryId': libraryId,
      'seriesDepth': 2,
      'maxDirectoryDepth': 1,
      'parent': parent,
      'breadcrumbs': parent.isEmpty
          ? const []
          : [
              {'name': parent, 'path': parent},
            ],
      'directories': parent.isEmpty
          ? [
              for (var i = (page - 1) * pageSize;
                  i < directoryTotal && i < page * pageSize;
                  i++)
                {
                  'name': i == 0 ? '韩漫' : '分类${i + 1}',
                  'path': i == 0 ? '韩漫' : '分类${i + 1}',
                  'depth': 1,
                  'workCount': 3,
                  'hasChildren': false,
                  'coverUrl': '/api/comics/c1/thumbnail',
                },
            ]
          : const [],
      'total': parent.isEmpty ? directoryTotal : 0,
      'page': page,
      'pageSize': pageSize,
      'totalPages': parent.isEmpty ? (directoryTotal / pageSize).ceil() : 1,
    };
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

  test('directory pages reach categories after 100 and cache independently',
      () async {
    api.directoryTotal = 101;
    const firstKey = LibraryDirectoryQueryKey(libraryId: 'large-library');
    const secondKey =
        LibraryDirectoryQueryKey(libraryId: 'large-library', page: 2);
    expect(firstKey, isNot(secondKey));
    final first =
        await container.read(libraryDirectoriesProvider(firstKey).future);
    final second =
        await container.read(libraryDirectoriesProvider(secondKey).future);
    expect(first.directories.length, 100);
    expect(first.totalPages, 2);
    expect(second.directories.single.name, '分类101');
    expect(second.page, 2);
    await container.read(libraryDirectoriesProvider(firstKey).future);
    await container.read(libraryDirectoriesProvider(secondKey).future);
    expect(api.directoryPages, [1, 2]);
    container.read(scope.notifier).state = 'other-server:bob:user';
    await container.read(libraryDirectoriesProvider(secondKey).future);
    expect(api.directoryPages, [1, 2, 2]);
  });

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

  test(
      'directory navigation preserves libraryId and directoryPath across pagination and reader return',
      () async {
    final notifier = container.read(comicListProvider.notifier);
    var load = notifier.loadComics(
      params: const ComicListParams(
        libraryId: 'lib-kr',
        directoryPath: '韩漫',
      ),
    );
    expect(api.requests.last.libraryId, 'lib-kr');
    expect(api.requests.last.directoryPath, '韩漫');
    api.requests.last.result.complete(_page(0, 20));
    await load;

    load = notifier.loadMore();
    expect(api.requests.last.page, 2);
    expect(api.requests.last.libraryId, 'lib-kr');
    expect(api.requests.last.directoryPath, '韩漫');
    api.requests.last.result.complete(_page(20, 20));
    await load;

    final refresh = notifier.refreshVisible();
    expect(api.requests.last.limit, 40);
    expect(api.requests.last.libraryId, 'lib-kr');
    expect(api.requests.last.directoryPath, '韩漫');
    api.requests.last.result.complete(_page(0, 40, progress: 5));
    await refresh;

    final state = container.read(comicListProvider);
    expect(state.params.libraryId, 'lib-kr');
    expect(state.params.directoryPath, '韩漫');
    expect(state.params.page, 2);

    // Cached directory nodes survive reader return and invalidate on account switch.
    const key = LibraryDirectoryQueryKey(libraryId: 'lib-kr', parent: '');
    final firstDirs =
        await container.read(libraryDirectoriesProvider(key).future);
    final cachedDirs =
        await container.read(libraryDirectoriesProvider(key).future);
    expect(firstDirs.directories.single.name, '韩漫');
    expect(cachedDirs.directories.single.workCount, 3);
    expect(api.directoryFetches, 1);

    container.read(scope.notifier).state = 'other-server:bob:user';
    await container.read(libraryDirectoriesProvider(key).future);
    expect(api.directoryFetches, 2);
  });
}
