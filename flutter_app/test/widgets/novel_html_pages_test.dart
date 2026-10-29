import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/features/reader/novel_html_content.dart';
import 'package:nowen_reader/features/reader/novel_html_pages.dart';

List<Rect> _lineBounds(RenderNovelHtmlPages viewport) {
  final lines = <Rect>[];
  void visit(RenderObject node) {
    if (node is RenderParagraph) {
      final transform = node.getTransformTo(viewport.child!);
      for (final box in node.getBoxesForSelection(
        TextSelection(
            baseOffset: 0, extentOffset: node.text.toPlainText().length),
        boxHeightStyle: ui.BoxHeightStyle.tight,
        boxWidthStyle: ui.BoxWidthStyle.max,
      )) {
        lines.add(MatrixUtils.transformRect(transform, box.toRect()));
      }
    }
    node.visitChildren(visit);
  }

  visit(viewport.child!);
  return lines;
}

void _expectCompleteLines(RenderNovelHtmlPages viewport) {
  final pages = viewport.metrics!.pages;
  expect(pages.first.start, lessThanOrEqualTo(0));
  expect(pages.last.end, greaterThanOrEqualTo(viewport.child!.size.height));
  for (var i = 0; i < pages.length; i++) {
    expect(pages[i].height, greaterThan(0));
    expect(pages[i].height, lessThanOrEqualTo(viewport.size.height + 0.001));
    if (i > 0) expect(pages[i].start, pages[i - 1].end);
  }
  // Every rendered line belongs to exactly one page: no clipped, repeated or
  // omitted glyphs, including styled runs with different font heights.
  for (final line in _lineBounds(viewport)) {
    expect(
      pages.where((page) =>
          line.top >= page.start - 0.001 && line.bottom <= page.end + 0.001),
      hasLength(1),
      reason: 'Line $line must be wholly inside one page',
    );
  }
}

