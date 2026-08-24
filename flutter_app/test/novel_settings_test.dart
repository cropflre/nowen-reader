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
}
