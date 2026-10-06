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
      expect(comic.progress, 33);
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
