import 'package:flutter/material.dart';

import 'novel_settings.dart';

/// 小说阅读点击区域设置。
///
/// 左 / 中 / 右三个区域独立配置动作，配置保存仍由上层
/// [NovelReaderScreen] 统一通过 NovelSettings.save() 完成。
class NovelTapZoneSettingsPanel extends StatelessWidget {
  final NovelSettings settings;
  final ValueChanged<NovelSettings> onChanged;
  final VoidCallback onClose;

  const NovelTapZoneSettingsPanel({
    super.key,
    required this.settings,
    required this.onChanged,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = settings.isDark;
    final panelBg = isDark ? const Color(0xFF27272A) : const Color(0xFFF5F5F5);
    final textColor = isDark ? Colors.white70 : Colors.black87;
    final secondary = isDark ? Colors.white54 : Colors.black54;
    final primary = Theme.of(context).colorScheme.primary;

    return Material(
      color: panelBg,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      elevation: 10,
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white24 : Colors.black12,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '点击区域',
                          style: TextStyle(
                            color: textColor,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '分别设置屏幕左侧、中间、右侧的点击动作',
                          style: TextStyle(color: secondary, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: onClose,
                    icon: Icon(Icons.close, color: secondary, size: 20),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // 点击区域示意图
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Row(
                  children: [
                    _ZonePreview(
                      label: '左侧',
                      action: settings.leftTapAction,
                      primary: primary,
                      textColor: textColor,
                      isDark: isDark,
                    ),
                    _ZonePreview(
                      label: '中间',
                      action: settings.centerTapAction,
                      primary: primary,
                      textColor: textColor,
                      isDark: isDark,
                    ),
                    _ZonePreview(
                      label: '右侧',
                      action: settings.rightTapAction,
                      primary: primary,
                      textColor: textColor,
                      isDark: isDark,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              _ActionRow(
                label: '左侧点击',
                value: settings.leftTapAction,
                textColor: textColor,
                secondary: secondary,
                isDark: isDark,
                onChanged: (value) => onChanged(
                  settings.copyWith(leftTapAction: value),
                ),
              ),
              _ActionRow(
                label: '中间点击',
                value: settings.centerTapAction,
                textColor: textColor,
                secondary: secondary,
                isDark: isDark,
                onChanged: (value) => onChanged(
                  settings.copyWith(centerTapAction: value),
                ),
              ),
              _ActionRow(
                label: '右侧点击',
                value: settings.rightTapAction,
                textColor: textColor,
                secondary: secondary,
                isDark: isDark,
                onChanged: (value) => onChanged(
                  settings.copyWith(rightTapAction: value),
                ),
              ),
              const SizedBox(height: 6),

              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text(
                  '上下滚动模式也使用点击分区',
                  style: TextStyle(color: textColor, fontSize: 13),
                ),
                subtitle: Text(
                  '关闭时保持原行为：滚动模式点击正文只显示/隐藏菜单',
                  style: TextStyle(color: secondary, fontSize: 10),
                ),
                value: settings.tapZonesInScrollMode,
                onChanged: (value) => onChanged(
                  settings.copyWith(tapZonesInScrollMode: value),
                ),
              ),
              const SizedBox(height: 10),

              Text('快捷预设', style: TextStyle(color: secondary, fontSize: 12)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _PresetButton(
                    label: '标准',
                    description: '左上一页 · 中菜单 · 右下一页',
                    onTap: () => onChanged(settings.copyWith(
                      leftTapAction: NovelTapAction.previousPage,
                      centerTapAction: NovelTapAction.menu,
                      rightTapAction: NovelTapAction.nextPage,
                    )),
                  ),
                  _PresetButton(
                    label: '左手阅读',
                    description: '左右两侧都下一页',
                    onTap: () => onChanged(settings.copyWith(
                      leftTapAction: NovelTapAction.nextPage,
                      centerTapAction: NovelTapAction.menu,
                      rightTapAction: NovelTapAction.nextPage,
                    )),
                  ),
                  _PresetButton(
                    label: '左右反转',
                    description: '左下一页 · 右上一页',
                    onTap: () => onChanged(settings.copyWith(
                      leftTapAction: NovelTapAction.nextPage,
                      centerTapAction: NovelTapAction.menu,
                      rightTapAction: NovelTapAction.previousPage,
                    )),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: onClose,
                  child: const Text('完成'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  final String label;
  final NovelTapAction value;
  final Color textColor;
  final Color secondary;
  final bool isDark;
  final ValueChanged<NovelTapAction> onChanged;

  const _ActionRow({
    required this.label,
    required this.value,
    required this.textColor,
    required this.secondary,
    required this.isDark,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: TextStyle(color: textColor, fontSize: 13)),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: isDark ? Colors.white10 : Colors.black.withAlpha(8),
              borderRadius: BorderRadius.circular(8),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<NovelTapAction>(
                value: value,
                dropdownColor: isDark ? const Color(0xFF27272A) : Colors.white,
                style: TextStyle(color: textColor, fontSize: 12),
                items: NovelTapAction.values
                    .map((action) => DropdownMenuItem(
                          value: action,
                          child: Text(_actionLabel(action)),
                        ))
                    .toList(),
                onChanged: (action) {
                  if (action != null) onChanged(action);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ZonePreview extends StatelessWidget {
  final String label;
  final NovelTapAction action;
  final Color primary;
  final Color textColor;
  final bool isDark;

  const _ZonePreview({
    required this.label,
    required this.action,
    required this.primary,
    required this.textColor,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        height: 72,
        decoration: BoxDecoration(
          color: isDark ? Colors.white.withAlpha(8) : Colors.black.withAlpha(5),
          border: Border(
            right: BorderSide(color: textColor.withAlpha(18)),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(_actionIcon(action), size: 18, color: primary),
            const SizedBox(height: 5),
            Text(label, style: TextStyle(color: textColor, fontSize: 10)),
            Text(
              _actionLabel(action),
              style: TextStyle(color: textColor.withAlpha(130), fontSize: 9),
            ),
          ],
        ),
      ),
    );
  }
}

class _PresetButton extends StatelessWidget {
  final String label;
  final String description;
  final VoidCallback onTap;

  const _PresetButton({
    required this.label,
    required this.description,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      onPressed: onTap,
      avatar: const Icon(Icons.touch_app_outlined, size: 15),
      label: Tooltip(message: description, child: Text(label)),
    );
  }
}

String _actionLabel(NovelTapAction action) {
  switch (action) {
    case NovelTapAction.previousPage:
      return '上一页';
    case NovelTapAction.menu:
      return '菜单';
    case NovelTapAction.nextPage:
      return '下一页';
    case NovelTapAction.none:
      return '无操作';
  }
}

IconData _actionIcon(NovelTapAction action) {
  switch (action) {
    case NovelTapAction.previousPage:
      return Icons.chevron_left;
    case NovelTapAction.menu:
      return Icons.menu_open;
    case NovelTapAction.nextPage:
      return Icons.chevron_right;
    case NovelTapAction.none:
      return Icons.block;
  }
}
