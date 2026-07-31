import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/widgets/reader_settings_panel.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ReaderSettings fit mode migration', () {
    test('new installations default to fit width', () async {
      SharedPreferences.setMockInitialValues({});

      final settings = await ReaderSettings.load();

      expect(settings.fitMode, FitMode.width);
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getInt('reader_settings_version'),
        ReaderSettings.settingsVersion,
      );
      expect(prefs.getInt('reader_fitMode'), FitMode.width.index);
    });

    test('old contain default migrates once to fit width', () async {
      SharedPreferences.setMockInitialValues({
        'reader_settings_version': 1,
        'reader_fitMode': FitMode.contain.index,
      });

      final settings = await ReaderSettings.load();

      expect(settings.fitMode, FitMode.width);
    });

    test('current explicit contain preference is preserved', () async {
      SharedPreferences.setMockInitialValues({
        'reader_settings_version': ReaderSettings.settingsVersion,
        'reader_fitMode': FitMode.contain.index,
      });

      final settings = await ReaderSettings.load();

      expect(settings.fitMode, FitMode.contain);
    });
  });
}
