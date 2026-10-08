"use client";

import { useEffect, useRef, useCallback } from "react";
import { apiPath } from "@/lib/base-path";

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

function triggerWarmup(comicId: string, sessionId: string, startPage: number, count: number) {
  return fetch(apiPath(`/api/comics/${comicId}/warmup`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, startPage, count }),
  }).then(response => {
    if (!response.ok) throw new Error("Warmup failed");
  });
}

function triggerWarmupDone(comicId: string, sessionId: string) {
  const body = JSON.stringify({ sessionId });
  if (navigator.sendBeacon?.(apiPath(`/api/comics/${comicId}/warmup-done`), new Blob([body], { type: "application/json" }))) return;
  fetch(apiPath(`/api/comics/${comicId}/warmup-done`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
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
  const sessionRef = useRef<string | null>(null);
  const bucketRef = useRef<number | null>(null);
  const pageRef = useRef(currentPage);
  const totalRef = useRef(pages.length);
  pageRef.current = currentPage;
  totalRef.current = pages.length;
  const hasPages = pages.length > 0;

  const warmAhead = useCallback(() => {
    const session = sessionRef.current;
    const page = pageRef.current;
    const bucket = Math.floor(page / 4);
    if (!comicId || !session || bucketRef.current === bucket || page + 1 >= totalRef.current) return;
    bucketRef.current = bucket;
    triggerWarmup(comicId, session, page + 1, Math.min(8, totalRef.current - page - 1))
      .catch(() => {
        if (sessionRef.current === session && bucketRef.current === bucket) bucketRef.current = null;
      });
  }, [comicId]);

  useEffect(() => {
    if (!comicId || !hasPages) return;
    preloadedRef.current.clear();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(heartbeat);
      const session = sessionRef.current;
      sessionRef.current = null;
      bucketRef.current = null;
      if (session) triggerWarmupDone(comicId, session);
    };
    const start = () => {
      if (document.visibilityState === "hidden" || sessionRef.current) return;
      const session = crypto.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionRef.current = session;
      const renew = () => {
        triggerWarmup(comicId, session, pageRef.current, -1).catch(() => {});
      };
      renew();
      heartbeat = setInterval(renew, 30_000);
      warmAhead();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", start);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", start);
    };
  }, [comicId, hasPages, warmAhead]);

  useEffect(() => { warmAhead(); }, [currentPage, warmAhead]);

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
  }, [pages, currentPage, range]);
}
