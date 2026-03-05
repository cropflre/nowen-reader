"use client";

import { useState, useEffect, useCallback } from "react";

export interface ApiComicTag {
  name: string;
  color: string;
}

export interface ApiComic {
  id: string;
  title: string;
  filename: string;
  pageCount: number;
  fileSize: number;
  addedAt: string;
  lastReadPage: number;
  lastReadAt: string | null;
  isFavorite: boolean;
  rating: number | null;
  coverUrl: string;
  sortOrder: number;
  groupName: string;
  totalReadTime: number;
  tags: ApiComicTag[];
  // Metadata fields
  author: string;
  publisher: string;
  year: number | null;
  description: string;
  language: string;
  seriesName: string;
  seriesIndex: number | null;
  genre: string;
  metadataSource: string;
}

interface ComicsResponse {
  comics: ApiComic[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface PagesResponse {
  comicId: string;
  title: string;
  totalPages: number;
  pages: { index: number; name: string; url: string }[];
}

/**
 * Hook to fetch the comics library list
 */
export function useComics(options?: {
  search?: string;
  tags?: string[];
  favoritesOnly?: boolean;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
}) {
  const [comics, setComics] = useState<ApiComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchComics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (options?.search) params.set("search", options.search);
      if (options?.tags?.length) params.set("tags", options.tags.join(","));
      if (options?.favoritesOnly) params.set("favorites", "true");
      if (options?.sortBy) params.set("sortBy", options.sortBy);
      if (options?.sortOrder) params.set("sortOrder", options.sortOrder);
      if (options?.page) params.set("page", String(options.page));
      if (options?.pageSize) params.set("pageSize", String(options.pageSize));

      const qs = params.toString();
      const url = `/api/comics${qs ? `?${qs}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch comics");
      const data: ComicsResponse = await res.json();
      setComics(data.comics);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [options?.search, options?.tags, options?.favoritesOnly, options?.sortBy, options?.sortOrder, options?.page, options?.pageSize]);

  useEffect(() => {
    fetchComics();
  }, [fetchComics]);

  return { comics, loading, error, total, totalPages, refetch: fetchComics };
}

/**
 * Hook to fetch pages for a specific comic
 */
export function useComicPages(comicId: string) {
  const [pages, setPages] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!comicId) return;

    setLoading(true);
    setError(null);

    fetch(`/api/comics/${comicId}/pages`)
      .then((res) => {
        if (!res.ok) throw new Error("Comic not found");
        return res.json();
      })
      .then((data: PagesResponse) => {
        setTitle(data.title);
        setPages(data.pages.map((p) => p.url));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [comicId]);

  return { pages, title, loading, error };
}

/**
 * Hook for comic details (with DB metadata)
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
        setComic(data);
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

/**
 * Upload files to the server
 */
export async function uploadComics(
  files: FileList | File[]
): Promise<{ success: boolean; message: string }> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
  return {
    success: res.ok,
    message: data.message || data.error,
  };
}

/**
 * Save reading progress
 */
export async function saveReadingProgress(comicId: string, page: number) {
  try {
    await fetch(`/api/comics/${comicId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
    });
  } catch {
    // Silently fail — progress saving shouldn't block reading
  }
}

/**
 * Toggle favorite
 */
export async function toggleComicFavorite(
  comicId: string
): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/comics/${comicId}/favorite`, {
      method: "PUT",
    });
    if (res.ok) {
      const data = await res.json();
      return data.isFavorite;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Update rating
 */
export async function updateComicRating(
  comicId: string,
  rating: number | null
) {
  try {
    await fetch(`/api/comics/${comicId}/rating`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
  } catch {
    // ignore
  }
}

/**
 * Add tags to a comic
 */
export async function addComicTags(comicId: string, tags: string[]) {
  try {
    await fetch(`/api/comics/${comicId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
  } catch {
    // ignore
  }
}

/**
 * Remove a tag from a comic
 */
export async function removeComicTag(comicId: string, tag: string) {
  try {
    await fetch(`/api/comics/${comicId}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
  } catch {
    // ignore
  }
}

// ============================================================
// Batch Operations
// ============================================================

export async function batchOperation(
  action: string,
  comicIds: string[],
  params?: Record<string, unknown>
) {
  try {
    const res = await fetch("/api/comics/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, comicIds, ...params }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteComicById(comicId: string) {
  try {
    const res = await fetch(`/api/comics/${comicId}/delete`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================
// Reading Statistics
// ============================================================

export async function startSession(comicId: string, startPage: number): Promise<number | null> {
  try {
    const res = await fetch("/api/stats/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicId, startPage }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.sessionId;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function endSession(sessionId: number, endPage: number, duration: number) {
  try {
    await fetch("/api/stats/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, endPage, duration }),
    });
  } catch {
    // ignore
  }
}

import { ReadingStats } from "@/types/comic";

export function useReadingStats() {
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}

// ============================================================
// Sort Order
// ============================================================

export async function updateSortOrders(orders: { id: string; sortOrder: number }[]) {
  try {
    await fetch("/api/comics/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders }),
    });
  } catch {
    // ignore
  }
}

// ============================================================
// Group Management
// ============================================================

export async function updateComicGroup(comicId: string, groupName: string) {
  try {
    await fetch(`/api/comics/${comicId}/group`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupName }),
    });
  } catch {
    // ignore
  }
}

export function useGroups() {
  const [groups, setGroups] = useState<{ name: string; count: number }[]>([]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return { groups, refetch: fetchGroups };
}
