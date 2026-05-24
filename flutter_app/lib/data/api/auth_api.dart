import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

/// 认证 API
class AuthApi {
  final Dio _dio;
  AuthApi(this._dio);

  /// 登录
  Future<Map<String, dynamic>> login(String username, String password) async {
    final res = await _dio.post('/auth/login', data: {
      'username': username,
      'password': password,
    });
    return res.data;
  }

  /// 注册
  Future<Map<String, dynamic>> register(
      String username, String password, String nickname) async {
    final res = await _dio.post('/auth/register', data: {
      'username': username,
      'password': password,
      'nickname': nickname,
    });
    return res.data;
  }

  /// 退出登录
  Future<void> logout() async {
    await _dio.post('/auth/logout');
  }

  /// 获取当前用户信息
  Future<Map<String, dynamic>> me() async {
    final res = await _dio.get('/auth/me');
    return res.data;
  }
}

final authApiProvider = Provider<AuthApi>((ref) {
  return AuthApi(ref.watch(dioProvider));
});
