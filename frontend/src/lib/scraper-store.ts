/**
 * 全局刮削状态管理 (模块级单例)
 *
 * SSE 连接和进度状态保存在模块作用域中，
 * 页面组件卸载/重新挂载不会丢失正在进行的刮削进度。
 */

/* ── 类型 ── */
export interface ProgressItem {
  type: string;
  current: number;
  total: number;
  comicId: string;
  filename: string;
  step?: string;
  status?: string;
  source?: string;
  message?: string;
  matchTitle?: string;
  resultsCount?: number;
  parsed?: {
    title?: string;
    author?: string;
    year?: number;
    language?: string;
    genre?: string;
    group?: string;
    tags?: string;
  };
}

export interface CompletedItem extends ProgressItem {
  id: string;
}

export interface BatchDone {
  type: string;
  total: number;
  success: number;
  failed: number;
}

export interface MetadataStats {
  total: number;
  withMetadata: number;
  missing: number;
}

export type BatchMode = "standard" | "ai";
export type ScrapeScope = "missing" | "all";

export type MetaFilter = "all" | "with" | "missing";
export type ActiveTab = "scrape" | "library";

export interface LibraryItemTag {
  name: string;
  color: string;
}

export interface LibraryItem {
  id: string;
  title: string;
  filename: string;
  author: string;
  genre: string;
  description: string;
  year: number | null;
  fileSize: number;
  updatedAt: string;
  metadataSource: string;
  hasMetadata: boolean;
  contentType: string;
  tags: LibraryItemTag[];
}

export type LibrarySortBy = "title" | "fileSize" | "updatedAt" | "metaStatus";

export interface BatchEditNameEntry {
  comicId: string;
  filename: string;
  oldTitle: string;
  newTitle: string;
}

export interface BatchRenameResult {
  comicId: string;
  status: "success" | "failed" | "skipped";
  newTitle?: string;
  message?: string;
}

/* ── AI 聊天相关类型 ── */

export interface AIChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  /** 指令执行结果（仅系统消息） */
  commandResult?: {
    action: string;
    success: boolean;
    message: string;
  };
}

export interface AIChatQuickCommand {
  label: string;
  prompt: string;
  icon?: string;
}

/* ── 合集管理相关类型 ── */

export interface CollectionGroup {
  id: number;
  name: string;
  coverUrl: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  comicCount: number;
}

export interface CollectionGroupDetail extends CollectionGroup {
  comics: CollectionGroupComic[];
}

export interface CollectionGroupComic {
  id: string;
  filename: string;
  title: string;
  pageCount: number;
  fileSize: number;
  lastReadPage: number;
  totalReadTime: number;
  coverUrl: string;
  sortIndex: number;
  readingStatus: string;
  lastReadAt: string | null;
}

export interface AutoDetectSuggestion {
  name: string;
  comicIds: string[];
  titles: string[];
}

/* ── 引导教程系统相关类型 ── */

export interface GuideStep {
  id: string;
  /** 高亮目标元素的 CSS 选择器 */
  targetSelector: string;
  /** 标题 key (i18n) */
  titleKey: string;
  /** 描述 key (i18n) */
  descKey: string;
  /** 弹窗位置 */
  placement: "top" | "bottom" | "left" | "right";
  /** 操作提示 key (可选) */
  actionKey?: string;
}

export interface ScraperState {
  // 统计
  stats: MetadataStats | null;
  statsLoading: boolean;
  // 运行状态
  batchRunning: boolean;
  batchMode: BatchMode;
  scrapeScope: ScrapeScope;
  updateTitle: boolean;
  // 进度
  currentProgress: ProgressItem | null;
  batchDone: BatchDone | null;
  completedItems: CompletedItem[];
  showResults: boolean;
  // 书库管理
  activeTab: ActiveTab;
  libraryItems: LibraryItem[];
  libraryLoading: boolean;
  librarySearch: string;
  libraryMetaFilter: MetaFilter;
  libraryContentType: string; // "comic" | "novel"
  librarySortBy: LibrarySortBy;
  librarySortOrder: "asc" | "desc";
  libraryPage: number;
  libraryPageSize: number;
  libraryTotalPages: number;
  libraryTotal: number;
  selectedIds: Set<string>;
  // 详情面板
  focusedItemId: string | null;
  // 批量编辑模式
  batchEditMode: boolean;
  batchEditNames: Map<string, BatchEditNameEntry>;
  batchEditSaving: boolean;
  batchEditResults: BatchRenameResult[] | null;
  aiRenameLoading: boolean;

