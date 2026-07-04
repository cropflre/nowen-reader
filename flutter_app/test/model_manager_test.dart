import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/services/model_manager.dart';

// 注意: 完整测试需要 mock Dio Client。
// 此处仅验证数据类型解析逻辑（纯 dart 无平台依赖）。
void main() {
  group('UpscaleModelManifest', () {
    test('parses valid JSON manifest', () {
      final json = {
        'models': {
          'realesrgan-anime': {
            'name': 'Real-ESRGAN Anime',
            'x2': {
              'downloadUrl': 'https://cdn.example.com/x2.onnx',
              'md5': 'abc123',
            },
            'x4': {
              'downloadUrl': 'https://cdn.example.com/x4.onnx',
              'md5': 'def456',
            },
          },
        },
      };

      final manifest = UpscaleModelManifest.fromJson(json);
      expect(manifest.models.length, 1);
      expect(manifest.models[0].id, 'realesrgan-anime');
      expect(manifest.models[0].x2?.md5, 'abc123');
      expect(manifest.models[0].x4?.md5, 'def456');
    });

    test('getModel returns null for unknown id', () {
      final manifest = UpscaleModelManifest(models: []);
      expect(manifest.getModel('nonexistent'), isNull);
    });

    test('entryForScale returns correct entry', () {
      final model = UpscaleModelInfo(
        id: 'test',
        name: 'Test',
        x2: UpscaleModelEntry(downloadUrl: 'url2', md5: 'md5_2'),
        x4: UpscaleModelEntry(downloadUrl: 'url4', md5: 'md5_4'),
      );
      expect(model.entryForScale(2)?.md5, 'md5_2');
      expect(model.entryForScale(4)?.md5, 'md5_4');
      expect(model.entryForScale(3), isNull);
    });
  });
}
