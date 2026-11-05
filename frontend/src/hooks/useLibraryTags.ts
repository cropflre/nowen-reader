import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath } from "@/lib/base-path";
import { syncBus, type SyncEventType } from "@/lib/sync-event";

const TAG_EVENTS = new Set<SyncEventType>([
  "tags_updated",
  "scrape_applied",
  "metadata_cleared",
  "batch_sync_complete",
]);

/** Keep filter options current after local edits, cross-tab edits and external writes. */
export function useLibraryTags(scope: string | undefined) {
  const [snapshot, setSnapshot] = useState<{ scope: string | undefined; tags: string[]; loaded: boolean }>({
    scope, tags: [], loaded: false,
  });
  const refreshRef = useRef(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let version = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const load = async (requestVersion: number) => {
      const requestController = new AbortController();
      controller = requestController;
      try {
        const res = await fetch(apiPath("/api/tags"), {
          signal: requestController.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const entries: unknown = Array.isArray(data) ? data : data?.tags;
        if (!Array.isArray(entries)) return;
        const tags = [...new Set(entries
          .filter((tag): tag is { name: string } => typeof tag?.name === "string" && tag.name.length > 0)
          .map((tag) => tag.name))].sort();
        if (disposed || requestController.signal.aborted || requestVersion !== version) return;
        setSnapshot({ scope, tags, loaded: true });
      } catch {
        // Keep the last usable list during a temporary network failure.
      }
    };

    // Coalesce focus + visibilitychange and bursts of batch mutation events.
    // Invalidate pending responses immediately so a late result cannot restore old names.
    const scheduleRefresh = () => {
      const requestVersion = ++version;
      clearTimeout(timer);
      controller?.abort();
      timer = setTimeout(() => { void load(requestVersion); }, 100);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    refreshRef.current = scheduleRefresh;
    const unsubscribe = syncBus?.onAll((event) => {
      if (TAG_EVENTS.has(event.type)) scheduleRefresh();
    });
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("nowen:tags-updated", scheduleRefresh);
    void load(++version);

    return () => {
      disposed = true;
      refreshRef.current = () => {};
      clearTimeout(timer);
      controller?.abort();
      unsubscribe?.();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("nowen:tags-updated", scheduleRefresh);
    };
  }, [scope]);

  return {
    tags: snapshot.scope === scope ? snapshot.tags : [],
    loaded: snapshot.scope === scope && snapshot.loaded,
    refresh,
  };
}
