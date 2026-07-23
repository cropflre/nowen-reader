"use client";

import { apiPath } from "@/lib/base-path";
import { useState, useEffect, useCallback } from "react";
import type { ApiComic } from "./useComicTypes";

interface PagesResponse {
  comicId: string;
  title: string;
  totalPages: number;
  pages: { index: number; name: string; url: string; title?: string }[];
  isNovel?: boolean;
  isPdf?: boolean;
}

/**
 * Hook: 获取漫画/小说的页面或章节列表
 */
export function useComicPages(comicId: string) {
  const [pages, setPages] = useState<string[]>([]);
  const [chapters, setChapters] = useState<{ index: number; name: string; url: string; title?: string }[]>([]);
  const [title, setTitle] = useState("");
  const [isNovel, setIsNovel] = useState(false);
  const [isPdf, setIsPdf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!comicId) return;

    let cancelled = false;
    let timedOut = false;

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000); // 120s timeout for large files

    fetch(apiPath(`/api/comics/${comicId}/pages`), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Comic not found");
        }
        return res.json();
      })
      .then((data: PagesResponse) => {
        if (cancelled) return;
        setTitle(data.title);
        setIsNovel(!!data.isNovel);
        setIsPdf(!!data.isPdf);
        setChapters(data.pages || []);
        setPages((data.pages || []).map((p) => p.url));
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          if (timedOut) {
            setError("Loading timeout — file may be too large. Please retry.");
          }
        } else {
          const msg = err instanceof Error ? err.message : "Unknown error";
          // 区分 403 错误：如果响应是 403，保留 status 信息供页面判断
          if (msg.includes("403") || msg.toLowerCase().includes("forbidden") || msg.includes("do not have access")) {
            setError("403: " + msg);
          } else {
            setError(msg);
          }
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [comicId]);

  return { pages, chapters, title, isNovel, isPdf, loading, error };
}

/**
 * Hook: 获取漫画详情（含数据库元数据）
 */
export function useComicDetail(comicId: string) {
  const [comic, setComic] = useState<ApiComic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!comicId) return;
    try {
      setError(null);
      setStatusCode(null);
      const res = await fetch(apiPath(`/api/comics/${comicId}`));
      if (res.ok) {
        const data = await res.json();
        setComic({
          ...data,
          tags: data.tags || [],
          categories: data.categories || [],
        });
      } else {
        setStatusCode(res.status);
        const body = await res.json().catch(() => null);
        setError(body?.error || `HTTP ${res.status}`);
      }
    } catch {
      // ignore network errors
    } finally {
      setLoading(false);
    }
  }, [comicId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return { comic, loading, error, statusCode, refetch: fetchDetail };
}
