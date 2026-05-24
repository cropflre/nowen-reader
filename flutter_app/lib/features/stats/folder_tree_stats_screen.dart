import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/comic_api.dart';
import '../../widgets/animations.dart';

/// 文件夹层级统计页面
class FolderTreeStatsScreen extends ConsumerStatefulWidget {
  const FolderTreeStatsScreen({super.key});

  @override
  ConsumerState<FolderTreeStatsScreen> createState() => _FolderTreeStatsScreenState();
}

class _FolderTreeStatsScreenState extends ConsumerState<FolderTreeStatsScreen> {
  bool _loading = true;
  String? _error;
  List<_FolderNode> _roots = [];
  Map<String, dynamic>? _summary;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.getFolderTreeStats();
      final tree = data['tree'] as List<dynamic>? ?? [];
      _roots = tree.map((e) => _FolderNode.fromJson(e as Map<String, dynamic>)).toList();
      _summary = data['summary'] as Map<String, dynamic>?;
      setState(() => _loading = false);
    } catch (e) {
      setState(() { _loading = false; _error = '加载失败: $e'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('文件夹统计'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: TextStyle(color: cs.error)))
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // ─── 总览 ───
                      if (_summary != null)
                        SlideAndFade(
                          delay: const Duration(milliseconds: 100),
                          child: _buildSummaryCard(cs),
                        ),
                      const SizedBox(height: 16),
                      // ─── 树形列表 ───
                      ..._roots.asMap().entries.map((entry) => SlideAndFade(
                        delay: Duration(milliseconds: 150 + entry.key * 50),
                        child: _FolderTile(node: entry.value, depth: 0),
                      )),
                    ],
                  ),
                ),
    );
  }

  Widget _buildSummaryCard(ColorScheme cs) {
    final s = _summary!;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [cs.primaryContainer, cs.primaryContainer.withOpacity(0.5)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('总览', style: TextStyle(fontWeight: FontWeight.bold, color: cs.onPrimaryContainer)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _summaryItem('总文件夹', '${s['totalFolders'] ?? 0}', Icons.folder_rounded, cs),
              _summaryItem('总文件', '${s['totalFiles'] ?? 0}', Icons.insert_drive_file_rounded, cs),
              _summaryItem('总大小', _formatSize(s['totalSize'] ?? 0), Icons.storage_rounded, cs),
            ],
          ),
        ],
      ),
    );
  }

  Widget _summaryItem(String label, String value, IconData icon, ColorScheme cs) {
    return Column(
      children: [
        Icon(icon, size: 22, color: cs.primary),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: cs.onPrimaryContainer)),
        Text(label, style: TextStyle(fontSize: 10, color: cs.onPrimaryContainer.withOpacity(0.7))),
      ],
    );
  }

  String _formatSize(dynamic bytes) {
    final b = (bytes is int) ? bytes : int.tryParse(bytes.toString()) ?? 0;
    if (b < 1024) return '$b B';
    if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(1)} KB';
    if (b < 1024 * 1024 * 1024) return '${(b / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(b / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }
}

/// 文件夹节点数据模型
class _FolderNode {
  final String name;
  final String path;
  final int fileCount;
  final int totalSize;
  final List<_FolderNode> children;

  _FolderNode({
    required this.name,
    required this.path,
    this.fileCount = 0,
    this.totalSize = 0,
    this.children = const [],
  });

  factory _FolderNode.fromJson(Map<String, dynamic> json) {
    return _FolderNode(
      name: json['name'] ?? '',
      path: json['path'] ?? '',
      fileCount: json['fileCount'] ?? json['count'] ?? 0,
      totalSize: json['totalSize'] ?? json['size'] ?? 0,
      children: (json['children'] as List<dynamic>?)
              ?.map((e) => _FolderNode.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

/// 文件夹树形节点组件
class _FolderTile extends StatefulWidget {
  final _FolderNode node;
  final int depth;

  const _FolderTile({required this.node, required this.depth});

  @override
  State<_FolderTile> createState() => _FolderTileState();
}

class _FolderTileState extends State<_FolderTile> {
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _expanded = widget.depth < 1; // 默认展开第一层
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final hasChildren = widget.node.children.isNotEmpty;
    final indent = widget.depth * 16.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: hasChildren ? () => setState(() => _expanded = !_expanded) : null,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: EdgeInsets.only(left: indent, top: 6, bottom: 6, right: 8),
            child: Row(
              children: [
                // 展开/折叠图标
                SizedBox(
                  width: 24,
                  child: hasChildren
                      ? Icon(
                          _expanded ? Icons.expand_more_rounded : Icons.chevron_right_rounded,
                          size: 18,
                          color: cs.onSurfaceVariant,
                        )
                      : const SizedBox(width: 18),
                ),
                // 文件夹图标
                Icon(
                  _expanded ? Icons.folder_open_rounded : Icons.folder_rounded,
                  size: 18,
                  color: cs.primary.withOpacity(0.8),
                ),
                const SizedBox(width: 8),
                // 名称
                Expanded(
                  child: Text(
                    widget.node.name,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: hasChildren ? FontWeight.w500 : FontWeight.normal,
                      color: cs.onSurface,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                // 文件数
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: cs.primaryContainer.withOpacity(0.5),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${widget.node.fileCount}',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: cs.primary),
                  ),
                ),
                const SizedBox(width: 8),
                // 大小
                Text(
                  _formatSize(widget.node.totalSize),
                  style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ),
        // 子节点
        if (_expanded && hasChildren)
          ...widget.node.children.map((child) => _FolderTile(node: child, depth: widget.depth + 1)),
      ],
    );
  }
}
