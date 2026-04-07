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

/** 获取分组详情（支持按内容类型过滤分组内的漫画） */
export async function fetchGroupDetail(groupId: number, contentType?: string): Promise<ComicGroupDetail | null> {
  try {
    const params = new URLSearchParams();
    if (contentType) params.set("contentType", contentType);
    const url = params.toString() ? `/api/groups/${groupId}?${params}` : `/api/groups/${groupId}`;
    const res = await fetch(url);
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

/** 更新系列元数据 */
export async function updateGroupMetadata(
  groupId: number,
  metadata: {
    name?: string;
    coverUrl?: string;
    author?: string;
    description?: string;
    tags?: string;
    year?: number;
    publisher?: string;
    language?: string;
    genre?: string;
    status?: string;
  }
): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}/metadata`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 从第一本漫画继承元数据到系列 */
export async function inheritGroupMetadata(groupId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}/inherit-metadata`, {
      method: "POST",
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
export async function batchCreateGroups(
  groups: AutoDetectGroup[],
  autoInherit: boolean = false
): Promise<{ success: boolean; created: number }> {
  try {
    const res = await fetch("/api/groups/batch-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups, autoInherit }),
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

// ============================================================
// 元数据继承
// ============================================================

/** 继承字段变更 */
export interface InheritField {
  field: string;
  label: string;
  value: string;
  oldValue: string;
}

/** 继承预览结果 */
export interface InheritPreview {
  sourceComicId: string;
  sourceComicTitle: string;
  groupChanges: InheritField[];
  volumeCount: number;
  volumeChanges: InheritField[];
}

/** 预览从首卷继承元数据的结果 */
export async function previewInheritMetadata(groupId: number): Promise<InheritPreview | null> {
  try {
    const res = await fetch(`/api/groups/${groupId}/preview-inherit`, {
      method: "POST",
    });
    if (res.ok) return await res.json();
    return null;
  } catch {
    return null;
  }
}

/** 从首卷继承元数据到系列所有卷 */
export async function inheritMetadataToVolumes(groupId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/groups/${groupId}/inherit-to-volumes`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================
// 批量操作
// ============================================================

/** 批量删除分组 */
export async function batchDeleteGroups(groupIds: number[]): Promise<{ success: boolean; deleted: number }> {
  try {
    const res = await fetch("/api/groups/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds }),
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, deleted: data.deleted || 0 };
    }
    return { success: false, deleted: 0 };
  } catch {
    return { success: false, deleted: 0 };
  }
}

/** 合并多个分组 */
export async function mergeGroups(groupIds: number[], newName: string): Promise<{ success: boolean; newGroupId?: number }> {
  try {
    const res = await fetch("/api/groups/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds, newName }),
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, newGroupId: data.newGroupId };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/** 导出分组数据 */
export async function exportGroups(groupIds: number[]): Promise<unknown | null> {
  try {
    const res = await fetch("/api/groups/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds }),
    });
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch {
    return null;
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

// ============================================================
// P2: 系列级标签管理
// ============================================================

/** 系列标签 */
export interface GroupTag {
  id: number;
  name: string;
  color: string;
}

/** 标签同步结果 */
export interface TagSyncResult {
  success: boolean;
  added: string[];
  removed: string[];
  unchanged: string[];
  syncedTo: number;
}

/** 获取系列标签 */
export async function fetchGroupTags(groupId: number): Promise<GroupTag[]> {
  try {
    const res = await fetch(`/api/groups/${groupId}/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.tags || [];
  } catch {
    return [];
  }
}

/** 设置系列标签（替换所有现有标签，自动同步到所有卷） */
export async function setGroupTags(groupId: number, tags: string[], autoSync: boolean = true): Promise<TagSyncResult | null> {
  try {
    const res = await fetch(`/api/groups/${groupId}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags, autoSync }),
    });
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch {
    return null;
  }
}

/** 标签完整同步结果 */
export interface TagFullSyncResult {
  success: boolean;
  totalVolumes: number;
  syncedVolumes: number;
  tagsAdded: number;
  tagsRemoved: number;
}

/** 将系列标签同步到所有卷（完整同步） */
export async function syncGroupTags(groupId: number): Promise<TagFullSyncResult | null> {
  try {
    const res = await fetch(`/api/groups/${groupId}/sync-tags`, {
      method: "POST",
    });
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch {
    return null;
  }
}

/** AI 建议系列标签 */
export async function aiSuggestGroupTags(groupId: number, targetLang: string = "zh"): Promise<{ success: boolean; suggestedTags: string[] } | null> {
  try {
    const res = await fetch(`/api/groups/${groupId}/ai-suggest-tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLang }),
    });
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// P3: 按话/卷自动分组
// ============================================================

/** 按文件夹自动创建分组（用于按话分类模式） */
export async function autoGroupByDirectory(): Promise<{ success: boolean; created: number }> {
  try {
    const res = await fetch("/api/groups/auto-group-by-dir", {
      method: "POST",
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
