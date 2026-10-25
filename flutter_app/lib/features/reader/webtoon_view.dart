import 'package:flutter/foundation.dart' show precisionErrorTolerance;
import 'package:flutter/material.dart';

import '../../data/api/api_client.dart';
import '../../widgets/authenticated_image.dart';

/// A page index plus an offset within that page survives changes in image size.
class WebtoonController extends ScrollController {
  WebtoonController() : super(keepScrollOffset: false);

  _PageGeometry? _geometry;
  double? _pendingOffset;
  double _savedOffset = 0;
  int? _requestedPage;

  int get page => _geometry?.pageAt(_offset) ?? 0;
  double get _offset =>
      _pendingOffset ?? (hasClients ? position.pixels : _savedOffset);

  void jumpToPage(int page) {
    _requestedPage = page;
    final geometry = _geometry;
    if (geometry == null || !hasClients) return;
    final offset = geometry.startOf(page);
    _requestedPage = null;
    _pendingOffset = null;
    jumpTo(offset.clamp(position.minScrollExtent, position.maxScrollExtent));
  }

  void _updateGeometry(_PageGeometry geometry) {
    final previous = _geometry;
    if (_requestedPage != null) {
      _pendingOffset = geometry.startOf(_requestedPage!);
      _requestedPage = null;
    } else if (previous != null && !previous.sameAs(geometry)) {
      final offset = _offset;
      final page = previous.pageAt(offset);
      final fraction =
          ((offset - previous.startOf(page)) / previous.extentOf(page))
              .clamp(0.0, 1.0);
      _pendingOffset =
          geometry.startOf(page) + fraction * geometry.extentOf(page);
    }
    _geometry = geometry;
  }

  @override
  ScrollPosition createScrollPosition(ScrollPhysics physics,
          ScrollContext context, ScrollPosition? oldPosition) =>
      _WebtoonPosition(
        controller: this,
        physics: physics,
        context: context,
        initialPixels: _pendingOffset ?? _savedOffset,
        oldPosition: oldPosition,
      );

  @override
  void detach(ScrollPosition position) {
    _savedOffset = position.pixels;
    super.detach(position);
  }
}

class _WebtoonPosition extends ScrollPositionWithSingleContext {
  _WebtoonPosition({
    required this.controller,
    required super.physics,
    required super.context,
    required super.initialPixels,
    super.oldPosition,
  }) : super(keepScrollOffset: false);

  final WebtoonController controller;

  @override
  bool applyContentDimensions(double minScrollExtent, double maxScrollExtent) {
    final pending = controller._pendingOffset;
    if (pending != null) {
      controller._pendingOffset = null;
      final target = pending.clamp(minScrollExtent, maxScrollExtent);
      if ((target - pixels).abs() > precisionErrorTolerance) {
        // Correct during layout, before the viewport clamps an old pixel offset
        // against the new extent. A post-frame jump would already lose the page.
        correctPixels(target);
        return false;
      }
    }
    return super.applyContentDimensions(minScrollExtent, maxScrollExtent);
  }
}

class _PageGeometry {
  _PageGeometry(this.width, this.viewportHeight, List<double?> ratios)
      : ratios = List.unmodifiable(ratios) {
    for (final ratio in ratios) {
      starts
          .add(starts.last + (ratio == null ? viewportHeight : width / ratio));
    }
  }

  final double width;
  final double viewportHeight;
  final List<double?> ratios;
  final starts = <double>[0];

  int pageAt(double offset) {
    var low = 0;
    var high = ratios.length;
    while (low + 1 < high) {
      final mid = (low + high) ~/ 2;
      if (starts[mid] <= offset) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return low;
  }

  double startOf(int page) =>
      ratios.isEmpty ? 0 : starts[page.clamp(0, ratios.length - 1)];
  double extentOf(int page) {
    if (ratios.isEmpty) return viewportHeight;
    final index = page.clamp(0, ratios.length - 1);
    return starts[index + 1] - starts[index];
  }

  bool sameAs(_PageGeometry other) {
    if (width != other.width ||
        viewportHeight != other.viewportHeight ||
        ratios.length != other.ratios.length) {
      return false;
    }
    for (var i = 0; i < ratios.length; i++) {
      if (ratios[i] != other.ratios[i]) return false;
    }
    return true;
  }
}

/// Explicit row extents remain nonzero during download, decode and recycling.
/// Only intrinsic dimensions are retained; offscreen image widgets stay lazy.
class WebtoonView extends StatefulWidget {
  const WebtoonView({
    super.key,
    required this.controller,
    required this.comicId,
    required this.serverUrl,
    required this.pageCount,
    required this.onPageChanged,
    this.initialPage = 0,
  });

  final WebtoonController controller;
  final String comicId;
  final String serverUrl;
  final int pageCount;
  final int initialPage;
  final ValueChanged<int> onPageChanged;

  @override
  State<WebtoonView> createState() => _WebtoonViewState();
}

class _WebtoonViewState extends State<WebtoonView> {
  late List<double?> _ratios;
  int? _reportedPage;
  bool _reportScheduled = false;

  @override
  void initState() {
    super.initState();
    _ratios = List.generate(widget.pageCount,
        (i) => widget.controller._geometry?.ratios.elementAtOrNull(i));
    if (widget.controller._geometry == null) {
      widget.controller._requestedPage = widget.initialPage;
    }
  }

  @override
  void didUpdateWidget(WebtoonView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.comicId != widget.comicId) {
      _ratios = List.filled(widget.pageCount, null);
      widget.controller._geometry = null;
      widget.controller._requestedPage = widget.initialPage;
      _reportedPage = null;
    } else if (oldWidget.pageCount != widget.pageCount) {
      _ratios = List.generate(
          widget.pageCount, (i) => i < _ratios.length ? _ratios[i] : null);
    }
  }

  void _schedulePageReport() {
    if (_reportScheduled) return;
    _reportScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _reportScheduled = false;
      if (!mounted || !widget.controller.hasClients || widget.pageCount == 0) {
        return;
      }
      final page = widget.controller.page;
      if (_reportedPage != page) {
        _reportedPage = page;
        widget.onPageChanged(page);
      }
    });
  }

  void _imageSize(int index, Size size) {
    if (!mounted ||
        index >= _ratios.length ||
        size.width <= 0 ||
        size.height <= 0) {
      return;
    }
    final ratio = size.width / size.height;
    if (_ratios[index] == ratio) return;
    setState(() => _ratios[index] = ratio);
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final geometry = _PageGeometry(
              constraints.maxWidth, constraints.maxHeight, _ratios);
          widget.controller._updateGeometry(geometry);
          _schedulePageReport();
          return NotificationListener<ScrollNotification>(
            onNotification: (_) {
              _schedulePageReport();
              return false;
            },
            child: ListView.builder(
              padding: EdgeInsets.zero,
              controller: widget.controller,
              itemCount: widget.pageCount,
              itemExtentBuilder: (index, _) => geometry.extentOf(index),
              itemBuilder: (context, index) => AuthenticatedImage(
                key: ValueKey(index),
                imageUrl:
                    getImageUrl(widget.serverUrl, widget.comicId, page: index),
                comicId: widget.comicId,
                pageIndex: index,
                fit: BoxFit.fitWidth,
                onImageSize: (size) => _imageSize(index, size),
                placeholder: const Center(child: CircularProgressIndicator()),
                errorWidget: const Center(
                  child:
                      Icon(Icons.broken_image, color: Colors.white54, size: 48),
                ),
              ),
            ),
          );
        },
      );
}