void main() {
  test('page boundaries retreat to a complete line or illustration', () {
    final pages = paginateNovelLayout(260, 100, const [
      NovelPageSlice(0, 30),
      NovelPageSlice(35, 65),
      NovelPageSlice(70, 110),
      NovelPageSlice(120, 200),
      NovelPageSlice(220, 260),
    ]);
    expect(pages, const [
      NovelPageSlice(0, 70),
      NovelPageSlice(70, 120),
      NovelPageSlice(120, 220),
      NovelPageSlice(220, 260),
    ]);
  });

  test('overlapping styled runs stay together and oversized blocks progress',
      () {
    expect(
        paginateNovelLayout(180, 100, const [
          NovelPageSlice(80, 105),
          NovelPageSlice(90, 120),
        ]),
        const [NovelPageSlice(0, 80), NovelPageSlice(80, 180)]);
    expect(
        paginateNovelLayout(250, 100, const [NovelPageSlice(0, 250)]), const [
      NovelPageSlice(0, 100),
      NovelPageSlice(100, 200),
      NovelPageSlice(200, 250)
    ]);
  });

  for (final scale in [1.0, 1.6]) {
    for (final width in [210.0, 480.0]) {
      testWidgets('rich long paragraphs have complete lines at $width / $scale',
          (tester) async {
        await tester.pumpWidget(MaterialApp(
          home: Center(
            child: SizedBox(
              width: width,
              height: 173,
              child: MediaQuery(
                data: MediaQueryData(textScaler: TextScaler.linear(scale)),
                child: NovelHtmlPages(
                  page: 0,
                  onMetrics: (_) {},
                  child: NovelHtmlContent(
                    content: List.generate(
                            8,
                            (i) => '<p>第$i段：${'长段落需要按完整文字行跨页显示。' * 12}'
                                '<strong style="font-size: 26px">强调文字</strong>结尾。</p>')
                        .join(),
                    serverUrl: 'https://reader.example',
                    textStyle: const TextStyle(fontSize: 19, height: 1.85),
                  ),
                ),
              ),
            ),
          ),
        ));
        await tester.pumpAndSettle();
        final viewport = tester
            .renderObject<RenderNovelHtmlPages>(find.byType(NovelHtmlPages));
        expect(viewport.metrics!.pages.length, greaterThan(8));
        _expectCompleteLines(viewport);
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('image layout changes rebuild pages and keep illustrations whole',
      (tester) async {
    var imageHeight = 60.0;
    late StateSetter update;
    final reports = <NovelHtmlPageMetrics>[];
    await tester.pumpWidget(MaterialApp(
      home: Center(
          child: SizedBox(
        width: 240,
        height: 150,
        child: StatefulBuilder(builder: (context, setState) {
          update = setState;
          return NovelHtmlPages(
            page: 0,
            onMetrics: reports.add,
            child: Column(children: [
              const Text('插图前文'),
              NovelPageAtomic(child: SizedBox(height: imageHeight, width: 100)),
              Text('后文内容。' * 80),
            ]),
          );
        }),
      )),
    ));
    await tester.pumpAndSettle();
    final before = reports.last;
    update(() => imageHeight = 140);
    await tester.pumpAndSettle();
    expect(reports.last, isNot(before));
    final viewport =
        tester.renderObject<RenderNovelHtmlPages>(find.byType(NovelHtmlPages));
    _expectCompleteLines(viewport);
    final image = tester.renderObject<RenderBox>(find.byType(NovelPageAtomic));
    final rect = MatrixUtils.transformRect(
        image.getTransformTo(viewport.child!), Offset.zero & image.size);
    expect(
        reports.last.pages
            .where((page) => rect.top >= page.start && rect.bottom <= page.end),
        hasLength(1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('last page controls receive taps in their painted position',
      (tester) async {
    var page = 0;
    var tapped = false;
    late StateSetter update;
    await tester.pumpWidget(MaterialApp(
      home: Center(
          child: SizedBox(
        width: 240,
        height: 150,
        child: StatefulBuilder(builder: (context, setState) {
          update = setState;
          return NovelHtmlPages(
            page: page,
            onMetrics: (_) {},
            child: Column(children: [
              Text('正文内容。' * 120),
              NovelPageAtomic(
                  child: TextButton(
                      onPressed: () => tapped = true,
                      child: const Text('下一章'))),
            ]),
          );
        }),
      )),
    ));
    await tester.pumpAndSettle();
    final viewport =
        tester.renderObject<RenderNovelHtmlPages>(find.byType(NovelHtmlPages));
    update(() => page = viewport.metrics!.pages.length - 1);
    await tester.pumpAndSettle();
    await tester.tap(find.text('下一章'));
    await tester.pumpAndSettle();
    expect(tapped, isTrue);
    _expectCompleteLines(viewport);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tall EPUB images fit a page and follow cached HTML on resize',
      (tester) async {
    var height = 170.0;
    late StateSetter update;
    await tester.pumpWidget(MaterialApp(
      home: Center(child: StatefulBuilder(builder: (context, setState) {
        update = setState;
        return SizedBox(
          width: 240,
          height: height,
          child: NovelHtmlPages(
            page: 0,
            onMetrics: (_) {},
            child: NovelHtmlContent(
              content:
                  '<p>插图前文</p><img width="100" height="2000" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII="><p>插图后文</p>',
              serverUrl: 'https://reader.example',
              textStyle: const TextStyle(fontSize: 18, height: 1.8),
              maxImageHeight: height,
            ),
          ),
        );
      })),
    ));
    await tester.pumpAndSettle();
    for (final pageHeight in [170.0, 110.0]) {
      update(() => height = pageHeight);
      await tester.pumpAndSettle();
      final viewport = tester
          .renderObject<RenderNovelHtmlPages>(find.byType(NovelHtmlPages));
      final image =
          tester.renderObject<RenderBox>(find.byType(NovelPageAtomic));
      expect(image.size.height, closeTo(pageHeight, 0.001));
      final bounds = MatrixUtils.transformRect(
          image.getTransformTo(viewport.child!), Offset.zero & image.size);
      expect(
          viewport.metrics!.pages.where((page) =>
              bounds.top >= page.start - 0.001 &&
              bounds.bottom <= page.end + 0.001),
          hasLength(1));
      _expectCompleteLines(viewport);
      expect(tester.takeException(), isNull);
    }
  });
}
