import { apiPath } from "@/lib/base-path";
/**
 * 刮削状态管理 — 文件夹模式 Actions
 *
 * 包含：文件夹树加载、文件夹刮削、视图模式切换等。
 */

import { getState, notify } from "./scraper-core";
import { loadStats } from "./scraper-batch-actions";
import type { ViewMode, CompletedItem } from "./scraper-types";

/* ── 文件夹模式 Actions ── */

export function setViewMode(mode: ViewMode) {
  const state = getState();
  state.viewMode = mode;
  if (mode === "folder" && !state.folderTree && !state.folderTreeLoading) {
    loadFolderTree();
  }
  if (mode === "group" && state.scraperGroups.length === 0 && !state.scraperGroupsLoading) {
    // 延迟导入避免循环依赖
    import("./group-scraper-actions").then(m => m.loadScraperGroups());
  }
  notify();
}

export function setSelectedFolderPath(path: string | null) {
  getState().selectedFolderPath = path;
  notify();
}

export function setFolderSearch(search: string) {
  getState().folderSearch = search;
  notify();
}

export async function loadFolderTree() {
  getState().folderTreeLoading = true;
  notify();
  try {
    const res = await fetch(apiPath("/api/metadata/folder-tree"));
    if (res.ok) {
      getState().folderTree = await res.json();
    }
  } catch {
    // ignore
  } finally {
    getState().folderTreeLoading = false;
    notify();
  }
}

let folderScrapeAbort: AbortController | null = null;

export async function startFolderScrape(folderPath: string, scope: "missing" | "all" = "missing") {
  const state = getState();
  if (state.folderScrapeRunning) return;

  state.folderScrapeRunning = true;
  state.folderScrapeProgress = null;
  state.folderScrapeDone = null;
  state.completedItems = [];
  state.showResults = true;
  notify();

  const abort = new AbortController();
  folderScrapeAbort = abort;
  const lang = navigator.language.startsWith("zh") ? "zh" : "en";

  try {
    const res = await fetch(apiPath("/api/metadata/batch-folder"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderPath,
        mode: state.batchMode,
        scope,
        lang,
        skipCover: state.skipCover,
      }),
      signal: abort.signal,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Request failed" }));
      const s = getState();
      s.folderScrapeDone = { total: 0, success: 0, failed: 0 };
      s.completedItems = [{
        type: "progress",
        current: 0,
        total: 0,
        comicId: "",
        filename: "",
        status: "failed",
        message: errData.error || `HTTP ${res.status}`,
        id: `error-${Date.now()}`,
      } as CompletedItem];
      notify();
      return;
    }

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
            s.folderScrapeDone = data;
            notify();
          } else if (data.type === "progress") {
            s.folderScrapeProgress = {
              current: data.current,
              total: data.total,
              status: data.status,
              filename: data.filename,
            };
            if (data.status === "success" || data.status === "failed" || data.status === "skipped") {
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
      getState().folderScrapeDone = { total: 0, success: 0, failed: 0 };
      notify();
    }
  } finally {
    const s = getState();
    s.folderScrapeRunning = false;
    folderScrapeAbort = null;
    notify();
    loadStats();
    loadFolderTree();
  }
}

export function cancelFolderScrape() {
  folderScrapeAbort?.abort();
  getState().folderScrapeRunning = false;
  notify();
}
