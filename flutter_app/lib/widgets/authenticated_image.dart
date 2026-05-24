import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

import '../data/api/api_client.dart';

/// 带 Cookie 认证的网络图片组件
/// 使用 Dio + CookieJar 下载图片，解决 CachedNetworkImage 无法携带 session cookie 的问题
class AuthenticatedImage extends StatefulWidget {
  final String imageUrl;
  final BoxFit fit;
  final AlignmentGeometry alignment;
  final Widget? placeholder;
  final Widget? errorWidget;
  final double? width;
  final double? height;

  const AuthenticatedImage({
    super.key,
    required this.imageUrl,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.center,
    this.placeholder,
    this.errorWidget,
    this.width,
    this.height,
  });

  @override
  State<AuthenticatedImage> createState() => _AuthenticatedImageState();
}

class _AuthenticatedImageState extends State<AuthenticatedImage> {
  Uint8List? _imageBytes;
  bool _loading = true;
  bool _error = false;

  // 简单的内存缓存，避免反复下载同一图片
  static final Map<String, Uint8List> _cache = {};
  static const int _maxCacheSize = 200;

  @override
  void initState() {
    super.initState();
    _loadImage();
  }

  @override
  void didUpdateWidget(AuthenticatedImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imageUrl != widget.imageUrl) {
      _loadImage();
    }
  }

  Future<void> _loadImage() async {
    if (!mounted) return;

    // 检查缓存
    final cached = _cache[widget.imageUrl];
    if (cached != null) {
      setState(() {
        _imageBytes = cached;
        _loading = false;
        _error = false;
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = false;
    });

    try {
      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 30),
        responseType: ResponseType.bytes,
      ));
      if (!kIsWeb) {
        dio.interceptors.add(CookieManager(persistCookieJar));
      }

      final response = await dio.get<List<int>>(widget.imageUrl);
      final bytes = Uint8List.fromList(response.data!);

      // 加入缓存（简单 LRU 策略：超过上限清空一半）
      if (_cache.length >= _maxCacheSize) {
        final keys = _cache.keys.toList();
        for (int i = 0; i < keys.length ~/ 2; i++) {
          _cache.remove(keys[i]);
        }
      }
      _cache[widget.imageUrl] = bytes;

      if (mounted) {
        setState(() {
          _imageBytes = bytes;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return widget.placeholder ??
          SizedBox(
            width: widget.width,
            height: widget.height,
            child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
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
class AuthenticatedImageProvider extends ImageProvider<AuthenticatedImageProvider> {
  final String url;

  const AuthenticatedImageProvider(this.url);

  @override
  Future<AuthenticatedImageProvider> obtainKey(ImageConfiguration configuration) {
    return Future.value(this);
  }

  @override
  ImageStreamCompleter loadImage(AuthenticatedImageProvider key, ImageDecoderCallback decode) {
    return MultiFrameImageStreamCompleter(
      codec: _loadAsync(key, decode),
      scale: 1.0,
    );
  }

  Future<ui.Codec> _loadAsync(AuthenticatedImageProvider key, ImageDecoderCallback decode) async {
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 60),
      responseType: ResponseType.bytes,
    ));
    if (!kIsWeb) {
      dio.interceptors.add(CookieManager(persistCookieJar));
    }

    final response = await dio.get<List<int>>(url);
    final bytes = Uint8List.fromList(response.data!);
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
