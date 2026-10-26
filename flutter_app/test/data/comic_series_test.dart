import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/models/comic.dart';
import 'package:nowen_reader/data/providers/comic_provider.dart';

void main() {
  test('home shelf params default to series mode and preserve toggles', () {
    const params = ComicListParams();
    expect(params.seriesView, isTrue);
    expect(params.copyWith(seriesView: false).seriesView, isFalse);
    expect(params.copyWith(sort: 'title').seriesView, isTrue);
  });

  group('Comic series shelf item', () {
    test('recognizes server synthetic series row', () {
      final comic = Comic.fromJson({
        'id': 'series-love-magazine',
        'filename': '__series__.cbz',
        'title': '爱格',
        'pageCount': 12,
        'comicCount': 12,
        'lastReadPage': 3,
        'lastReadAt': '2026-10-01T12:00:00Z',
        'coverUrl': '/api/comics/series_love-magazine/thumbnail',
        'type': 'comic',
      });

      expect(comic.isSeriesShelfItem, isTrue);
      expect(comic.seriesId, 'love-magazine');
      expect(comic.seriesItemCount, 12);
      expect(comic.coverImageUrl,
          '/api/comics/series_love-magazine/thumbnail');
      expect(comic.progress, 25);
      expect(comic.isFinished, isFalse);
    });

    test('handles single-chapter work at seriesDepth >= 2 without false 100% completion', () {
      final inProgressSingle = Comic.fromJson({
        'id': 'series-solo-work',
        'filename': '__series__.cbz',
        'title': '单话短篇',
        'pageCount': 1,
        'comicCount': 1,
        'lastReadPage': 0,
        'lastReadAt': '2026-10-01T12:00:00Z',
        'type': 'comic',
      });
      expect(inProgressSingle.isSeriesShelfItem, isTrue);
      expect(inProgressSingle.seriesItemCount, 1);
      expect(inProgressSingle.isFinished, isFalse);
      expect(inProgressSingle.progress, 0);

      final completedSingle = inProgressSingle.copyWith(lastReadPage: 1);
      expect(completedSingle.isFinished, isTrue);
      expect(completedSingle.progress, 100);
    });

    test('parses AccessibleLibrary with backward-compatible seriesDepth default', () {
      final legacyLib = AccessibleLibrary.fromJson({
        'id': 'lib-legacy',
        'name': '旧版服务端漫画库',
        'type': 'comic',
        'comicCount': 42,
      });
      expect(legacyLib.seriesDepth, 1);
      expect(legacyLib.logicalCount, 42);
      expect(legacyLib.supportsDirectoryCategories, isFalse);

      final depth2Lib = AccessibleLibrary.fromJson({
        'id': 'lib-depth2',
        'name': '分类漫画库',
        'type': 'comic',
        'seriesDepth': 2,
        'comicCount': 120,
        'shelfCount': 18,
      });
      expect(depth2Lib.seriesDepth, 2);
      expect(depth2Lib.logicalCount, 18);
      expect(depth2Lib.supportsDirectoryCategories, isTrue);
    });

    test('parses LibraryDirectoryListResponse and clears directoryPath when libraryId clears', () {
      const scopedParams = ComicListParams(
        libraryId: 'lib-depth2',
        directoryPath: '韩漫/连载',
      );
      expect(scopedParams.copyWith(clearDirectoryPath: true).libraryId, 'lib-depth2');
      expect(scopedParams.copyWith(clearDirectoryPath: true).directoryPath, isNull);
      expect(scopedParams.copyWith(clearLibraryId: true).libraryId, isNull);
      expect(scopedParams.copyWith(clearLibraryId: true).directoryPath, isNull);

      final dirResponse = LibraryDirectoryListResponse.fromJson({
        'libraryId': 'lib-depth2',
        'seriesDepth': 3,
        'maxDirectoryDepth': 2,
        'parent': '韩漫',
        'breadcrumbs': [
          {'name': '韩漫', 'path': '韩漫'},
        ],
        'directories': [
          {
            'name': '连载',
            'path': '韩漫/连载',
            'depth': 2,
            'workCount': 7,
            'hasChildren': false,
            'coverUrl': '/api/comics/c-cover/thumbnail',
          },
        ],
        'total': 1,
        'page': 1,
        'pageSize': 50,
        'totalPages': 1,
      });
      expect(dirResponse.maxDirectoryDepth, 2);
      expect(dirResponse.breadcrumbs.single.path, '韩漫');
      expect(dirResponse.directories.single.path, '韩漫/连载');
      expect(dirResponse.directories.single.workCount, 7);
    });

    test('does not treat a normal comic as a series row', () {
      final comic = Comic.fromJson({
        'id': 'comic-1',
        'filename': '爱格 2026-01.cbz',
        'title': '爱格 2026-01',
        'pageCount': 120,
        'comicCount': 0,
      });

      expect(comic.isSeriesShelfItem, isFalse);
      expect(comic.seriesId, isNull);
      expect(comic.seriesItemCount, 120);
    });
  });
}
