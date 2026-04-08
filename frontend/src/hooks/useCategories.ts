"use client";

import { useState, useEffect, useCallback } from "react";
import type { ApiCategory } from "./useComicTypes";

/**
 * Hook: 获取和管理分类
 */
export function useCategories() {
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [groupCategories, setGroupCategories] = useState<ApiCategory[]>([]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch {
      // ignore
    }
  }, []);

  // 获取系列级分类统计（用于系列视图的分类筛选）
  const fetchGroupCategories = useCallback(async (contentType?: string) => {
    try {
      const params = new URLSearchParams({ scope: "groups" });
      if (contentType) params.set("contentType", contentType);
      const res = await fetch(`/api/categories?${params}`);
      if (res.ok) {
        const data = await res.json();
        setGroupCategories(data.categories || []);
      }
    } catch {
      // ignore
    }
  }, []);

  // 初始化分类
  const initCategories = useCallback(async (lang: string = "zh") => {
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  return {
    categories,
    groupCategories,
    refetch: fetchCategories,
    refetchGroupCategories: fetchGroupCategories,
    initCategories,
  };
}
