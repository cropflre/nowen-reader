import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

// ============================================================
// Tile 分块信息
// ============================================================

class TileInfo {
  final int x;
  final int y;
  final int width;
  final int height;
  final Uint8List pixelBytes; // ARGB raw bytes for this tile

  const TileInfo({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    required this.pixelBytes,
  });
}

class TileResult {
  final int x;
  final int y;
  final int width;
  final int height;
  final List<double> data; // NCHW float32 output

  const TileResult({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    required this.data,
  });
}

// ============================================================
// 预处理与后处理配置
// ============================================================

/// ONNX 模型输入参数（不同模型可能不同，定义默认值）
class UpscaleModelConfig {
  final int inputSize; // 模型输入边长 (如 512)
  final int tileSize; // 推理分块边长 (如 512)
  final int tileOverlap; // 分块重叠像素 (如 8)

  const UpscaleModelConfig({
    this.inputSize = 512,
    this.tileSize = 512,
    this.tileOverlap = 8,
  });
}

// ============================================================
// UpscaleProcessor
// ============================================================

/// 图像预处理和后处理
/// 所有方法均为 static — 无状态纯函数
class UpscaleProcessor {
  /// 将原始图片字节解码为 ui.Image
  static Future<ui.Image> decodeImage(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    codec.dispose();
    return frame.image;
  }

  /// 从 ui.Image 提取 RGBA 像素数据 (Uint8List, 每像素 4 字节)
  static Future<Uint8List> extractPixels(ui.Image image) async {
    final byteData =
        await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (byteData == null) {
      throw Exception('Failed to extract pixel data from image');
    }
    return Uint8List.view(byteData.buffer);
  }

