import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter_test/flutter_test.dart';
import 'package:nowen_reader/services/upscale_processor.dart';

void main() {
  group('UpscaleProcessor', () {
    // ─────────────────────────────────────────────
    // pixelsToNchwFloat
    // ─────────────────────────────────────────────
    group('pixelsToNchwFloat', () {
      test('produces correct tensor shape for 2x2 image', () {
        final rgba = Uint8List.fromList([
          255, 0, 0, 255, 0, 255, 0, 255, //
          0, 0, 255, 255, 255, 255, 255, 255, //
        ]);

        final tensor = UpscaleProcessor.pixelsToNchwFloat(rgba, 2, 2);
        expect(tensor.length, 12); // 3 channels * 2 * 2
      });

      test('normalizes R channel values correctly', () {
        // 2x2 image: R varies from 0 to 255
        final rgba = Uint8List.fromList([
          0, 0, 0, 255, 128, 0, 0, 255, //
          255, 0, 0, 255, 64, 0, 0, 255, //
        ]);

        final tensor = UpscaleProcessor.pixelsToNchwFloat(rgba, 2, 2);
        // R channel (first 4 values)
        expect(tensor[0], closeTo(0.0, 1e-6)); // 0/255
        expect(tensor[1], closeTo(128.0 / 255.0, 1e-6));
        expect(tensor[2], closeTo(1.0, 1e-6)); // 255/255
        expect(tensor[3], closeTo(64.0 / 255.0, 1e-6));
      });

      test('ignores alpha channel', () {
        // Same RGB with different alpha values — should produce identical tensor
        final rgba1 = Uint8List.fromList([
          255, 0, 0, 0, 0, 255, 0, 128, //
          0, 0, 255, 255, 128, 128, 128, 0, //
        ]);
        final rgba2 = Uint8List.fromList([
          255, 0, 0, 255, 0, 255, 0, 0, //
          0, 0, 255, 128, 128, 128, 128, 255, //
        ]);

        final t1 = UpscaleProcessor.pixelsToNchwFloat(rgba1, 2, 2);
        final t2 = UpscaleProcessor.pixelsToNchwFloat(rgba2, 2, 2);
        expect(t1, t2);
      });

      test('handles 1x1 image', () {
        final rgba = Uint8List.fromList([100, 150, 200, 255]);
        final tensor = UpscaleProcessor.pixelsToNchwFloat(rgba, 1, 1);
        expect(tensor.length, 3);
        expect(tensor[0], closeTo(100.0 / 255.0, 1e-6));
        expect(tensor[1], closeTo(150.0 / 255.0, 1e-6));
        expect(tensor[2], closeTo(200.0 / 255.0, 1e-6));
      });

      test('NCHW layout: R,G,B channels are in order', () {
        // Pure red, pure green, pure blue
        final rgba = Uint8List.fromList([
          255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
        ]);
        final h = 3;
        final w = 1;
        final tensor = UpscaleProcessor.pixelsToNchwFloat(rgba, w, h);
        final count = w * h;

        // All R values in first count elements
        expect(tensor[0 * count + 0], closeTo(1.0, 1e-6)); // pixel 0 R
        expect(tensor[0 * count + 1], closeTo(0.0, 1e-6)); // pixel 1 R
        expect(tensor[0 * count + 2], closeTo(0.0, 1e-6)); // pixel 2 R

        // All G values in second count elements
        expect(tensor[1 * count + 0], closeTo(0.0, 1e-6)); // pixel 0 G
        expect(tensor[1 * count + 1], closeTo(1.0, 1e-6)); // pixel 1 G
        expect(tensor[1 * count + 2], closeTo(0.0, 1e-6)); // pixel 2 G

        // All B values in third count elements
        expect(tensor[2 * count + 0], closeTo(0.0, 1e-6)); // pixel 0 B
        expect(tensor[2 * count + 1], closeTo(0.0, 1e-6)); // pixel 1 B
        expect(tensor[2 * count + 2], closeTo(1.0, 1e-6)); // pixel 2 B
      });
    });

    // ─────────────────────────────────────────────
    // nchwFloatToRgba
    // ─────────────────────────────────────────────
    group('nchwFloatToRgba', () {
      test('converts float values to RGBA bytes', () {
        // 2x2 image
        final count = 4;
        final data = List<double>.filled(3 * count, 0.0);
        // R channel
        data[0] = 1.0;
        data[1] = 0.5;
        data[2] = 0.0;
        data[3] = 1.0;
        // G channel
        data[count + 0] = 0.0;
        data[count + 1] = 1.0;
        data[count + 2] = 0.5;
        data[count + 3] = 1.0;
        // B channel
        data[2 * count + 0] = 0.0;
        data[2 * count + 1] = 0.0;
        data[2 * count + 2] = 1.0;
        data[2 * count + 3] = 1.0;

        final rgba = UpscaleProcessor.nchwFloatToRgba(data, 2, 2);
        expect(rgba.length, 16); // 4 pixels * 4 bytes

        // Pixel 0: R=255, G=0, B=0, A=255
        expect(rgba[0], 255);
        expect(rgba[1], 0);
        expect(rgba[2], 0);
        expect(rgba[3], 255);

        // Pixel 1: R=128, G=255, B=0, A=255
        expect(rgba[4], 128);
        expect(rgba[5], 255);
        expect(rgba[6], 0);
        expect(rgba[7], 255);

        // Pixel 2: R=0, G=128, B=255, A=255
        expect(rgba[8], 0);
        expect(rgba[9], 128);
        expect(rgba[10], 255);
        expect(rgba[11], 255);

        // Pixel 3: R=255, G=255, B=255, A=255
        expect(rgba[12], 255);
        expect(rgba[13], 255);
        expect(rgba[14], 255);
        expect(rgba[15], 255);
      });

      test('clamps values outside [0, 1]', () {
        final count = 1;
        final data = List<double>.filled(3 * count, 0.0);
        data[0] = 2.0; // R > 1
        data[1] = -0.5; // G < 0
        data[2] = 1.5; // B > 1

        final rgba = UpscaleProcessor.nchwFloatToRgba(data, 1, 1);
        expect(rgba[0], 255); // clamped: 2.0*255 -> 510 -> 255
        expect(rgba[1], 0); // clamped: -0.5*255 -> -128 -> 0
        expect(rgba[2], 255); // clamped: 1.5*255 -> 383 -> 255
        expect(rgba[3], 255); // alpha always 255
      });

      test('alpha is always 255', () {
        final rgba =
            UpscaleProcessor.nchwFloatToRgba([0.0, 0.0, 0.0], 1, 1);
        expect(rgba[3], 255);
      });

      test('handles 1x1 image', () {
        final rgba = UpscaleProcessor.nchwFloatToRgba(
            [0.5, 0.2, 0.8], 1, 1);
        expect(rgba.length, 4);
        expect(rgba[0], 128); // 0.5 * 255 = 127.5 -> 128
        expect(rgba[1], 51); // 0.2 * 255 = 51.0 -> 51
        expect(rgba[2], 204); // 0.8 * 255 = 204.0 -> 204
      });
    });

    // ─────────────────────────────────────────────
    // pixelsToNchwFloat <-> nchwFloatToRgba roundtrip
    // ─────────────────────────────────────────────
    group('roundtrip', () {
      test('RGBA -> NCHW -> RGBA preserves values', () {
        final original = Uint8List.fromList([
          10, 20, 30, 255, 40, 50, 60, 255, //
          70, 80, 90, 255, 100, 110, 120, 255, //
        ]);

        final tensor = UpscaleProcessor.pixelsToNchwFloat(original, 2, 2);
        final result = UpscaleProcessor.nchwFloatToRgba(tensor, 2, 2);

        expect(result.length, original.length);
        // RGB channels should match (within rounding)
        for (int i = 0; i < 12; i++) {
          expect((result[i] - original[i]).abs() <= 1, isTrue,
              reason: 'Channel $i: expected ${original[i]}, got ${result[i]}');
        }
        // Alpha should be 255
        for (int i = 3; i < 16; i += 4) {
          expect(result[i], 255);
        }
      });
    });

    // ─────────────────────────────────────────────
    // splitTileRects
    // ─────────────────────────────────────────────
    group('splitTileRects', () {
      test('produces 4 tiles for 100x100 image with 50px tile and no overlap',
          () {
        final rects = UpscaleProcessor.splitTileRects(100, 100,
            tileSize: 50, overlap: 0);
        expect(rects.length, 4);

        // Tile positions
        expect(rects[0].left, 0);
        expect(rects[0].top, 0);
        expect(rects[1].left, 50);
        expect(rects[1].top, 0);
        expect(rects[2].left, 0);
        expect(rects[2].top, 50);
        expect(rects[3].left, 50);
        expect(rects[3].top, 50);

        // All tiles are 50x50
        for (final r in rects) {
          expect(r.width, 50);
          expect(r.height, 50);
        }
      });

      test('produces correct tile count with overlap', () {
        // 100x100, tileSize=50, overlap=10 -> step=40
        // x: 0, 40, 80 -> 3 tiles (last clamped to 20px)
        // y: 0, 40, 80 -> 3 tiles
        // Total: 9 tiles
        final rects = UpscaleProcessor.splitTileRects(100, 100,
            tileSize: 50, overlap: 10);
        expect(rects.length, 9);

        // First tile starts at (0,0), last tile ends at (80,80)
        expect(rects[0].left, 0);
        expect(rects[0].top, 0);
        expect(rects[8].left, 80);
        expect(rects[8].top, 80);
      });

      test('tiles cover the entire image with no overlap', () {
        final imageWidth = 100;
        final imageHeight = 100;
        final rects = UpscaleProcessor.splitTileRects(imageWidth, imageHeight,
            tileSize: 50, overlap: 0);

        // Check that tiles form a complete partition
        bool covered(int x, int y) {
          for (final r in rects) {
            if (x >= r.left &&
                x < r.left + r.width &&
                y >= r.top &&
                y < r.top + r.height) {
              return true;
            }
          }
          return false;
        }

        // Spot-check several positions
        expect(covered(0, 0), isTrue);
        expect(covered(49, 49), isTrue);
        expect(covered(50, 50), isTrue);
        expect(covered(99, 99), isTrue);
        expect(covered(25, 75), isTrue);
      });

      test('handles image smaller than tile size', () {
        final rects = UpscaleProcessor.splitTileRects(10, 10,
            tileSize: 50, overlap: 0);
        expect(rects.length, 1);
        expect(rects[0].width, 10);
        expect(rects[0].height, 10);
        expect(rects[0].left, 0);
        expect(rects[0].top, 0);
      });

      test('tiles overlap correctly with non-zero overlap', () {
        final rects = UpscaleProcessor.splitTileRects(100, 100,
            tileSize: 50, overlap: 10);

        // The step is 40, so adjacent tiles overlap by 10 pixels
        // Tile (0,0) and Tile (1,0): both cover x=[0,50) and x=[40,90)
        // Overlap in x: [40, 50) = 10 pixels
        expect(rects[0].left, 0);
        expect(rects[0].width, 50);
        expect(rects[1].left, 40);
        expect(rects[1].width, 50);

        // Overlap region = 50 - 40 = 10 pixels (matches overlap param)
        final overlapWidth = rects[0].width -
            (rects[1].left - rects[0].left);
        expect(overlapWidth, 10);
      });
    });

    // ─────────────────────────────────────────────
    // extractTilePixels
    // ─────────────────────────────────────────────
    group('extractTilePixels', () {
      test('extracts sub-region from 4x4 image', () {
        // 4x4 RGBA image with unique pixel values
        // Pixel (x,y) has value y*4+x (repeated in R,G,B for simplicity)
        final w = 4;
        final h = 4;
        final rgba = Uint8List(w * h * 4);
        for (int y = 0; y < h; y++) {
          for (int x = 0; x < w; x++) {
            final idx = (y * w + x) * 4;
            final val = y * w + x;
            rgba[idx] = val; // R
            rgba[idx + 1] = val; // G
            rgba[idx + 2] = val; // B
            rgba[idx + 3] = 255; // A
          }
        }

        // Extract 2x2 tile at (1, 1)
        final tileRect = ui.Rect.fromLTWH(1, 1, 2, 2);
        final tile = UpscaleProcessor.extractTilePixels(
            rgba, w, h, tileRect);

        // Should be 4 pixels (2x2 * 4 bytes = 16 bytes)
        expect(tile.length, 16);

        // Tile pixel (0,0) = original pixel (1,1) = 1*4+1 = 5
        expect(tile[0], 5);
        expect(tile[1], 5);
        expect(tile[2], 5);
        expect(tile[3], 255);

        // Tile pixel (1,0) = original pixel (2,1) = 1*4+2 = 6
        expect(tile[4], 6);

        // Tile pixel (0,1) = original pixel (1,2) = 2*4+1 = 9
        expect(tile[8], 9);

        // Tile pixel (1,1) = original pixel (2,2) = 2*4+2 = 10
        expect(tile[12], 10);
      });

      test('extracts tile at image edge', () {
        final w = 4;
        final h = 4;
        final rgba = Uint8List(w * h * 4);
        for (int y = 0; y < h; y++) {
          for (int x = 0; x < w; x++) {
            final idx = (y * w + x) * 4;
            rgba[idx] = (y * w + x) as int;
            rgba[idx + 1] = (y * w + x) as int;
            rgba[idx + 2] = (y * w + x) as int;
            rgba[idx + 3] = 255;
          }
        }

        // Extract bottom-right pixel
        final tileRect = ui.Rect.fromLTWH(3, 3, 1, 1);
        final tile = UpscaleProcessor.extractTilePixels(
            rgba, w, h, tileRect);
        expect(tile.length, 4);
        expect(tile[0], 15); // pixel (3,3) = 3*4+3
      });
    });

    // ─────────────────────────────────────────────
    // mergeTiles
    // ─────────────────────────────────────────────
    group('mergeTiles', () {
      test('single tile scale=1 returns original pixels', () {
        // 2x2 RGBA image
        final rgba = Uint8List.fromList([
          10, 20, 30, 255, 40, 50, 60, 255, //
          70, 80, 90, 255, 100, 110, 120, 255, //
        ]);
        const w = 2;
        const h = 2;
        const scale = 1;

        // Convert to NCHW and create TileResult
        final nchw = UpscaleProcessor.pixelsToNchwFloat(rgba, w, h);
        final result = TileResult(
            x: 0, y: 0, width: w, height: h, data: nchw);

        final merged = UpscaleProcessor.mergeTiles(
            w, h, scale, 0, [result]);
        expect(merged.length, rgba.length);

        // Should match original (within rounding)
        for (int i = 0; i < rgba.length; i++) {
          expect((merged[i] - rgba[i]).abs() <= 1, isTrue,
              reason: 'Byte $i: expected ${rgba[i]}, got ${merged[i]}');
        }
      });

      test('multiple tiles without overlap produce correct output', () {
        // 3x2 image split into 2 tiles: [0-2), [2-3)
        // tileSize=2, overlap=0 -> tiles at x=0 and x=2
        const w = 3;
        const h = 2;
        final rgba = Uint8List(w * h * 4);
        // Fill with position-based values
        for (int y = 0; y < h; y++) {
          for (int x = 0; x < w; x++) {
            final idx = (y * w + x) * 4;
            final val = y * w + x;
            rgba[idx] = val;
            rgba[idx + 1] = val;
            rgba[idx + 2] = val;
            rgba[idx + 3] = 255;
          }
        }

        // Split into tiles manually: tile 1 = (0,0,2,h), tile 2 = (2,0,1,h)
        final rects = UpscaleProcessor.splitTileRects(
            w, h, tileSize: 2, overlap: 0);
        expect(
            rects.length, 2); // (0,0,2,2) and (2,0,1,2)

        final results = <TileResult>[];
        for (final rect in rects) {
          final tilePixels = UpscaleProcessor.extractTilePixels(
              rgba, w, h, rect);
          final tw = rect.width.toInt();
          final th = rect.height.toInt();
          final nchw = UpscaleProcessor.pixelsToNchwFloat(
              tilePixels, tw, th);
          results.add(TileResult(
            x: rect.left.toInt(),
            y: rect.top.toInt(),
            width: tw,
            height: th,
            data: nchw,
          ));
        }

        final scale = 1;
        final merged = UpscaleProcessor.mergeTiles(
            w, h, scale, 0, results);
        expect(merged.length, rgba.length);

        // Verify output matches original (within rounding)
        for (int i = 0; i < rgba.length; i++) {
          expect((merged[i] - rgba[i]).abs() <= 1, isTrue,
              reason:
                  'No-overlap byte $i: expected ${rgba[i]}, got ${merged[i]}');
        }
      });

      test('multiple tiles with overlap produce correct output dimensions', () {
        // 8x8 image, tileSize=6, overlap=2, scale=1
        // Step = 4, tiles at (0,0,6,6), (4,0,4,6), (0,4,6,4), (4,4,4,4)
        // overlapScaled = 2 ensures no pixel gets weightSum=0
        const w = 8;
        const h = 8;
        final rgba = Uint8List(w * h * 4);
        for (int y = 0; y < h; y++) {
          for (int x = 0; x < w; x++) {
            final idx = (y * w + x) * 4;
            final val = y * w + x;
            rgba[idx] = val;
            rgba[idx + 1] = val;
            rgba[idx + 2] = val;
            rgba[idx + 3] = 255;
          }
        }

        const scale = 1;
        const overlap = 2;
        final rects = UpscaleProcessor.splitTileRects(
            w, h, tileSize: 6, overlap: overlap);

        final results = <TileResult>[];
        for (final rect in rects) {
          final tilePixels = UpscaleProcessor.extractTilePixels(
              rgba, w, h, rect);
          final tw = rect.width.toInt();
          final th = rect.height.toInt();
          final nchw = UpscaleProcessor.pixelsToNchwFloat(
              tilePixels, tw, th);
          results.add(TileResult(
            x: rect.left.toInt(),
            y: rect.top.toInt(),
            width: tw,
            height: th,
            data: nchw,
          ));
        }

        final merged = UpscaleProcessor.mergeTiles(
            w, h, scale, overlap, results);
        expect(merged.length, w * h * 4 * scale * scale);

        // Verify output matches original (within rounding)
        for (int i = 0; i < rgba.length; i++) {
          expect((merged[i] - rgba[i]).abs() <= 1, isTrue,
              reason:
                  'Overlap byte $i: expected ${rgba[i]}, got ${merged[i]}');
        }
      });

      test('scale=2 produces correctly sized output', () {
        // 2x2 image scaled to 4x4
        const w = 2;
        const h = 2;
        final rgba = Uint8List.fromList([
          10, 20, 30, 255, 40, 50, 60, 255, //
          70, 80, 90, 255, 100, 110, 120, 255, //
        ]);

        const scale = 2;
        const overlap = 0;
        const tileSize = 2;

        final rects = UpscaleProcessor.splitTileRects(
            w, h, tileSize: tileSize, overlap: overlap);

        final results = <TileResult>[];
        for (final rect in rects) {
          final tilePixels = UpscaleProcessor.extractTilePixels(
              rgba, w, h, rect);
          final tw = rect.width.toInt();
          final th = rect.height.toInt();

          // For scale=2, the model produces output at 2x resolution
          // Simulate this by creating NCHW data at the proper output size
          final nchwInput = UpscaleProcessor.pixelsToNchwFloat(
              tilePixels, tw, th);

          // Create output tensor at [1, 3, th*scale, tw*scale]
          // For testing, we upscale by replicating pixels (nearest neighbor)
          final outCount = (tw * scale) * (th * scale);
          final outNchw = List<double>.filled(3 * outCount, 0.0);
          for (int ty = 0; ty < th * scale; ty++) {
            for (int tx = 0; tx < tw * scale; tx++) {
              final srcY = ty ~/ scale;
              final srcX = tx ~/ scale;
              final srcIdx = srcY * tw + srcX;
              final dstIdx = ty * (tw * scale) + tx;
              outNchw[0 * outCount + dstIdx] =
                  nchwInput[0 * tw * th + srcIdx];
              outNchw[1 * outCount + dstIdx] =
                  nchwInput[1 * tw * th + srcIdx];
              outNchw[2 * outCount + dstIdx] =
                  nchwInput[2 * tw * th + srcIdx];
            }
          }

          results.add(TileResult(
            x: rect.left.toInt(),
            y: rect.top.toInt(),
            width: tw,
            height: th,
            data: outNchw,
          ));
        }

        final merged = UpscaleProcessor.mergeTiles(
            w, h, scale, overlap, results);
        expect(merged.length, w * h * 4 * scale * scale); // 64 bytes
      });

      test('mergeTiles handles empty tile list gracefully', () {
        final merged = UpscaleProcessor.mergeTiles(2, 2, 1, 0, []);
        expect(merged.length, 16); // 2*2*4
        // All pixels should be black (transparent since weightSum=0)
        for (int i = 0; i < 16; i += 4) {
          expect(merged[i], 0);
          expect(merged[i + 1], 0);
          expect(merged[i + 2], 0);
          expect(merged[i + 3], 0);
        }
      });
    });
  });
}
