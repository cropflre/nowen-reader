import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/api/api_client.dart';
import '../../data/providers/auth_provider.dart';
import '../../data/providers/server_route_provider.dart';

/// 服务器配置页面 —— 首次启动或切换服务器时显示。
class ServerConfigScreen extends ConsumerStatefulWidget {
  const ServerConfigScreen({super.key});

  @override
  ConsumerState<ServerConfigScreen> createState() => _ServerConfigScreenState();
}

class _ServerConfigScreenState extends ConsumerState<ServerConfigScreen> {
  final _urlCtrl = TextEditingController(text: 'http://');
  final _backupCtrl = TextEditingController();
  ServerRouteMode _mode = ServerRouteMode.automatic;
  final _formKey = GlobalKey<FormState>();
  bool _busy = false;
  String? _errorMsg;
  List<ServerRecord> _history = [];

  @override
  void initState() {
    super.initState();
    _loadSavedServers();
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _backupCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadSavedServers() async {
    final results = await Future.wait<dynamic>([
      loadServerUrl(),
      loadServerHistory(),
    ]);
    if (!mounted) return;

    final savedUrl = results[0] as String;
    final history = results[1] as List<ServerRecord>;
    final primary = savedUrl.isNotEmpty
        ? savedUrl
        : history.isNotEmpty
            ? history.first.url
            : '';
    final config = await loadServerRouteConfig(primary);
    if (!mounted) return;
    setState(() {
      _history = history;
      _backupCtrl.text = config.backupUrl;
      _mode = config.mode;
      if (savedUrl.isNotEmpty) {
        _urlCtrl.text = savedUrl;
      } else if (history.isNotEmpty && _urlCtrl.text == 'http://') {
        _urlCtrl.text = history.first.url;
      }
    });
  }

  String _normalizeUrl(String raw) {
    return normalizeServerUrl(raw);
  }

  String? _validateUrl(String? value) {
    return validateServerUrl(value ?? '');
  }

  Future<void> _connect() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    HapticFeedback.lightImpact();
    final url = _normalizeUrl(_urlCtrl.text);
    setState(() {
      _busy = true;
      _errorMsg = null;
    });

    try {
      final connected = await ref
          .read(authProvider.notifier)
          .setServerUrl(url, backupUrl: _backupCtrl.text, mode: _mode);
      if (!mounted) return;

      if (connected) {
        if (ref.read(authProvider).user == null) {
          context.go('/login');
        } else if (context.canPop()) {
          context.pop();
        } else {
          context.go('/');
        }
      } else {
        final error = ref.read(authProvider).error;
        setState(() {
          _errorMsg = error ?? '服务器暂时不可达，地址已保存，可进入离线缓存';
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _errorMsg = '连接失败：$error\n服务器地址已保留';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeHistory(String url) async {
    await removeServerRecord(url);
    await _loadSavedServers();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final auth = ref.watch(authProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('服务器设置'),
        actions: [
          if (auth.isOffline)
            TextButton.icon(
              onPressed: () => context.go('/cache'),
              icon: const Icon(Icons.cloud_off_rounded),
              label: const Text('离线书架'),
            ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: 24,
              vertical: 32,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(
                      Icons.dns_rounded,
                      size: 64,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      '连接到 Nowen Reader',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '填写同一服务器的内网和公网地址，自动使用延迟更低的线路。'
                      '也可以只填写一个地址。配置会保存在本机。',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _urlCtrl,
                      enabled: !_busy,
                      autocorrect: false,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.go,
                      validator: _validateUrl,
                      onFieldSubmitted: (_) => _connect(),
                      decoration: const InputDecoration(
                        labelText: '主线路地址',
                        hintText: 'http://192.168.1.100:3000',
                        prefixIcon: Icon(Icons.link_rounded),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _backupCtrl,
                      enabled: !_busy,
                      autocorrect: false,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.go,
                      onFieldSubmitted: (_) => _connect(),
                      validator: (value) {
                        final error =
                            validateServerUrl(value ?? '', optional: true);
                        if (error != null) return error;
                        if ((value ?? '').trim().isNotEmpty &&
                            _normalizeUrl(value!) ==
                                _normalizeUrl(_urlCtrl.text)) {
                          return '备用线路不能与主线路相同';
                        }
                        return null;
                      },
                      decoration: const InputDecoration(
                        labelText: '备用线路地址（可选）',
                        hintText: 'https://reader.example.com',
                        prefixIcon: Icon(Icons.alt_route_rounded),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<ServerRouteMode>(
                      // Flutter 3.32 does not have initialValue yet.
                      // ignore: deprecated_member_use
                      value: _mode,
                      decoration: const InputDecoration(
                          labelText: '线路模式', border: OutlineInputBorder()),
                      items: const [
                        DropdownMenuItem(
                            value: ServerRouteMode.automatic,
                            child: Text('自动 · 低延迟优先')),
                        DropdownMenuItem(
                            value: ServerRouteMode.primary,
                            child: Text('仅使用主线路')),
                        DropdownMenuItem(
                            value: ServerRouteMode.backup,
                            child: Text('仅使用备用线路')),
                      ],
                      validator: (mode) => mode == ServerRouteMode.backup &&
                              _backupCtrl.text.trim().isEmpty
                          ? '请先填写备用线路地址'
                          : null,
                      onChanged: _busy
                          ? null
                          : (mode) => setState(
                              () => _mode = mode ?? ServerRouteMode.automatic),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      '首次验证需要两条线路同时可达并登录。验证成功后保留结果；'
                      '在外网暂时无法访问内网时，仍可使用公网线路。',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                    if (_errorMsg != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.cloud_off_rounded,
                              color: theme.colorScheme.onErrorContainer,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _errorMsg!,
                                style: TextStyle(
                                  color: theme.colorScheme.onErrorContainer,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: _busy ? null : _connect,
                      icon: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(Icons.login_rounded),
                      label: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Text(_busy ? '正在连接…' : '连接服务器'),
                      ),
                    ),
                    if (auth.isOffline) ...[
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () => context.go('/cache'),
                        icon: const Icon(Icons.menu_book_rounded),
                        label: const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Text('服务器不可达，进入离线书架'),
                        ),
                      ),
                    ],
                    if (_history.isNotEmpty) ...[
                      const SizedBox(height: 32),
                      Text(
                        '最近使用',
                        style: theme.textTheme.titleSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ..._history.map(
                        (record) => Card(
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          child: ListTile(
                            leading: const Icon(Icons.history_rounded),
                            title: Text(
                              record.url,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: record.username != null
                                ? Text(
                                    '用户：'
                                    '${record.nickname ?? record.username}',
                                  )
                                : null,
                            trailing: IconButton(
                              icon: const Icon(Icons.close_rounded),
                              tooltip: '从历史中移除',
                              onPressed: _busy
                                  ? null
                                  : () => _removeHistory(record.url),
                            ),
                            onTap: _busy
                                ? null
                                : () async {
                                    final config =
                                        await loadServerRouteConfig(record.url);
                                    if (!mounted) return;
                                    setState(() {
                                      _urlCtrl.text = record.url;
                                      _backupCtrl.text = config.backupUrl;
                                      _mode = config.mode;
                                      _errorMsg = null;
                                    });
                                  },
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
