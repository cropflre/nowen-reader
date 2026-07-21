/**
 * Groups API �?自定义合并分组相�?API
 */

import { apiClient } from "@/lib/apiClient";
import type { ComicGroup, ComicGroupDetail, AutoDetectGroup } from "@/hooks/useComicTypes";

// ============================================================
// 分组 CRUD
// ============================================================

/** 获取所有分组（支持按内容类型、分类、标签、书库过滤） */
export async function fetchGroups(contentType?: string, category?: string, tags?: string[], favoritesOnly?: boolean, libraryIds?: string[]): Promise<ComicGroup[]> {
  try {
    const params = new URLSearchParams();
    if (contentType) params.set("contentType", contentType);
    if (category) params.set("category", category);
    if (tags && tags.length > 0) params.set("tags", tags.join(","));
    if (favoritesOnly) params.set("favoritesOnly", "true");
    if (libraryIds && libraryIds.length > 0) params.set("libraryIds", libraryIds.join(","));
    const url = params.toString() ? `/api/groups?${params}` : "/api/groups";
    const data: any = await apiClient.get(url);
    return data.groups || [];
  } catch {
    return [];
  }
}

/** 获取分组详情（支持按内容类型过滤分组内的漫画�?*/
export async function fetchGroupDetail(groupId: number, contentType?: string): Promise<ComicGroupDetail | null> {
  try {
    const params = new URLSearchParams();
    if (contentType) params.set("contentType", contentType);
    const url = params.toString() ? `/api/groups/${groupId}?${params}` : `/api/groups/${groupId}`;
    return await apiClient.get<ComicGroupDetail | null>(url);
  } catch {
    return null;
  }
}

/** 创建分组 */
export async function createGroup(name: string, comicIds?: string[], seriesIds?: string[]): Promise<{ success: boolean; id?: number }> {
  try {
    const data: any = await apiClient.post("/api/groups", { name, comicIds: comicIds || [], seriesIds: seriesIds || [] });
    return { success: true, id: data.id };
  } catch {
    return { success: false };
  }
}

/** 更新分组 */
export async function updateGroup(groupId: number, name: string, coverUrl?: string): Promise<boolean> {
  try {
    await apiClient.put(`/api/groups/${groupId}`, { name, coverUrl: coverUrl || "" });
    return true;
  } catch {
    return false;
  }
}

/** 更新系列元数�?*/
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
    await apiClient.put(`/api/groups/${groupId}/metadata`, metadata);
    return true;
  } catch {
    return false;
  }
}

/** 从第一本漫画继承元数据到系?*/
export async function inheritGroupMetadata(groupId: number): Promise<boolean> {
  try {
    await apiClient.post(`/api/groups/${groupId}/inherit-metadata`);
    return true;
  } catch {
    return false;
  }
}

/** 删除分组 */
export async function deleteGroup(groupId: number): Promise<boolean> {
  try {
    await apiClient.delete(`/api/groups/${groupId}`);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 分组内漫画管?
// ============================================================

/** 添加漫画到分组 */
export async function addComicsToGroup(groupId: number, comicIds: string[]): Promise<boolean> {
  try {
    await apiClient.post(`/api/groups/${groupId}/comics`, { comicIds });
    return true;
  } catch {
    return false;
  }
}

/** 从分组移除漫画 */
export async function removeComicFromGroup(groupId: number, comicId: string): Promise<boolean> {
  try {
    await apiClient.delete(`/api/groups/${groupId}/comics/${comicId}`);
    return true;
  } catch {
    return false;
  }
}

/** 添加目录作品到分组 */
export async function addSeriesToGroup(groupId: number, seriesIds: string[]): Promise<boolean> {
  try {
    await apiClient.post(`/api/groups/${groupId}/series`, { seriesIds });
    return true;
  } catch {
    return false;
  }
}

/** 从分组移除目录作品 */
export async function removeSeriesFromGroup(groupId: number, seriesId: string): Promise<boolean> {
  try {
    await apiClient.delete(`/api/groups/${groupId}/series/${seriesId}`);
    return true;
  } catch {
    return false;
  }
}

/** 重新排序分组内漫?*/
export async function reorderGroupComics(groupId: number, comicIds: string[]): Promise<boolean> {
  try {
    await apiClient.put(`/api/groups/${groupId}/reorder`, { comicIds });
    return true;
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
    const data: any = await apiClient.post("/api/groups/auto-detect", { contentType: contentType || "" });
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
    const data: any = await apiClient.post("/api/groups/batch-create", { groups, autoInherit });
    return { success: true, created: data.created || 0 };
  } catch {
    return { success: false, created: 0 };
  }
}

// ============================================================
// 元数据继�?
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

/** 预览从首卷继承元数据的结�?*/
export async function previewInheritMetadata(groupId: number): Promise<InheritPreview | null> {
  try {
    return await apiClient.post(`/api/groups/${groupId}/preview-inherit`);
  } catch {
    return null;
  }
}

/** 从首卷继承元数据到系列所有卷 */
export async function inheritMetadataToVolumes(groupId: number): Promise<boolean> {
  try {
    await apiClient.post(`/api/groups/${groupId}/inherit-to-volumes`);
    return true;
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
    const data: any = await apiClient.post("/api/groups/batch-delete", { groupIds });
    return { success: true, deleted: data.deleted || 0 };
  } catch {
    return { success: false, deleted: 0 };
  }
}

/** 合并多个分组 */
export async function mergeGroups(groupIds: number[], newName: string): Promise<{ success: boolean; newGroupId?: number }> {
  try {
    const data: any = await apiClient.post("/api/groups/merge", { groupIds, newName });
    return { success: true, newGroupId: data.newGroupId };
  } catch {
    return { success: false };
  }
}

/** 导出分组数据 */
export async function exportGroups(groupIds: number[]): Promise<unknown | null> {
  try {
    return await apiClient.post("/api/groups/export", { groupIds });
  } catch {
    return null;
  }
}

/** 获取已分组的漫画ID映射（一本漫画可属于多个分组�?*/
export async function fetchGroupedComicMap(): Promise<Record<string, number[]>> {
  try {
    const data: any = await apiClient.get("/api/groups/comic-map");
    return data.map || {};
  } catch {
    return {};
  }
}

// ============================================================
// P2: 系列级标签管�?
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
    const data: any = await apiClient.get(`/api/groups/${groupId}/tags`);
    return data.tags || [];
  } catch {
    return [];
  }
}

