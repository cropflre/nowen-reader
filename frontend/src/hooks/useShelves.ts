"use client";

import { useState, useEffect, useCallback } from "react";

export interface ShelfData {
  id: number;
  name: string;
  icon: string;
  sortOrder: number;
  count: number;
  createdAt: string;
}

/**
 * Hook: 获取和管理书架
 */
export function useShelves() {
  const [shelves, setShelves] = useState<ShelfData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchShelves = useCallback(async () => {
    try {
      const res = await fetch("/api/shelves");
      if (res.ok) {
        const data = await res.json();
        setShelves(data.shelves || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShelves();
  }, [fetchShelves]);

  const createShelf = useCallback(async (name: string, icon: string) => {
    try {
      const res = await fetch("/api/shelves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon }),
      });
      if (res.ok) {
        await fetchShelves();
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, [fetchShelves]);

  const updateShelf = useCallback(async (id: number, name: string, icon: string) => {
    try {
      const res = await fetch(`/api/shelves/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon }),
      });
      if (res.ok) {
        await fetchShelves();
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, [fetchShelves]);

  const deleteShelf = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/shelves/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchShelves();
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, [fetchShelves]);

  const addComicToShelf = useCallback(async (shelfId: number, comicIds: string[], move = false) => {
    try {
      const res = await fetch(`/api/shelves/${shelfId}/comics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comicIds, move }),
      });
      if (res.ok) {
        await fetchShelves();
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, [fetchShelves]);

  const removeComicFromShelf = useCallback(async (shelfId: number, comicId: string) => {
    try {
      const res = await fetch(`/api/shelves/${shelfId}/comics`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comicId }),
      });
      if (res.ok) {
        await fetchShelves();
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }, [fetchShelves]);

  const initShelves = useCallback(async (lang: string = "zh") => {
    try {
      const res = await fetch("/api/shelves/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      if (res.ok) {
        const data = await res.json();
        setShelves(data.shelves || []);
      }
    } catch {
      // ignore
    }
  }, []);

  return {
    shelves,
    loading,
    refetch: fetchShelves,
    createShelf,
    updateShelf,
    deleteShelf,
    addComicToShelf,
    removeComicFromShelf,
    initShelves,
  };
}