  /// 像素数据 → 归一化 Float32 List (NCHW 格式)
  /// 输入: RGBA bytes [H, W, 4] (R,G,B,忽略A)
  /// 输出: Float32 [1, 3, H, W]
  static List<double> pixelsToNchwFloat(
    Uint8List rgbaPixels,
    int width,
    int height,
  ) {
    final count = width * height;
    final output = List<double>.filled(3 * count, 0.0);

    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        final srcIdx = (y * width + x) * 4;
        final dstIdx = y * width + x;
        // 归一化 [0,255] → [0.0,1.0]
        output[0 * count + dstIdx] = rgbaPixels[srcIdx] / 255.0; // R
        output[1 * count + dstIdx] = rgbaPixels[srcIdx + 1] / 255.0; // G
        output[2 * count + dstIdx] = rgbaPixels[srcIdx + 2] / 255.0; // B
      }
    }
    return output;
  }

  /// NCHW Float32 输出 → RGBA bytes
  /// 输入: Float32 [1, 3, H, W], 值域 [0,1]
  /// 输出: RGBA bytes [H, W, 4]
  static Uint8List nchwFloatToRgba(
    List<double> data,
    int height,
    int width,
  ) {
    final count = width * height;
    final output = Uint8List(count * 4);

    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        final srcIdx = y * width + x;
        final dstIdx = (y * width + x) * 4;

        // 钳位 [0,1] → [0,255]
        final r = (data[0 * count + srcIdx] * 255.0).round().clamp(0, 255);
        final g = (data[1 * count + srcIdx] * 255.0).round().clamp(0, 255);
        final b = (data[2 * count + srcIdx] * 255.0).round().clamp(0, 255);

        output[dstIdx] = r;
        output[dstIdx + 1] = g;
        output[dstIdx + 2] = b;
        output[dstIdx + 3] = 255; // Alpha 全不透明
      }
    }
    return output;
  }

  /// 将 RGBA bytes 编码为 JPEG bytes
  ///
  /// 注意: Flutter UI 不支持直接编码 JPEG。此处返回 raw RGBA，
  /// 实际 JPEG 编码由调用方在原生侧处理或在缓存写入时处理。
  /// 目前返回 RGBA bytes，调用方使用 Image.memory 可正确渲染。
  static Future<Uint8List> encodeJpeg(
    Uint8List rgba,
    int width,
    int height, {
    int quality = 92,
  }) async {
    final image = await _rgbaToImage(rgba, width, height);
    final byteData = await image.toByteData(
      format: ui.ImageByteFormat.rawRgba,
    );
    if (byteData == null) {
      throw Exception('Failed to encode image');
    }
    return Uint8List.view(byteData.buffer);
  }

  /// 辅助: RGBA bytes → ui.Image
  static Future<ui.Image> _rgbaToImage(
    Uint8List rgba,
    int width,
    int height,
  ) async {
    final completer = Completer<ui.Image>();
    ui.decodeImageFromPixels(
      rgba,
      width,
      height,
      ui.PixelFormat.rgba8888,
      (image) => completer.complete(image),
    );
    return completer.future;
  }

  // ══════════════════════════════════════════════════════════════
  // Tile 分块与合并
  // ══════════════════════════════════════════════════════════════

  /// 将大图切割为多个 tile (仅计算区域，不拷贝像素)
  static List<ui.Rect> splitTileRects(
    int imageWidth,
    int imageHeight, {
    int tileSize = 512,
    int overlap = 8,
  }) {
    final rects = <ui.Rect>[];
    for (int y = 0; y < imageHeight; y += tileSize - overlap) {
      for (int x = 0; x < imageWidth; x += tileSize - overlap) {
        final tileW =
            (x + tileSize > imageWidth) ? imageWidth - x : tileSize;
        final tileH =
            (y + tileSize > imageHeight) ? imageHeight - y : tileSize;
        rects.add(ui.Rect.fromLTWH(
            x.toDouble(), y.toDouble(), tileW.toDouble(), tileH.toDouble()));
      }
    }
    return rects;
  }

  /// 从完整 RGBA 像素中提取单个 tile 的像素数据
  static Uint8List extractTilePixels(
    Uint8List fullRgba,
    int imageWidth,
    int imageHeight,
    ui.Rect tileRect,
  ) {
    final tx = tileRect.left.toInt();
    final ty = tileRect.top.toInt();
    final tw = tileRect.width.toInt();
    final th = tileRect.height.toInt();
    final tileBytes = Uint8List(tw * th * 4);

    for (int row = 0; row < th; row++) {
      final srcRow = (ty + row) * imageWidth * 4;
      final dstRow = row * tw * 4;
      for (int col = 0; col < tw; col++) {
        final src = srcRow + (tx + col) * 4;
        final dst = dstRow + col * 4;
        tileBytes[dst] = fullRgba[src];
        tileBytes[dst + 1] = fullRgba[src + 1];
        tileBytes[dst + 2] = fullRgba[src + 2];
        tileBytes[dst + 3] = fullRgba[src + 3];
      }
    }
    return tileBytes;
  }

  /// 合并多个 tile 的推理结果为完整放大图像
  ///
  /// 重叠区域使用线性衰减加权平均:
  /// - 每个 tile 的像素权重沿其边缘线性降低 (0 到 1, 跨度 = overlap * scale)
  /// - 对于图像边界上的 tile, 边界一侧不衰减 (无相邻 tile)
  /// - 最终每个像素的 RGB 值 = sum(channel * weight) / sum(weight)
  static Uint8List mergeTiles(
    int imageWidth,
    int imageHeight,
    int scale,
    int overlap,
    List<TileResult> tileResults,
  ) {
    final outW = imageWidth * scale;
    final outH = imageHeight * scale;
    final outCount = outW * outH;

    // Accumulated weighted color sums and weight sum per pixel
    final accR = Float64List(outCount);
    final accG = Float64List(outCount);
    final accB = Float64List(outCount);
    final weightSum = Float64List(outCount);

    final overlapScaled = overlap * scale;

    for (final tile in tileResults) {
      final tileOutW = tile.width * scale;
      final tileOutH = tile.height * scale;
      final offsetX = tile.x * scale;
      final offsetY = tile.y * scale;
      final count = tileOutW * tileOutH;

      // Determine which edges of this tile border adjacent tiles
      // Only feather edges that have neighboring tiles
      final hasLeftOverlap = tile.x > 0;
      final hasRightOverlap = tile.x + tile.width < imageWidth;
      final hasTopOverlap = tile.y > 0;
      final hasBottomOverlap = tile.y + tile.height < imageHeight;

      for (int ty = 0; ty < tileOutH; ty++) {
        for (int tx = 0; tx < tileOutW; tx++) {
          final outX = offsetX + tx;
          final outY = offsetY + ty;
          if (outX >= outW || outY >= outH) continue;

          final outIdx = outY * outW + outX;
          final tileSrcIdx = ty * tileOutW + tx;

          final r = tile.data[0 * count + tileSrcIdx];
          final g = tile.data[1 * count + tileSrcIdx];
          final b = tile.data[2 * count + tileSrcIdx];

          // Compute weight: linear ramp from 0 at tile edge to 1 at overlapScaled
          double weight = 1.0;
          if (overlapScaled > 0) {
            double minDist = overlapScaled.toDouble();

            if (hasLeftOverlap) {
              final d = tx.toDouble();
              if (d < minDist) minDist = d;
            }
            if (hasRightOverlap) {
              final d = (tileOutW - 1 - tx).toDouble();
              if (d < minDist) minDist = d;
            }
            if (hasTopOverlap) {
              final d = ty.toDouble();
              if (d < minDist) minDist = d;
            }
            if (hasBottomOverlap) {
              final d = (tileOutH - 1 - ty).toDouble();
              if (d < minDist) minDist = d;
            }

            if (minDist < overlapScaled) {
              weight = minDist / overlapScaled;
            }
          }

          accR[outIdx] += r * weight;
          accG[outIdx] += g * weight;
          accB[outIdx] += b * weight;
          weightSum[outIdx] += weight;
        }
      }
    }

    // Normalize and write final RGBA output
    final output = Uint8List(outCount * 4);
    for (int i = 0; i < outCount; i++) {
      final w = weightSum[i];
      if (w > 0) {
        output[i * 4] = (accR[i] / w * 255.0).round().clamp(0, 255);
        output[i * 4 + 1] = (accG[i] / w * 255.0).round().clamp(0, 255);
        output[i * 4 + 2] = (accB[i] / w * 255.0).round().clamp(0, 255);
        output[i * 4 + 3] = 255;
      } else {
        output[i * 4] = 0;
        output[i * 4 + 1] = 0;
        output[i * 4 + 2] = 0;
        output[i * 4 + 3] = 0;
      }
    }

    return output;
  }
}
