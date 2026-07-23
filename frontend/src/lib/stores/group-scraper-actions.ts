import { apiPath } from "@/lib/base-path";
/**
 * 刮削状态管理 — 系列模式 Actions
 *
 * 包含：系列列表加载、筛选、排序、分页、批量刮削、脏数据检测等。
 */

import { getState, notify, BATCH_SCRAPE_FIELDS } from "./scraper-core";
import { loadStats } from "./scraper-batch-actions";
import type { GroupMetaFilter, GroupSortBy } from "./scraper-types";

/* ── 系列模式 Actions ── */

export async function loadScraperGroups() {
  getState().scraperGroupsLoading = true;
  notify();
  try {
    const state = getState();
    const params = new URLSearchParams();
    if (state.scraperGroupContentType) {
      params.set("contentType", state.scraperGroupContentType);
    }
    const url = params.toString() ? `/api/groups?${params}` : "/api/groups";
    const res = await fetch(apiPath(url));
    if (!res.ok) throw new Error("Failed to load groups");
    const data = await res.json();
    const groups = data.groups || data || [];
    getState().scraperGroups = (groups as Record<string, unknown>[]).map((g) => ({
      id: g.id as number,
      name: (g.name as string) || "",
      coverUrl: (g.coverUrl as string) || "",
      comicCount: (g.comicCount as number) || 0,
      author: (g.author as string) || "",
      description: (g.description as string) || "",
      genre: (g.genre as string) || "",
      status: (g.status as string) || "",
      tags: (g.tags as string) || "",
      year: (g.year as number | null) ?? null,
      publisher: (g.publisher as string) || "",
      language: (g.language as string) || "",
      updatedAt: (g.updatedAt as string) || "",
      hasMetadata: !!(g.author || g.description || g.genre),
      contentType: (g.contentType as string) || "comic",
    }));
  } catch {
    getState().scraperGroups = [];
  } finally {
    getState().scraperGroupsLoading = false;
    notify();
  }
}

export function setScraperGroupFocusedId(id: number | null) {
  getState().scraperGroupFocusedId = id;
  notify();
}

export function setScraperGroupSearch(search: string) {
  const state = getState();
  state.scraperGroupSearch = search;
  state.groupPage = 1;
  notify();
}

export function setScraperGroupContentType(contentType: string) {
  const state = getState();
  state.scraperGroupContentType = contentType;
  state.groupPage = 1;
  notify();
  loadScraperGroups();
}

export function setScraperGroupMetaFilter(filter: GroupMetaFilter) {
  const state = getState();
  state.scraperGroupMetaFilter = filter;
  state.groupPage = 1;
  notify();
}

export function setScraperGroupSortBy(sortBy: GroupSortBy) {
  const state = getState();
  if (state.scraperGroupSortBy === sortBy) {
    state.scraperGroupSortAsc = !state.scraperGroupSortAsc;
  } else {
    state.scraperGroupSortBy = sortBy;
    state.scraperGroupSortAsc = true;
  }
  state.groupPage = 1;
  notify();
}

export function setGroupPage(page: number) {
  getState().groupPage = page;
  notify();
}

export function setGroupPageSize(size: number) {
  const state = getState();
  state.groupPageSize = size;
  state.groupPage = 1;
  notify();
}

export function toggleSelectGroup(id: number) {
  const state = getState();
  const s = new Set(state.scraperGroupSelectedIds);
  if (s.has(id)) s.delete(id); else s.add(id);
  state.scraperGroupSelectedIds = s;
  notify();
}

export function selectAllVisibleGroups(ids: number[]) {
  const state = getState();
  const allSelected = ids.every((id) => state.scraperGroupSelectedIds.has(id));
  if (allSelected) {
    state.scraperGroupSelectedIds = new Set<number>();
  } else {
    state.scraperGroupSelectedIds = new Set(ids);
  }
  notify();
}

export function clearGroupSelection() {
  getState().scraperGroupSelectedIds = new Set<number>();
  notify();
}

// 系列批量刮削（逐个AI识别）
let groupBatchAbort: AbortController | null = null;

