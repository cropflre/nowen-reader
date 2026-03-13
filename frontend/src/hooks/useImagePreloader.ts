"use client";

import { useEffect, useRef } from "react";

/**
 * Preloads images around the current page index.
 * Uses the browser's built-in image cache via HTMLImageElement.
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

    const start = Math.max(0, currentPage - 1);
    const end = Math.min(pages.length - 1, currentPage + range);

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
