import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nowen_reader/widgets/reader_settings_panel.dart';

void main() {
  group('ReaderSettings', () {
    test('default values', () {
      const settings = ReaderSettings();
      expect(settings.mode, ComicReadingMode.single);
      expect(settings.direction, ReadingDirection.ltr);
      expect(settings.fitMode, FitMode.contain);
      expect(settings.showPageNumber, isTrue);
      expect(settings.imageUpscaling, isFalse);
      expect(settings.upscaleScale, 2);
      expect(settings.upscaleModel, 'realesrgan-anime');
    });

    test('copyWith updates new fields', () {
      const settings = ReaderSettings();
      final updated = settings.copyWith(
        imageUpscaling: true,
        upscaleScale: 4,
        upscaleModel: 'realesrgan-general',
      );
      expect(updated.imageUpscaling, isTrue);
      expect(updated.upscaleScale, 4);
      expect(updated.upscaleModel, 'realesrgan-general');
      // unchanged fields should keep defaults
      expect(updated.mode, ComicReadingMode.single);
      expect(updated.showPageNumber, isTrue);
    });

    test('load and save with SharedPreferences', () async {
      SharedPreferences.setMockInitialValues({
        'reader_imageUpscaling': true,
        'reader_upscaleScale': 4,
        'reader_upscaleModel': 'realesrgan-general',
        'reader_mode': 2, // doublePage
        'reader_direction': 1, // rtl
      });

      final settings = await ReaderSettings.load();
      expect(settings.imageUpscaling, isTrue);
      expect(settings.upscaleScale, 4);
      expect(settings.upscaleModel, 'realesrgan-general');
      expect(settings.mode, ComicReadingMode.doublePage);
      expect(settings.direction, ReadingDirection.rtl);

      // Save then reload to verify persistence
      await settings.save();
      final reloaded = await ReaderSettings.load();
      expect(reloaded.imageUpscaling, isTrue);
      expect(reloaded.upscaleScale, 4);
      expect(reloaded.upscaleModel, 'realesrgan-general');
      expect(reloaded.mode, ComicReadingMode.doublePage);
    });

    test('load returns defaults when SharedPreferences is empty', () async {
      SharedPreferences.setMockInitialValues({});

      final settings = await ReaderSettings.load();
      expect(settings.imageUpscaling, isFalse);
      expect(settings.upscaleScale, 2);
      expect(settings.upscaleModel, 'realesrgan-anime');
    });
  });

  group('ReaderSettingsPanel', () {
    /// Helper to scroll the settings ListView down so the AI section is visible
    Future<void> scrollToAiSection(WidgetTester tester) async {
      // The AI section is below the rendering mode section.
      // Scroll the ListView down by 400 pixels to reveal it.
      await tester.drag(find.byType(ListView), const Offset(0, -400));
      await tester.pumpAndSettle();
    }

    testWidgets('renders AI upscaling section with toggle',
        (WidgetTester tester) async {
      SharedPreferences.setMockInitialValues({});

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => ReaderSettingsPanel.show(
                context,
                settings: const ReaderSettings(),
                onChanged: (_) {},
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      // Open the bottom sheet panel
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // Scroll to reveal the AI section
      await scrollToAiSection(tester);

      // Verify the AI upscaling section title and toggle label exist
      expect(find.text('AI 超分'), findsOneWidget);
      expect(find.text('图片超分辨率'), findsOneWidget);

      // When upscaling is off, the scale options should NOT be visible
      expect(find.text('放大倍数'), findsNothing);
      expect(find.text('2x'), findsNothing);
      expect(find.text('4x'), findsNothing);
    });

    testWidgets('shows scale options when upscaling is enabled',
        (WidgetTester tester) async {
      SharedPreferences.setMockInitialValues({});

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => ReaderSettingsPanel.show(
                context,
                settings: ReaderSettings(
                  imageUpscaling: true,
                  upscaleScale: 2,
                ),
                onChanged: (_) {},
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // Scroll to reveal the AI section
      await scrollToAiSection(tester);

      // Scale options should be visible
      expect(find.text('AI 超分'), findsOneWidget);
      expect(find.text('放大倍数'), findsOneWidget);
      expect(find.text('2x'), findsOneWidget);
      expect(find.text('4x'), findsOneWidget);
    });

    testWidgets('toggling upscaling switch shows/hides scale options',
        (WidgetTester tester) async {
      SharedPreferences.setMockInitialValues({});
      ReaderSettings? emitted;

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => ReaderSettingsPanel.show(
                context,
                settings: const ReaderSettings(),
                onChanged: (s) => emitted = s,
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      // Scroll to reveal the AI section
      await scrollToAiSection(tester);

      // Initially off — no scale options
      expect(find.text('放大倍数'), findsNothing);

      // Find the upscaling Switch widget (value: false).
      // There are multiple switches: showPageNumber=true, imageUpscaling=false.
      // Find the one that's off.
      final offSwitch = find.byWidgetPredicate(
        (w) => w is Switch && !w.value,
      );
      expect(offSwitch, findsOneWidget);

      // Tap it to enable upscaling
      await tester.tap(offSwitch);
      await tester.pumpAndSettle();

      // Now scale options should appear
      expect(find.text('放大倍数'), findsOneWidget);
      expect(find.text('2x'), findsOneWidget);
      expect(find.text('4x'), findsOneWidget);

      // Verify the callback was called
      expect(emitted, isNotNull);
      expect(emitted!.imageUpscaling, isTrue);
    });
  });
}