export async function startGroupBatchScrape(groupIds: number[]) {
  const state = getState();
  if (state.groupBatchRunning || groupIds.length === 0) return;
  state.groupBatchRunning = true;
  state.groupBatchProgress = { current: 0, total: groupIds.length, currentName: "" };
  state.groupBatchDone = null;
  groupBatchAbort = new AbortController();
  notify();

  let success = 0;
  let failed = 0;

  for (let i = 0; i < groupIds.length; i++) {
    if (groupBatchAbort?.signal.aborted) break;

    const gid = groupIds[i];
    const group = state.scraperGroups.find((g) => g.id === gid);
    getState().groupBatchProgress = {
      current: i + 1,
      total: groupIds.length,
      currentName: group?.name || `#${gid}`,
    };
    notify();

    try {
      const res = await fetch(apiPath(`/api/groups/${gid}/ai-recognize`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: "zh", autoApply: true }),
        signal: groupBatchAbort?.signal,
      });
      if (res.ok) {
        success++;
      } else {
        failed++;
      }
    } catch {
      if (groupBatchAbort?.signal.aborted) break;
      failed++;
    }
  }

  const s = getState();
  s.groupBatchRunning = false;
  s.groupBatchProgress = null;
  s.groupBatchDone = { total: groupIds.length, success, failed };
  groupBatchAbort = null;
  notify();

  loadScraperGroups();
  loadStats();
}

export function cancelGroupBatchScrape() {
  groupBatchAbort?.abort();
  getState().groupBatchRunning = false;
  notify();
}

export function clearGroupBatchDone() {
  getState().groupBatchDone = null;
  notify();
}

/* ── 批量在线刮削 Actions ── */

export function openGroupBatchScrapeDialog(mode: "online" | "ai" = "online") {
  const state = getState();
  state.groupBatchScrapeDialogOpen = true;
  state.groupBatchScrapeMode = mode;
  state.groupBatchScrapePreview = null;
  state.groupBatchScrapeResult = null;
  notify();
}

export function closeGroupBatchScrapeDialog() {
  const state = getState();
  state.groupBatchScrapeDialogOpen = false;
  state.groupBatchScrapePreview = null;
  state.groupBatchScrapeResult = null;
  state.groupBatchScrapePreviewLoading = false;
  state.groupBatchScrapeApplying = false;
  notify();
}

export function setGroupBatchScrapeMode(mode: "online" | "ai") {
  const state = getState();
  state.groupBatchScrapeMode = mode;
  state.groupBatchScrapePreview = null;
  state.groupBatchScrapeResult = null;
  notify();
}

export function toggleGroupBatchScrapeField(field: string) {
  const state = getState();
  const next = new Set(state.groupBatchScrapeFields);
  if (next.has(field)) {
    next.delete(field);
  } else {
    next.add(field);
  }
  state.groupBatchScrapeFields = next;
  notify();
}

export function setGroupBatchScrapeAllFields(selectAll: boolean) {
  const state = getState();
  if (selectAll) {
    state.groupBatchScrapeFields = new Set(BATCH_SCRAPE_FIELDS.map((f) => f.id));
  } else {
    state.groupBatchScrapeFields = new Set();
  }
  notify();
}

export function setGroupBatchScrapeOverwrite(v: boolean) {
  getState().groupBatchScrapeOverwrite = v;
  notify();
}

export function setGroupBatchScrapeSyncTags(v: boolean) {
  getState().groupBatchScrapeSyncTags = v;
  notify();
}

export function setGroupBatchScrapeSyncToVolumes(v: boolean) {
  getState().groupBatchScrapeSyncToVolumes = v;
  notify();
}

export function toggleGroupBatchScrapeSource(source: string) {
  const state = getState();
  const sources = [...state.groupBatchScrapeSources];
  const idx = sources.indexOf(source);
  if (idx >= 0) {
    sources.splice(idx, 1);
  } else {
    sources.push(source);
  }
  state.groupBatchScrapeSources = sources;
  notify();
}

