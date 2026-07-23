import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/models/comic.dart';

void main() {
  group('Comic API contract', () {
    test('parses current backend fields', () {
      final comic = Comic.fromJson({
        'id': 'comic-1',
        'filename': 'book.cbz',
        'title': 'Book',
        'titleSortKey': 'book',
        'pageCount': 100,
        'fileSize': 2048,
        'addedAt': '2026-07-23T00:00:00Z',
        'updatedAt': '2026-07-23T01:00:00Z',
        'sortOrder': 3,
        'lastReadPage': 49,
        'lastReadAt': '2026-07-23T02:00:00Z',
        'readingStatus': 'reading',
        'coverAspectRatio': 0.72,
        'type': 'comic',
        'libraryId': 'library-1',
        'externalRating': 8.4,
        'externalRatingMax': 10,
        'externalRatingSource': 'anilist',
        'externalRatingUpdatedAt': '2026-07-23T03:00:00Z',
        'canManage': true,
        'comicCount': 2,
        'tags': [
          {'name': 'Action', 'color': '#ff0000'}
        ],
        'categories': [
          {
            'id': 1,
            'name': 'Manga',
            'slug': 'manga',
            'icon': 'book',
            'sortOrder': 4,
            'comicCount': 8,
          }
        ],
      });

      expect(comic.titleSortKey, 'book');
      expect(comic.addedAt, isNotEmpty);
      expect(comic.sortOrder, 3);
      expect(comic.coverAspectRatio, 0.72);
      expect(comic.libraryId, 'library-1');
      expect(comic.externalRating, 8.4);
      expect(comic.externalRatingMax, 10);
      expect(comic.canManage, isTrue);
      expect(comic.comicCount, 2);
      expect(comic.progress, 50);
      expect(comic.categories.single.icon, 'book');
      expect(comic.categories.single.sortOrder, 4);
    });

    test('does not show progress for an unread item', () {
      final comic = Comic.fromJson({
        'id': 'comic-2',
        'filename': 'book.cbz',
        'title': 'Unread',
        'pageCount': 100,
        'lastReadPage': 0,
        'lastReadAt': null,
        'readingStatus': '',
      });

      expect(comic.readingStatus, '');
      expect(comic.hasReadingProgress, isFalse);
      expect(comic.progress, 0);
    });

    test('uses status and legacy page index as reading evidence', () {
      final firstPage = Comic.fromJson({
        'id': 'comic-3',
        'filename': 'first.cbz',
        'title': 'First page',
        'pageCount': 1000,
        'lastReadPage': 0,
        'readingStatus': 'reading',
      });
      final legacy = Comic.fromJson({
        'id': 'comic-4',
        'filename': 'legacy.cbz',
        'title': 'Legacy',
        'pageCount': 100,
        'lastReadPage': 9,
        'readingStatus': '',
      });
      final finished = Comic.fromJson({
        'id': 'comic-5',
        'filename': 'finished.cbz',
        'title': 'Finished',
        'pageCount': 100,
        'lastReadPage': 0,
        'readingStatus': 'finished',
      });

      expect(firstPage.progress, 1);
      expect(legacy.progress, 10);
      expect(finished.isFinished, isTrue);
    });
  });

  test('parses user AI permission and group content type', () {
    final user = AuthUser.fromJson({
      'id': 'user-1',
      'username': 'reader',
      'role': 'user',
      'aiEnabled': true,
    });
    final group = ComicGroup.fromJson({
      'id': 7,
      'name': 'Collection',
      'contentType': 'novel',
    });

    expect(user.canUseAI, isTrue);
    expect(group.contentType, 'novel');
  });
}
