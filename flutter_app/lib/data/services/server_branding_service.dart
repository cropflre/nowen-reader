import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path_provider/path_provider.dart';

import '../models/server_branding.dart';

/// Branding endpoints are public. A separate client keeps failures here from
/// invalidating authentication or delaying the server connection flow.
class ServerBrandingService {
  final Dio _dio;
  final Future<Directory> Function() _supportDirectory;
  final Map<String, Future<void>> _writes = {};

  ServerBrandingService({
    Dio? dio,
    Future<Directory> Function()? supportDirectory,
  })  : _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: const Duration(seconds: 5),
              receiveTimeout: const Duration(seconds: 10),
            )),
        _supportDirectory = supportDirectory ?? getApplicationSupportDirectory;

  Future<Map<String, dynamic>> fetchSettings(
    String baseUrl,
    CancelToken cancelToken,
  ) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '$baseUrl/api/site-settings',
      cancelToken: cancelToken,
      options: Options(headers: {'Cache-Control': 'no-cache'}),
    );
    if (response.data == null) {
      throw const FormatException('Empty site settings');
    }
    return response.data!;
  }

  Future<Uint8List?> fetchIcon(
    String baseUrl,
    String version,
    CancelToken cancelToken,
  ) async {
    try {
      final response = await _dio.get<List<int>>(
        '$baseUrl/api/site-settings/icon',
        queryParameters: {'v': version},
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.bytes,
          headers: {'Cache-Control': 'no-cache'},
        ),
      );
      final data = response.data;
      if (data == null || data.isEmpty || data.length > 2 * 1024 * 1024) {
        return null;
      }
      final bytes = Uint8List.fromList(data);
      // Reject invalid images so callers can display the default logo.
      try {
        final codec = await ui.instantiateImageCodec(bytes);
        try {
          final frame = await codec.getNextFrame();
          frame.image.dispose();
        } finally {
          codec.dispose();
        }
      } catch (_) {
        return null;
      }
      return bytes;
    } on DioException catch (error) {
      if (error.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<Directory> _directory(String key) async {
    final root = await _supportDirectory();
    final digest = sha256.convert(utf8.encode(key));
    return Directory('${root.path}/server-branding-v1/$digest');
  }

  Future<ServerBranding?> readCached(String key) async {
    if (key.isEmpty || kIsWeb) return null;
    try {
      await _writes[key];
      final directory = await _directory(key);
      final json = jsonDecode(
          await File('${directory.path}/metadata.json').readAsString()) as Map;
      Uint8List? icon;
      if (json['hasIcon'] == true) {
        try {
          icon = await File('${directory.path}/icon.bin').readAsBytes();
        } catch (_) {
          // A missing logo must not discard the cached name.
        }
      }
      return ServerBranding(
        name: ServerBranding.normalizeName(json['name']),
        iconBytes: icon,
        fetchedAt: DateTime.tryParse(json['fetchedAt'] as String? ?? ''),
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> writeCached(String key, ServerBranding branding) {
    if (key.isEmpty || kIsWeb) return Future.value();
    final previous = _writes[key] ?? Future<void>.value();
    final write = previous.then((_) async {
      try {
        final directory = await _directory(key);
        await directory.create(recursive: true);
        final icon = File('${directory.path}/icon.bin');
        if (branding.iconBytes != null) {
          final temporary = File('${icon.path}.tmp');
          await temporary.writeAsBytes(branding.iconBytes!, flush: true);
          await temporary.rename(icon.path);
        } else if (await icon.exists()) {
          await icon.delete();
        }
        final metadata = File('${directory.path}/metadata.json.tmp');
        await metadata.writeAsString(
            jsonEncode({
              'name': branding.name,
              'hasIcon': branding.iconBytes != null,
              'fetchedAt': branding.fetchedAt?.toIso8601String(),
            }),
            flush: true);
        await metadata.rename('${directory.path}/metadata.json');
      } catch (_) {
        // Local storage failure only disables caching, not the live branding.
      }
    });
    _writes[key] = write;
    return write;
  }

  void dispose() => _dio.close(force: true);
}
