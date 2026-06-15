"use client";

import { useState, useEffect } from "react";
import {
  type AmbientColors,
  getCachedAmbientColor,
  cacheAmbientColor,
  extractAmbientColors,
  getCoverImageUrl,
} from "@/lib/reader/ambientColor";

// 默认氛围色（靛蓝 + 紫罗兰）
const DEFAULT_COLORS: AmbientColors = {
  primary: "99, 102, 241",
  secondary: "139, 92, 246",
};

/**
 * Hook: 获取漫画封面氛围色
 * 自动缓存到 sessionStorage，跨域失败时降级到默认色
 */
export function useCoverAmbientColor(
  comicId: string,
  coverUrl?: string | null
): AmbientColors {
  const [colors, setColors] = useState<AmbientColors>(DEFAULT_COLORS);

  useEffect(() => {
    if (!comicId) return;

    // 1. 先检查缓存
    const cached = getCachedAmbientColor(comicId);
    if (cached) {
      setColors(cached);
      return;
    }

    // 2. 获取封面 URL
    const imageUrl = getCoverImageUrl(comicId, coverUrl ?? undefined);
    if (!imageUrl) return;

    // 3. 异步取色
    let cancelled = false;
    extractAmbientColors(imageUrl)
      .then((extracted) => {
        if (cancelled) return;
        setColors(extracted);
        cacheAmbientColor(comicId, extracted);
      })
      .catch(() => {
        // 取色失败：使用默认色，不缓存失败结果
        if (!cancelled) {
          setColors(DEFAULT_COLORS);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [comicId, coverUrl]);

  return colors;
}