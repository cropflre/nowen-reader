"use client";

import { useState, useEffect, useCallback } from "react";
import type { ApiComic } from "./useComicTypes";

interface PagesResponse {
  comicId: string;
  title: string;
  totalPages: number;
  pages: { index: number; name: string; url: string; title?: string }[];
  isNovel?: boolean;
}

/**
 * Hook: 获取漫画/小说的页面或章节列表
 */
export function useComicPages(comicId: string) {
  const [pages, setPages] = useState<string[]>([]);
  const [chapters, setChapters] = useState<{ index: number; name: string; url: string; title?: string }[]>([]);
  const [title, setTitle] = useState("");
  const [isNovel, setIsNovel] = useState(false);
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

    fetch(`/api/comics/${comicId}/pages`, { signal: controller.signal })
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
          setError(err instanceof Error ? err.message : "Unknown error");
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

  return { pages, chapters, title, isNovel, loading, error };
}

/**
 * Hook: 获取漫画详情（含数据库元数据）
 */
export function useComicDetail(comicId: string) {
  const [comic, setComic] = useState<ApiComic | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async () => {
    if (!comicId) return;
    try {
      const res = await fetch(`/api/comics/${comicId}`);
      if (res.ok) {
        const data = await res.json();
        setComic({
          ...data,
          tags: data.tags || [],
          categories: data.categories || [],
        });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [comicId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return { comic, loading, refetch: fetchDetail };
}