/** 设置系列标签（替换所有现有标签，自动同步到所有卷�?*/
export async function setGroupTags(groupId: number, tags: string[], autoSync: boolean = true): Promise<TagSyncResult | null> {
  try {
    return await apiClient.put(`/api/groups/${groupId}/tags`, { tags, autoSync });
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
    return await apiClient.post(`/api/groups/${groupId}/sync-tags`);
  } catch {
    return null;
  }
}

/** 标签覆盖结果 */
export interface TagOverrideResult {
  success: boolean;
  totalVolumes: number;
  syncedVolumes: number;
  tagsSet: number;
}

/** 将系列标签覆盖到所有卷（先清除卷标签再设置为系列标签） */
export async function overrideGroupTagsToVolumes(groupId: number): Promise<TagOverrideResult | null> {
  try {
    return await apiClient.post(`/api/groups/${groupId}/override-tags`);
  } catch {
    return null;
  }
}

/** AI 建议系列标签 */
export async function aiSuggestGroupTags(groupId: number, targetLang: string = "zh"): Promise<{ success: boolean; suggestedTags: string[] } | null> {
  try {
    return await apiClient.post(`/api/groups/${groupId}/ai-suggest-tags`, { targetLang });
  } catch {
    return null;
  }
}

// ============================================================
// P5: 系列级分类管�?
// ============================================================

/** 系列分类 */
export interface GroupCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
}

/** 获取系列分类 */
export async function fetchGroupCategories(groupId: number): Promise<GroupCategory[]> {
  try {
    const data: any = await apiClient.get(`/api/groups/${groupId}/categories`);
    return data.categories || [];
  } catch {
    return [];
  }
}

/** 设置系列分类（替换所有，可选自动同步到所有卷�?*/
export async function setGroupCategories(
  groupId: number,
  categorySlugs: string[],
  autoSync: boolean = true
): Promise<{ success: boolean; syncedTo: number } | null> {
  try {
    return await apiClient.put(`/api/groups/${groupId}/categories`, { categorySlugs, autoSync });
  } catch {
    return null;
  }
}

/** 将系列分类同步到所有卷 */
export async function syncGroupCategories(groupId: number): Promise<{ success: boolean; totalVolumes: number; syncedVolumes: number } | null> {
  try {
    return await apiClient.post(`/api/groups/${groupId}/sync-categories`);
  } catch {
    return null;
  }
}

/** AI 建议系列分类 */
export async function aiSuggestGroupCategories(
  groupId: number,
  targetLang: string = "zh"
): Promise<{ success: boolean; suggestedCategories: string[] } | null> {
  try {
    return await apiClient.post(`/api/groups/${groupId}/ai-suggest-categories`, { targetLang });
  } catch {
    return null;
  }
}

// ============================================================
// P3: 按话/卷自动分�?
// ============================================================

/** 按文件夹自动创建分组（用于按话分类模式） */
export async function autoGroupByDirectory(): Promise<{ success: boolean; created: number }> {
  try {
    const data: any = await apiClient.post("/api/groups/auto-group-by-dir");
    return { success: true, created: data.created || 0 };
  } catch {
    return { success: false, created: 0 };
  }
}

// ============================================================
// P6: 批量刮削
// ============================================================

/** 批量刮削单个结果 */
export interface BatchScrapeResultItem {
  groupId: number;
  groupName: string;
  success: boolean;
  error?: string;
  metadata?: {
    title?: string;
    author?: string;
    publisher?: string;
    year?: number;
    description?: string;
    language?: string;
    genre?: string;
    coverUrl?: string;
    source: string;
  };
  applied: boolean;
  volumes: number;
}

/** 批量刮削响应 */
export interface BatchScrapeResponse {
  results: BatchScrapeResultItem[];
  total: number;
  success: number;
  failed: number;
  applied: number;
}

/** 批量刮削参数 */
export interface BatchScrapeParams {
  groupIds: number[];
  sources?: string[];
  lang?: string;
  fields?: string[];
  overwrite?: boolean;
  syncTags?: boolean;
  syncToVolumes?: boolean;
  autoApply?: boolean;
  dryRun?: boolean;
}

/** 批量刮削系列元数�?*/
export async function batchScrapeGroups(params: BatchScrapeParams): Promise<BatchScrapeResponse | null> {
  try {
    return await apiClient.post("/api/groups/batch-scrape", params);
  } catch {
    return null;
  }
}
