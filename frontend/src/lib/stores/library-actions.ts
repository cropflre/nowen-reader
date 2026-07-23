import { apiPath } from "@/lib/base-path";
/**
 * 刮削状态管理 — 书库管理 Actions
 *
 * 包含：书库列表加载、搜索、筛选、排序、分页、选择、批量编辑等。
 */

import { getState, notify } from "./scraper-core";
import { loadStats } from "./scraper-batch-actions";
import type { ActiveTab, MetaFilter, LibrarySortBy, BatchEditNameEntry, CompletedItem } from "./scraper-types";

/* ── Tab 切换 ── */
export function setActiveTab(tab: ActiveTab) {
  getState().activeTab = tab;
  notify();
}

/* ── 书库管理 Actions ── */

export function setLibrarySearch(search: string) {
  const state = getState();
  state.librarySearch = search;
  state.libraryPage = 1;
  notify();
}

export function setLibraryMetaFilter(filter: MetaFilter) {
  const state = getState();
  state.libraryMetaFilter = filter;
  state.libraryPage = 1;
  notify();
}

export function setLibraryContentType(ct: string) {
  const state = getState();
  state.libraryContentType = ct;
  state.libraryPage = 1;
  notify();
}

export function setLibraryPage(page: number) {
  getState().libraryPage = page;
  notify();
}

export function setLibraryPageSize(size: number) {
  const state = getState();
  state.libraryPageSize = size;
  state.libraryPage = 1;
  notify();
}

export function setLibrarySort(sortBy: LibrarySortBy, sortOrder?: "asc" | "desc") {
  const state = getState();
  if (state.librarySortBy === sortBy && !sortOrder) {
    state.librarySortOrder = state.librarySortOrder === "asc" ? "desc" : "asc";
  } else {
    state.librarySortBy = sortBy;
    state.librarySortOrder = sortOrder || (sortBy === "updatedAt" ? "desc" : "asc");
  }
  state.libraryPage = 1;
  try {
    localStorage.setItem("scraper-sortBy", state.librarySortBy);
    localStorage.setItem("scraper-sortOrder", state.librarySortOrder);
  } catch { /* ignore */ }
  notify();
}

export function setFocusedItem(id: string | null) {
  getState().focusedItemId = id;
  notify();
}

/* ── 选择 Actions ── */

export function toggleSelectItem(id: string) {
  const state = getState();
  const next = new Set(state.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  state.selectedIds = next;
  notify();
}

export function selectAllVisible() {
  const state = getState();
  const next = new Set(state.selectedIds);
  for (const item of state.libraryItems) {
    next.add(item.id);
  }
  state.selectedIds = next;
  notify();
}

export function deselectAll() {
  getState().selectedIds = new Set();
  notify();
}

/* ── 书库加载 ── */

export async function loadLibrary() {
  const state = getState();
  state.libraryLoading = true;
  notify();
  try {
    const params = new URLSearchParams({
      page: String(state.libraryPage),
      pageSize: String(state.libraryPageSize),
      metaFilter: state.libraryMetaFilter,
    });
    if (state.librarySearch) params.set("search", state.librarySearch);
    if (state.libraryContentType) params.set("contentType", state.libraryContentType);
    if (state.librarySortBy) params.set("sortBy", state.librarySortBy);
    if (state.librarySortOrder) params.set("sortOrder", state.librarySortOrder);

    const res = await fetch(apiPath(`/api/metadata/library?${params}`));
    if (res.ok) {
      const data = await res.json();
      const s = getState();
      s.libraryItems = data.items || [];
      s.libraryTotal = data.total || 0;
      s.libraryTotalPages = data.totalPages || 1;
    }
  } catch {
    // ignore
  } finally {
    getState().libraryLoading = false;
    notify();
  }
}

/* ── 批量选中刮削 ── */

let selectedAbortController: AbortController | null = null;

export async function startBatchSelected() {
  const state = getState();
  if (state.batchRunning || state.selectedIds.size === 0) return;

  state.activeTab = "scrape";
  state.batchRunning = true;
  state.currentProgress = null;
  state.batchDone = null;
  state.completedItems = [];
  state.showResults = true;
  notify();

  const abort = new AbortController();
  selectedAbortController = abort;
  const lang = navigator.language.startsWith("zh") ? "zh" : "en";

  try {
    const res = await fetch(apiPath("/api/metadata/batch-selected"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comicIds: Array.from(state.selectedIds),
        lang,
        updateTitle: state.updateTitle,
        mode: state.batchMode,
        skipCover: state.skipCover,
      }),
      signal: abort.signal,
    });

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          const s = getState();
          if (data.type === "complete") {
            s.batchDone = data;
            notify();
          } else if (data.type === "progress") {
            s.currentProgress = data;
            if (data.status === "success" || data.status === "failed" || data.status === "skipped" || data.status === "warning") {
              s.completedItems = [
                ...s.completedItems,
                { ...data, id: `${data.comicId}-${Date.now()}` },
              ];
            }
            notify();
          }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      getState().batchDone = { type: "complete", success: 0, failed: 0, total: 0 };
      notify();
    }
  } finally {
    const s = getState();
    s.batchRunning = false;
    selectedAbortController = null;
    s.selectedIds = new Set();
    notify();
    loadStats();
    loadLibrary();
  }
}