  // AI 聊天面板
  aiChatOpen: boolean;
  aiChatMessages: AIChatMessage[];
  aiChatLoading: boolean;
  aiChatInput: string;

  // 引导教程系统
  guideActive: boolean;
  guideCurrentStep: number;
  guideDismissed: boolean;   // 用户是否已永久关闭引导
  helpPanelOpen: boolean;    // 帮助面板是否打开
  helpSearchQuery: string;   // 帮助面板搜索词

  // 合集管理
  collectionPanelOpen: boolean;       // 合集管理面板是否打开
  collectionGroups: CollectionGroup[]; // 合集列表
  collectionGroupsLoading: boolean;
  collectionDetail: CollectionGroupDetail | null; // 当前查看的合集详情
  collectionDetailLoading: boolean;
  collectionAutoSuggestions: AutoDetectSuggestion[]; // 智能检测建议
  collectionAutoLoading: boolean;
  collectionCreateDialog: boolean;    // 创建合集弹窗
  collectionAddToGroupDialog: boolean; // 添加到合集弹窗（从选中项触发）
  collectionEditingId: number | null; // 正在编辑的合集ID
  collectionEditingName: string;      // 编辑中的合集名称
}

/* ── 模块级状态 ── */
let state: ScraperState = {
  stats: null,
  statsLoading: false,
  batchRunning: false,
  batchMode: "standard",
  scrapeScope: "missing",
  updateTitle: false,
  currentProgress: null,
  batchDone: null,
  completedItems: [],
  showResults: true,
  // 书库管理
  activeTab: "scrape",
  libraryItems: [],
  libraryLoading: false,
  librarySearch: "",
  libraryMetaFilter: "all",
  libraryContentType: "comic",
  librarySortBy: (typeof globalThis !== "undefined" && globalThis.localStorage?.getItem("scraper-sortBy") as LibrarySortBy) || "title",
  librarySortOrder: (typeof globalThis !== "undefined" && globalThis.localStorage?.getItem("scraper-sortOrder") as "asc" | "desc") || "asc",
  libraryPage: 1,
  libraryPageSize: 20,
  libraryTotalPages: 1,
  libraryTotal: 0,
  selectedIds: new Set(),
  // 详情面板
  focusedItemId: null,
  // 批量编辑模式
  batchEditMode: false,
  batchEditNames: new Map(),
  batchEditSaving: false,
  batchEditResults: null,
  aiRenameLoading: false,

  // AI 聊天面板
  aiChatOpen: false,
  aiChatMessages: [],
  aiChatLoading: false,
  aiChatInput: "",

  // 引导教程系统
  guideActive: false,
  guideCurrentStep: 0,
  guideDismissed: typeof globalThis !== "undefined" ? globalThis.localStorage?.getItem("scraper-guide-dismissed") === "true" : false,
  helpPanelOpen: false,
  helpSearchQuery: "",

  // 合集管理
  collectionPanelOpen: false,
  collectionGroups: [],
  collectionGroupsLoading: false,
  collectionDetail: null,
  collectionDetailLoading: false,
  collectionAutoSuggestions: [],
  collectionAutoLoading: false,
  collectionCreateDialog: false,
  collectionAddToGroupDialog: false,
  collectionEditingId: null,
  collectionEditingName: "",
};

let abortController: AbortController | null = null;
const listeners = new Set<() => void>();

/* ── 订阅机制 ── */
function notify() {
  // 创建新的 state 引用以触发 useSyncExternalStore 重渲染
  state = { ...state };
  listeners.forEach((fn) => fn());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ScraperState {
  return state;
}

/* ── Actions ── */

export function setBatchMode(mode: BatchMode) {
  if (state.batchRunning) return;
  state.batchMode = mode;
  notify();
}

export function setScrapeScope(scope: ScrapeScope) {
  if (state.batchRunning) return;
  state.scrapeScope = scope;
  notify();
}

export function setShowResults(show: boolean) {
  state.showResults = show;
  notify();
}

export function setUpdateTitle(enabled: boolean) {
  if (state.batchRunning) return;
  state.updateTitle = enabled;
  notify();
}

export async function loadStats() {
  state.statsLoading = true;
  notify();
  try {
    const res = await fetch("/api/metadata/stats");
    if (res.ok) {
      state.stats = await res.json();
    }
  } catch {
    // ignore
  } finally {
    state.statsLoading = false;
    notify();
  }
}

export async function startBatch() {
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
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.scrapeScope, lang, updateTitle: state.updateTitle }),
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
          if (data.type === "complete") {
            state.batchDone = data;
            notify();
          } else if (data.type === "progress") {
            state.currentProgress = data;
            // 只有最终状态才加入完成列表
            if (
              data.status === "success" ||
              data.status === "failed" ||
              data.status === "skipped"
            ) {
              state.completedItems = [
                ...state.completedItems,
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
      state.batchDone = { type: "complete", success: 0, failed: 0, total: 0 };
      notify();
    }
  } finally {
    state.batchRunning = false;
    abortController = null;
    notify();
    // 刷新统计
    loadStats();
  }
}

