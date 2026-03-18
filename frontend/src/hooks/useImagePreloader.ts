"use client";

import { useEffect, useRef } from "react";

/**
 * 获取有效的预加载范围（根据网络环境动态调整）
 */
function getEffectiveRange(range: number): number {
  if (typeof navigator !== "undefined" && "connection" in navigator) {
    const conn = (navigator as unknown as { connection: { effectiveType?: string; saveData?: boolean } }).connection;
    // 数据节省模式下只预加载 1 张
    if (conn?.saveData) return 1;
    // 慢速网络减少预加载
    const type = conn?.effectiveType;
    if (type === "slow-2g" || type === "2g") return 0;
    if (type === "3g") return Math.min(range, 1);
  }
  return range;
}

/**
 * Preloads images around the current page index.
 * Uses the browser's built-in image cache via HTMLImageElement.
 * 根据网络环境自动调整预加载策略。
 *
 * @param pages - Array of image URLs
 * @param currentPage - Currently visible page index
 * @param range - Number of pages to preload ahead/behind (default: 3)
 */
export function useImagePreloader(
  pages: string[],
  currentPage: number,
  range: number = 3
) {
  const preloadedRef = useRef(new Set<string>());

  useEffect(() => {
    if (pages.length === 0) return;

    const effectiveRange = getEffectiveRange(range);
    const start = Math.max(0, currentPage - 1);
    const end = Math.min(pages.length - 1, currentPage + effectiveRange);

    for (let i = start; i <= end; i++) {
      const url = pages[i];
      if (!url || preloadedRef.current.has(url)) continue;
      preloadedRef.current.add(url);

      const img = new Image();
      img.src = url;
    }
  }, [pages, currentPage, range]);

  // Reset when pages change (e.g. different comic)
  useEffect(() => {
    preloadedRef.current.clear();
  }, [pages]);
}
