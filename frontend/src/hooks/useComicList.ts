"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ApiComic, ComicsResponse } from "./useComicTypes";

/**
 * 客户端缓存：漫画列表 API 响应
 * Key = URL 查询字符串, Value = { data, timestamp }
 * 缓存条目在 CACHE_TTL 毫秒后过期。
 */
const comicsCache = new Map<string, { data: ComicsResponse; ts: number }>();
const COMICS_CACHE_TTL = 30_000; // 30 秒
const MAX_CACHE_ENTRIES = 20;

function getCachedResponse(key: string): ComicsResponse | null {
  const entry = comicsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > COMICS_CACHE_TTL) {
    comicsCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedResponse(key: string, data: ComicsResponse) {
  if (comicsCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = comicsCache.keys().next().value;
    if (oldest !== undefined) comicsCache.delete(oldest);
  }
  comicsCache.set(key, { data, ts: Date.now() });
}

/** 清除所有缓存（在变更操作后调用） */
export function invalidateComicsCache() {
  comicsCache.clear();
}

/**
 * Hook: 获取漫画列表（带客户端缓存 + AbortController）
 */
export function useComics(options?: {
  search?: string;
  tags?: string[];
  favoritesOnly?: boolean;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
  category?: string;
  contentType?: string; // "comic" | "novel" | ""
  excludeGrouped?: boolean; // 排除已在合集中的漫画（合集视图）
  fetchAll?: boolean; // 获取全部漫画（不分页，用于客户端合并分页）
}) {
  const [comics, setComics] = useState<ApiComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const initializedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchComics = useCallback(async () => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.tags?.length) params.set("tags", options.tags.join(","));
    if (options?.favoritesOnly) params.set("favorites", "true");
    if (options?.sortBy) params.set("sortBy", options.sortBy);
    if (options?.sortOrder) params.set("sortOrder", options.sortOrder);
    // fetchAll 模式不传 page/pageSize，后端 pageSize<=0 时不应用 LIMIT
    if (!options?.fetchAll) {
      if (options?.page) params.set("page", String(options.page));
      if (options?.pageSize) params.set("pageSize", String(options.pageSize));
    }
    if (options?.category) params.set("category", options.category);
    if (options?.contentType) params.set("contentType", options.contentType);
    if (options?.excludeGrouped) params.set("excludeGrouped", "true");

    const qs = params.toString();
    const cacheKey = qs || "__default__";
    const url = `/api/comics${qs ? `?${qs}` : ""}`;

    // Check client cache first
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      setComics(cached.comics);
      setTotal(cached.total);
      setTotalPages(cached.totalPages);
      if (!initializedRef.current) {
        initializedRef.current = true;
        setLoading(false);
      }
    }

    if (!initializedRef.current && !cached) {
      setLoading(true);
    }
    setFetching(true);
    setError(null);

    try {
      const res = await fetch(url, { signal: abortController.signal });
      if (!res.ok) throw new Error("Failed to fetch comics");
      const data: ComicsResponse = await res.json();
      // 检查请求是否被取消
      if (abortController.signal.aborted) return;
      const safeComics = (data.comics || []).map((c) => ({
        ...c,
        tags: c.tags || [],
        categories: c.categories || [],
      }));
      setComics(safeComics);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setCachedResponse(cacheKey, { ...data, comics: safeComics });
      initializedRef.current = true;
    } catch (err) {
      // 忽略取消的请求
      if (err instanceof Error && err.name === "AbortError") return;
      if (!cached) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      // 只有当前请求没有被取消时才更新状态
      if (!abortController.signal.aborted) {
        setLoading(false);
        setFetching(false);
      }
    }
  }, [options?.search, JSON.stringify(options?.tags), options?.favoritesOnly, options?.sortBy, options?.sortOrder, options?.page, options?.pageSize, options?.category, options?.contentType, options?.excludeGrouped, options?.fetchAll]);

  useEffect(() => {
    fetchComics();
    return () => {
      // 组件卸载时取消请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchComics]);

  const refetch = useCallback(async () => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    invalidateComicsCache();
    return fetchComics();
  }, [fetchComics]);

  // 导出 setComics 供外部直接更新状态（乐观更新）
  return { comics, setComics, loading, fetching, error, total, totalPages, refetch };
}