export function cancelBatch() {
  abortController?.abort();
  state.batchRunning = false;
  notify();
}

/* ── Tab 切换 ── */
export function setActiveTab(tab: ActiveTab) {
  state.activeTab = tab;
  notify();
}

/* ── 书库管理 Actions ── */

export function setLibrarySearch(search: string) {
  state.librarySearch = search;
  state.libraryPage = 1;
  notify();
}

export function setLibraryMetaFilter(filter: MetaFilter) {
  state.libraryMetaFilter = filter;
  state.libraryPage = 1;
  notify();
}

export function setLibraryContentType(ct: string) {
  state.libraryContentType = ct;
  state.libraryPage = 1;
  notify();
}

export function setLibraryPage(page: number) {
  state.libraryPage = page;
  notify();
}

export function setLibraryPageSize(size: number) {
  state.libraryPageSize = size;
  state.libraryPage = 1; // 切换每页条数时回到第一页
  notify();
}

export function setLibrarySort(sortBy: LibrarySortBy, sortOrder?: "asc" | "desc") {
  if (state.librarySortBy === sortBy && !sortOrder) {
    // 同一字段切换排序方向
    state.librarySortOrder = state.librarySortOrder === "asc" ? "desc" : "asc";
  } else {
    state.librarySortBy = sortBy;
    state.librarySortOrder = sortOrder || (sortBy === "updatedAt" ? "desc" : "asc");
  }
  state.libraryPage = 1;
  // 持久化排序状态
  try {
    localStorage.setItem("scraper-sortBy", state.librarySortBy);
    localStorage.setItem("scraper-sortOrder", state.librarySortOrder);
  } catch { /* ignore */ }
  notify();
}

export function setFocusedItem(id: string | null) {
  state.focusedItemId = id;
  notify();
}

/* ── 批量编辑模式 Actions ── */

export function enterBatchEditMode() {
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
  state.batchEditMode = false;
  state.batchEditNames = new Map();
  state.batchEditResults = null;
  state.aiRenameLoading = false;
  notify();
}

export function setBatchEditName(comicId: string, newTitle: string) {
  const entry = state.batchEditNames.get(comicId);
  if (entry) {
    state.batchEditNames = new Map(state.batchEditNames);
    state.batchEditNames.set(comicId, { ...entry, newTitle });
    notify();
  }
}

export function applyNameToAll(title: string) {
  const next = new Map<string, BatchEditNameEntry>();
  for (const [id, entry] of state.batchEditNames) {
    next.set(id, { ...entry, newTitle: title });
  }
  state.batchEditNames = next;
  notify();
}

export function undoBatchEditNames() {
  const next = new Map<string, BatchEditNameEntry>();
  for (const [id, entry] of state.batchEditNames) {
    next.set(id, { ...entry, newTitle: entry.oldTitle });
  }
  state.batchEditNames = next;
  state.batchEditResults = null;
  notify();
}

export async function saveBatchRename() {
  if (state.batchEditSaving) return;

  // 收集有变更的项
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
    const res = await fetch("/api/metadata/batch-rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (res.ok) {
      const data = await res.json();
      state.batchEditResults = data.results || [];
      // 更新oldTitle为newTitle以反映最新状态
      const next = new Map(state.batchEditNames);
      for (const result of data.results || []) {
        if (result.status === "success") {
          const entry = next.get(result.comicId);
          if (entry) {
            next.set(result.comicId, { ...entry, oldTitle: entry.newTitle });
          }
        }
      }
      state.batchEditNames = next;
      loadLibrary();
      loadStats();
    }
  } catch {
    // ignore
  } finally {
    state.batchEditSaving = false;
    notify();
  }
}

