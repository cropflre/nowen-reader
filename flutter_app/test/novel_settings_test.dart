import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nowen_reader/features/reader/novel_settings.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('tap zone defaults preserve existing swipe behavior', () async {
    final settings = await NovelSettings.load();

    expect(settings.leftTapAction, NovelTapAction.previousPage);
    expect(settings.centerTapAction, NovelTapAction.menu);
    expect(settings.rightTapAction, NovelTapAction.nextPage);
    expect(settings.tapZonesInScrollMode, isFalse);
  });

  test('tap zone preferences persist and load', () async {
    final settings = const NovelSettings().copyWith(
      leftTapAction: NovelTapAction.nextPage,
      centerTapAction: NovelTapAction.none,
      rightTapAction: NovelTapAction.previousPage,
      tapZonesInScrollMode: true,
    );

    await settings.save();
    final loaded = await NovelSettings.load();

    expect(loaded.leftTapAction, NovelTapAction.nextPage);
    expect(loaded.centerTapAction, NovelTapAction.none);
    expect(loaded.rightTapAction, NovelTapAction.previousPage);
    expect(loaded.tapZonesInScrollMode, isTrue);
  });

  test('invalid persisted tap action falls back safely', () async {
    SharedPreferences.setMockInitialValues({
      'novel_leftTapAction': 999,
      'novel_centerTapAction': -5,
      'novel_rightTapAction': 999,
    });

    final settings = await NovelSettings.load();

    expect(settings.leftTapAction, NovelTapAction.previousPage);
    expect(settings.centerTapAction, NovelTapAction.menu);
    expect(settings.rightTapAction, NovelTapAction.nextPage);
  });

  test('tap position resolves into equal left center right zones', () {
    expect(resolveNovelTapZone(0), NovelTapZone.left);
    expect(resolveNovelTapZone(0.32), NovelTapZone.left);
    expect(resolveNovelTapZone(1 / 3), NovelTapZone.center);
    expect(resolveNovelTapZone(0.66), NovelTapZone.center);
    expect(resolveNovelTapZone(2 / 3), NovelTapZone.right);
    expect(resolveNovelTapZone(1), NovelTapZone.right);
    expect(resolveNovelTapZone(-1), NovelTapZone.left);
    expect(resolveNovelTapZone(2), NovelTapZone.right);
  });

  test('legacy bookmarks migrate without losing chapter data', () async {
    SharedPreferences.setMockInitialValues({
      'novel_bookmarks_legacy-book': jsonEncode([
        {
          'chapterIndex': 14,
          'chapterTitle': '第十五章',
          'timestamp': 1700000000000,
        },
      ]),
    });

    final bookmarks = await BookmarkManager.load('legacy-book');

    expect(bookmarks, hasLength(1));
    expect(bookmarks.single.id, 'legacy-14-1700000000000');
    expect(bookmarks.single.chapterTitle, '第十五章');
    expect(bookmarks.single.name, isEmpty);
    expect(bookmarks.single.note, isEmpty);
    expect(bookmarks.single.positionRatio, 0);

    final prefs = await SharedPreferences.getInstance();
    final migrated =
        jsonDecode(prefs.getString('novel_bookmarks_legacy-book')!) as List;
    expect(migrated.single['id'], 'legacy-14-1700000000000');
    expect(migrated.single['positionRatio'], 0);
    expect(migrated.single['updatedAt'], 1700000000000);
  });

  test('bookmark manager preserves multiple positions in one chapter', () async {
    final bookmarks = [
      const NovelBookmark(
        id: 'bookmark-a',
        chapterIndex: 2,
        chapterTitle: '第三章',
        name: '人物登场',
        note: '记录角色关系',
        positionRatio: 0.2,
        timestamp: 1700000000000,
        updatedAt: 1700000000000,
      ),
      const NovelBookmark(
        id: 'bookmark-b',
        chapterIndex: 2,
        chapterTitle: '第三章',
        name: '战斗场面',
        positionRatio: 0.8,
        timestamp: 1700000001000,
        updatedAt: 1700000001000,
      ),
    ];

    await BookmarkManager.save('same-chapter', bookmarks);
    final loaded = await BookmarkManager.load('same-chapter');

    expect(loaded, hasLength(2));
    expect(loaded.map((bookmark) => bookmark.id), ['bookmark-a', 'bookmark-b']);
    expect(
        loaded.map((bookmark) => bookmark.positionRatio), [0.2, 0.8]);
    expect(loaded.first.displayTitle, '人物登场');
  });
}
