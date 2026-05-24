import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';

import '../../data/api/comic_api.dart';
import '../../widgets/animations.dart';

/// 文件上传页面
class UploadScreen extends ConsumerStatefulWidget {
  const UploadScreen({super.key});

  @override
  ConsumerState<UploadScreen> createState() => _UploadScreenState();
}

class _UploadScreenState extends ConsumerState<UploadScreen> {
  List<PlatformFile> _selectedFiles = [];
  String _category = 'auto'; // auto | comic | novel
  bool _uploading = false;
  double _progress = 0;
  int _uploadedCount = 0;
  String? _error;
  String? _successMessage;

  // 漫画文件扩展名
  static const _comicExtensions = ['.cbz', '.cbr', '.zip', '.rar', '.7z', '.pdf'];
  // 小说文件扩展名
  static const _novelExtensions = ['.epub', '.mobi', '.azw3', '.txt', '.fb2'];
  // 所有支持的扩展名
  static const _allExtensions = [..._comicExtensions, ..._novelExtensions];

  Future<void> _pickFiles() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: true,
        type: FileType.custom,
        allowedExtensions: _allExtensions.map((e) => e.substring(1)).toList(),
      );
      if (result != null && result.files.isNotEmpty) {
        setState(() {
          _selectedFiles = result.files;
          _error = null;
          _successMessage = null;
        });
      }
    } catch (e) {
      setState(() => _error = '选择文件失败: $e');
    }
  }

  Future<void> _startUpload() async {
    if (_selectedFiles.isEmpty) return;
    setState(() {
      _uploading = true;
      _progress = 0;
      _uploadedCount = 0;
      _error = null;
      _successMessage = null;
    });

    final api = ref.read(comicApiProvider);
    int success = 0;
    int failed = 0;

    for (int i = 0; i < _selectedFiles.length; i++) {
      final file = _selectedFiles[i];
      if (file.path == null) {
        failed++;
        continue;
      }

      try {
        // 根据分类策略决定 category
        String? category;
        if (_category == 'comic') {
          category = 'comic';
        } else if (_category == 'novel') {
          category = 'novel';
        }
        // auto 模式不传 category，让后端自动判断

        await api.uploadFile(
          filePath: file.path!,
          fileName: file.name,
          category: category,
          onProgress: (sent, total) {
            if (total > 0) {
              setState(() {
                _progress = (i + sent / total) / _selectedFiles.length;
              });
            }
          },
        );
        success++;
      } catch (e) {
        failed++;
      }

      setState(() => _uploadedCount = i + 1);
    }

    setState(() {
      _uploading = false;
      _progress = 1.0;
      if (failed == 0) {
        _successMessage = '全部上传成功！共 $success 个文件';
        _selectedFiles = [];
      } else {
        _successMessage = '上传完成：成功 $success，失败 $failed';
      }
    });
  }

  String _formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  IconData _getFileIcon(String name) {
    final ext = name.contains('.') ? '.${name.split('.').last.toLowerCase()}' : '';
    if (_comicExtensions.contains(ext)) return Icons.collections_bookmark_rounded;
    if (_novelExtensions.contains(ext)) return Icons.menu_book_rounded;
    return Icons.insert_drive_file_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('上传文件')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ─── 说明卡片 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 100),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [cs.primaryContainer, cs.primaryContainer.withOpacity(0.5)],
                ),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  Icon(Icons.cloud_upload_rounded, size: 36, color: cs.primary),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('上传到书库', style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: cs.onPrimaryContainer,
                        )),
                        const SizedBox(height: 4),
                        Text(
                          '支持漫画 (CBZ/CBR/ZIP/PDF) 和小说 (EPUB/MOBI/AZW3/TXT)',
                          style: TextStyle(fontSize: 12, color: cs.onPrimaryContainer.withOpacity(0.7)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // ─── 分类选择 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 200),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('目标分类', style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: cs.onSurface,
                )),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'auto', label: Text('自动'), icon: Icon(Icons.auto_awesome, size: 16)),
                    ButtonSegment(value: 'comic', label: Text('漫画'), icon: Icon(Icons.collections_bookmark, size: 16)),
                    ButtonSegment(value: 'novel', label: Text('小说'), icon: Icon(Icons.menu_book, size: 16)),
                  ],
                  selected: {_category},
                  onSelectionChanged: (v) => setState(() => _category = v.first),
                ),
                const SizedBox(height: 4),
                Text(
                  _category == 'auto' ? '根据文件扩展名自动判断存放目录' :
                  _category == 'comic' ? '所有文件存放到漫画目录' : '所有文件存放到小说目录',
                  style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // ─── 选择文件按钮 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 300),
            child: FilledButton.icon(
              onPressed: _uploading ? null : _pickFiles,
              icon: const Icon(Icons.folder_open_rounded),
              label: const Text('选择文件'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // ─── 已选文件列表 ───
          if (_selectedFiles.isNotEmpty) ...[
            Text('已选择 ${_selectedFiles.length} 个文件',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cs.onSurface)),
            const SizedBox(height: 8),
            ...List.generate(_selectedFiles.length, (i) {
              final file = _selectedFiles[i];
              return Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: cs.surfaceContainerHighest.withOpacity(0.5),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(_getFileIcon(file.name), size: 20, color: cs.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(file.name, style: const TextStyle(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                          Text(_formatFileSize(file.size), style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
                        ],
                      ),
                    ),
                    if (!_uploading)
                      IconButton(
                        icon: Icon(Icons.close, size: 16, color: cs.error),
                        onPressed: () {
                          setState(() => _selectedFiles = List.from(_selectedFiles)..removeAt(i));
                        },
                        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                        padding: EdgeInsets.zero,
                      ),
                  ],
                ),
              );
            }),
            const SizedBox(height: 16),

            // ─── 上传按钮 ───
            FilledButton.icon(
              onPressed: _uploading ? null : _startUpload,
              icon: _uploading
                  ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: cs.onPrimary))
                  : const Icon(Icons.cloud_upload_rounded),
              label: Text(_uploading ? '上传中 $_uploadedCount/${_selectedFiles.length}' : '开始上传'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
                backgroundColor: cs.primary,
              ),
            ),
          ],

          // ─── 上传进度 ───
          if (_uploading) ...[
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value: _progress,
                minHeight: 6,
                backgroundColor: cs.surfaceContainerHighest,
              ),
            ),
            const SizedBox(height: 8),
            Text('${(_progress * 100).toInt()}%',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
          ],

          // ─── 结果消息 ───
          if (_successMessage != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: cs.primaryContainer.withOpacity(0.5),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(Icons.check_circle_rounded, color: cs.primary, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_successMessage!, style: TextStyle(fontSize: 12, color: cs.onPrimaryContainer))),
                ],
              ),
            ),
          ],

          if (_error != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: cs.errorContainer.withOpacity(0.5),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(Icons.error_rounded, color: cs.error, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_error!, style: TextStyle(fontSize: 12, color: cs.onErrorContainer))),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
