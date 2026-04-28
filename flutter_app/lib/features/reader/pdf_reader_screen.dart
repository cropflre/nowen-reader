import 'dart:io';

import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdfrx/pdfrx.dart';

import '../../data/api/api_client.dart';
import '../../data/api/comic_api.dart';
import '../../data/providers/auth_provider.dart';

/// PDF 阅读器 — 基于 pdfrx（PDFium），支持全平台
class PdfReaderScreen extends ConsumerStatefulWidget {
  final String comicId;
  final int initialPage;

  const PdfReaderScreen({
    super.key,
    required this.comicId,
    this.initialPage = 0,
  });

  @override
  ConsumerState<PdfReaderScreen> createState() => _PdfReaderScreenState();
}

class _PdfReaderScreenState extends ConsumerState<PdfReaderScreen> {
  bool _loading = true;
  String? _error;
  String? _localPath;
  int _currentPage = 0;
  int _totalPages = 0;
  bool _showOverlay = false;

  late final PdfViewerController _pdfController;

  // 阅读会话
  int? _sessionId;
  DateTime? _sessionStart;
  bool _sessionEnded = false;
  late final ComicApi _api;

  @override
  void initState() {
    super.initState();
    _currentPage = widget.initialPage;
    _pdfController = PdfViewerController();
    _api = ref.read(comicApiProvider);
    // 全屏沉浸模式
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _downloadAndOpen();
  }

  @override
  void dispose() {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    _saveProgressDirect();
    _endSessionDirect();
    super.dispose();
  }

  /// 下载 PDF 文件到本地临时目录
  Future<void> _downloadAndOpen() async {
    try {
      final serverUrl = ref.read(authProvider).serverUrl;
      final pdfUrl = '$serverUrl/api/comics/${widget.comicId}/pdf';

      // 检查本地缓存
      final dir = await getTemporaryDirectory();
      final localFile = File('${dir.path}/pdf_cache/${widget.comicId}.pdf');

      if (await localFile.exists()) {
        if (mounted) {
          setState(() {
            _localPath = localFile.path;
            _loading = false;
          });
          _startSession();
        }
        return;
      }

      // 下载 PDF
      await localFile.parent.create(recursive: true);

      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 30),
        receiveTimeout: const Duration(minutes: 5),
        responseType: ResponseType.bytes,
      ));
      dio.interceptors.add(CookieManager(persistCookieJar));

      final response = await dio.get<List<int>>(pdfUrl);
      await localFile.writeAsBytes(response.data!);

      if (mounted) {
        setState(() {
          _localPath = localFile.path;
          _loading = false;
        });
        _startSession();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'PDF 加载失败: $e';
          _loading = false;
        });
      }
    }
  }

  Future<void> _startSession() async {
    try {
      _sessionId = await _api.startSession(widget.comicId, _currentPage);
      _sessionStart = DateTime.now();
    } catch (_) {}
  }

  Future<void> _endSession() async {
    if (_sessionId == null || _sessionStart == null || _sessionEnded) return;
    _sessionEnded = true;
    final duration = DateTime.now().difference(_sessionStart!).inSeconds;
    try {
      await _api.endSession(_sessionId!, _currentPage, duration);
    } catch (_) {}
  }

  void _endSessionDirect() {
    if (_sessionId == null || _sessionStart == null || _sessionEnded) return;
    _sessionEnded = true;
    final duration = DateTime.now().difference(_sessionStart!).inSeconds;
    _api.endSession(_sessionId!, _currentPage, duration);
  }

  Future<void> _saveProgress() async {
    try {
      await _api.updateProgress(widget.comicId, _currentPage);
    } catch (_) {}
  }

  void _saveProgressDirect() {
    _api.updateProgress(widget.comicId, _currentPage);
  }

  Future<void> _onWillPop() async {
    await _saveProgress();
    await _endSession();
    if (mounted) Navigator.of(context).pop();
  }

  void _toggleOverlay() {
    setState(() => _showOverlay = !_showOverlay);
    if (_showOverlay) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    } else {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(color: Colors.white),
              SizedBox(height: 16),
              Text('正在加载 PDF...', style: TextStyle(color: Colors.white70)),
            ],
          ),
        ),
      );
    }

    if (_error != null) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: Colors.red, size: 48),
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.white70),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () {
                  setState(() {
                    _loading = true;
                    _error = null;
                  });
                  _downloadAndOpen();
                },
                child: const Text('重试'),
              ),
            ],
          ),
        ),
      );
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _onWillPop();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            // PDF 主体 — 使用 pdfrx
            PdfViewer.file(
              _localPath!,
              controller: _pdfController,
              initialPageNumber: widget.initialPage + 1,
              params: PdfViewerParams(
                maxScale: 8.0,
                backgroundColor: Colors.black,
                onPageChanged: (pageNumber) {
                  if (pageNumber != null) {
                    setState(() => _currentPage = pageNumber - 1);
                    // 每5页保存一次进度
                    if (_currentPage % 5 == 0) _saveProgress();
                  }
                },
                onViewerReady: (document, controller) {
                  setState(() {
                    _totalPages = document.pages.length;
                  });
                },
                onGeneralTap: (context, controller, details) {
                  _toggleOverlay();
                  return true;
                },
              ),
            ),

            // 顶部 & 底部覆盖层
            if (_showOverlay) ...[
              _buildTopOverlay(),
              _buildBottomOverlay(),
            ],
          ],
        ),
      ),
    );
  }

  /// 顶部工具栏
  Widget _buildTopOverlay() {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Colors.black87, Colors.transparent],
          ),
        ),
        child: SafeArea(
          bottom: false,
          child: Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: _onWillPop,
              ),
              Expanded(
                child: Text(
                  '${_currentPage + 1} / $_totalPages',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 48),
            ],
          ),
        ),
      ),
    );
  }

  /// 底部工具栏
  Widget _buildBottomOverlay() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.bottomCenter,
            end: Alignment.topCenter,
            colors: [Colors.black87, Colors.transparent],
          ),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text(
                  '${_currentPage + 1}',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
                Expanded(
                  child: Slider(
                    value: _currentPage.toDouble(),
                    min: 0,
                    max: (_totalPages - 1).toDouble().clamp(0, double.infinity),
                    onChanged: (value) {
                      final page = value.round();
                      _pdfController.goToPage(pageNumber: page + 1);
                    },
                  ),
                ),
                Text(
                  '$_totalPages',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