export async function aiRename(prompt: string) {
  if (state.aiRenameLoading || state.batchEditNames.size === 0) return;

  state.aiRenameLoading = true;
  notify();

  const items = Array.from(state.batchEditNames.values()).map((e) => ({
    comicId: e.comicId,
    filename: e.filename,
    title: e.oldTitle,
  }));

  const lang = navigator.language.startsWith("zh") ? "zh" : "en";

  try {
    const res = await fetch("/api/metadata/ai-rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, prompt, lang }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.results) {
        const next = new Map(state.batchEditNames);
        for (const r of data.results) {
          const entry = next.get(r.comicId);
          if (entry && r.newTitle) {
            next.set(r.comicId, { ...entry, newTitle: r.newTitle });
          }
        }
        state.batchEditNames = next;
      }
    }
  } catch {
    // ignore
  } finally {
    state.aiRenameLoading = false;
    notify();
  }
}

export function toggleSelectItem(id: string) {
  const next = new Set(state.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  state.selectedIds = next;
  notify();
}

export function selectAllVisible() {
  const next = new Set(state.selectedIds);
  for (const item of state.libraryItems) {
    next.add(item.id);
  }
  state.selectedIds = next;
  notify();
}

export function deselectAll() {
  state.selectedIds = new Set();
  notify();
}

export async function loadLibrary() {
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

    const res = await fetch(`/api/metadata/library?${params}`);
    if (res.ok) {
      const data = await res.json();
      state.libraryItems = data.items || [];
      state.libraryTotal = data.total || 0;
      state.libraryTotalPages = data.totalPages || 1;
    }
  } catch {
    // ignore
  } finally {
    state.libraryLoading = false;
    notify();
  }
}

