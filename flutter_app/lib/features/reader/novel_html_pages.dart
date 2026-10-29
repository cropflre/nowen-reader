import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// A range in the chapter's actual layout, rather than a fixed-height crop.
@immutable
class NovelPageSlice {
  const NovelPageSlice(this.start, this.end);

  final double start;
  final double end;
  double get height => end - start;

  @override
  bool operator ==(Object other) =>
      other is NovelPageSlice && start == other.start && end == other.end;

  @override
  int get hashCode => Object.hash(start, end);
}

@immutable
class NovelHtmlPageMetrics {
  const NovelHtmlPageMetrics(this.viewport, this.pages);

  final Size viewport;
  final List<NovelPageSlice> pages;

  @override
  bool operator ==(Object other) =>
      other is NovelHtmlPageMetrics &&
      viewport == other.viewport &&
      listEquals(pages, other.pages);

  @override
  int get hashCode => Object.hash(viewport, Object.hashAll(pages));
}

/// Lay out the chapter once and paint only the current page's complete lines.
/// Layout changes, including asynchronously loaded images, rebuild the ranges.
class NovelHtmlPages extends SingleChildRenderObjectWidget {
  const NovelHtmlPages({
    super.key,
    required this.page,
    required this.onMetrics,
    required super.child,
  });

  final int page;
  final ValueChanged<NovelHtmlPageMetrics> onMetrics;

  @override
  RenderNovelHtmlPages createRenderObject(BuildContext context) =>
      RenderNovelHtmlPages(page: page, onMetrics: onMetrics);

  @override
  void updateRenderObject(
      BuildContext context, RenderNovelHtmlPages renderObject) {
    renderObject
      ..page = page
      ..onMetrics = onMetrics;
  }
}

/// Keep a title, illustration or chapter navigation row on one page.
class NovelPageAtomic extends SingleChildRenderObjectWidget {
  const NovelPageAtomic({super.key, required super.child});

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderNovelPageAtomic();
}

class _RenderNovelPageAtomic extends RenderProxyBox {
  Size measuredSize = Size.zero;

  @override
  void performLayout() {
    super.performLayout();
    measuredSize = size;
  }
}

class RenderNovelHtmlPages extends RenderProxyBox {
  RenderNovelHtmlPages({
    required int page,
    required ValueChanged<NovelHtmlPageMetrics> onMetrics,
  })  : _page = page,
        _onMetrics = onMetrics;

  int _page;
  ValueChanged<NovelHtmlPageMetrics> _onMetrics;
  NovelHtmlPageMetrics? _metrics;

  NovelHtmlPageMetrics? get metrics => _metrics;
  NovelPageSlice get visibleSlice {
    final pages = _metrics?.pages;
    if (pages == null || pages.isEmpty) return const NovelPageSlice(0, 0);
    return pages[_page.clamp(0, pages.length - 1)];
  }

  set page(int value) {
    if (_page == value) return;
    _page = value;
    markNeedsPaint();
    markNeedsSemanticsUpdate();
  }

  set onMetrics(ValueChanged<NovelHtmlPageMetrics> value) => _onMetrics = value;

  @override
  void performLayout() {
    size = constraints.biggest;
    final chapter = child;
    if (chapter == null || size.isEmpty) return;
    chapter.layout(BoxConstraints.tightFor(width: size.width),
        parentUsesSize: true);

    final spans = <NovelPageSlice>[];
    void collect(RenderObject node) {
      if (node is _RenderNovelPageAtomic &&
          node.measuredSize.height <= size.height) {
        final rect = MatrixUtils.transformRect(
            node.getTransformTo(chapter), Offset.zero & node.measuredSize);
        spans.add(NovelPageSlice(rect.top, rect.bottom));
        return;
      }
      if (node is RenderParagraph) {
        final boxes = node.getBoxesForSelection(
          TextSelection(
              baseOffset: 0, extentOffset: node.text.toPlainText().length),
          boxHeightStyle: ui.BoxHeightStyle.tight,
          boxWidthStyle: ui.BoxWidthStyle.max,
        );
        final transform = node.getTransformTo(chapter);
        for (final box in boxes) {
          final rect = MatrixUtils.transformRect(transform, box.toRect());
          if (rect.height > 0) {
            spans.add(NovelPageSlice(rect.top, rect.bottom));
          }
        }
      }
      node.visitChildren(collect);
    }

    collect(chapter);
    final next = NovelHtmlPageMetrics(
      size,
      paginateNovelLayout(chapter.size.height, size.height, spans),
    );
    if (_metrics == next) return;
    _metrics = next;
    // Publishing after layout avoids setState during a frame. A newer layout
    // or a disposed chapter invalidates an already queued notification.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (attached && identical(_metrics, next)) _onMetrics(next);
    });
    markNeedsSemanticsUpdate();
  }

  Rect get _pageClip => Rect.fromLTWH(
      0, 0, size.width, math.min(size.height, visibleSlice.height));

  @override
  void paint(PaintingContext context, Offset offset) {
    if (child == null) return;
    context.pushClipRect(needsCompositing, offset, _pageClip,
        (context, offset) {
      context.paintChild(child!, offset - Offset(0, visibleSlice.start));
    });
  }

  @override
  bool hitTestSelf(Offset position) => true;

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) {
    if (child == null || !_pageClip.contains(position)) return false;
    return result.addWithPaintOffset(
      offset: Offset(0, -visibleSlice.start),
      position: position,
      hitTest: (result, transformed) =>
          child!.hitTest(result, position: transformed),
    );
  }

  @override
  void applyPaintTransform(RenderBox child, Matrix4 transform) {
    transform.multiply(Matrix4.translationValues(0, -visibleSlice.start, 0));
  }

  @override
  Rect? describeApproximatePaintClip(RenderObject child) => _pageClip;

  @override
  Rect? describeSemanticsClip(RenderObject? child) => _pageClip;
}

/// Overlapping spans (styled runs, inline images, or columns) must stay
/// together. Adjacent lines remain separate so long paragraphs can span pages.
List<NovelPageSlice> paginateNovelLayout(
    double contentHeight, double pageHeight, List<NovelPageSlice> spans) {
  if (contentHeight <= 0 || pageHeight <= 0) {
    return const [NovelPageSlice(0, 0)];
  }
  final sorted = [...spans]..sort((a, b) => a.start.compareTo(b.start));
  final merged = <NovelPageSlice>[];
  for (final span in sorted) {
    if (merged.isNotEmpty && span.start < merged.last.end - 0.001) {
      final previous = merged.removeLast();
      merged.add(
          NovelPageSlice(previous.start, math.max(previous.end, span.end)));
    } else {
      merged.add(span);
    }
  }

  final pages = <NovelPageSlice>[];
  // Font metrics can extend a fraction of a pixel beyond a paragraph's box.
  // Include those glyph bounds at the chapter's first and last page as well.
  double start = merged.isEmpty ? 0 : math.min(0.0, merged.first.start);
  final extent =
      merged.isEmpty ? contentHeight : math.max(contentHeight, merged.last.end);
  var spanIndex = 0;
  while (start < extent) {
    var end = math.min(start + pageHeight, extent);
    while (spanIndex < merged.length && merged[spanIndex].end <= end) {
      spanIndex++;
    }
    if (spanIndex < merged.length) {
      final span = merged[spanIndex];
      if (span.start < end && span.start > start) end = span.start;
      // An element taller than the viewport must still make forward progress.
      // Illustrations are constrained to the viewport by NovelHtmlContent.
    }
    pages.add(NovelPageSlice(start, end));
    start = end;
  }
  return List.unmodifiable(pages);
}
