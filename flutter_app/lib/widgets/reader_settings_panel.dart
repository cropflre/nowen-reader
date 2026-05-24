import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 漫画阅读模式
enum ComicReadingMode { single, webtoon, doublePage }

/// 阅读方向
enum ReadingDirection { ltr, rtl, ttb }

/// 适应显示模式
enum FitMode { contain, width, height }

/// 阅读器设置 — 持久化到 SharedPreferences
class ReaderSettings {
  final ComicReadingMode mode;
  final ReadingDirection direction;
  final FitMode fitMode;
  final bool showPageNumber;
  final int autoPageInterval; // 秒，0=禁用
  /// 双页模式下封面单独显示（错页 1 页），日漫见开页对齐用
  final bool doubleCoverAlone;
  /// 双页模式贴合（去除中间缝隙），让两页在屏幕中央对齐拼接
  final bool doublePageNoGap;

  const ReaderSettings({
    this.mode = ComicReadingMode.single,
    this.direction = ReadingDirection.ltr,
    this.fitMode = FitMode.contain,
    this.showPageNumber = true,
    this.autoPageInterval = 10,
    this.doubleCoverAlone = true,
    this.doublePageNoGap = true,
  });

  ReaderSettings copyWith({
    ComicReadingMode? mode,
    ReadingDirection? direction,
    FitMode? fitMode,
    bool? showPageNumber,
    int? autoPageInterval,
    bool? doubleCoverAlone,
    bool? doublePageNoGap,
  }) {
    return ReaderSettings(
      mode: mode ?? this.mode,
      direction: direction ?? this.direction,
      fitMode: fitMode ?? this.fitMode,
      showPageNumber: showPageNumber ?? this.showPageNumber,
      autoPageInterval: autoPageInterval ?? this.autoPageInterval,
      doubleCoverAlone: doubleCoverAlone ?? this.doubleCoverAlone,
      doublePageNoGap: doublePageNoGap ?? this.doublePageNoGap,
    );
  }

  /// 从 SharedPreferences 读取
  static Future<ReaderSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    return ReaderSettings(
      mode: ComicReadingMode.values[prefs.getInt('reader_mode') ?? 0],
      direction: ReadingDirection.values[prefs.getInt('reader_direction') ?? 0],
      fitMode: FitMode.values[prefs.getInt('reader_fitMode') ?? 0],
      showPageNumber: prefs.getBool('reader_showPageNumber') ?? true,
      autoPageInterval: prefs.getInt('reader_autoPageInterval') ?? 10,
      doubleCoverAlone: prefs.getBool('reader_doubleCoverAlone') ?? true,
      doublePageNoGap: prefs.getBool('reader_doublePageNoGap') ?? true,
    );
  }

  /// 保存到 SharedPreferences
  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('reader_mode', mode.index);
    await prefs.setInt('reader_direction', direction.index);
    await prefs.setInt('reader_fitMode', fitMode.index);
    await prefs.setBool('reader_showPageNumber', showPageNumber);
    await prefs.setInt('reader_autoPageInterval', autoPageInterval);
    await prefs.setBool('reader_doubleCoverAlone', doubleCoverAlone);
    await prefs.setBool('reader_doublePageNoGap', doublePageNoGap);
  }
}

/// 阅读器设置面板（底部弹出）
class ReaderSettingsPanel extends StatefulWidget {
  final ReaderSettings settings;
  final ValueChanged<ReaderSettings> onChanged;

  const ReaderSettingsPanel({
    super.key,
    required this.settings,
    required this.onChanged,
  });

  @override
  State<ReaderSettingsPanel> createState() => _ReaderSettingsPanelState();

  /// 从底部弹出显示
  static void show(BuildContext context,
      {required ReaderSettings settings,
      required ValueChanged<ReaderSettings> onChanged}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ReaderSettingsPanel(
        settings: settings,
        onChanged: onChanged,
      ),
    );
  }
}

class _ReaderSettingsPanelState extends State<ReaderSettingsPanel> {
  late ReaderSettings _settings;

  @override
  void initState() {
    super.initState();
    _settings = widget.settings;
  }

