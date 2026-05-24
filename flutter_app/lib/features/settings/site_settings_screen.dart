import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/comic_api.dart';
import '../../widgets/animations.dart';

/// 站点设置页面（电子书类型识别策略等）
class SiteSettingsScreen extends ConsumerStatefulWidget {
  const SiteSettingsScreen({super.key});

  @override
  ConsumerState<SiteSettingsScreen> createState() => _SiteSettingsScreenState();
}

class _SiteSettingsScreenState extends ConsumerState<SiteSettingsScreen> {
  bool _loading = true;
  bool _saving = false;
  String? _message;
  bool _isError = false;

  // 配置项
  String _ebookTypeAutoDetect = 'comics'; // off | comics | all
  String _siteName = '';
  bool _scraperEnabled = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    try {
      final api = ref.read(comicApiProvider);
      final data = await api.getSiteSettings();
      setState(() {
        _siteName = data['siteName'] ?? 'NowenReader';
        _ebookTypeAutoDetect = data['ebookTypeAutoDetect'] ?? 'comics';
        _scraperEnabled = data['scraperEnabled'] ?? true;
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _message = '加载失败: $e'; _isError = true; });
    }
  }

  Future<void> _save() async {
    setState(() { _saving = true; _message = null; });
    try {
      final api = ref.read(comicApiProvider);
      await api.updateSiteSettings({
        'siteName': _siteName,
        'ebookTypeAutoDetect': _ebookTypeAutoDetect,
        'scraperEnabled': _scraperEnabled,
      });
      setState(() { _saving = false; _message = '已保存'; _isError = false; });
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) setState(() => _message = null);
      });
    } catch (e) {
      setState(() { _saving = false; _message = '保存失败: $e'; _isError = true; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('站点设置')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('站点设置')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ─── 站点名称 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 100),
            child: _buildSection(cs, '站点名称', Icons.language_rounded, [
              Padding(
                padding: const EdgeInsets.all(12),
                child: TextField(
                  controller: TextEditingController(text: _siteName),
                  onChanged: (v) => _siteName = v,
                  decoration: InputDecoration(
                    hintText: 'NowenReader',
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    isDense: true,
                  ),
                  style: const TextStyle(fontSize: 14),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 16),

          // ─── 电子书类型识别策略 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 200),
            child: _buildSection(cs, '电子书类型识别策略', Icons.menu_book_rounded, [
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'EPUB/MOBI/AZW3 文件可能既是图文教材也可能是漫画。该选项决定系统如何判断它们的类型。',
                      style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
                    ),
                    const SizedBox(height: 12),
                    _buildRadioOption(
                      cs,
                      value: 'comics',
                      groupValue: _ebookTypeAutoDetect,
                      title: '仅漫画目录里的电子书做内容识别（推荐）',
                      subtitle: '放在小说目录里的文件一律视为小说，避免图文教材被误判为漫画',
                      onChanged: (v) => setState(() => _ebookTypeAutoDetect = v!),
                    ),
                    const SizedBox(height: 8),
                    _buildRadioOption(
                      cs,
                      value: 'off',
                      groupValue: _ebookTypeAutoDetect,
                      title: '完全按目录区分',
                      subtitle: '严格按文件所在目录决定类型，不做任何内容分析',
                      onChanged: (v) => setState(() => _ebookTypeAutoDetect = v!),
                    ),
                    const SizedBox(height: 8),
                    _buildRadioOption(
                      cs,
                      value: 'all',
                      groupValue: _ebookTypeAutoDetect,
                      title: '对所有电子书都做内容识别（旧版行为）',
                      subtitle: '无论文件位于哪个目录，只要图片占比高就归类为漫画',
                      onChanged: (v) => setState(() => _ebookTypeAutoDetect = v!),
                    ),
                  ],
                ),
              ),
            ]),
          ),
          const SizedBox(height: 16),

          // ─── 内容刮削开关 ───
          SlideAndFade(
            delay: const Duration(milliseconds: 300),
            child: _buildSection(cs, '内容刮削', Icons.cloud_download_rounded, [
              SwitchListTile(
                title: const Text('启用内容刮削', style: TextStyle(fontSize: 14)),
                subtitle: const Text('允许从在线数据源自动获取元数据', style: TextStyle(fontSize: 11)),
                value: _scraperEnabled,
                onChanged: (v) => setState(() => _scraperEnabled = v),
              ),
            ]),
          ),
          const SizedBox(height: 24),

          // ─── 保存按钮 ───
          FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save_rounded),
            label: Text(_saving ? '保存中...' : '保存设置'),
            style: FilledButton.styleFrom(minimumSize: const Size(double.infinity, 48)),
          ),

          // ─── 消息 ───
          if (_message != null) ...[
            const SizedBox(height: 12),
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
          ],

          const SizedBox(height: 16),
          Text(
            '部分设置修改后需要重启服务才能生效',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
          ),
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
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  Widget _buildRadioOption(
    ColorScheme cs, {
    required String value,
    required String groupValue,
    required String title,
    required String subtitle,
    required ValueChanged<String?> onChanged,
  }) {
    final selected = value == groupValue;
    return InkWell(
      onTap: () => onChanged(value),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? cs.primaryContainer.withOpacity(0.4) : null,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? cs.primary.withOpacity(0.5) : cs.outlineVariant.withOpacity(0.3),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Radio<String>(
              value: value,
              groupValue: groupValue,
              onChanged: onChanged,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: cs.onSurface)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
