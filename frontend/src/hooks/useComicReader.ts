"use client";

import { apiPath } from "@/lib/base-path";
import { useState, useEffect, useCallback } from "react";
import type { ApiComic } from "./useComicTypes";

interface PagesResponse {
  comicId: string;
  title: string;
  totalPages: number;
  pages: {
    index: number;
    name: string;
    url: string;
    title?: string;
    level?: number;
    parentIndex?: number;
    hasChildren?: boolean;
  }[];
  isNovel?: boolean;
  isPdf?: boolean;
}

function normalizeReaderError(message: string) {
  const lower = message.toLowerCase();
  if (
    lower.includes("permission denied") ||
    lower.includes("operation not permitted") ||
    lower.includes("eacces")
  ) {
    return "无法读取漫画文件（Permission denied）。NowenReader 对该文件没有读取权限。请检查宿主机/NAS 文件的 UID、GID 或 ACL，并让 Docker 的 PUID/PGID 与媒体文件权限匹配。如果只有后来新增的文件异常，可临时设置 PERMISSION_FIX_MODE=recursive 后重建容器进行一次递归修复；NAS/SMB/NFS 无法 chown 时可使用 recursive-relaxed。";
  }
  return message;
}

/**
 * Hook: 获取漫画/小说的页面或章节列表
 */
export function useComicPages(comicId: string) {
  const [pages, setPages] = useState<string[]>([]);
  const [chapters, setChapters] = useState<PagesResponse["pages"]>([]);
  const [title, setTitle] = useState("");
  const [isNovel, setIsNovel] = useState(false);
  const [isPdf, setIsPdf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Applying/editing a TXT chapter rule should refresh just the chapter list,
  // not reload the whole reader page and not discard unrelated reader state.
  useEffect(() => {
    const handleChapterRuleApplied = (event: Event) => {
      const detail = (event as CustomEvent<{ comicId?: string }>).detail;
      if (!detail?.comicId || detail.comicId === comicId) {
        setReloadToken((value) => value + 1);
      }
    };
    window.addEventListener("novel-chapter-rule-applied", handleChapterRuleApplied);
    return () => window.removeEventListener("novel-chapter-rule-applied", handleChapterRuleApplied);
  }, [comicId]);

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
        const nextPages = data.pages || [];
        setTitle(data.title);
        setIsNovel(!!data.isNovel);
        setIsPdf(!!data.isPdf);
        setChapters(nextPages);
        setPages(nextPages.map((p) => p.url));

        // Only chapter-rule-triggered reloads need position reconciliation.
        // Keep the existing chapter index whenever possible; the toolbar will
        // clamp it only when the new TOC is shorter and the index is invalid.
        if (reloadToken > 0) {
          window.dispatchEvent(
            new CustomEvent("novel-chapter-rule-refreshed", {
              detail: { comicId, totalChapters: nextPages.length },
            })
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          if (timedOut) {
            setError("Loading timeout — file may be too large. Please retry.");
          }
        } else {
          const rawMessage = err instanceof Error ? err.message : "Unknown error";
          const msg = normalizeReaderError(rawMessage);
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
  }, [comicId, reloadToken]);

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