export async function startBatchSelected() {
  if (state.batchRunning || state.selectedIds.size === 0) return;

  state.activeTab = "scrape";
  state.batchRunning = true;
  state.currentProgress = null;
  state.batchDone = null;
  state.completedItems = [];
  state.showResults = true;
  notify();

  const abort = new AbortController();
  abortController = abort;
  const lang = navigator.language.startsWith("zh") ? "zh" : "en";

  try {
    const res = await fetch("/api/metadata/batch-selected", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comicIds: Array.from(state.selectedIds),
        lang,
        updateTitle: state.updateTitle,
        mode: state.batchMode,
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
          if (data.type === "complete") {
            state.batchDone = data;
            notify();
          } else if (data.type === "progress") {
            state.currentProgress = data;
            if (data.status === "success" || data.status === "failed" || data.status === "skipped") {
              state.completedItems = [
                ...state.completedItems,
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
      state.batchDone = { type: "complete", success: 0, failed: 0, total: 0 };
      notify();
    }
  } finally {
    state.batchRunning = false;
    abortController = null;
    state.selectedIds = new Set();
    notify();
    loadStats();
    loadLibrary();
  }
}

export async function clearSelectedMetadata() {
  if (state.selectedIds.size === 0) return;
  try {
    const res = await fetch("/api/metadata/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds: Array.from(state.selectedIds) }),
    });
    if (res.ok) {
      state.selectedIds = new Set();
      notify();
      loadLibrary();
      loadStats();
    }
  } catch {
    // ignore
  }
}

/* ── AI 聊天面板 Actions ── */

export function toggleAIChat() {
  state.aiChatOpen = !state.aiChatOpen;
  // 打开聊天面板时，清除详情面板和批量编辑面板
  if (state.aiChatOpen) {
    state.focusedItemId = null;
    state.batchEditMode = false;
  }
  notify();
}

export function openAIChat() {
  state.aiChatOpen = true;
  state.focusedItemId = null;
  state.batchEditMode = false;
  notify();
}

export function closeAIChat() {
  state.aiChatOpen = false;
  notify();
}

export function setAIChatInput(input: string) {
  state.aiChatInput = input;
  notify();
}

export function clearAIChatMessages() {
  state.aiChatMessages = [];
  notify();
}

let chatAbortController: AbortController | null = null;

export function abortAIChat() {
  chatAbortController?.abort();
  state.aiChatLoading = false;
  notify();
}

/**
 * 发送 AI 聊天消息 — 支持SSE流式返回 + 智能指令识别
 */
export async function sendAIChatMessage(userInput?: string) {
  const input = (userInput ?? state.aiChatInput).trim();
  if (!input || state.aiChatLoading) return;

  // 添加用户消息
  const userMsg: AIChatMessage = {
    id: `user-${Date.now()}`,
    role: "user",
    content: input,
    timestamp: Date.now(),
  };
  state.aiChatMessages = [...state.aiChatMessages, userMsg];
  state.aiChatInput = "";
  state.aiChatLoading = true;
  notify();

  // 构建对话历史（最近10轮）
  const recentHistory = state.aiChatMessages
    .filter((m) => m.role !== "system")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  // 构建上下文：当前选中的书籍信息、当前筛选状态等
  const contextInfo: Record<string, unknown> = {
    totalBooks: state.libraryTotal,
    currentFilter: state.libraryMetaFilter,
    currentContentType: state.libraryContentType,
    currentSearch: state.librarySearch,
    selectedCount: state.selectedIds.size,
    selectedIds: Array.from(state.selectedIds).slice(0, 20),
    batchRunning: state.batchRunning,
    stats: state.stats,
  };

  // 如果有聚焦的书籍，添加其信息
  if (state.focusedItemId) {
    const focusedItem = state.libraryItems.find((i) => i.id === state.focusedItemId);
    if (focusedItem) {
      contextInfo.focusedBook = {
        id: focusedItem.id,
        title: focusedItem.title,
        filename: focusedItem.filename,
        author: focusedItem.author,
        hasMetadata: focusedItem.hasMetadata,
        contentType: focusedItem.contentType,
      };
    }
  }

  // 当前页面显示的书籍列表（前20本）
  contextInfo.visibleBooks = state.libraryItems.slice(0, 20).map((i) => ({
    id: i.id,
    title: i.title,
    filename: i.filename,
    hasMetadata: i.hasMetadata,
    contentType: i.contentType,
  }));

  const assistantMsgId = `assistant-${Date.now()}`;
  const assistantMsg: AIChatMessage = {
    id: assistantMsgId,
    role: "assistant",
    content: "",
    timestamp: Date.now(),
  };
  state.aiChatMessages = [...state.aiChatMessages, assistantMsg];
  notify();

  const abort = new AbortController();
  chatAbortController = abort;
  const lang = navigator.language.startsWith("zh") ? "zh" : "en";

  try {
    const res = await fetch("/api/metadata/ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: input,
        history: recentHistory.slice(0, -1), // 不包含当前问题
        context: contextInfo,
        lang,
      }),
      signal: abort.signal,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

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

          // 跳过初始化事件
          if (data.type === "init") continue;

          if (data.error) {
            fullContent += (fullContent ? "\n" : "") + `⚠️ ${data.error}`;
            // 更新助手消息显示错误
            state.aiChatMessages = state.aiChatMessages.map((m) =>
              m.id === assistantMsgId ? { ...m, content: fullContent } : m
            );
            notify();
            if (data.done) break;
            continue;
          }

          if (data.content) {
            fullContent += data.content;
            // 更新助手消息内容（流式）
            state.aiChatMessages = state.aiChatMessages.map((m) =>
              m.id === assistantMsgId ? { ...m, content: fullContent } : m
            );
            notify();
          }

          if (data.command) {
            // AI 返回了要执行的指令
            await executeAIChatCommand(data.command);
          }

          if (data.done) {
            break;
          }
        } catch {
          /* skip parse error */
        }
      }
    }

    // 确保最终内容已更新
    if (fullContent) {
      state.aiChatMessages = state.aiChatMessages.map((m) =>
        m.id === assistantMsgId ? { ...m, content: fullContent } : m
      );
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      state.aiChatMessages = state.aiChatMessages.map((m) =>
        m.id === assistantMsgId ? { ...m, content: m.content || "（已中断）" } : m
      );
    } else {
      const errorMsg = (err as Error).message || "未知错误";
      state.aiChatMessages = state.aiChatMessages.map((m) =>
        m.id === assistantMsgId ? { ...m, content: `❌ 出错了: ${errorMsg}` } : m
      );
    }
  } finally {
    state.aiChatLoading = false;
    chatAbortController = null;
    notify();
  }
}

/**
 * 执行 AI 返回的指令
 */
