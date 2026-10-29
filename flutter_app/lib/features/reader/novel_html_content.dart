import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';

import '../../data/api/api_client.dart';
import 'novel_content.dart';
import 'novel_html_pages.dart';

/// 与 Web 一样渲染服务端解析后的 HTML，图片宽度受正文区域约束。
class NovelHtmlContent extends StatefulWidget {
  final String content;
  final String serverUrl;
  final TextStyle textStyle;
  final double? maxImageHeight;

  const NovelHtmlContent({
    super.key,
    required this.content,
    required this.serverUrl,
    required this.textStyle,
    this.maxImageHeight,
  });

  @override
  State<NovelHtmlContent> createState() => _NovelHtmlContentState();
}

class _NovelHtmlContentState extends State<NovelHtmlContent> {
  late String _prepared;

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  @override
  void didUpdateWidget(NovelHtmlContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.content != oldWidget.content ||
        widget.serverUrl != oldWidget.serverUrl) {
      _prepare();
    }
  }

  void _prepare() =>
      _prepared = prepareNovelHtml(widget.content, widget.serverUrl);

  @override
  Widget build(BuildContext context) {
    return _NovelImageConstraints(
      maxHeight: widget.maxImageHeight,
      child: HtmlWidget(
        _prepared,
        // Publish pagination only for the chapter itself, never for an async
        // loading placeholder that would incorrectly restore a saved page to 0.
        buildAsync: false,
        enableCaching: true,
        textStyle: widget.textStyle,
        factoryBuilder: () => _NovelWidgetFactory(),
        customStylesBuilder: (element) {
          switch (element.localName) {
            case 'img':
            case 'svg':
              return {
                'display': 'block',
                'margin': '1em auto',
                'max-width': '100%',
                'height': 'auto'
              };
            case 'p':
              return {'margin-bottom': '1em'};
            case 'figure':
              return {'margin': '1em 0', 'text-align': 'center'};
            case 'figcaption':
              return {'font-size': '0.85em', 'text-align': 'center'};
            case 'a':
              return {'color': 'inherit', 'text-decoration': 'underline'};
          }
          return null;
        },
        customWidgetBuilder: (element) {
          if (element.localName == 'svg') {
            return _NovelPageImage(
                child:
                    SvgPicture.string(element.outerHtml, fit: BoxFit.contain));
          }
          return null;
        },
        // EPUB 的内页链接由阅读器管理，不交给外部浏览器。
        onTapUrl: (_) => true,
      ),
    );
  }
}

// The HTML renderer caches its image widgets and factory. Inherited constraints
// let those same images resize when rotating without reparsing the chapter.
class _NovelImageConstraints extends InheritedWidget {
  const _NovelImageConstraints({required this.maxHeight, required super.child});

  final double? maxHeight;

  @override
  bool updateShouldNotify(_NovelImageConstraints oldWidget) =>
      maxHeight != oldWidget.maxHeight;
}

class _NovelPageImage extends StatelessWidget {
  const _NovelPageImage({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final maxHeight = context
        .dependOnInheritedWidgetOfExactType<_NovelImageConstraints>()
        ?.maxHeight;
    return NovelPageAtomic(
        child: ConstrainedBox(
            constraints:
                BoxConstraints(maxHeight: maxHeight ?? double.infinity),
            child: child));
  }
}

class _NovelWidgetFactory extends WidgetFactory {
  @override
  Widget? buildText(
      BuildTree tree, InheritedProperties resolved, InlineSpan text) {
    final built = super.buildText(tree, resolved, text);
    return built != null &&
            const {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
                .contains(tree.element.localName)
        ? NovelPageAtomic(child: built)
        : built;
  }

  @override
  Widget? buildImage(BuildTree tree, ImageMetadata data) {
    final image = super.buildImage(tree, data);
    return image == null ? null : _NovelPageImage(child: image);
  }

  @override
  Widget? buildImageWidget(BuildTree tree, ImageSource src) =>
      NovelResourceImage(
        source: src.url,
        label: src.image?.alt ?? src.image?.title,
      );
}

Future<Uint8List> loadNovelImageBytes(String source) async {
  final uri = Uri.parse(source);
  if (uri.scheme == 'data') return uri.data!.contentAsBytes();
  if (uri.scheme != 'http' && uri.scheme != 'https') {
    throw const FormatException('Unsupported image URL');
  }
  return readerImageLoader.load(source);
}

/// 图片请求按各自 URL 读取 Cookie，兼容受保护资源和 SVG 图片文件。
class NovelResourceImage extends StatefulWidget {
  final String source;
  final String? label;

  const NovelResourceImage({super.key, required this.source, this.label});

  @override
  State<NovelResourceImage> createState() => _NovelResourceImageState();
}

class _NovelResourceImageState extends State<NovelResourceImage> {
  late Future<Uint8List> _bytes;

  @override
  void initState() {
    super.initState();
    _bytes = loadNovelImageBytes(widget.source);
  }

  @override
  void didUpdateWidget(NovelResourceImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.source != widget.source) {
      _bytes = loadNovelImageBytes(widget.source);
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = Padding(
      padding: const EdgeInsets.all(16),
      child: Text(widget.label?.isNotEmpty == true ? widget.label! : '图片加载失败'),
    );
    return FutureBuilder<Uint8List>(
      future: _bytes,
      builder: (context, snapshot) {
        if (snapshot.hasError) return error;
        final bytes = snapshot.data;
        if (bytes == null) {
          return const SizedBox(
            height: 64,
            child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
          );
        }
        final prefix =
            utf8.decode(bytes.take(512).toList(), allowMalformed: true);
        if (prefix.contains('<svg')) {
          return SvgPicture.memory(bytes,
              fit: BoxFit.contain, semanticsLabel: widget.label);
        }
        return Image.memory(
          bytes,
          fit: BoxFit.contain,
          semanticLabel: widget.label,
          errorBuilder: (_, __, ___) => error,
        );
      },
    );
  }
}
