import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/auth_api.dart';
import '../models/comic.dart';
import 'server_route_provider.dart';

enum ServerConnectionStatus {
  unknown,
  checking,
  online,
  offline,
  unauthorized,
}

/// 认证状态
class AuthState {
  final AuthUser? user;
  final String serverUrl;
  final bool isLoading;
  final bool needsSetup;
  final String? error;
  final String registrationMode;
  final ServerConnectionStatus connectionStatus;

  const AuthState({
    this.user,
    this.serverUrl = '',
    this.isLoading = true,
    this.needsSetup = false,
    this.error,
    this.registrationMode = 'open',
    this.connectionStatus = ServerConnectionStatus.unknown,
  });

  bool get isOffline => connectionStatus == ServerConnectionStatus.offline;
  bool get isOnline => connectionStatus == ServerConnectionStatus.online;

  AuthState copyWith({
    AuthUser? user,
    String? serverUrl,
    bool? isLoading,
    bool? needsSetup,
    String? error,
    String? registrationMode,
    ServerConnectionStatus? connectionStatus,
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
      connectionStatus: connectionStatus ?? this.connectionStatus,
    );
  }
}

/// 认证状态管理 Notifier
class AuthNotifier extends StateNotifier<AuthState> {
  final Ref _ref;

  AuthNotifier(this._ref) : super(const AuthState()) {
    _ref.listen<String>(serverUrlProvider, (_, url) {
      if (mounted && state.serverUrl != url) {
        state = state.copyWith(serverUrl: url);
      }
    });
    _ref.listen<int>(authInvalidationProvider, (_, __) {
      if (mounted) {
        state = state.copyWith(
            clearUser: true,
            isLoading: false,
            connectionStatus: ServerConnectionStatus.unauthorized);
      }
    });
    _ref.listen<ServerRouteState>(serverRouteProvider, (previous, next) {
      if (mounted &&
          state.isOffline &&
          previous?.measuring == true &&
          !next.measuring &&
          next.latencies[next.activeUrl] != null) {
        unawaited(checkAuth(selectRoute: false));
      }
    });
    _init();
  }

  Future<void> _init() async {
    final url = await loadServerUrl();
    if (url.isEmpty) {
      state = state.copyWith(
        serverUrl: '',
        isLoading: false,
        connectionStatus: ServerConnectionStatus.unknown,
      );
      return;
    }

    state = state.copyWith(
      serverUrl: url,
      isLoading: true,
      connectionStatus: ServerConnectionStatus.checking,
    );
    final config = await loadServerRouteConfig(url);
    if (!mounted) return;
    await _ref.read(serverRouteProvider.notifier).configure(config);
    await checkAuth();
  }

  /// 设置服务器地址。
  ///
  /// 地址格式已经由页面校验，因此先持久化，再检测连通性。即使当前断网，
  /// 用户下次打开 App 时也不会丢失刚输入的服务器地址。
  Future<bool> setServerUrl(
    String url, {
    String? backupUrl,
    ServerRouteMode? mode,
  }) async {
    url = normalizeServerUrl(url);
    final saved = await loadServerRouteConfig(url);
    final backup = normalizeServerUrl(backupUrl ?? saved.backupUrl);
    final config = ServerRouteConfig(
      primaryUrl: url,
      backupUrl: backup == url ? '' : backup,
      mode: backup.isEmpty ? ServerRouteMode.automatic : mode ?? saved.mode,
    );
    final previous = _ref.read(serverRouteProvider).config.primaryUrl;
    if (previous.isNotEmpty && previous != url) {
      await _ref.read(apiClientProvider).clearCookies();
      state = state.copyWith(clearUser: true);
    }
    await saveServerUrl(url);
    state = state.copyWith(
      serverUrl: url,
      isLoading: true,
      connectionStatus: ServerConnectionStatus.checking,
      clearError: true,
    );
    await _ref.read(serverRouteProvider.notifier).configure(config);
    await checkAuth();
    return state.connectionStatus != ServerConnectionStatus.offline;
  }

