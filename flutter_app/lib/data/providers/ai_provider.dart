import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/comic_api.dart';
import 'auth_provider.dart';

/// 检查服务端 AI 是否已配置且当前用户具备使用权限（管理员或开启 aiEnabled）。
/// 使用 autoDispose，确保在服务端新配置 AI 后重新进入页面即可生效。
final aiConfiguredProvider = FutureProvider.autoDispose<bool>((ref) async {
  final auth = ref.watch(
    authProvider.select(
      (s) => (
        serverUrl: s.serverUrl,
        userId: s.user?.id ?? '',
        canUseAI: s.user?.canUseAI ?? false,
      ),
    ),
  );
  if (!auth.canUseAI) return false;
  return ref.watch(comicApiProvider).isAIConfigured();
});
