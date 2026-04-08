import { useEffect, useCallback, useRef } from "react";
import {
  syncBus,
  type SyncEvent,
  type SyncEventType,
} from "@/lib/sync-event";

/**
 * 监听特定漫画的同步事件，自动在组件卸载时取消订阅。
 *
 * @param comicId - 要监听的漫画 ID
 * @param onSync - 收到同步事件时的回调
 * @param options - 可选配置
 */
export function useSyncEvent(
  comicId: string | undefined,
  onSync: (event: SyncEvent) => void,
  options?: {
    /** 只监听特定类型的事件 */
    types?: SyncEventType[];
    /** 忽略来自特定来源的事件（避免自己触发自己） */
    ignoreSource?: SyncEvent["source"];
  }
): void {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    if (!comicId || !syncBus) return;

    const unsubscribe = syncBus.on(comicId, (event) => {
      // 过滤来源
      if (options?.ignoreSource && event.source === options.ignoreSource) {
        return;
      }
      // 过滤事件类型
      if (options?.types && !options.types.includes(event.type)) {
        return;
      }
      onSyncRef.current(event);
    });

    return unsubscribe;
  }, [comicId, options?.ignoreSource, options?.types]);
}

/**
 * 监听所有同步事件（全局），适用于刮削页面等需要监听多本漫画的场景。
 *
 * @param onSync - 收到同步事件时的回调
 * @param options - 可选配置
 */
export function useGlobalSyncEvent(
  onSync: (event: SyncEvent) => void,
  options?: {
    types?: SyncEventType[];
    ignoreSource?: SyncEvent["source"];
  }
): void {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    if (!syncBus) return;

    const unsubscribe = syncBus.onAll((event) => {
      if (options?.ignoreSource && event.source === options.ignoreSource) {
        return;
      }
      if (options?.types && !options.types.includes(event.type)) {
        return;
      }
      onSyncRef.current(event);
    });

    return unsubscribe;
  }, [options?.ignoreSource, options?.types]);
}

/**
 * 获取同步历史日志的 hook。
 */
export function useSyncHistory(comicId?: string) {
  const fetchHistory = useCallback(
    async (limit = 20) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (comicId) params.set("comicId", comicId);

      const res = await fetch(`/api/sync/history?${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.logs || [];
    },
    [comicId]
  );

  const revertLog = useCallback(async (logId: number) => {
    const res = await fetch("/api/sync/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logId }),
    });
    return res.ok;
  }, []);

  return { fetchHistory, revertLog };
}