async function executeAIChatCommand(command: { action: string; params?: Record<string, unknown> }) {
  const { action, params } = command;
  const sysMsg: AIChatMessage = {
    id: `sys-${Date.now()}`,
    role: "system",
    content: "",
    timestamp: Date.now(),
    commandResult: { action, success: false, message: "" },
  };

  try {
    switch (action) {
      case "scrape_selected": {
        if (state.selectedIds.size === 0) {
          sysMsg.commandResult = { action, success: false, message: "没有选中的项目" };
          break;
        }
        sysMsg.commandResult = { action, success: true, message: `开始刮削 ${state.selectedIds.size} 项...` };
        state.aiChatMessages = [...state.aiChatMessages, sysMsg];
        notify();
        await startBatchSelected();
        return;
      }

      case "scrape_all": {
        const mode = (params?.mode as string) || "missing";
        setScrapeScope(mode === "all" ? "all" : "missing");
        sysMsg.commandResult = { action, success: true, message: `开始${mode === "all" ? "全部" : "缺失项"}刮削...` };
        state.aiChatMessages = [...state.aiChatMessages, sysMsg];
        notify();
        await startBatch();
        return;
      }

      case "set_mode": {
        const newMode = (params?.mode as string) || "standard";
        setBatchMode(newMode === "ai" ? "ai" : "standard");
        sysMsg.commandResult = { action, success: true, message: `已切换到${newMode === "ai" ? "AI 智能" : "标准"}刮削模式` };
        break;
      }

      case "select_all": {
        selectAllVisible();
        sysMsg.commandResult = { action, success: true, message: `已选中当前页 ${state.libraryItems.length} 项` };
        break;
      }

      case "deselect_all": {
        deselectAll();
        sysMsg.commandResult = { action, success: false, message: "已取消全部选择" };
        break;
      }

      case "filter": {
        const filter = params?.filter as string;
        if (filter === "missing" || filter === "with" || filter === "all") {
          setLibraryMetaFilter(filter);
          sysMsg.commandResult = { action, success: true, message: `已筛选: ${filter}` };
        }
        break;
      }

      case "search": {
        const query = params?.query as string;
        if (query) {
          setLibrarySearch(query);
          sysMsg.commandResult = { action, success: true, message: `正在搜索: ${query}` };
        }
        break;
      }

      case "enter_batch_edit": {
        if (state.selectedIds.size === 0) {
          sysMsg.commandResult = { action, success: false, message: "请先选中要编辑的项目" };
          break;
        }
        enterBatchEditMode();
        state.aiChatOpen = false;
        sysMsg.commandResult = { action, success: true, message: "已进入批量编辑模式" };
        break;
      }

      case "stop_scraping": {
        cancelBatch();
        sysMsg.commandResult = { action, success: true, message: "已停止刮削" };
        break;
      }

      case "refresh": {
        await loadStats();
        await loadLibrary();
        sysMsg.commandResult = { action, success: true, message: "已刷新数据" };
        break;
      }

      case "clear_metadata": {
        if (state.selectedIds.size === 0) {
          sysMsg.commandResult = { action, success: false, message: "请先选中要清除的项目" };
          break;
        }
        await clearSelectedMetadata();
        sysMsg.commandResult = { action, success: true, message: `已清除 ${state.selectedIds.size} 项的元数据` };
        break;
      }

      default:
        sysMsg.commandResult = { action, success: false, message: `未知指令: ${action}` };
    }
  } catch (err) {
    sysMsg.commandResult = { action, success: false, message: `执行失败: ${(err as Error).message}` };
  }

  state.aiChatMessages = [...state.aiChatMessages, sysMsg];
  notify();
}

/* ── 引导教程系统 Actions ── */

/** 引导步骤定义（与i18n key对应） */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "welcome",
    targetSelector: "[data-guide='header']",
    titleKey: "guideWelcomeTitle",
    descKey: "guideWelcomeDesc",
    placement: "bottom",
  },
  {
    id: "filter",
    targetSelector: "[data-guide='filter-bar']",
    titleKey: "guideFilterTitle",
    descKey: "guideFilterDesc",
    placement: "bottom",
    actionKey: "guideFilterAction",
  },
  {
    id: "list",
    targetSelector: "[data-guide='book-list']",
    titleKey: "guideListTitle",
    descKey: "guideListDesc",
    placement: "right",
    actionKey: "guideListAction",
  },
  {
    id: "select",
    targetSelector: "[data-guide='select-bar']",
    titleKey: "guideSelectTitle",
    descKey: "guideSelectDesc",
    placement: "bottom",
    actionKey: "guideSelectAction",
  },
  {
    id: "scrape-panel",
    targetSelector: "[data-guide='scrape-panel']",
    titleKey: "guideScrapeTitle",
    descKey: "guideScrapeDesc",
    placement: "left",
    actionKey: "guideScrapeAction",
  },
  {
    id: "ai-chat",
    targetSelector: "[data-guide='ai-chat-btn']",
    titleKey: "guideAIChatTitle",
    descKey: "guideAIChatDesc",
    placement: "top",
    actionKey: "guideAIChatAction",
  },
];

