import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/comic_api.dart';
import '../../data/models/comic.dart';
import 'comic_reader_screen.dart';
import 'novel_reader_screen.dart';
import 'pdf_reader_screen.dart';

/// 兼容旧链接和外部深链的阅读器分发页。
///
/// 内容所在书库只决定分类；真正使用哪个阅读器必须以文件格式为准。
/// 特别是小说库中的 PDF，必须进入 PDF 阅读器而不是章节阅读器。
class ReaderDispatchScreen extends ConsumerStatefulWidget {
  final String comicId;
  final int initialPosition;

  const ReaderDispatchScreen({
    super.key,
    required this.comicId,
    this.initialPosition = 0,
  });

  @override
  ConsumerState<ReaderDispatchScreen> createState() =>
      _ReaderDispatchScreenState();
}

class _ReaderDispatchScreenState extends ConsumerState<ReaderDispatchScreen> {
  Comic? _comic;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data =
          await ref.read(comicApiProvider).getComic(widget.comicId);
      if (!mounted) return;
      setState(() {
        _comic = Comic.fromJson(data);
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final comic = _comic;
    if (comic == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline_rounded, size: 48),
                const SizedBox(height: 12),
                const Text('无法识别文件类型或加载作品信息失败'),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error.toString(),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('重试'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (comic.isPdf) {
      return PdfReaderScreen(
        comicId: comic.id,
        initialPage: widget.initialPosition,
      );
    }
    if (comic.isNovel) {
      return NovelReaderScreen(
        comicId: comic.id,
        initialChapter: widget.initialPosition,
      );
    }
    return ComicReaderScreen(
      comicId: comic.id,
      initialPage: widget.initialPosition,
    );
  }
}
