import { apiPath } from "@/lib/base-path";
/**
 * 刮削状态管理 — AI 聊天 Actions
 *
 * 包含：AI 聊天面板开关、消息发送、流式响应、指令执行等。
 */

import { getState, notify } from "./scraper-core";
import { loadStats } from "./scraper-batch-actions";
import {
  loadLibrary,
  startBatchSelected,
  selectAllVisible,
  deselectAll,
  enterBatchEditMode,
  clearSelectedMetadata,
} from "./library-actions";
import { setBatchMode, setScrapeScope, startBatch, cancelBatch } from "./scraper-batch-actions";
import type { AIChatMessage } from "./scraper-types";

/* ── AI 聊天面板 Actions ── */

export function toggleAIChat() {
  const state = getState();
  state.aiChatOpen = !state.aiChatOpen;
  if (state.aiChatOpen) {
    state.focusedItemId = null;
    state.batchEditMode = false;
  }
  notify();
}

export function openAIChat() {
  const state = getState();
  state.aiChatOpen = true;
  state.focusedItemId = null;
  state.batchEditMode = false;
  notify();
}

export function closeAIChat() {
  getState().aiChatOpen = false;
  notify();
}

export function setAIChatInput(input: string) {
  getState().aiChatInput = input;
  notify();
}

export function clearAIChatMessages() {
  getState().aiChatMessages = [];
  notify();
}

let chatAbortController: AbortController | null = null;

export function abortAIChat() {
  chatAbortController?.abort();
  getState().aiChatLoading = false;
  notify();
}

/**
 * 发送 AI 聊天消息 — 支持SSE流式返回 + 智能指令识别
 */
export async function sendAIChatMessage(userInput?: string) {
  const state = getState();
  const input = (userInput ?? state.aiChatInput).trim();
  if (!input || state.aiChatLoading) return;

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

  const recentHistory = state.aiChatMessages
    .filter((m) => m.role !== "system")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

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
    const res = await fetch(apiPath("/api/metadata/ai-chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: input,
        history: recentHistory.slice(0, -1),
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

          if (data.type === "init") continue;

          if (data.error) {
            fullContent += (fullContent ? "\n" : "") + `⚠️ ${data.error}`;
            getState().aiChatMessages = getState().aiChatMessages.map((m) =>
              m.id === assistantMsgId ? { ...m, content: fullContent } : m
            );
            notify();
            if (data.done) break;
            continue;
          }

          if (data.content) {
            fullContent += data.content;
            getState().aiChatMessages = getState().aiChatMessages.map((m) =>
              m.id === assistantMsgId ? { ...m, content: fullContent } : m
            );
            notify();
          }

          if (data.command) {
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

    if (fullContent) {
      getState().aiChatMessages = getState().aiChatMessages.map((m) =>
        m.id === assistantMsgId ? { ...m, content: fullContent } : m
      );
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      getState().aiChatMessages = getState().aiChatMessages.map((m) =>
        m.id === assistantMsgId ? { ...m, content: m.content || "（已中断）" } : m
      );
    } else {
      const errorMsg = (err as Error).message || "未知错误";
      getState().aiChatMessages = getState().aiChatMessages.map((m) =>
        m.id === assistantMsgId ? { ...m, content: `❌ 出错了: ${errorMsg}` } : m
      );
    }
  } finally {
    getState().aiChatLoading = false;
    chatAbortController = null;
    notify();
  }
}

/**
 * 执行 AI 返回的指令
 */
async function executeAIChatCommand(command: { action: string; params?: Record<string, unknown> }) {
  const { action, params } = command;
  const state = getState();
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
          const { setLibraryMetaFilter } = await import("./library-actions");
          setLibraryMetaFilter(filter);
          sysMsg.commandResult = { action, success: true, message: `已筛选: ${filter}` };
        }
        break;
      }
      case "search": {
        const query = params?.query as string;
        if (query) {
          const { setLibrarySearch } = await import("./library-actions");
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
