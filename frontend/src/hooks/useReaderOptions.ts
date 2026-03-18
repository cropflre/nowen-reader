"use client";

import { useState, useCallback, useEffect } from "react";
import { ReaderOptions, defaultReaderOptions } from "@/types/reader";

const STORAGE_KEY = "reader-options";

/**
 * Hook: 管理阅读器选项，自动持久化到 localStorage
 */
export function useReaderOptions() {
  const [options, setOptions] = useState<ReaderOptions>(defaultReaderOptions);
  const [loaded, setLoaded] = useState(false);

  // 从 localStorage 恢复
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setOptions({ ...defaultReaderOptions, ...parsed });
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  // 更新选项并持久化
  const updateOptions = useCallback((partial: Partial<ReaderOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { options, updateOptions, loaded };
}