  void _update(ReaderSettings newSettings) {
    setState(() => _settings = newSettings);
    widget.onChanged(newSettings);
    newSettings.save(); // 自动持久化
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.55,
      minChildSize: 0.3,
      maxChildSize: 0.75,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: Colors.grey[900],
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 拖拽把手
              Padding(
                padding: const EdgeInsets.only(top: 12, bottom: 8),
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              // 标题栏
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      '阅读器设置',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Text(
                      '自动保存',
                      style: TextStyle(
                        color: Colors.white.withAlpha(77),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(color: Colors.white12, height: 16),
              // 可滚动的设置项
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  children: [
                    // ── 显示设置 ──
                    _SectionTitle(icon: Icons.monitor, title: '显示'),
                    const SizedBox(height: 8),

                    // 适应显示
                    _SettingLabel('适应显示'),
                    const SizedBox(height: 6),
                    _ToggleGroup<FitMode>(
                      value: _settings.fitMode,
                      items: const [
                        _ToggleItem(FitMode.contain, '容器'),
                        _ToggleItem(FitMode.width, '宽度'),
                        _ToggleItem(FitMode.height, '高度'),
                      ],
                      onChanged: (v) =>
                          _update(_settings.copyWith(fitMode: v)),
                    ),
                    const SizedBox(height: 16),

                    // 页面渲染
                    _SettingLabel('页面渲染'),
                    const SizedBox(height: 6),
                    _ToggleGroup<ComicReadingMode>(
                      value: _settings.mode,
                      items: const [
                        _ToggleItem(ComicReadingMode.single, '单页'),
                        _ToggleItem(ComicReadingMode.doublePage, '双页'),
                        _ToggleItem(ComicReadingMode.webtoon, '长条'),
                      ],
                      onChanged: (v) =>
                          _update(_settings.copyWith(mode: v)),
                    ),
                    const SizedBox(height: 16),

                    // 双页：封面单独显示（错页对齐）
                    if (_settings.mode == ComicReadingMode.doublePage) ...[
                      _SwitchRow(
                        label: '封面单独显示（双页错页）',
                        value: _settings.doubleCoverAlone,
                        onChanged: (v) => _update(
                            _settings.copyWith(doubleCoverAlone: v)),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(top: 2, bottom: 8),
                        child: Text(
                          '关闭后从第 1 页开始两两配对，适合欧美漫画；开启后第 1 页单独显示，对齐日漫见开页',
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.white.withAlpha(77),
                          ),
                        ),
                      ),
                      _SwitchRow(
                        label: '双页贴合（去除中间缝）',
                        value: _settings.doublePageNoGap,
                        onChanged: (v) => _update(
                            _settings.copyWith(doublePageNoGap: v)),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(top: 2, bottom: 8),
                        child: Text(
                          '开启后两页在屏幕中央贴合拼接，跨页大图观感更佳；关闭则两页各自居中（左右对称留白）',
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.white.withAlpha(77),
                          ),
                        ),
                      ),
                    ],

                    // 阅读方向
                    _SettingLabel('阅读方向'),
                    const SizedBox(height: 6),
                    _ToggleGroup<ReadingDirection>(
                      value: _settings.direction,
                      items: const [
                        _ToggleItem(ReadingDirection.ltr, '左→右'),
                        _ToggleItem(ReadingDirection.rtl, '右→左'),
                        _ToggleItem(ReadingDirection.ttb, '上→下'),
                      ],
                      onChanged: (v) {
                        var s = _settings.copyWith(direction: v);
                        // 上→下 自动切换为长条模式
                        if (v == ReadingDirection.ttb) {
                          s = s.copyWith(mode: ComicReadingMode.webtoon);
                        }
                        _update(s);
                      },
                    ),
                    const SizedBox(height: 16),

                    // ── 行为设置 ──
                    _SectionTitle(icon: Icons.tune, title: '行为'),
                    const SizedBox(height: 8),

                    // 页码指示器
                    _SwitchRow(
                      label: '页码指示器',
                      value: _settings.showPageNumber,
                      onChanged: (v) =>
                          _update(_settings.copyWith(showPageNumber: v)),
                    ),
                    const SizedBox(height: 8),

                    // 自动翻页间隔
                    _SettingLabel('自动翻页间隔 (秒)'),
                    const SizedBox(height: 4),
                    Text(
                      '设为0则禁用，设置后可在工具栏启停',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.white.withAlpha(77),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          child: SliderTheme(
                            data: SliderThemeData(
                              activeTrackColor: Colors.blue[600],
                              thumbColor: Colors.white,
                              overlayColor: Colors.blue.withAlpha(51),
                              inactiveTrackColor: Colors.white12,
                            ),
                            child: Slider(
                              value: _settings.autoPageInterval.toDouble(),
                              min: 0,
                              max: 30,
                              divisions: 30,
                              onChanged: (v) => _update(_settings.copyWith(
                                  autoPageInterval: v.round())),
                            ),
                          ),
                        ),
                        SizedBox(
                          width: 36,
                          child: Text(
                            '${_settings.autoPageInterval}s',
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ── 辅助组件 ──

class _SectionTitle extends StatelessWidget {
  final IconData icon;
  final String title;
  const _SectionTitle({required this.icon, required this.title});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Colors.white54),
        const SizedBox(width: 6),
        Text(
          title,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: Colors.white70,
          ),
        ),
      ],
    );
  }
}

class _SettingLabel extends StatelessWidget {
  final String text;
  const _SettingLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: Colors.white.withAlpha(115),
        letterSpacing: 0.5,
      ),
    );
  }
}

class _ToggleItem<T> {
  final T value;
  final String label;
  const _ToggleItem(this.value, this.label);
}

class _ToggleGroup<T> extends StatelessWidget {
  final T value;
  final List<_ToggleItem<T>> items;
  final ValueChanged<T> onChanged;

  const _ToggleGroup({
    required this.value,
    required this.items,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      children: items.map((item) {
        final selected = value == item.value;
        return GestureDetector(
          onTap: () => onChanged(item.value),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: selected ? Colors.blue[600] : Colors.white.withAlpha(20),
              borderRadius: BorderRadius.circular(8),
              boxShadow: selected
                  ? [
                      BoxShadow(
                        color: Colors.blue.withAlpha(64),
                        blurRadius: 6,
                      )
                    ]
                  : null,
            ),
            child: Text(
              item.label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: selected ? Colors.white : Colors.white54,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _SwitchRow extends StatelessWidget {
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _SwitchRow({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 13,
            color: Colors.white70,
          ),
        ),
        SizedBox(
          height: 24,
          child: Switch(
            value: value,
            onChanged: onChanged,
            activeColor: Colors.blue[600],
            inactiveTrackColor: Colors.white12,
          ),
        ),
      ],
    );
  }
}
