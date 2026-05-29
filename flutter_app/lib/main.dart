import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'data/api/api_client.dart';
import 'data/services/cache_service.dart';

void main() async {
  // ============================================================
  // 全局异常处理
  // ============================================================

  // 捕获 Flutter 框架内的错误（Widget 构建、布局、绘制等）
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    _reportError(details.exception, details.stack);
  };

  // 捕获未被 Flutter 框架捕获的异步错误
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    _reportError(error, stack);
    return true; // 返回 true 表示已处理，不再传播
  };

  // 在 Zone 中运行应用以捕获所有未处理的异步错误
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();

      // 初始化持久化 CookieJar（登录状态保持）
      await initCookieJar();

      // 初始化离线缓存服务
      await cacheService.init();

      // 适配安卓15 edge-to-edge
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarDividerColor: Colors.transparent,
      ));

      runApp(const ProviderScope(child: NowenReaderApp()));
    },
    (Object error, StackTrace stack) {
      _reportError(error, stack);
    },
  );
}

/// 统一错误上报处理
/// 当前以日志输出为主，后续可接入 Sentry / Firebase Crashlytics 等服务
void _reportError(Object error, StackTrace? stack) {
  if (kDebugMode) {
    // Debug 模式下打印详细错误信息
    debugPrint('══════════════════════════════════════');
    debugPrint('🚨 UNCAUGHT ERROR');
    debugPrint('Error: $error');
    if (stack != null) {
      debugPrint('Stack trace:\n$stack');
    }
    debugPrint('══════════════════════════════════════');
  } else {
    // Release 模式下静默记录，可替换为远程上报
    // TODO: 接入 Sentry / Firebase Crashlytics
    // Sentry.captureException(error, stackTrace: stack);
    debugPrint('[CrashReport] $error');
  }
}
