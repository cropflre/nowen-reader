"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * 获取有效的预加载范围（根据网络环境动态调整）
 */
function getEffectiveRange(range: number): number {
  if (typeof navigator !== "undefined" && "connection" in navigator) {
    const conn = (navigator as unknown as { connection: { effectiveType?: string; saveData?: boolean; rtt?: number } }).connection;
    // 数据节省模式下只预加载 1 张
    if (conn?.saveData) return 1;
    // 慢速网络减少预加载
    const type = conn?.effectiveType;
    if (type === "slow-2g" || type === "2g") return Math.min(range, 1);
    if (type === "3g") return Math.min(range, 2);
    // 高延迟网络（如网盘映射场景）增加预加载范围
    if (conn?.rtt && conn.rtt > 200) return Math.max(range, 8);
    if (conn?.rtt && conn.rtt > 100) return Math.max(range, 5);
  }
  return range;
}

/**
 * 触发后端页面预热（适用于网盘等高延迟存储场景）
 */
function triggerWarmup(comicId: string, startPage: number, count: number) {
  fetch(`/api/comics/${comicId}/warmup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startPage, count }),
  }).catch(() => {
    // 静默失败，不影响阅读体验
  });
}

/**
 * 通知后端阅读结束，释放阅读锁
 */
function triggerWarmupDone(comicId: string) {
  // 使用 sendBeacon 确保页面关闭时也能发出请求
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(`/api/comics/${comicId}/warmup-done`, JSON.stringify({}));
  } else {
    fetch(`/api/comics/${comicId}/warmup-done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }
}

/**
 * Preloads images around the current page index.
 * Uses the browser's built-in image cache via HTMLImageElement.
 * 根据网络环境自动调整预加载策略。
 * 在首次加载和翻页时自动触发后端预热 API。
 *
 * @param pages - Array of image URLs
 * @param currentPage - Currently visible page index
 * @param range - Number of pages to preload ahead/behind (default: 5)
 * @param comicId - Comic ID for triggering backend warmup
 */
export function useImagePreloader(
  pages: string[],
  currentPage: number,
  range: number = 5,
  comicId?: string
) {
  const preloadedRef = useRef(new Set<string>());
  const warmupRef = useRef(new Set<number>()); // 已触发预热的页面范围起点
  const comicIdRef = useRef(comicId);

  // 首次加载时触发后端预热（预热前 15 页）
  useEffect(() => {
    if (!comicId || pages.length === 0) return;
    comicIdRef.current = comicId;
    triggerWarmup(comicId, 0, 15);
    warmupRef.current.add(0);

    // 页面卸载时释放阅读锁
    return () => {
      if (comicIdRef.current) {
        triggerWarmupDone(comicIdRef.current);
      }
    };
  }, [comicId, pages.length]);

  useEffect(() => {
    if (pages.length === 0) return;

    const effectiveRange = getEffectiveRange(range);
    // 双向预加载：向前 2 页 + 向后 effectiveRange 页
    const start = Math.max(0, currentPage - 2);
    const end = Math.min(pages.length - 1, currentPage + effectiveRange);

    for (let i = start; i <= end; i++) {
      const url = pages[i];
      if (!url || preloadedRef.current.has(url)) continue;
      preloadedRef.current.add(url);

      const img = new Image();
      img.src = url;
    }

    // 当用户翻到预加载范围的后半段时，触发后端预热下一批页面
    if (comicId) {
      const warmupThreshold = currentPage + Math.floor(effectiveRange / 2);
      const warmupStart = currentPage + effectiveRange;
      // 每 10 页触发一次预热，避免频繁请求
      const warmupBucket = Math.floor(warmupStart / 10) * 10;
      if (!warmupRef.current.has(warmupBucket) && warmupStart < pages.length) {
        warmupRef.current.add(warmupBucket);
        triggerWarmup(comicId, warmupStart, 15);
      }
    }
  }, [pages, currentPage, range, comicId]);

  // Reset when pages change (e.g. different comic)
  useEffect(() => {
    preloadedRef.current.clear();
    warmupRef.current.clear();
  }, [pages]);
}