export function startGuide() {
  state.guideActive = true;
  state.guideCurrentStep = 0;
  // 关闭所有可能干扰遮罩层的面板
  state.aiChatOpen = false;
  state.focusedItemId = null;
  state.batchEditMode = false;
  state.helpPanelOpen = false;
  state.collectionPanelOpen = false;
  notify();
}

export function nextGuideStep() {
  if (state.guideCurrentStep < GUIDE_STEPS.length - 1) {
    state.guideCurrentStep++;
  } else {
    finishGuide();
  }
  notify();
}

export function prevGuideStep() {
  if (state.guideCurrentStep > 0) {
    state.guideCurrentStep--;
    notify();
  }
}

export function goToGuideStep(step: number) {
  if (step >= 0 && step < GUIDE_STEPS.length) {
    state.guideCurrentStep = step;
    notify();
  }
}

export function finishGuide() {
  state.guideActive = false;
  state.guideCurrentStep = 0;
  state.guideDismissed = true;
  try {
    localStorage.setItem("scraper-guide-dismissed", "true");
  } catch { /* ignore */ }
  notify();
}

export function skipGuide() {
  state.guideActive = false;
  state.guideCurrentStep = 0;
  state.guideDismissed = true;
  try {
    localStorage.setItem("scraper-guide-dismissed", "true");
  } catch { /* ignore */ }
  notify();
}

export function resetGuide() {
  state.guideDismissed = false;
  state.guideActive = false;
  state.guideCurrentStep = 0;
  try {
    localStorage.removeItem("scraper-guide-dismissed");
  } catch { /* ignore */ }
  notify();
}

export function openHelpPanel() {
  state.helpPanelOpen = true;
  // 切换到帮助面板时关闭 AI 聊天
  state.aiChatOpen = false;
  state.focusedItemId = null;
  state.batchEditMode = false;
  notify();
}

export function closeHelpPanel() {
  state.helpPanelOpen = false;
  notify();
}

export function setHelpSearchQuery(query: string) {
  state.helpSearchQuery = query;
  notify();
}

/**
 * 检查是否应该自动启动引导（首次使用检测）
 */
export function checkAutoStartGuide() {
  if (!state.guideDismissed && state.stats && state.stats.total > 0) {
    // 有书但从未看过引导 → 自动启动
    state.guideActive = true;
    state.guideCurrentStep = 0;
    // 确保关闭所有面板，避免干扰遮罩层
    state.aiChatOpen = false;
    state.focusedItemId = null;
    state.batchEditMode = false;
    state.helpPanelOpen = false;
    state.collectionPanelOpen = false;
    notify();
  }
}

/* ── 合集管理 Actions ── */

export function openCollectionPanel() {
  state.collectionPanelOpen = true;
  state.focusedItemId = null;
  state.aiChatOpen = false;
  state.batchEditMode = false;
  state.helpPanelOpen = false;
  state.collectionDetail = null;
  notify();
  loadCollectionGroups();
}

export function closeCollectionPanel() {
  state.collectionPanelOpen = false;
  state.collectionDetail = null;
  state.collectionAutoSuggestions = [];
  state.collectionCreateDialog = false;
  state.collectionAddToGroupDialog = false;
  state.collectionEditingId = null;
  notify();
}

export function openAddToGroupDialog() {
  state.collectionAddToGroupDialog = true;
  notify();
  // 确保合集列表已加载
  if (state.collectionGroups.length === 0) {
    loadCollectionGroups();
  }
}

export function closeAddToGroupDialog() {
  state.collectionAddToGroupDialog = false;
  notify();
}

export function setCollectionEditingId(id: number | null) {
  state.collectionEditingId = id;
  if (id !== null) {
    const group = state.collectionGroups.find(g => g.id === id);
    state.collectionEditingName = group?.name || "";
  } else {
    state.collectionEditingName = "";
  }
  notify();
}

