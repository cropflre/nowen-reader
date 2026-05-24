import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/auth_api.dart';
import '../models/comic.dart';


/// 认证状态
class AuthState {
  final AuthUser? user;
  final String serverUrl;
  final bool isLoading;
  final bool needsSetup;
  final String? error;
  final String registrationMode;

  const AuthState({
    this.user,
    this.serverUrl = '',
    this.isLoading = true,
    this.needsSetup = false,
    this.error,
    this.registrationMode = 'open',
  });

  AuthState copyWith({
    AuthUser? user,
    String? serverUrl,
    bool? isLoading,
    bool? needsSetup,
    String? error,
    String? registrationMode,
    bool clearUser = false,
    bool clearError = false,
  }) {
    return AuthState(
      user: clearUser ? null : (user ?? this.user),
      serverUrl: serverUrl ?? this.serverUrl,
      isLoading: isLoading ?? this.isLoading,
      needsSetup: needsSetup ?? this.needsSetup,
      error: clearError ? null : (error ?? this.error),
      registrationMode: registrationMode ?? this.registrationMode,
    );
  }
}

/// 认证状态管理 Notifier
class AuthNotifier extends StateNotifier<AuthState> {
  final Ref _ref;

  AuthNotifier(this._ref) : super(const AuthState()) {
    _init();
  }

  Future<void> _init() async {
    // 从本地读取服务器地址
    final url = await loadServerUrl();
    if (url.isEmpty) {
      state = state.copyWith(serverUrl: '', isLoading: false);
      return;
    }
    state = state.copyWith(serverUrl: url);
    // 同步服务器地址到 serverUrlProvider，使 ApiClient 能正确设置 baseUrl
    _ref.read(serverUrlProvider.notifier).state = url;
    // 检查登录状态
    await checkAuth();
  }

  /// 设置服务器地址
  Future<bool> setServerUrl(String url) async {
    // 测试连接
    final ok = await testServerConnection(url);
    if (!ok) {
      state = state.copyWith(error: '无法连接到服务器');
      return false;
    }
    await saveServerUrl(url);
    state = state.copyWith(serverUrl: url, clearError: true);
    // 同步服务器地址到 serverUrlProvider
    _ref.read(serverUrlProvider.notifier).state = url;
    await checkAuth();
    return true;
  }

  /// 检查当前认证状态
  Future<void> checkAuth() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final api = _ref.read(authApiProvider);
      final data = await api.me();
      final needsSetup = data['needsSetup'] == true;
      final registrationMode = data['registrationMode'] ?? 'open';
      final userData = data['user'];
      AuthUser? user;
      if (userData != null) {
        user = AuthUser.fromJson(userData);
      }
      state = state.copyWith(
        user: user,
        isLoading: false,
        needsSetup: needsSetup,
        registrationMode: registrationMode.toString(),
        clearUser: userData == null,
      );
    } catch (_) {
      state = state.copyWith(isLoading: false, clearUser: true);
    }
  }

  /// 登录
  Future<bool> login(String username, String password) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      // 登录前清除旧 Cookie，避免旧的过期 session 干扰
      final client = _ref.read(apiClientProvider);
      await client.clearCookies();

      final api = _ref.read(authApiProvider);
      final data = await api.login(username, password);

      // 登录成功后，验证 Cookie 是否已正确存储
      final uri = Uri.parse('${client.baseUrl}/api');
      final cookies = await persistCookieJar.loadForRequest(uri);
      print('[AUTH] After login, cookies for $uri: ${cookies.map((c) => '${c.name}=${c.value.substring(0, c.value.length.clamp(0, 8))}...').toList()}');

      final userData = data['user'];
      if (userData != null) {
        final user = AuthUser.fromJson(userData);
        state = state.copyWith(
          user: user,
          isLoading: false,
        );
        // 保存服务器记录到历史列表
        await saveServerRecord(ServerRecord(
          url: state.serverUrl,
          username: user.username,
          nickname: user.nickname.isNotEmpty ? user.nickname : null,
          lastUsed: DateTime.now(),
        ));
        return true;
      }
      state = state.copyWith(isLoading: false, error: '登录失败');
      return false;
    } catch (e) {
      String msg = '登录失败';
      if (e is DioException && e.response?.data is Map) {
        msg = (e.response!.data as Map)['error'] ?? msg;
      }
      state = state.copyWith(isLoading: false, error: msg);
      return false;
    }
  }

  /// 注册
  Future<bool> register(
      String username, String password, String nickname) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final api = _ref.read(authApiProvider);
      final data = await api.register(username, password, nickname);
      final userData = data['user'];
      if (userData != null) {
        state = state.copyWith(
          user: AuthUser.fromJson(userData),
          isLoading: false,
          needsSetup: false,
        );
        return true;
      }
      state = state.copyWith(isLoading: false, error: '注册失败');
      return false;
    } catch (e) {
      String msg = '注册失败';
      if (e is DioException && e.response?.data is Map) {
        msg = (e.response!.data as Map)['error'] ?? msg;
      }
      state = state.copyWith(isLoading: false, error: msg);
      return false;
    }
  }

  /// 退出登录
  Future<void> logout() async {
    try {
      final api = _ref.read(authApiProvider);
      await api.logout();
    } catch (_) {}
    state = state.copyWith(clearUser: true, isLoading: false);
  }

  /// 清除错误
  void clearError() {
    state = state.copyWith(clearError: true);
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
