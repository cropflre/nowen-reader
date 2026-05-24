import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ============================================================
// 常量 & 全局变量
// ============================================================

const String _kServerUrlKey = 'server_url';
const String _kServerHistoryKey = 'server_history';

/// 全局持久化 CookieJar（登录状态保持）
late final PersistCookieJar persistCookieJar;

/// 初始化持久化 CookieJar（在 main 中调用）
Future<void> initCookieJar() async {
  if (kIsWeb) {
    // Web 环境下不需要持久化 Cookie
    persistCookieJar = PersistCookieJar();
  } else {
    final dir = await getApplicationDocumentsDirectory();
    persistCookieJar =
        PersistCookieJar(storage: FileStorage('${dir.path}/.cookies/'));
  }
}

// ============================================================
// API 客户端
// ============================================================

/// 全局回调：当收到 401 时通知上层清除登录状态
/// 由 apiClientProvider 在创建时注入
typedef OnUnauthorizedCallback = void Function();

/// NowenReader API 客户端
/// 封装 Dio HTTP 客户端，管理 Cookie Session 认证
class ApiClient {
  late final Dio _dio;
  late final PersistCookieJar _cookieJar;
  String _baseUrl = '';
  OnUnauthorizedCallback? onUnauthorized;

  ApiClient({this.onUnauthorized}) {
    _cookieJar = persistCookieJar;
    _dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 30),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));
    // Web 环境下浏览器自动管理 Cookie，不需要 CookieManager
    if (!kIsWeb) {
      _dio.interceptors.add(CookieManager(_cookieJar));
    }
    _dio.interceptors.add(_LogInterceptor());
    _dio.interceptors.add(_AuthInterceptor(this));
  }

  String get baseUrl => _baseUrl;
  String get serverUrl => _baseUrl;

  /// 设置服务器地址
  void setBaseUrl(String url) {
    _baseUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
    _dio.options.baseUrl = '$_baseUrl/api';
  }

  /// 清除所有 Cookie（退出登录时调用）
  Future<void> clearCookies() async {
    await _cookieJar.deleteAll();
  }

  // ============================================================
  // 通用请求方法
  // ============================================================

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return _dio.get<T>(path, queryParameters: queryParameters, options: options);
  }

  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return _dio.post<T>(path,
        data: data, queryParameters: queryParameters, options: options);
  }

  Future<Response<T>> put<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return _dio.put<T>(path,
        data: data, queryParameters: queryParameters, options: options);
  }

  Future<Response<T>> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return _dio.delete<T>(path,
        data: data, queryParameters: queryParameters, options: options);
  }

  // ============================================================
  // 图片 URL 生成（用于 CachedNetworkImage）
  // ============================================================

  /// 获取漫画缩略图 URL
  String thumbnailUrl(String comicId) {
    return '$_baseUrl/api/comics/$comicId/thumbnail';
  }

  /// 获取漫画单页图片 URL
  String pageImageUrl(String comicId, int pageIndex) {
    return '$_baseUrl/api/comics/$comicId/page/$pageIndex';
  }

  /// 获取 PDF 文件 URL
  String pdfUrl(String comicId) {
    return '$_baseUrl/api/comics/$comicId/pdf';
  }

  /// 获取 EPUB 资源 URL
  String epubResourceUrl(String comicId, String resourcePath) {
    return '$_baseUrl/api/comics/$comicId/epub-resource/$resourcePath';
  }

  /// 获取 Dio 实例（用于高级场景）
  Dio get dio => _dio;

  /// 获取 CookieJar
  PersistCookieJar get cookieJar => _cookieJar;
}

/// 日志拦截器
class _LogInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final cookie = options.headers['cookie'] ?? options.headers['Cookie'] ?? '';
    print('[API] ${options.method} ${options.uri} [Cookie: ${cookie.toString().isNotEmpty ? cookie.toString().substring(0, cookie.toString().length.clamp(0, 60)) : "(none)"}]');
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    final path = response.requestOptions.path;
    // 打印响应状态码
    print('[API] Response $path ${response.statusCode}');
    // 打印所有响应头（调试认证问题）
    if (path.contains('/auth/login') || path.contains('/auth/register')) {
      print('[API] Response headers: ${response.headers.map}');
      final bodyStr = response.data?.toString() ?? '';
      print('[API] Response body: ${bodyStr.substring(0, bodyStr.length.clamp(0, 200))}');
    }
    // 打印 Set-Cookie 头
    final setCookie = response.headers['set-cookie'];
    if (setCookie != null && setCookie.isNotEmpty) {
      for (final c in setCookie) {
        print('[API] Set-Cookie: ${c.substring(0, c.length.clamp(0, 120))}');
      }
    } else {
      if (path.contains('/auth/login') || path.contains('/auth/register')) {
        print('[API] WARNING: No Set-Cookie header in login/register response!');
      }
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    print('[API] ERROR ${err.response?.statusCode} ${err.requestOptions.uri}: ${err.message}');
    // 打印错误响应的 headers 和 body（调试 401）
    if (err.response?.statusCode == 401) {
      print('[API] 401 Response headers: ${err.response?.headers.map}');
      final bodyStr = err.response?.data?.toString() ?? '';
      print('[API] 401 Response body: ${bodyStr.substring(0, bodyStr.length.clamp(0, 200))}');
    }
    handler.next(err);
  }
}

/// 401 认证失败拦截器
/// 当收到 401 响应时，自动清除登录状态，触发路由守卫跳转到登录页
class _AuthInterceptor extends Interceptor {
  final ApiClient _client;
  bool _isHandling401 = false;

