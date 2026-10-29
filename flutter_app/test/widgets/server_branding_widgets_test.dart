import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/data/api/api_client.dart';
import 'package:nowen_reader/data/models/server_branding.dart';
import 'package:nowen_reader/data/providers/server_branding_provider.dart';
import 'package:nowen_reader/data/services/server_branding_service.dart';
import 'package:nowen_reader/features/auth/login_screen.dart';
import 'package:nowen_reader/features/settings/server_settings_screen.dart';
import 'package:nowen_reader/l10n/app_localizations.dart';
import 'package:nowen_reader/widgets/server_logo.dart';
import 'package:shared_preferences/shared_preferences.dart';

final png = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQyDvxHwAEfgJe2Svy2gAAAABJRU5ErkJggg==');

class _CachedBranding extends ServerBrandingService {
  @override
  Future<ServerBranding?> readCached(String key) async =>
      ServerBranding(name: key.contains('first') ? '第一间书房' : '第二间书房');
}

void main() {
  late Directory cookies;
  setUpAll(() async {
    cookies = await Directory.systemTemp.createTemp('nowen-branding-widgets-');
    persistCookieJar = PersistCookieJar(storage: FileStorage(cookies.path));
  });
  tearDownAll(() => cookies.delete(recursive: true));
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'login shows public server identity and updates without logging in',
      (tester) async {
    final branding = StateProvider<ServerBranding>(
        (ref) => const ServerBranding(name: '私人图书馆'));
    final container = ProviderContainer(overrides: [
      currentServerBrandingProvider.overrideWith((ref) => ref.watch(branding)),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: LoginScreen()),
    ));
    await tester.pump(const Duration(milliseconds: 1400));
    expect(find.text('私人图书馆'), findsOneWidget);
    expect(find.byType(ServerLogo), findsOneWidget);
    container.read(branding.notifier).state = const ServerBranding(name: '新名称');
    await tester.pump();
    expect(find.text('新名称'), findsOneWidget);
    expect(find.text('私人图书馆'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('long login names fit a narrow screen with larger text',
      (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        currentServerBrandingProvider.overrideWithValue(
            const ServerBranding(name: '这是一个非常长的私人图书馆服务器名称测试'))
      ],
      child: MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: const TextScaler.linear(2)),
          child: child!,
        ),
        home: const LoginScreen(),
      ),
    ));
    await tester.pump(const Duration(milliseconds: 1400));
    expect(find.text('这是一个非常长的私人图书馆服务器名称测试'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('undecodable logo renders the default icon', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Center(
          child: ServerLogo(
        branding: ServerBranding(
            name: '书房', iconBytes: Uint8List.fromList([1, 2, 3])),
      )),
    ));
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pump();
    expect(find.byIcon(Icons.auto_stories_rounded), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('valid cached logo displays without another network request',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Center(
          child: ServerLogo(
        branding: ServerBranding(name: '离线书房', iconBytes: png),
      )),
    ));
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pump();
    expect(find.byType(Image), findsOneWidget);
    expect(find.byIcon(Icons.auto_stories_rounded), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('server history shows isolated cached names alongside addresses',
      (tester) async {
    await saveServerRecord(ServerRecord(
        url: 'https://first.example/reader', lastUsed: DateTime.now()));
    await saveServerRecord(ServerRecord(
        url: 'https://second.example/reader', lastUsed: DateTime.now()));
    await tester.pumpWidget(ProviderScope(
      overrides: [
        serverBrandingTargetProvider
            .overrideWithValue(const ServerBrandingTarget()),
        serverBrandingServiceProvider.overrideWith((ref) {
          final service = _CachedBranding();
          ref.onDispose(service.dispose);
          return service;
        }),
      ],
      child: const MaterialApp(
        localizationsDelegates: [AppLocalizations.delegate],
        home: ServerSettingsScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('服务器列表'));
    await tester.pumpAndSettle();
    expect(find.text('第一间书房'), findsOneWidget);
    expect(find.text('第二间书房'), findsOneWidget);
    expect(find.text('https://first.example/reader'), findsOneWidget);
    expect(find.text('https://second.example/reader'), findsOneWidget);
    expect(find.byType(ServerLogo), findsNWidgets(3));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}