  /// 检查当前认证状态。
  ///
  /// 只有服务端明确返回 401/403 才视为认证失效；超时、断网、DNS 和
  /// 服务器临时不可达都进入离线状态，不清除 Cookie，也不清除已有用户。
  Future<void> checkAuth({bool selectRoute = true}) async {
    if (state.serverUrl.isEmpty) {
      state = state.copyWith(
        isLoading: false,
        connectionStatus: ServerConnectionStatus.unknown,
      );
      return;
    }

    state = state.copyWith(
      isLoading: true,
      connectionStatus: ServerConnectionStatus.checking,
      clearError: true,
    );

    try {
      if (selectRoute) await _ref.read(serverRouteProvider.notifier).refresh();
      if (!mounted) return;
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
        connectionStatus: ServerConnectionStatus.online,
        clearUser: userData == null,
        clearError: true,
      );
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      if (statusCode == 401 || statusCode == 403) {
        state = state.copyWith(
          isLoading: false,
          connectionStatus: ServerConnectionStatus.unauthorized,
          clearUser: true,
          clearError: true,
        );
      } else {
        state = state.copyWith(
          isLoading: false,
          connectionStatus: ServerConnectionStatus.offline,
          error: '服务器暂时不可达，已切换到离线模式',
        );
      }
    } catch (_) {
      state = state.copyWith(
        isLoading: false,
        connectionStatus: ServerConnectionStatus.offline,
        error: '服务器暂时不可达，已切换到离线模式',
      );
    }
  }

  /// 登录
  Future<bool> login(String username, String password) async {
    final routes = _ref.read(serverRouteProvider.notifier);
    routes.setAuthenticating(true);
    state = state.copyWith(
      isLoading: true,
      connectionStatus: ServerConnectionStatus.checking,
      clearError: true,
    );
    try {
      final client = _ref.read(apiClientProvider);
      await client.clearCookies();

      final api = _ref.read(authApiProvider);
      final data = await api.login(username, password);

      final uri = Uri.parse('${client.baseUrl}/api');
      final cookies = await persistCookieJar.loadForRequest(uri);
      print(
        '[AUTH] After login, cookies for $uri: '
        '${cookies.map((c) => '${c.name}=${c.value.substring(0, c.value.length.clamp(0, 8))}...').toList()}',
      );

      final userData = data['user'];
      if (userData != null) {
        final user = AuthUser.fromJson(userData);
        state = state.copyWith(
          user: user,
          isLoading: false,
          connectionStatus: ServerConnectionStatus.online,
          clearError: true,
        );
        await saveServerRecord(ServerRecord(
          url: _ref.read(serverRouteProvider).config.primaryUrl,
          username: user.username,
          nickname: user.nickname.isNotEmpty ? user.nickname : null,
          lastUsed: DateTime.now(),
        ));
        return true;
      }
      state = state.copyWith(
        isLoading: false,
        connectionStatus: ServerConnectionStatus.online,
        error: '登录失败',
      );
      return false;
    } catch (e) {
      String msg = '登录失败';
      var status = ServerConnectionStatus.online;
      if (e is DioException) {
        if (e.response?.data is Map) {
          msg = (e.response!.data as Map)['error'] ?? msg;
        }
        if (e.response == null) {
          status = ServerConnectionStatus.offline;
          msg = '无法连接到服务器，请检查网络';
        }
      }
      state = state.copyWith(
        isLoading: false,
        connectionStatus: status,
        error: msg,
      );
      return false;
    } finally {
      routes.setAuthenticating(false);
      unawaited(routes.refresh());
    }
  }

  /// 注册
  Future<bool> register(
      String username, String password, String nickname) async {
    final routes = _ref.read(serverRouteProvider.notifier);
    routes.setAuthenticating(true);
    state = state.copyWith(
      isLoading: true,
      connectionStatus: ServerConnectionStatus.checking,
      clearError: true,
    );
    try {
      final api = _ref.read(authApiProvider);
      final data = await api.register(username, password, nickname);
      final userData = data['user'];
      if (userData != null) {
        state = state.copyWith(
          user: AuthUser.fromJson(userData),
          isLoading: false,
          needsSetup: false,
          connectionStatus: ServerConnectionStatus.online,
          clearError: true,
        );
        return true;
      }
      state = state.copyWith(
        isLoading: false,
        connectionStatus: ServerConnectionStatus.online,
        error: '注册失败',
      );
      return false;
    } catch (e) {
      String msg = '注册失败';
      var status = ServerConnectionStatus.online;
      if (e is DioException) {
        if (e.response?.data is Map) {
          msg = (e.response!.data as Map)['error'] ?? msg;
        }
        if (e.response == null) {
          status = ServerConnectionStatus.offline;
          msg = '无法连接到服务器，请检查网络';
        }
      }
      state = state.copyWith(
        isLoading: false,
        connectionStatus: status,
        error: msg,
      );
      return false;
    } finally {
      routes.setAuthenticating(false);
      unawaited(routes.refresh());
    }
  }

  /// 退出登录
  Future<void> logout() async {
    final routes = _ref.read(serverRouteProvider.notifier);
    routes.setAuthenticating(true);
    try {
      final api = _ref.read(authApiProvider);
      await api.logout();
    } catch (_) {}
    await _ref.read(apiClientProvider).clearCookies();
    routes.setAuthenticating(false);
    readerImageLoader.clear();
    state = state.copyWith(clearUser: true, isLoading: false);
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