  _AuthInterceptor(this._client);

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response?.statusCode == 401 && !_isHandling401) {
      _isHandling401 = true;
      // 排除登录/注册/健康检查等不需要认证的接口
      final path = err.requestOptions.path;
      if (!path.contains('/auth/login') &&
          !path.contains('/auth/register') &&
          !path.contains('/auth/me') &&
          !path.contains('/health')) {
        print('[API] Session expired or invalid, triggering re-login...');
        _client.onUnauthorized?.call();
      }
      // 延迟重置标志，避免短时间内多次触发
      Future.delayed(const Duration(seconds: 2), () {
        _isHandling401 = false;
      });
    }
    handler.next(err);
  }
}

// ============================================================
// Providers
// ============================================================

/// 全局 ApiClient Provider
final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    onUnauthorized: () {
      // 清除登录状态，路由守卫会自动跳转到登录页
      // 使用 Future.microtask 避免在 build 阶段修改 state
      Future.microtask(() {
        try {
          // 动态导入会导致循环依赖，所以这里通过 ref 间接访问
          // authProvider 在 auth_provider.dart 中定义
          // 这里只清除 cookie，让 checkAuth 自然失败
          persistCookieJar.deleteAll();
          // 通知 serverUrlProvider 触发重建（间接触发 authProvider 重新检查）
          final url = ref.read(serverUrlProvider);
          ref.read(serverUrlProvider.notifier).state = '';
          Future.delayed(const Duration(milliseconds: 100), () {
            ref.read(serverUrlProvider.notifier).state = url;
          });
        } catch (_) {}
      });
    },
  );
  final serverUrl = ref.watch(serverUrlProvider);
  if (serverUrl.isNotEmpty) {
    client.setBaseUrl(serverUrl);
  }
  return client;
});

/// 服务器地址 Provider
final serverUrlProvider = StateProvider<String>((ref) => '');

/// Dio Provider — 供各 API 模块使用
final dioProvider = Provider<Dio>((ref) {
  final client = ref.watch(apiClientProvider);
  return client.dio;
});

// ============================================================
// 工具函数
// ============================================================

/// 获取指定 URL 对应的 Cookie 请求头
/// 用于 CachedNetworkImage 等独立 HTTP 客户端携带认证信息
Future<Map<String, String>> getCookieHeaders(String url) async {
  try {
    final uri = Uri.parse(url);
    final cookies = await persistCookieJar.loadForRequest(uri);
    if (cookies.isNotEmpty) {
      final cookieStr = cookies.map((c) => '${c.name}=${c.value}').join('; ');
      return {'Cookie': cookieStr};
    }
  } catch (_) {}
  return {};
}

/// 从 SharedPreferences 读取保存的服务器地址
Future<String> loadServerUrl() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString(_kServerUrlKey) ?? '';
}

/// 保存服务器地址到 SharedPreferences
Future<void> saveServerUrl(String url) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_kServerUrlKey, url);
}

/// 测试服务器连接
Future<bool> testServerConnection(String url) async {
  try {
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 5),
      receiveTimeout: const Duration(seconds: 5),
    ));
    final res = await dio.get('$url/api/health');
    return res.statusCode == 200;
  } catch (_) {
    return false;
  }
}

/// 获取完整的图片 URL
String getImageUrl(String serverUrl, String comicId,
    {int? page, bool thumbnail = false}) {
  if (thumbnail) {
    return '$serverUrl/api/comics/$comicId/thumbnail';
  }
  return '$serverUrl/api/comics/$comicId/page/$page';
}

// ============================================================
// 服务器历史记录
// ============================================================

/// 服务器历史记录条目
class ServerRecord {
  final String url;
  final String? username;
  final String? nickname;
  final DateTime lastUsed;

  ServerRecord({
    required this.url,
    this.username,
    this.nickname,
    required this.lastUsed,
  });

  Map<String, dynamic> toJson() => {
        'url': url,
        'username': username,
        'nickname': nickname,
        'lastUsed': lastUsed.toIso8601String(),
      };

  factory ServerRecord.fromJson(Map<String, dynamic> json) => ServerRecord(
        url: json['url'] as String,
        username: json['username'] as String?,
        nickname: json['nickname'] as String?,
        lastUsed: DateTime.parse(json['lastUsed'] as String),
      );
}

/// 加载服务器历史列表
Future<List<ServerRecord>> loadServerHistory() async {
  final prefs = await SharedPreferences.getInstance();
  final raw = prefs.getString(_kServerHistoryKey);
  if (raw == null || raw.isEmpty) return [];
  try {
    final list = jsonDecode(raw) as List;
    return list.map((e) => ServerRecord.fromJson(e as Map<String, dynamic>)).toList();
  } catch (_) {
    return [];
  }
}

/// 保存/更新服务器历史记录
Future<void> saveServerRecord(ServerRecord record) async {
  final prefs = await SharedPreferences.getInstance();
  final history = await loadServerHistory();
  // 移除同 URL 的旧记录
  history.removeWhere((r) => r.url == record.url);
  // 插入到最前面
  history.insert(0, record);
  // 最多保留 10 条
  if (history.length > 10) {
    history.removeRange(10, history.length);
  }
  final json = jsonEncode(history.map((e) => e.toJson()).toList());
  await prefs.setString(_kServerHistoryKey, json);
}

/// 删除服务器历史记录
Future<void> removeServerRecord(String url) async {
  final prefs = await SharedPreferences.getInstance();
  final history = await loadServerHistory();
  history.removeWhere((r) => r.url == url);
  final json = jsonEncode(history.map((e) => e.toJson()).toList());
  await prefs.setString(_kServerHistoryKey, json);
}
