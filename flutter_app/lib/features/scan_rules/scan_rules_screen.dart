import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/comic_api.dart';
import '../../widgets/animations.dart';

/// 扫描规则管理页面
class ScanRulesScreen extends ConsumerStatefulWidget {
  const ScanRulesScreen({super.key});

  @override
  ConsumerState<ScanRulesScreen> createState() => _ScanRulesScreenState();
}

class _ScanRulesScreenState extends ConsumerState<ScanRulesScreen> {
  bool _loading = true;
  bool _saving = false;
  bool _running = false;
  String? _message;
  bool _isError = false;
  Timer? _pollTimer;

  // 规则配置
  bool _enabled = false;
  String _applyOn = 'newOnly'; // newOnly | all | manual
  // AI 推断
  bool _aiEnabled = false;
  String _aiScope = 'folderGroup'; // folderGroup | file
  String _minConfidence = 'medium'; // low | medium | high
  bool _applyToComic = true;
  bool _applyToGroup = true;
  bool _overwriteTitle = false;
  // 虚拟归类
  bool _organizeEnabled = false;
  bool _autoGroupByDir = true;
  bool _inheritMeta = true;

  // 进度
  Map<String, dynamic>? _progress;
  // 执行结果
  Map<String, dynamic>? _lastResult;

  @override
  void initState() {
    super.initState();
    _loadRules();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadRules() async {
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.getScanRules();
      final rules = data['rules'] as Map<String, dynamic>? ?? {};
      setState(() {
        _enabled = rules['enabled'] ?? false;
        _applyOn = rules['applyOn'] ?? 'newOnly';
        final ai = rules['aiInfer'] as Map<String, dynamic>? ?? {};
        _aiEnabled = ai['enabled'] ?? false;
        _aiScope = ai['scope'] ?? 'folderGroup';
        _minConfidence = ai['minConfidence'] ?? 'medium';
        _applyToComic = ai['applyToComic'] ?? true;
        _applyToGroup = ai['applyToGroup'] ?? true;
        _overwriteTitle = ai['overwriteTitle'] ?? false;
        final org = rules['organize'] as Map<String, dynamic>? ?? {};
        _organizeEnabled = org['enabled'] ?? false;
        _autoGroupByDir = org['autoGroupByDir'] ?? true;
        _inheritMeta = org['inheritMeta'] ?? true;
        _running = data['running'] ?? false;
        _loading = false;
      });
      if (_running) _startPolling();
    } catch (e) {
      setState(() {
        _loading = false;
        _message = '加载失败: $e';
        _isError = true;
      });
    }
  }

  Map<String, dynamic> _buildRulesPayload() => {
    'enabled': _enabled,
    'applyOn': _applyOn,
    'concurrency': 2,
    'aiInfer': {
      'enabled': _aiEnabled,
      'scope': _aiScope,
      'minConfidence': _minConfidence,
      'applyToComic': _applyToComic,
      'applyToGroup': _applyToGroup,
      'overwriteTitle': _overwriteTitle,
      'fallbackToRule': true,
    },
    'organize': {
      'enabled': _organizeEnabled,
      'autoGroupByDir': _autoGroupByDir,
      'inheritMeta': _inheritMeta,
    },
    'filters': {},
  };

