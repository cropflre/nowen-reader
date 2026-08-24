import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/novel_chapter_rule_api.dart';
import 'novel_settings.dart';

class NovelChapterRuleSettingsPanel extends ConsumerStatefulWidget {
  final String comicId;
  final NovelSettings settings;
  final Future<void> Function() onApplied;
  final VoidCallback onClose;

  const NovelChapterRuleSettingsPanel({
    super.key,
    required this.comicId,
    required this.settings,
    required this.onApplied,
    required this.onClose,
  });

  @override
  ConsumerState<NovelChapterRuleSettingsPanel> createState() =>
      _NovelChapterRuleSettingsPanelState();
}

class _NovelChapterRuleSettingsPanelState
    extends ConsumerState<NovelChapterRuleSettingsPanel> {
  ComicChapterRuleInfo? _info;
  List<NovelChapterRule> _rules = const [];
  String _selectedRuleId = 'auto';
  bool _loading = true;
  bool _saving = false;
  String? _error;
  NovelChapterRulePreview? _preview;

  String? _editingRuleId;
  final _nameController = TextEditingController();
  final _patternController = TextEditingController();

  NovelChapterRuleApi get _api => ref.read(novelChapterRuleApiProvider);

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _patternController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final results = await Future.wait([
        _api.getComicRule(widget.comicId),
        _api.listRules(),
      ]);
      if (!mounted) return;
      final info = results[0] as ComicChapterRuleInfo;
      final rules = results[1] as List<NovelChapterRule>;
      setState(() {
        _info = info;
        _rules = rules;
        _selectedRuleId = info.ruleId;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _message(e);
      });
    }
  }

  NovelChapterRule? get _selectedRule {
    for (final rule in _rules) {
      if (rule.id == _selectedRuleId) return rule;
    }
    return null;
  }

  Future<void> _previewSelected() async {
    final rule = _selectedRule;
    if (rule == null || rule.id == 'auto') return;
    await _runPreview(rule.pattern);
  }

  Future<void> _runPreview(String pattern) async {
    if (pattern.trim().isEmpty) {
      setState(() => _error = '请先填写正则表达式');
      return;
    }
    setState(() {
      _saving = true;
      _preview = null;
      _error = null;
    });
    try {
      final preview = await _api.preview(widget.comicId, regex: pattern);
      if (!mounted) return;
      setState(() => _preview = preview);
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _applySelected() async {
    if (_info?.canManage != true) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _api.setComicRule(widget.comicId, _selectedRuleId);
      await _refresh();
      await widget.onApplied();
      if (mounted) widget.onClose();
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _startCreate() {
    setState(() {
      _editingRuleId = null;
      _nameController.clear();
      _patternController.clear();
      _preview = null;
      _error = null;
    });
  }

  void _startEdit(NovelChapterRule rule) {
    setState(() {
      _editingRuleId = rule.id;
      _nameController.text = rule.name;
      _patternController.text = rule.pattern;
      _preview = null;
      _error = null;
    });
  }

  Future<void> _saveCustomRule() async {
    if (_info?.canEditGlobalRules != true) return;
    final name = _nameController.text.trim();
    final pattern = _patternController.text.trim();
    if (name.isEmpty || pattern.isEmpty) {
      setState(() => _error = '规则名称和正则表达式不能为空');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    final editingID = _editingRuleId;
    final affectedCurrentBook = editingID != null && _info?.ruleId == editingID;
    try {
      NovelChapterRule saved;
      if (editingID == null) {
        saved = await _api.createRule(name, pattern);
      } else {
        saved = await _api.updateRule(editingID, name, pattern);
      }
      await _refresh();
      if (!mounted) return;
      setState(() {
        if (editingID == null) _selectedRuleId = saved.id;
        _editingRuleId = null;
        _nameController.clear();
        _patternController.clear();
        _preview = null;
      });
      if (affectedCurrentBook) await widget.onApplied();
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _deleteRule(NovelChapterRule rule) async {
    if (_info?.canEditGlobalRules != true || rule.system) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除分章规则'),
        content: Text('删除“${rule.name}”？使用该规则的小说会恢复自动识别。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _saving = true;
      _error = null;
    });
    final affectedCurrentBook = _info?.ruleId == rule.id;
    try {
      await _api.deleteRule(rule.id);
      await _refresh();
      if (affectedCurrentBook) await widget.onApplied();
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.settings;
    final panelColor = s.isDark ? const Color(0xFF27272A) : const Color(0xFFF7F7F7);
    final primary = Theme.of(context).colorScheme.primary;

    return Material(
      color: panelColor,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      elevation: 12,
      child: SafeArea(
        top: false,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.82,
          ),
          child: _loading
              ? const SizedBox(
                  height: 220,
                  child: Center(child: CircularProgressIndicator()),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _header(s),
                      const SizedBox(height: 12),
                      if (_info?.isTxt != true)
                        _notice('当前文件不是 TXT。EPUB / MOBI / AZW3 会继续使用电子书自身目录。', s)
                      else if (_info?.canManage != true)
                        _notice('你可以使用当前分章结果，但没有修改这本书分章规则的权限。', s)
                      else ...[
                        Text('本书分章规则', style: TextStyle(color: s.textColor, fontWeight: FontWeight.w600)),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<String>(
                          value: _rules.any((r) => r.id == _selectedRuleId)
                              ? _selectedRuleId
                              : 'auto',
                          isExpanded: true,
                          items: _rules
                              .map((rule) => DropdownMenuItem(
                                    value: rule.id,
                                    child: Text(rule.name, overflow: TextOverflow.ellipsis),
                                  ))
                              .toList(),
                          onChanged: _saving
                              ? null
                              : (value) => setState(() {
                                    _selectedRuleId = value ?? 'auto';
                                    _preview = null;
                                  }),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            OutlinedButton.icon(
                              onPressed: _saving || _selectedRuleId == 'auto'
                                  ? null
                                  : _previewSelected,
                              icon: const Icon(Icons.visibility_outlined, size: 18),
                              label: const Text('预览匹配'),
                            ),
                            FilledButton.icon(
                              onPressed: _saving ? null : _applySelected,
                              icon: const Icon(Icons.check, size: 18),
                              label: const Text('应用到本书'),
                            ),
                          ],
                        ),
                        if (_preview != null) ...[
                          const SizedBox(height: 12),
                          _previewCard(_preview!, s, primary),
                        ],
                        if (_info?.canEditGlobalRules == true) ...[
                          const SizedBox(height: 18),
                          Divider(color: s.secondaryTextColor.withAlpha(45)),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: Text('自定义规则', style: TextStyle(color: s.textColor, fontWeight: FontWeight.w600)),
                              ),
                              TextButton.icon(
                                onPressed: _saving ? null : _startCreate,
                                icon: const Icon(Icons.add, size: 17),
                                label: const Text('新增'),
                              ),
                            ],
                          ),
                          ..._rules.where((rule) => !rule.system).map(
                                (rule) => ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(rule.name, style: TextStyle(color: s.textColor)),
                                  subtitle: Text(
                                    rule.pattern,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(color: s.secondaryTextColor, fontFamily: 'monospace', fontSize: 10),
                                  ),
                                  trailing: Wrap(
                                    spacing: 0,
                                    children: [
                                      IconButton(
                                        tooltip: '编辑',
                                        onPressed: _saving ? null : () => _startEdit(rule),
                                        icon: const Icon(Icons.edit_outlined, size: 18),
                                      ),
                                      IconButton(
                                        tooltip: '删除',
                                        onPressed: _saving ? null : () => _deleteRule(rule),
                                        icon: const Icon(Icons.delete_outline, size: 18),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                          const SizedBox(height: 8),
                          _editor(s),
                        ],
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 10),
                        Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
                      ],
                      if (_saving) ...[
                        const SizedBox(height: 10),
                        const LinearProgressIndicator(),
                      ],
                    ],
                  ),
                ),
        ),
      ),
    );
  }

  Widget _header(NovelSettings s) {
    return Row(
      children: [
        Icon(Icons.segment, color: s.secondaryTextColor),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('TXT 分章', style: TextStyle(color: s.textColor, fontSize: 16, fontWeight: FontWeight.w600)),
              Text('选择内置规则，或为特殊文本创建自定义正则', style: TextStyle(color: s.secondaryTextColor, fontSize: 10)),
            ],
          ),
        ),
        IconButton(onPressed: widget.onClose, icon: Icon(Icons.close, color: s.secondaryTextColor)),
      ],
    );
  }

  Widget _notice(String text, NovelSettings s) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: s.isDark ? Colors.white.withAlpha(8) : Colors.black.withAlpha(5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text, style: TextStyle(color: s.secondaryTextColor, fontSize: 12)),
    );
  }

  Widget _previewCard(NovelChapterRulePreview preview, NovelSettings s, Color primary) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: primary.withAlpha(80)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('匹配到 ${preview.matchCount} 个章节', style: TextStyle(color: s.textColor, fontWeight: FontWeight.w600)),
          if (preview.warning != null) ...[
            const SizedBox(height: 4),
            Text(preview.warning!, style: const TextStyle(color: Colors.orange, fontSize: 11)),
          ],
          if (preview.chapters.isNotEmpty) ...[
            const SizedBox(height: 8),
            ...preview.chapters.take(20).map(
                  (chapter) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 1),
                    child: Text(chapter, style: TextStyle(color: s.secondaryTextColor, fontSize: 11)),
                  ),
                ),
          ],
        ],
      ),
    );
  }

  Widget _editor(NovelSettings s) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: s.isDark ? Colors.white.withAlpha(8) : Colors.black.withAlpha(5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_editingRuleId == null ? '新增规则' : '编辑规则', style: TextStyle(color: s.textColor, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(labelText: '规则名称', isDense: true),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _patternController,
            minLines: 2,
            maxLines: 5,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            decoration: const InputDecoration(
              labelText: '正则表达式（Go / RE2）',
              hintText: r'^【\d+】.+$',
              isDense: true,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton(
                onPressed: _saving ? null : () => _runPreview(_patternController.text),
                child: const Text('测试正则'),
              ),
              FilledButton(
                onPressed: _saving ? null : _saveCustomRule,
                child: Text(_editingRuleId == null ? '保存规则' : '保存修改'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _message(Object error) {
    final text = error.toString();
    return text.startsWith('Exception: ') ? text.substring(11) : text;
  }
}
