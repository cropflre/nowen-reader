/**
 * Groups API — 自定义合并分组相关 API
 */

import type { ComicGroup, ComicGroupDetail, AutoDetectGroup } from "@/hooks/useComicTypes";

// ============================================================
// 分组 CRUD
// ============================================================

/** 获取所有分组（支持按内容类型过滤） */
export async function fetchGroups(contentType?: string): Promise<ComicGroup[]> {
  try {
    const params = new URLSearchParams();
    if (contentType) params.set("contentType", contentType);
    const url = params.toString() ? `/api/groups?${params}` : "/api/groups";
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.groups || [];
  } catch {
    return [];
  }
}

/** 获取分组详情 */
export async function fetchGroupDetail(groupId: number): Promise<ComicGroupDetail | null> {
  try {
    const res = await fetch(`/api/groups/${groupId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 创建分组 */
export async function createGroup(name: string, comicIds?: string[]): Promise<{ success: boolean; id?: number }> {
  try {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, comicIds: comicIds || [] }),
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, id: data.id };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/** 更新分组 */
export async function updateGroup(groupId: number, name: string, coverUrl?: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, coverUrl: coverUrl || "" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 删除分组 */
export async function deleteGroup(groupId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================
// 分组内漫画管理
// ============================================================

/** 添加漫画到分组 */
export async function addComicsToGroup(groupId: number, comicIds: string[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}/comics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 从分组移除漫画 */
export async function removeComicFromGroup(groupId: number, comicId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}/comics/${comicId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** 重新排序分组内漫画 */
export async function reorderGroupComics(groupId: number, comicIds: string[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================
// 智能分组
// ============================================================

/** 自动检测可合并的漫画系列（支持按内容类型过滤） */
export async function autoDetectGroups(contentType?: string): Promise<AutoDetectGroup[]> {
  try {
    const res = await fetch("/api/groups/auto-detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: contentType || "" }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.suggestions || [];
  } catch {
    return [];
  }
}

/** 批量创建分组 */
export async function batchCreateGroups(groups: AutoDetectGroup[]): Promise<{ success: boolean; created: number }> {
  try {
    const res = await fetch("/api/groups/batch-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups }),
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, created: data.created || 0 };
    }
    return { success: false, created: 0 };
  } catch {
    return { success: false, created: 0 };
  }
}

/** 获取已分组的漫画ID映射（一本漫画可属于多个分组） */
export async function fetchGroupedComicMap(): Promise<Record<string, number[]>> {
  try {
    const res = await fetch("/api/groups/comic-map");
    if (!res.ok) return {};
    const data = await res.json();
    return data.map || {};
  } catch {
    return {};
  }
}
