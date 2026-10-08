import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

import '../data/api/api_client.dart';
import '../data/services/cache_service.dart';

/// All reader paths share the same bytes and pending download.
Future<Uint8List> loadAuthenticatedImageBytes(
  String url, {
  String? comicId,
  int? pageIndex,
  bool isThumbnail = false,
}) {
  return readerImageLoader.load(
    url,
    readLocal: !kIsWeb && comicId != null
        ? () async {
            await cacheService.init();
            if (isThumbnail) return cacheService.readCachedThumb(comicId);
            if (pageIndex != null) {
              return cacheService.readCachedPage(comicId, pageIndex);
            }
            return null;
          }
        : null,
  );
}

/// 带 Cookie 认证的网络图片组件
/// 支持离线缓存：优先读取本地缓存，网络不可用时自动降级
class AuthenticatedImage extends StatefulWidget {
  final String imageUrl;
  final BoxFit fit;
  final AlignmentGeometry alignment;
  final Widget? placeholder;
  final Widget? errorWidget;
  final double? width;
  final double? height;

  /// 离线缓存参数（可选）
  final String? comicId;
  final int? pageIndex;
  final bool isThumbnail;

  const AuthenticatedImage({
    super.key,
    required this.imageUrl,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.center,
    this.placeholder,
    this.errorWidget,
    this.width,
    this.height,
    this.comicId,
    this.pageIndex,
    this.isThumbnail = false,
  });

  @override
  State<AuthenticatedImage> createState() => _AuthenticatedImageState();
}

class _AuthenticatedImageState extends State<AuthenticatedImage> {
  Uint8List? _imageBytes;
  bool _loading = true;
  bool _error = false;

  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _loadImage();
  }

  @override
  void didUpdateWidget(AuthenticatedImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imageUrl != widget.imageUrl ||
        oldWidget.comicId != widget.comicId ||
        oldWidget.pageIndex != widget.pageIndex ||
        oldWidget.isThumbnail != widget.isThumbnail) {
      _loadImage();
    }
  }

  Future<void> _loadImage() async {
    final generation = ++_loadGeneration;
    setState(() {
      _loading = true;
      _error = false;
      _imageBytes = null;
    });
    try {
      final bytes = await loadAuthenticatedImageBytes(
        widget.imageUrl,
        comicId: widget.comicId,
        pageIndex: widget.pageIndex,
        isThumbnail: widget.isThumbnail,
      );
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _imageBytes = bytes;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _loading = false;
        _error = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return widget.placeholder ??
          SizedBox(
            width: widget.width,
            height: widget.height,
            child:
                const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          );
    }

    if (_error || _imageBytes == null) {
      return widget.errorWidget ??
          SizedBox(
            width: widget.width,
            height: widget.height,
            child: const Center(
              child: Icon(Icons.broken_image_outlined, size: 32),
            ),
          );
    }

    return Image.memory(
      _imageBytes!,
      fit: widget.fit,
      alignment: widget.alignment,
      width: widget.width,
      height: widget.height,
      errorBuilder: (_, __, ___) =>
          widget.errorWidget ??
          const Center(child: Icon(Icons.broken_image_outlined, size: 32)),
    );
  }
}

/// 带 Cookie 认证的 ImageProvider（用于 PhotoView 等需要 ImageProvider 的场景）
/// 支持离线缓存：优先读取本地缓存
class AuthenticatedImageProvider
    extends ImageProvider<AuthenticatedImageProvider> {
  final String url;
  final String? comicId;
  final int? pageIndex;

  const AuthenticatedImageProvider(this.url, {this.comicId, this.pageIndex});

  @override
  Future<AuthenticatedImageProvider> obtainKey(
      ImageConfiguration configuration) {
    return Future.value(this);
  }

  @override
  ImageStreamCompleter loadImage(
      AuthenticatedImageProvider key, ImageDecoderCallback decode) {
    return MultiFrameImageStreamCompleter(
      codec: _loadAsync(key, decode),
      scale: 1.0,
    );
  }

  Future<ui.Codec> _loadAsync(
      AuthenticatedImageProvider key, ImageDecoderCallback decode) async {
    final bytes = await loadAuthenticatedImageBytes(
      key.url,
      comicId: key.comicId,
      pageIndex: key.pageIndex,
    );
    final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
    return decode(buffer);
  }

  @override
  bool operator ==(Object other) {
    if (other is AuthenticatedImageProvider) {
      return url == other.url;
    }
    return false;
  }

  @override
  int get hashCode => url.hashCode;

  @override
  String toString() => 'AuthenticatedImageProvider("$url")';
}
