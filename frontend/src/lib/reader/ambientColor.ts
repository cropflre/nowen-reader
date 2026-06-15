/**
 * 封面氛围色提取 — 从漫画封面图片中提取主色和辅色
 * 用于阅读器沉浸式背景
 */

export interface AmbientColors {
  primary: string;   // "r, g, b" 格式，用于 rgba()
  secondary: string; // "r, g, b" 格式
}

const CACHE_PREFIX = "reader:ambient:";

/**
 * 从 sessionStorage 读取缓存的氛围色
 */
export function getCachedAmbientColor(comicId: string): AmbientColors | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${comicId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.primary && parsed.secondary) return parsed as AmbientColors;
  } catch {
    // ignore
  }
  return null;
}

/**
 * 缓存氛围色到 sessionStorage
 */
export function cacheAmbientColor(comicId: string, colors: AmbientColors): void {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${comicId}`, JSON.stringify(colors));
  } catch {
    // ignore
  }
}

/**
 * 从图片 URL 提取主色和辅色
 * 使用 canvas 采样，过滤过暗/过亮/透明像素
 */
export function extractAmbientColors(imageUrl: string): Promise<AmbientColors> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          reject(new Error("Canvas context not available"));
          return;
        }

        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size);
        const pixels = imageData.data;

        let r1 = 0, g1 = 0, b1 = 0;
        let r2 = 0, g2 = 0, b2 = 0;
        let count1 = 0, count2 = 0;
        const halfY = size / 2;

        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];

            if (a < 128) continue;
            const brightness = (r + g + b) / 3;
            if (brightness < 15 || brightness > 245) continue;

            if (y < halfY) {
              r1 += r; g1 += g; b1 += b; count1++;
            } else {
              r2 += r; g2 += g; b2 += b; count2++;
            }
          }
        }

        if (count1 < 4 || count2 < 4) {
          let rAll = 0, gAll = 0, bAll = 0, countAll = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 128) continue;
            rAll += pixels[i]; gAll += pixels[i + 1]; bAll += pixels[i + 2]; countAll++;
          }
          if (countAll === 0) {
            resolve({ primary: "99, 102, 241", secondary: "139, 92, 246" });
            return;
          }
          const avg = `${Math.round(rAll / countAll)}, ${Math.round(gAll / countAll)}, ${Math.round(bAll / countAll)}`;
          resolve({ primary: avg, secondary: avg });
          return;
        }

        const darken = (r: number, g: number, b: number) => {
          const factor = 0.6;
          return `${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)}`;
        };

        resolve({
          primary: darken(Math.round(r1 / count1), Math.round(g1 / count1), Math.round(b1 / count1)),
          secondary: darken(Math.round(r2 / count2), Math.round(g2 / count2), Math.round(b2 / count2)),
        });
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = () => {
      reject(new Error("Image load failed"));
    };

    setTimeout(() => {
      reject(new Error("Image load timeout"));
    }, 5000);

    img.src = imageUrl;
  });
}

/**
 * 获取封面图片 URL
 */
export function getCoverImageUrl(comicId: string, coverUrl?: string): string | null {
  if (coverUrl) return coverUrl;
  return `/api/comics/${comicId}/page/0`;
}