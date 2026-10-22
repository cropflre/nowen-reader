import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/providers/server_route_provider.dart';

class ServerRouteSettings extends ConsumerWidget {
  const ServerRouteSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routes = ref.watch(serverRouteProvider);
    final config = routes.config;
    final colors = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              const Expanded(
                  child: Text('线路与延迟',
                      style: TextStyle(fontWeight: FontWeight.w600))),
              TextButton(
                  onPressed: () => context.push('/server'),
                  child: const Text('编辑地址')),
            ]),
            DropdownButtonFormField<ServerRouteMode>(
              // Keep compatibility with the minimum Flutter 3.32 SDK.
              // ignore: deprecated_member_use
              value: config.mode,
              decoration: const InputDecoration(labelText: '线路模式'),
              items: [
                const DropdownMenuItem(
                    value: ServerRouteMode.automatic,
                    child: Text('自动 · 低延迟优先')),
                const DropdownMenuItem(
                    value: ServerRouteMode.primary, child: Text('仅使用主线路')),
                if (config.backupUrl.isNotEmpty)
                  const DropdownMenuItem(
                      value: ServerRouteMode.backup, child: Text('仅使用备用线路')),
              ],
              onChanged: routes.measuring
                  ? null
                  : (mode) async {
                      if (mode == null || mode == config.mode) return;
                      final notifier = ref.read(serverRouteProvider.notifier);
                      await notifier.configure(ServerRouteConfig(
                          primaryUrl: config.primaryUrl,
                          backupUrl: config.backupUrl,
                          mode: mode));
                      await notifier.refresh();
                    },
            ),
            const SizedBox(height: 12),
            for (final url in config.urls)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(children: [
                  Expanded(
                      child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        if (url == routes.activeUrl) ...[
                          Icon(Icons.check_circle_rounded,
                              size: 18,
                              color: Theme.of(context).brightness ==
                                      Brightness.dark
                                  ? Colors.green.shade400
                                  : Colors.green.shade700,
                              semanticLabel: '当前使用线路'),
                          const SizedBox(width: 6),
                        ],
                        Flexible(
                          child: Text(
                              '${url == config.primaryUrl ? '主线路' : '备用线路'}'
                              '${url == routes.activeUrl ? ' · 当前使用' : ''}',
                              style: TextStyle(
                                  color: url == routes.activeUrl
                                      ? colors.primary
                                      : colors.onSurface)),
                        ),
                      ]),
                      Text(url,
                          style: TextStyle(
                              fontSize: 12, color: colors.onSurfaceVariant)),
                    ],
                  )),
                  const SizedBox(width: 12),
                  Text(routes.measuring
                      ? '测速中…'
                      : !routes.latencies.containsKey(url)
                          ? '未检测'
                          : routes.latencies[url] == null
                              ? '不可达'
                              : '${routes.latencies[url]!.ceil().clamp(1, 999999)} ms'),
                ]),
              ),
            if (config.backupUrl.isNotEmpty) ...[
              const Divider(),
              Text(_verificationText(routes.verification),
                  style: TextStyle(
                      fontSize: 13,
                      color: routes.verification ==
                              ServerRouteVerification.mismatch
                          ? colors.error
                          : colors.onSurfaceVariant)),
              TextButton(
                onPressed: routes.measuring
                    ? null
                    : () => ref
                        .read(serverRouteProvider.notifier)
                        .refresh(verify: true),
                child: const Text('重新验证线路'),
              ),
            ],
            if (routes.measuredAt != null)
              Text(
                  '最近检测：${TimeOfDay.fromDateTime(routes.measuredAt!).format(context)}',
                  style:
                      TextStyle(fontSize: 12, color: colors.onSurfaceVariant)),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: routes.measuring
                    ? null
                    : () => ref.read(serverRouteProvider.notifier).refresh(),
                icon: routes.measuring
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.refresh_rounded),
                label: const Text('重新测速'),
              ),
            ),
            Text(
                '前台每 30 秒检测一次；自动模式优先使用低延迟线路，'
                '延迟接近时保持当前连接。手动模式只测速。响应延迟不代表下载速度。',
                style: TextStyle(fontSize: 12, color: colors.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }

  String _verificationText(ServerRouteVerification verification) =>
      switch (verification) {
        ServerRouteVerification.verified => '已验证：两条线路属于同一服务器',
        ServerRouteVerification.mismatch => '身份不一致：自动模式仅使用主线路，请检查地址',
        ServerRouteVerification.authenticationRequired => '请先登录，再验证两条线路',
        ServerRouteVerification.authenticationFailed => '线路认证失败，请确认地址并重新登录后验证',
        ServerRouteVerification.deferred => '等待两条线路同时可达后验证，当前可用线路可继续使用',
        ServerRouteVerification.unavailable => '验证接口暂时不可用，请检查地址路径和服务器版本',
        _ => '两条线路同时可达且登录后，将自动核对服务器身份',
      };
}