export async function clearSelectedMetadata() {
  const state = getState();
  if (state.selectedIds.size === 0) return;
  try {
    const res = await fetch(apiPath("/api/metadata/clear"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds: Array.from(state.selectedIds) }),
    });
    if (res.ok) {
      getState().selectedIds = new Set();
      notify();
      loadLibrary();
      loadStats();
    }
  } catch {
    // ignore
  }
}

/* ── 批量编辑模式 Actions ── */

export function enterBatchEditMode() {
  const state = getState();
  if (state.selectedIds.size === 0) return;
  const names = new Map<string, BatchEditNameEntry>();
  for (const item of state.libraryItems) {
    if (state.selectedIds.has(item.id)) {
      names.set(item.id, {
        comicId: item.id,
        filename: item.filename,
        oldTitle: item.title,
        newTitle: item.title,
      });
    }
  }
  state.batchEditMode = true;
  state.batchEditNames = names;
  state.batchEditResults = null;
  state.focusedItemId = null;
  notify();
}

export function exitBatchEditMode() {
  const state = getState();
  state.batchEditMode = false;
  state.batchEditNames = new Map();
  state.batchEditResults = null;
  state.aiRenameLoading = false;
  notify();
}

export function setBatchEditName(comicId: string, newTitle: string) {
  const state = getState();
  const entry = state.batchEditNames.get(comicId);
  if (entry) {
    state.batchEditNames = new Map(state.batchEditNames);
    state.batchEditNames.set(comicId, { ...entry, newTitle });
    notify();
  }
}

export function applyNameToAll(title: string) {
  const state = getState();
  const next = new Map<string, BatchEditNameEntry>();
  for (const [id, entry] of state.batchEditNames) {
    next.set(id, { ...entry, newTitle: title });
  }
  state.batchEditNames = next;
  notify();
}

export function undoBatchEditNames() {
  const state = getState();
  const next = new Map<string, BatchEditNameEntry>();
  for (const [id, entry] of state.batchEditNames) {
    next.set(id, { ...entry, newTitle: entry.oldTitle });
  }
  state.batchEditNames = next;
  state.batchEditResults = null;
  notify();
}

export async function saveBatchRename() {
  const state = getState();
  if (state.batchEditSaving) return;

  const items: { comicId: string; newTitle: string }[] = [];
  for (const [, entry] of state.batchEditNames) {
    if (entry.newTitle.trim() && entry.newTitle.trim() !== entry.oldTitle) {
      items.push({ comicId: entry.comicId, newTitle: entry.newTitle.trim() });
    }
  }

  if (items.length === 0) return;

  state.batchEditSaving = true;
  state.batchEditResults = null;
  notify();

  try {
    const res = await fetch(apiPath("/api/metadata/batch-rename"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (res.ok) {
      const data = await res.json();
      const s = getState();
      s.batchEditResults = data.results || [];
      const next = new Map(s.batchEditNames);
      for (const result of data.results || []) {
        if (result.status === "success") {
          const entry = next.get(result.comicId);
          if (entry) {
            next.set(result.comicId, { ...entry, oldTitle: entry.newTitle });
          }
        }
      }
      s.batchEditNames = next;
      loadLibrary();
      loadStats();
    }
  } catch {
    // ignore
  } finally {
    getState().batchEditSaving = false;
    notify();
  }
}

export async function aiRename(prompt: string): Promise<string | null> {
  const state = getState();
  if (state.aiRenameLoading || state.batchEditNames.size === 0) return null;

  state.aiRenameLoading = true;
  notify();

  const items = Array.from(state.batchEditNames.values()).map((e) => ({
    comicId: e.comicId,
    filename: e.filename,
    title: e.oldTitle,
  }));

  const lang = navigator.language.startsWith("zh") ? "zh" : "en";

  try {
    const res = await fetch(apiPath("/api/metadata/ai-rename"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, prompt, lang }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Request failed" }));
      return errData.error || `HTTP ${res.status}`;
    }
    const data = await res.json();
    if (data.results) {
      const s = getState();
      const next = new Map(s.batchEditNames);
      for (const r of data.results) {
        const entry = next.get(r.comicId);
        if (entry && r.newTitle) {
          next.set(r.comicId, { ...entry, newTitle: r.newTitle });
        }
      }
      s.batchEditNames = next;
    }
    return null;
  } catch (err) {
    return (err as Error).message || "Unknown error";
  } finally {
    getState().aiRenameLoading = false;
    notify();
  }
}
