import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_client.dart';
import '../../data/providers/auth_provider.dart';

/// 服务器配置页面 —— 首次启动 / 退出登录后切换服务器时显示。
///
/// 触发条件参见 `lib/app/router.dart` 中的 redirect 逻辑：
/// 当 `authState.serverUrl` 为空时会被强制路由到这里。
class ServerConfigScreen extends ConsumerStatefulWidget {
  const ServerConfigScreen({super.key});

  @override
  ConsumerState<ServerConfigScreen> createState() => _ServerConfigScreenState();
}

class _ServerConfigScreenState extends ConsumerState<ServerConfigScreen> {
  final _urlCtrl = TextEditingController(text: 'http://');
  final _formKey = GlobalKey<FormState>();
  bool _busy = false;
  String? _errorMsg;
  List<ServerRecord> _history = [];

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    final history = await loadServerHistory();
    if (!mounted) return;
    setState(() {
      _history = history;
      // 若有历史记录，自动填入最近一次的地址，省得用户再输
      if (history.isNotEmpty && _urlCtrl.text == 'http://') {
        _urlCtrl.text = history.first.url;
      }
    });
  }

  String _normalizeUrl(String raw) {
    var url = raw.trim();
    // 去尾部斜杠
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }

  String? _validateUrl(String? value) {
    final v = (value ?? '').trim();
    if (v.isEmpty) return '请输入服务器地址';
    if (!v.startsWith('http://') && !v.startsWith('https://')) {
      return '地址必须以 http:// 或 https:// 开头';
    }
    final uri = Uri.tryParse(v);
    if (uri == null || uri.host.isEmpty) return '地址格式不正确';
    return null;
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
      final ok = await ref.read(authProvider.notifier).setServerUrl(url);
      if (!mounted) return;
      if (!ok) {
        final err = ref.read(authProvider).error;
        setState(() => _errorMsg = err ?? '无法连接到服务器，请检查地址或网络');
        return;
      }
      // 成功后 GoRouter 的 redirect 会根据登录状态自动跳到 /login 或 /
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorMsg = '连接失败：$e');
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _removeHistory(String url) async {
    await removeServerRecord(url);
    await _loadHistory();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.dns_rounded,
                        size: 64, color: theme.colorScheme.primary),
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
                      '请输入你的服务器地址，例如 http://192.168.1.100:3000',
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
                        labelText: '服务器地址',
                        hintText: 'http://host:port',
                        prefixIcon: Icon(Icons.link),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    if (_errorMsg != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.error_outline,
                                color: theme.colorScheme.onErrorContainer,
                                size: 20),
                            const SizedBox(width: 8),
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
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.login),
                      label: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Text(_busy ? '正在连接…' : '连接服务器'),
                      ),
                    ),
                    if (_history.isNotEmpty) ...[
                      const SizedBox(height: 32),
                      Row(
                        children: [
                          Text(
                            '最近使用',
                            style: theme.textTheme.titleSmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ..._history.map((rec) => Card(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            child: ListTile(
                              leading: const Icon(Icons.history),
                              title: Text(
                                rec.url,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: rec.username != null
                                  ? Text('用户：${rec.nickname ?? rec.username}')
                                  : null,
                              trailing: IconButton(
                                icon: const Icon(Icons.close),
                                tooltip: '从历史中移除',
                                onPressed: _busy
                                    ? null
                                    : () => _removeHistory(rec.url),
                              ),
                              onTap: _busy
                                  ? null
                                  : () {
                                      setState(() {
                                        _urlCtrl.text = rec.url;
                                        _errorMsg = null;
                                      });
                                    },
                            ),
                          )),
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