/** 预览批量刮削结果（dryRun 模式） */
export async function previewGroupBatchScrape(groupIds: number[]) {
  const state = getState();
  if (state.groupBatchScrapePreviewLoading || groupIds.length === 0) return;
  state.groupBatchScrapePreviewLoading = true;
  state.groupBatchScrapePreview = null;
  state.groupBatchScrapeResult = null;
  notify();

  try {
    const res = await fetch(apiPath("/api/groups/batch-scrape"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupIds,
        sources: state.groupBatchScrapeSources,
        lang: "zh",
        fields: Array.from(state.groupBatchScrapeFields),
        overwrite: state.groupBatchScrapeOverwrite,
        syncTags: state.groupBatchScrapeSyncTags,
        syncToVolumes: state.groupBatchScrapeSyncToVolumes,
        autoApply: false,
        dryRun: true,
        contentType: state.scraperGroupContentType || "",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      getState().groupBatchScrapePreview = data.results || [];
    }
  } catch {
    getState().groupBatchScrapePreview = [];
  } finally {
    getState().groupBatchScrapePreviewLoading = false;
    notify();
  }
}

/** 确认执行批量刮削（实际应用） */
export async function applyGroupBatchScrape(groupIds: number[]) {
  const state = getState();
  if (state.groupBatchScrapeApplying || groupIds.length === 0) return;
  state.groupBatchScrapeApplying = true;
  state.groupBatchScrapeResult = null;
  notify();

  try {
    const res = await fetch(apiPath("/api/groups/batch-scrape"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupIds,
        sources: state.groupBatchScrapeSources,
        lang: "zh",
        fields: Array.from(state.groupBatchScrapeFields),
        overwrite: state.groupBatchScrapeOverwrite,
        syncTags: state.groupBatchScrapeSyncTags,
        syncToVolumes: state.groupBatchScrapeSyncToVolumes,
        autoApply: true,
        dryRun: false,
        contentType: state.scraperGroupContentType || "",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      getState().groupBatchScrapeResult = {
        total: data.total || 0,
        success: data.success || 0,
        failed: data.failed || 0,
        applied: data.applied || 0,
        results: data.results || [],
      };
    }
  } catch {
    // ignore
  } finally {
    getState().groupBatchScrapeApplying = false;
    notify();
    loadScraperGroups();
    loadStats();
  }
}

export function clearGroupBatchScrapeResult() {
  const state = getState();
  state.groupBatchScrapeResult = null;
  state.groupBatchScrapePreview = null;
  notify();
}

/* ── 脏数据检测与清理 Actions ── */

export async function detectDirtyData() {
  const state = getState();
  state.dirtyDetecting = true;
  state.dirtyIssues = [];
  state.dirtyStats = null;
  state.cleanupResult = null;
  notify();
  try {
    const res = await fetch(apiPath("/api/groups/detect-dirty"), { method: "POST" });
    if (!res.ok) throw new Error("检测失败");
    const data = await res.json();
    const s = getState();
    s.dirtyIssues = data.issues || [];
    s.dirtyStats = data.stats || null;
  } catch {
    const s = getState();
    s.dirtyIssues = [];
    s.dirtyStats = null;
  } finally {
    getState().dirtyDetecting = false;
    notify();
  }
}

export async function runCleanup(actions?: string[]) {
  getState().dirtyCleaning = true;
  getState().cleanupResult = null;
  notify();
  try {
    const res = await fetch(apiPath("/api/groups/cleanup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions: actions || ["full"] }),
    });
    if (!res.ok) throw new Error("清理失败");
    const data = await res.json();
    getState().cleanupResult = data.result || null;
  } catch {
    getState().cleanupResult = null;
  } finally {
    getState().dirtyCleaning = false;
    notify();
    loadScraperGroups();
    loadStats();
  }
}

export async function fixGroupName(groupId: number, newName: string) {
  try {
    const res = await fetch(apiPath("/api/groups/fix-name"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, newName }),
    });
    if (!res.ok) throw new Error("修复失败");
    loadScraperGroups();
    const state = getState();
    state.dirtyIssues = state.dirtyIssues.filter(
      (i) => !(i.type === "dirty_name" && i.groupId === groupId)
    );
    notify();
    return true;
  } catch {
    return false;
  }
}

export function clearCleanupResult() {
  getState().cleanupResult = null;
  notify();
}

export function clearDirtyIssues() {
  const state = getState();
  state.dirtyIssues = [];
  state.dirtyStats = null;
  state.cleanupResult = null;
  notify();
}
