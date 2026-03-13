"use client";

import { useState, useEffect, useCallback } from "react";
import type { ApiCategory } from "./useComicTypes";

/**
 * Hook: 获取和管理分类
 */
export function useCategories() {
  const [categories, setCategories] = useState<ApiCategory[]>([]);

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

  return { categories, refetch: fetchCategories, initCategories };
}