export function setCollectionEditingName(name: string) {
  state.collectionEditingName = name;
  notify();
}

export async function loadCollectionGroups() {
  state.collectionGroupsLoading = true;
  notify();
  try {
    const params = new URLSearchParams();
    if (state.libraryContentType) params.set("contentType", state.libraryContentType);
    const res = await fetch(`/api/groups?${params}`);
    if (res.ok) {
      const data = await res.json();
      state.collectionGroups = data.groups || [];
    }
  } catch {
    // ignore
  } finally {
    state.collectionGroupsLoading = false;
    notify();
  }
}

export async function loadCollectionDetail(groupId: number) {
  state.collectionDetailLoading = true;
  notify();
  try {
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.ok) {
      const data = await res.json();
      state.collectionDetail = data;
    }
  } catch {
    // ignore
  } finally {
    state.collectionDetailLoading = false;
    notify();
  }
}

export function clearCollectionDetail() {
  state.collectionDetail = null;
  notify();
}

export async function createCollection(name: string, comicIds?: string[]) {
  try {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, comicIds: comicIds || [] }),
    });
    if (res.ok) {
      state.collectionCreateDialog = false;
      notify();
      await loadCollectionGroups();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function updateCollection(groupId: number, name: string, coverUrl?: string) {
  try {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, coverUrl: coverUrl || "" }),
    });
    if (res.ok) {
      state.collectionEditingId = null;
      state.collectionEditingName = "";
      notify();
      await loadCollectionGroups();
      // 如果正在查看该合集的详情，也刷新详情
      if (state.collectionDetail && state.collectionDetail.id === groupId) {
        await loadCollectionDetail(groupId);
      }
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function deleteCollection(groupId: number) {
  try {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      // 如果正在查看该合集的详情，关闭详情
      if (state.collectionDetail && state.collectionDetail.id === groupId) {
        state.collectionDetail = null;
      }
      notify();
      await loadCollectionGroups();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function addComicsToCollection(groupId: number, comicIds: string[]) {
  try {
    const res = await fetch(`/api/groups/${groupId}/comics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds }),
    });
    if (res.ok) {
      state.collectionAddToGroupDialog = false;
      notify();
      await loadCollectionGroups();
      if (state.collectionDetail && state.collectionDetail.id === groupId) {
        await loadCollectionDetail(groupId);
      }
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function removeComicFromCollection(groupId: number, comicId: string) {
  try {
    const res = await fetch(`/api/groups/${groupId}/comics/${comicId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await loadCollectionGroups();
      if (state.collectionDetail && state.collectionDetail.id === groupId) {
        await loadCollectionDetail(groupId);
      }
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function reorderCollectionComics(groupId: number, comicIds: string[]) {
  try {
    const res = await fetch(`/api/groups/${groupId}/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds }),
    });
    if (res.ok) {
      if (state.collectionDetail && state.collectionDetail.id === groupId) {
        await loadCollectionDetail(groupId);
      }
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function autoDetectCollections() {
  state.collectionAutoLoading = true;
  notify();
  try {
    const res = await fetch("/api/groups/auto-detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: state.libraryContentType }),
    });
    if (res.ok) {
      const data = await res.json();
      state.collectionAutoSuggestions = data.suggestions || [];
    }
  } catch {
    // ignore
  } finally {
    state.collectionAutoLoading = false;
    notify();
  }
}

export async function batchCreateCollections(groups: AutoDetectSuggestion[]) {
  try {
    const res = await fetch("/api/groups/batch-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups }),
    });
    if (res.ok) {
      state.collectionAutoSuggestions = [];
      notify();
      await loadCollectionGroups();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function batchDeleteCollections(groupIds: number[]) {
  try {
    const res = await fetch("/api/groups/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds }),
    });
    if (res.ok) {
      if (state.collectionDetail && groupIds.includes(state.collectionDetail.id)) {
        state.collectionDetail = null;
      }
      notify();
      await loadCollectionGroups();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function mergeCollections(groupIds: number[], newName: string) {
  try {
    const res = await fetch("/api/groups/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds, newName }),
    });
    if (res.ok) {
      state.collectionDetail = null;
      notify();
      await loadCollectionGroups();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function setCollectionCreateDialog(open: boolean) {
  state.collectionCreateDialog = open;
  notify();
}
