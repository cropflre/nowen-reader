import { apiPath } from "@/lib/base-path";
/**
 * 刮削状态管理 — 刮削批处理 Actions
 *
 * 包含：批量刮削启动/停止、统计加载、进度管理等。
 */

import { getState, notify } from "./scraper-core";
import type { BatchMode, ScrapeScope, CompletedItem } from "./scraper-types";

let abortController: AbortController | null = null;

export function setBatchMode(mode: BatchMode) {
  const state = getState();
  if (state.batchRunning) return;
  state.batchMode = mode;
  notify();
}

export function setScrapeScope(scope: ScrapeScope) {
  const state = getState();
  if (state.batchRunning) return;
  state.scrapeScope = scope;
  notify();
}

export function setShowResults(show: boolean) {
  getState().showResults = show;
  notify();
}

export function setUpdateTitle(enabled: boolean) {
  const state = getState();
  if (state.batchRunning) return;
  state.updateTitle = enabled;
  notify();
}

export function setSkipCover(enabled: boolean) {
  const state = getState();
  if (state.batchRunning) return;
  state.skipCover = enabled;
  notify();
}

export async function loadStats() {
  const state = getState();
  state.statsLoading = true;
  notify();
  try {
    const res = await fetch(apiPath("/api/metadata/stats"));
    if (res.ok) {
      getState().stats = await res.json();
    }
  } catch {
    // ignore
  } finally {
    getState().statsLoading = false;
    notify();
  }
}

export async function startBatch() {
  const state = getState();
  if (state.batchRunning) return;

  state.batchRunning = true;
  state.currentProgress = null;
  state.batchDone = null;
  state.completedItems = [];
  state.showResults = true;
  notify();

  const abort = new AbortController();
  abortController = abort;

  const endpoint =
    state.batchMode === "ai" ? "/api/metadata/ai-batch" : "/api/metadata/batch";
  const lang = navigator.language.startsWith("zh") ? "zh" : "en";

  try {
    const res = await fetch(apiPath(endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.scrapeScope, lang, updateTitle: state.updateTitle, skipCover: state.skipCover }),
      signal: abort.signal,
    });

    // 处理非SSE错误响应（如AI未配置返回400）
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Request failed" }));
      const s = getState();
      s.batchDone = { type: "complete", success: 0, failed: 0, total: 0 };
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
            s.batchDone = data;
            notify();
          } else if (data.type === "progress") {
            s.currentProgress = data;
            if (
              data.status === "success" ||
              data.status === "failed" ||
              data.status === "skipped"
            ) {
              s.completedItems = [
                ...s.completedItems,
                { ...data, id: `${data.comicId}-${Date.now()}` },
              ];
            }
            notify();
          }
        } catch {
          /* skip */
        }
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
    abortController = null;
    notify();
    loadStats();
  }
}

export function cancelBatch() {
  abortController?.abort();
  getState().batchRunning = false;
  notify();
}
