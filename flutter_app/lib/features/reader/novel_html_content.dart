import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';

import '../../data/api/api_client.dart';
import 'novel_content.dart';

/// 与 Web 一样渲染服务端解析后的 HTML，图片宽度受正文区域约束。
class NovelHtmlContent extends StatelessWidget {
  final String content;
  final String serverUrl;
  final TextStyle textStyle;

  const NovelHtmlContent({
    super.key,
    required this.content,
    required this.serverUrl,
    required this.textStyle,
  });

  @override
  Widget build(BuildContext context) {
    return HtmlWidget(
      prepareNovelHtml(content, serverUrl),
      textStyle: textStyle,
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
          return SvgPicture.string(element.outerHtml, fit: BoxFit.contain);
        }
        return null;
      },
      // EPUB 的内页链接由阅读器管理，不交给外部浏览器。
      onTapUrl: (_) => true,
    );
  }
}

class _NovelWidgetFactory extends WidgetFactory {
  @override
  Widget? buildImageWidget(BuildTree tree, ImageSource src) {
    return NovelResourceImage(
      source: src.url,
      label: src.image?.alt ?? src.image?.title,
    );
  }
}

Future<Uint8List> loadNovelImageBytes(String source) async {
  final uri = Uri.parse(source);
  if (uri.scheme == 'data') return uri.data!.contentAsBytes();
  if (uri.scheme != 'http' && uri.scheme != 'https') {
    throw const FormatException('Unsupported image URL');
  }
  final headers = await getCookieHeaders(source);
  final dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 30),
  ));
  try {
    final response = await dio.get<List<int>>(
      source,
      options: Options(responseType: ResponseType.bytes, headers: headers),
    );
    return Uint8List.fromList(response.data!);
  } finally {
    dio.close();
  }
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
