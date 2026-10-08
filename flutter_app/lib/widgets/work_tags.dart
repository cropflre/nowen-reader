import 'package:flutter/material.dart';

/// Shared tag controls for collection and directory-work details.
class WorkTags extends StatefulWidget {
  final List<String> tags;
  final bool canEdit;
  final Future<void> Function(List<String>) onSave;

  const WorkTags({
    super.key,
    required this.tags,
    required this.canEdit,
    required this.onSave,
  });

  @override
  State<WorkTags> createState() => _WorkTagsState();
}

class _WorkTagsState extends State<WorkTags> {
  final _input = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _save(List<String> tags, {bool clearInput = false}) async {
    if (_saving || !widget.canEdit) return;
    setState(() => _saving = true);
    try {
      await widget.onSave(tags);
      if (!mounted) return;
      if (clearInput) _input.clear();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('保存标签失败，请重试')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _add() {
    final names = _input.text
        .split(RegExp(r'[,，\n]'))
        .map((name) => name.trim())
        .where((name) => name.isNotEmpty)
        .toList();
    if (names.isEmpty) return;
    _save({...widget.tags, ...names}.toList(), clearInput: true);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.label_outline, size: 16, color: cs.onSurfaceVariant),
            const SizedBox(width: 6),
            Text('标签', style: TextStyle(color: cs.onSurfaceVariant)),
          ],
        ),
        const SizedBox(height: 8),
        if (widget.tags.isEmpty)
          Text('暂无标签', style: TextStyle(color: cs.onSurfaceVariant))
        else
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: widget.tags.map((tag) {
              return InputChip(
                label: Text(tag),
                isEnabled: !_saving,
                deleteButtonTooltipMessage: '移除标签 $tag',
                onDeleted: widget.canEdit && !_saving
                    ? () => _save(widget.tags.where((name) => name != tag).toList())
                    : null,
              );
            }).toList(),
          ),
        if (widget.canEdit) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  enabled: !_saving,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _add(),
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: '添加标签',
                    hintText: '多个用逗号分隔',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filledTonal(
                tooltip: '添加标签',
                onPressed: _saving || _input.text.trim().isEmpty ? null : _add,
                icon: _saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add),
              ),
            ],
          ),
        ],
      ],
    );
  }
}