  Future<void> _save() async {
    setState(() { _saving = true; _message = null; });
    try {
      final api = ref.read(comicApiProvider);
      await api.updateScanRules(_buildRulesPayload());
      setState(() { _saving = false; _message = '已保存'; _isError = false; });
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) setState(() => _message = null);
      });
    } catch (e) {
      setState(() { _saving = false; _message = '保存失败: $e'; _isError = true; });
    }
  }

  Future<void> _run({bool dryRun = false, String? scope}) async {
    setState(() { _running = true; _message = null; _lastResult = null; });
    _startPolling();
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.applyScanRules(dryRun: dryRun, scope: scope);
      final result = data['result'] as Map<String, dynamic>?;
      setState(() {
        _lastResult = result;
        _running = false;
        if (result != null) {
          final inferred = result['inferred'] ?? 0;
          final grouped = result['groupedNew'] ?? 0;
          final failed = result['failed'] ?? 0;
          _message = dryRun
              ? '预览完成（共 ${result['total']} 项）'
              : '执行完成（识别 $inferred，新建分组 $grouped，失败 $failed）';
          _isError = false;
        }
      });
    } catch (e) {
      setState(() { _running = false; _message = '执行失败: $e'; _isError = true; });
    }
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 1), (_) => _fetchProgress());
    _fetchProgress();
  }

  Future<void> _fetchProgress() async {
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.getScanRulesProgress();
      setState(() => _progress = data);
      if (data['running'] != true) {
        _pollTimer?.cancel();
        _pollTimer = null;
        setState(() => _running = false);
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('扫描规则')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('扫描规则')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ─── 说明 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 100),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [cs.tertiaryContainer, cs.tertiaryContainer.withOpacity(0.5)],
                ),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  Icon(Icons.auto_fix_high_rounded, size: 32, color: cs.tertiary),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('扫描期统一规则', style: TextStyle(fontWeight: FontWeight.bold, color: cs.onTertiaryContainer)),
                        const SizedBox(height: 4),
                        Text('AI 智能识别 + 虚拟归类，不修改磁盘文件',
                          style: TextStyle(fontSize: 11, color: cs.onTertiaryContainer.withOpacity(0.7))),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // ─── 进度条 ───
          if (_progress != null && (_progress!['running'] == true || _progress!['stage'] == 'done'))
            _buildProgressCard(cs),

          // ─── 总开关 ───
          _buildSection(cs, '总开关', Icons.power_settings_new_rounded, [
            SwitchListTile(
              title: const Text('启用扫描规则', style: TextStyle(fontSize: 14)),
              subtitle: const Text('关闭后所有动作均不会执行', style: TextStyle(fontSize: 11)),
              value: _enabled,
              onChanged: (v) => setState(() => _enabled = v),
            ),
            ListTile(
              title: const Text('触发时机', style: TextStyle(fontSize: 14)),
              trailing: DropdownButton<String>(
                value: _applyOn,
                underline: const SizedBox(),
                items: const [
                  DropdownMenuItem(value: 'newOnly', child: Text('仅新增', style: TextStyle(fontSize: 12))),
                  DropdownMenuItem(value: 'all', child: Text('全库', style: TextStyle(fontSize: 12))),
                  DropdownMenuItem(value: 'manual', child: Text('仅手动', style: TextStyle(fontSize: 12))),
                ],
                onChanged: (v) { if (v != null) setState(() => _applyOn = v); },
              ),
            ),
          ]),
          const SizedBox(height: 12),

          // ─── AI 智能识别 ───
          _buildSection(cs, 'AI 智能识别', Icons.auto_awesome_rounded, [
            SwitchListTile(
              title: const Text('启用', style: TextStyle(fontSize: 14)),
              subtitle: const Text('结合父目录与同伴文件名样本推断标题', style: TextStyle(fontSize: 11)),
              value: _aiEnabled,
              onChanged: (v) => setState(() => _aiEnabled = v),
            ),
            ListTile(
              title: const Text('识别范围', style: TextStyle(fontSize: 14)),
              trailing: DropdownButton<String>(
                value: _aiScope,
                underline: const SizedBox(),
                items: const [
                  DropdownMenuItem(value: 'folderGroup', child: Text('按目录', style: TextStyle(fontSize: 12))),
                  DropdownMenuItem(value: 'file', child: Text('每文件', style: TextStyle(fontSize: 12))),
                ],
                onChanged: (v) { if (v != null) setState(() => _aiScope = v); },
              ),
            ),
            ListTile(
              title: const Text('最低置信度', style: TextStyle(fontSize: 14)),
              trailing: DropdownButton<String>(
                value: _minConfidence,
                underline: const SizedBox(),
                items: const [
                  DropdownMenuItem(value: 'low', child: Text('低', style: TextStyle(fontSize: 12))),
                  DropdownMenuItem(value: 'medium', child: Text('中', style: TextStyle(fontSize: 12))),
                  DropdownMenuItem(value: 'high', child: Text('高', style: TextStyle(fontSize: 12))),
                ],
                onChanged: (v) { if (v != null) setState(() => _minConfidence = v); },
              ),
            ),
            SwitchListTile(
              title: const Text('写回单卷字段', style: TextStyle(fontSize: 14)),
              value: _applyToComic,
              onChanged: (v) => setState(() => _applyToComic = v),
            ),
            SwitchListTile(
              title: const Text('同步到所属分组', style: TextStyle(fontSize: 14)),
              value: _applyToGroup,
              onChanged: (v) => setState(() => _applyToGroup = v),
            ),
            SwitchListTile(
              title: const Text('覆盖已有标题', style: TextStyle(fontSize: 14)),
              subtitle: const Text('默认仅在标题为空时填充', style: TextStyle(fontSize: 11)),
              value: _overwriteTitle,
              onChanged: (v) => setState(() => _overwriteTitle = v),
            ),
          ]),
          const SizedBox(height: 12),

          // ─── 虚拟归类 ───
          _buildSection(cs, '虚拟归类（自动分组）', Icons.folder_copy_rounded, [
            SwitchListTile(
              title: const Text('启用', style: TextStyle(fontSize: 14)),
              subtitle: const Text('按目录结构自动创建/合并分组', style: TextStyle(fontSize: 11)),
              value: _organizeEnabled,
              onChanged: (v) => setState(() => _organizeEnabled = v),
            ),
            SwitchListTile(
              title: const Text('按文件夹自动分组', style: TextStyle(fontSize: 14)),
              value: _autoGroupByDir,
              onChanged: (v) => setState(() => _autoGroupByDir = v),
            ),
            SwitchListTile(
              title: const Text('从首卷继承元数据', style: TextStyle(fontSize: 14)),
              value: _inheritMeta,
              onChanged: (v) => setState(() => _inheritMeta = v),
            ),
          ]),
          const SizedBox(height: 20),

          // ─── 操作按钮 ───
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.save_rounded, size: 18),
                  label: const Text('保存'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _running ? null : () => _run(dryRun: true),
                  icon: const Icon(Icons.visibility_rounded, size: 18),
                  label: const Text('预览'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.tonal(
                  onPressed: (_running || !_enabled) ? null : () => _run(scope: 'newOnly'),
                  child: const Text('执行(新增)'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.tonal(
                  onPressed: (_running || !_enabled) ? null : () => _run(scope: 'all'),
                  child: const Text('执行(全库)'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // ─── 消息 ───
          if (_message != null)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _isError ? cs.errorContainer.withOpacity(0.5) : cs.primaryContainer.withOpacity(0.5),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(
                    _isError ? Icons.error_rounded : Icons.check_circle_rounded,
                    size: 18,
                    color: _isError ? cs.error : cs.primary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_message!, style: TextStyle(fontSize: 12, color: cs.onSurface))),
                ],
              ),
            ),

          // ─── 执行结果 ───
          if (_lastResult != null) ...[
            const SizedBox(height: 16),
            _buildResultCard(cs),
          ],
        ],
      ),
    );
  }

  Widget _buildSection(ColorScheme cs, String title, IconData icon, List<Widget> children) {
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withOpacity(0.3),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: cs.outlineVariant.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                Icon(icon, size: 18, color: cs.primary),
                const SizedBox(width: 8),
                Text(title, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cs.onSurface)),
              ],
            ),
          ),
          ...children,
        ],
      ),
    );
  }

  Widget _buildProgressCard(ColorScheme cs) {
    final p = _progress!;
    final running = p['running'] == true;
    final total = p['total'] ?? 0;
    final current = p['current'] ?? 0;
    final pct = total > 0 ? (current / total * 100).round() : 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: running ? cs.primaryContainer.withOpacity(0.3) : cs.tertiaryContainer.withOpacity(0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.primary.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (running)
                SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: cs.primary))
              else
                Icon(Icons.check_circle_rounded, size: 16, color: cs.tertiary),
              const SizedBox(width: 8),
              Text(running ? '正在执行...' : '已完成',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cs.onSurface)),
              const Spacer(),
              Text('$pct%', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: cs.primary)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: total > 0 ? current / total : 0,
              minHeight: 4,
              backgroundColor: cs.surfaceContainerHighest,
              color: cs.primary,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _miniStat('总项', '$total', cs),
              _miniStat('已处理', '$current', cs),
              _miniStat('AI识别', '${p['inferred'] ?? 0}', cs),
              _miniStat('失败', '${p['failed'] ?? 0}', cs),
            ],
          ),
        ],
      ),
    );
  }

  Widget _miniStat(String label, String value, ColorScheme cs) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: cs.primary)),
        Text(label, style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
      ],
    );
  }

  Widget _buildResultCard(ColorScheme cs) {
    final r = _lastResult!;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withOpacity(0.3),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(r['dryRun'] == true ? '预览结果' : '执行结果',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cs.onSurface)),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _miniStat('总数', '${r['total'] ?? 0}', cs),
              _miniStat('AI识别', '${r['inferred'] ?? 0}', cs),
              _miniStat('新建分组', '${r['groupedNew'] ?? 0}', cs),
              _miniStat('跳过', '${r['skipped'] ?? 0}', cs),
              _miniStat('失败', '${r['failed'] ?? 0}', cs),
            ],
          ),
          if (r['durationMs'] != null) ...[
            const SizedBox(height: 8),
            Text('用时 ${r['durationMs']} ms', style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
          ],
        ],
      ),
    );
  }
}
