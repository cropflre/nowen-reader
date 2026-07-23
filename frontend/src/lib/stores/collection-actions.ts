import { apiPath } from "@/lib/base-path";
/**
 * 刮削状态管理 — 合集管理 Actions
 *
 * 包含：合集 CRUD、智能检测、批量创建/删除/合并等。
 */

import { getState, notify } from "./scraper-core";
import type { AutoDetectSuggestion } from "./scraper-types";

/* ── 合集管理 Actions ── */

export function openCollectionPanel() {
  const state = getState();
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
  const state = getState();
  state.collectionPanelOpen = false;
  state.collectionDetail = null;
  state.collectionAutoSuggestions = [];
  state.collectionCreateDialog = false;
  state.collectionAddToGroupDialog = false;
  state.collectionEditingId = null;
  notify();
}

export function openAddToGroupDialog() {
  const state = getState();
  state.collectionAddToGroupDialog = true;
  notify();
  if (state.collectionGroups.length === 0) {
    loadCollectionGroups();
  }
}

export function closeAddToGroupDialog() {
  getState().collectionAddToGroupDialog = false;
  notify();
}

export function setCollectionEditingId(id: number | null) {
  const state = getState();
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
  getState().collectionEditingName = name;
  notify();
}

export async function loadCollectionGroups() {
  const state = getState();
  state.collectionGroupsLoading = true;
  notify();
  try {
    const params = new URLSearchParams();
    if (state.libraryContentType) params.set("contentType", state.libraryContentType);
    const res = await fetch(apiPath(`/api/groups?${params}`));
    if (res.ok) {
      const data = await res.json();
      getState().collectionGroups = data.groups || [];
    }
  } catch {
    // ignore
  } finally {
    getState().collectionGroupsLoading = false;
    notify();
  }
}

export async function loadCollectionDetail(groupId: number) {
  getState().collectionDetailLoading = true;
  notify();
  try {
    const res = await fetch(apiPath(`/api/groups/${groupId}`));
    if (res.ok) {
      const data = await res.json();
      getState().collectionDetail = data;
    }
  } catch {
    // ignore
  } finally {
    getState().collectionDetailLoading = false;
    notify();
  }
}

export function clearCollectionDetail() {
  getState().collectionDetail = null;
  notify();
}

export async function createCollection(name: string, comicIds?: string[]) {
  try {
    const res = await fetch(apiPath("/api/groups"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, comicIds: comicIds || [] }),
    });
    if (res.ok) {
      getState().collectionCreateDialog = false;
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
    const res = await fetch(apiPath(`/api/groups/${groupId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, coverUrl: coverUrl || "" }),
    });
    if (res.ok) {
      const state = getState();
      state.collectionEditingId = null;
      state.collectionEditingName = "";
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

export async function deleteCollection(groupId: number) {
  try {
    const res = await fetch(apiPath(`/api/groups/${groupId}`), {
      method: "DELETE",
    });
    if (res.ok) {
      const state = getState();
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
    const res = await fetch(apiPath(`/api/groups/${groupId}/comics`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds }),
    });
    if (res.ok) {
      getState().collectionAddToGroupDialog = false;
      notify();
      await loadCollectionGroups();
      const state = getState();
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
    const res = await fetch(apiPath(`/api/groups/${groupId}/comics/${comicId}`), {
      method: "DELETE",
    });
    if (res.ok) {
      await loadCollectionGroups();
      const state = getState();
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
    const res = await fetch(apiPath(`/api/groups/${groupId}/reorder`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds }),
    });
    if (res.ok) {
      const state = getState();
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
  const state = getState();
  state.collectionAutoLoading = true;
  notify();
  try {
    const res = await fetch(apiPath("/api/groups/auto-detect"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: state.libraryContentType }),
    });
    if (res.ok) {
      const data = await res.json();
      getState().collectionAutoSuggestions = data.suggestions || [];
    }
  } catch {
    // ignore
  } finally {
    getState().collectionAutoLoading = false;
    notify();
  }
}

export async function batchCreateCollections(groups: AutoDetectSuggestion[]) {
  try {
    const res = await fetch(apiPath("/api/groups/batch-create"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups }),
    });
    if (res.ok) {
      getState().collectionAutoSuggestions = [];
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
    const res = await fetch(apiPath("/api/groups/batch-delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds }),
    });
    if (res.ok) {
      const state = getState();
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
    const res = await fetch(apiPath("/api/groups/merge"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds, newName }),
    });
    if (res.ok) {
      getState().collectionDetail = null;
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
  getState().collectionCreateDialog = open;
  notify();
}
