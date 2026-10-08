import 'package:flutter/material.dart';

class WorkCategories extends StatefulWidget {
  final List<Map<String, dynamic>> categories;
  final bool canEdit;
  final Future<List<dynamic>> Function() loadOptions;
  final Future<void> Function(List<String>) onSave;

  const WorkCategories({
    super.key,
    required this.categories,
    required this.canEdit,
    required this.loadOptions,
    required this.onSave,
  });

  @override
  State<WorkCategories> createState() => _WorkCategoriesState();
}

class _WorkCategoriesState extends State<WorkCategories> {
  bool _busy = false;

  Future<void> _save(List<String> slugs) async {
    if (_busy || !widget.canEdit) return;
    setState(() => _busy = true);
    try {
      await widget.onSave(slugs);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('保存分类失败，请重试')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _choose() async {
    if (_busy || !widget.canEdit) return;
    setState(() => _busy = true);
    List<Map<String, dynamic>> options;
    try {
      options = (await widget.loadOptions()).whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item)).toList();
    } catch (_) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('分类列表加载失败，请重试')),
        );
      }
      return;
    }
    if (!mounted) return;
    final selected = widget.categories.map((item) => item['slug'].toString()).toSet();
    final slugs = await showDialog<List<String>>(
      context: context,
      builder: (context) => StatefulBuilder(builder: (context, setDialogState) {
        return AlertDialog(
          title: const Text('选择分类'),
          content: SizedBox(
            width: double.maxFinite,
            child: options.isEmpty
                ? const Text('暂无可用分类，请先由管理员创建分类')
                : ListView(
                    shrinkWrap: true,
                    children: options.map((item) {
                      final slug = item['slug'].toString();
                      return CheckboxListTile(
                        title: Text('${item['icon'] ?? ''} ${item['name']}'),
                        value: selected.contains(slug),
                        onChanged: (value) => setDialogState(() {
                          if (value == true) { selected.add(slug); } else { selected.remove(slug); }
                        }),
                      );
                    }).toList(),
                  ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('取消')),
            FilledButton(onPressed: () => Navigator.pop(context, selected.toList()), child: const Text('保存')),
          ],
        );
      }),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (slugs != null) await _save(slugs);
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Icon(Icons.folder_outlined, size: 16, color: muted),
        const SizedBox(width: 6),
        Text('分类', style: TextStyle(color: muted)),
      ]),
      const SizedBox(height: 8),
      if (widget.categories.isEmpty) Text('暂无分类', style: TextStyle(color: muted))
      else Wrap(spacing: 6, runSpacing: 6, children: widget.categories.map((item) {
        final name = item['name'].toString();
        return InputChip(
          label: Text('${item['icon'] ?? ''} $name'),
          isEnabled: !_busy,
          deleteButtonTooltipMessage: '移除分类 $name',
          onDeleted: widget.canEdit && !_busy ? () => _save(widget.categories
              .where((category) => category['slug'] != item['slug'])
              .map((category) => category['slug'].toString()).toList()) : null,
        );
      }).toList()),
      if (widget.canEdit) TextButton.icon(
        onPressed: _busy ? null : _choose,
        icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add, size: 18),
        label: const Text('选择分类'),
      ),
    ]);
  }
}
