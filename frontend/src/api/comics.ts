/**
 * Comics API — 所有独立的 API 调用函数
 * 从 useComics.ts 中拆分出来的纯函数层
 */

import { apiClient } from "@/lib/apiClient";
import { useToast } from "@/components/Toast";

/**
 * 上传文件到服务器
 *
 * @param files    待上传的文件列表
 * @param category 可选，当前页面的内容类别（"comic" | "novel"）。
 *                 后端会按文件扩展名自动分流到漫画/电子书目录；
 *                 此参数仅用于消除歧义扩展名（如.azw3）。
 */
export async function uploadComics(
  files: FileList | File[],
  category?: "comic" | "novel",
  libraryId?: string
): Promise<{ success: boolean; message: string; successCount: number; totalCount: number }> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));
  if (category) {
    formData.append("category", category);
  }
  if (libraryId) {
    formData.append("libraryId", libraryId);
  }

  try {
    const data = await apiClient.upload<{
      success?: boolean;
      message?: string;
      error?: string;
      successCount?: number;
      totalCount?: number;
    }>("/api/upload", formData);

    return {
      success: (data.successCount ?? 0) > 0,
      message: data.message || data.error || "Unknown error",
      successCount: data.successCount ?? 0,
      totalCount: data.totalCount ?? Array.from(files).length,
    };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return {
      success: false,
      message: err?.message || "Upload failed",
      successCount: 0,
      totalCount: Array.from(files).length,
    };
  }
}

/**
 * 保存阅读进度
 */
export async function saveReadingProgress(comicId: string, page: number, totalPages?: number) {
  try {
    await apiClient.put(`/api/comics/${comicId}/progress`, { page, ...(totalPages ? { totalPages } : {}) });
  } catch {
    // 静默失败 — 进度保存不应阻塞阅读
  }
}

/**
 * 切换收藏
 */
export async function toggleComicFavorite(
  comicId: string
): Promise<boolean | null> {
  try {
    const data = await apiClient.put<{ isFavorite?: boolean }>(
      `/api/comics/${comicId}/favorite`
    );
    return data.isFavorite ?? null;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 403) throw e;
  }
  return null;
}

/**
 * 更新评分
 */
export async function updateComicRating(
  comicId: string,
  rating: number | null
) {
  try {
    await apiClient.put(`/api/comics/${comicId}/rating`, { rating });
  } catch (e: unknown) {
    const err = e as { status?: number };
    if (err?.status === 403) throw e;
  }
}

/**
 * 为漫画添加标签
 */
export async function addComicTags(comicId: string, tags: string[]) {
  try {
    await apiClient.post(`/api/comics/${comicId}/tags`, { tags });
  } catch {
    // ignore
  }
}

/**
 * 从漫画移除标签
 */
export async function removeComicTag(comicId: string, tag: string) {
  try {
    await apiClient.delete(`/api/comics/${comicId}/tags`, { tag });
  } catch {
    // ignore
  }
}

/**
 * 清除漫画的所有标签（调用后端批量清除接口，单次请求）
 */
export async function clearAllComicTags(comicId: string) {
  try {
    await apiClient.delete(`/api/comics/${comicId}/tags/clear-all`);
  } catch {
    // ignore
  }
}

/** 带来源信息的标签 */
export interface ComicTagWithSource {
  id: number;
  name: string;
  color: string;
  source: "manual" | "series" | "excluded";
  sourceGroupId: number;
}

/**
 * 获取漫画标签（含来源信息）
 */
export async function getComicTagsWithSource(comicId: string): Promise<ComicTagWithSource[]> {
  try {
    const data = await apiClient.get<{ tags?: ComicTagWithSource[] }>(
      `/api/comics/${comicId}/tags-with-source`
    );
    return data.tags || [];
  } catch {
    return [];
  }
}

/**
 * 排除系列同步的标签（在卷级别）
 */
export async function excludeSeriesTag(comicId: string, tagName: string, groupId: number) {
  try {
    await apiClient.put(`/api/comics/${comicId}/tags/exclude-series`, { tagName, groupId });
  } catch {
    // ignore
  }
}

/**
 * 重新包含之前排除的系列标签
 */
export async function includeSeriesTag(comicId: string, tagName: string, groupId: number) {
  try {
    await apiClient.put(`/api/comics/${comicId}/tags/include-series`, { tagName, groupId });
  } catch {
    // ignore
  }
}

/**
 * 批量操作
 * @param params - 额外参数（如 deleteFiles: true）
 */
export async function batchComicAction(
  comicIds: string[],
  action: string,
  params?: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiClient.post("/api/comics/batch", { comicIds, action, ...params });
    return { success: true };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { success: false, error: err?.message || `HTTP ${err?.status ?? "unknown"}` };
  }
}

// Backward-compatible alias
export function batchOperation(action: string, comicIds: string[], params?: Record<string, unknown>) {
  return batchComicAction(comicIds, action, params);
}

// Delete a single comic
export async function deleteComicById(comicId: string, deleteFiles = false): Promise<{ success: boolean; error?: string }> {
  try {
    const url = deleteFiles
      ? `/api/comics/${comicId}?deleteFiles=true`
      : `/api/comics/${comicId}`;
    await apiClient.delete(url);
    return { success: true };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { success: false, error: err?.message || `HTTP ${err?.status ?? "unknown"}` };
  }
}

// ============================================================
// 阅读会话
// ============================================================

export async function startSession(comicId: string, startPage: number): Promise<number | null> {
  try {
    const data = await apiClient.post<{ sessionId?: number }>(
      "/api/stats/session",
      { comicId, startPage }
    );
    return data.sessionId ?? null;
  } catch (error) {
    if (typeof window !== "undefined") {
      console.warn("[reader] failed to start reading session", {
        comicId,
        startPage,
        error,
      });
    }
  }
  return null;
}

export async function endSession(sessionId: number, endPage: number, duration: number) {
  try {
    await apiClient.put("/api/stats/session", { sessionId, endPage, duration });
  } catch (error) {
    if (typeof window !== "undefined") {
      console.warn("[reader] failed to end reading session", {
        sessionId,
        endPage,
        duration,
        error,
      });
    }
  }
}

/**
 * 使用 navigator.sendBeacon 发送会话结束请求（用于 beforeunload 兜底）。
 * sendBeacon 在页面卸载/崩溃时仍能可靠地发出请求。
 */
export function endSessionBeacon(sessionId: number, endPage: number, duration: number) {
  try {
    const data = JSON.stringify({ sessionId, endPage, duration });
    // sendBeacon 只支持 POST，后端需要兼容
    const blob = new Blob([data], { type: "application/json" });
    navigator.sendBeacon("/api/stats/session/end", blob);
  } catch {
    // 如果 sendBeacon 不可用，回退到普通请求
    endSession(sessionId, endPage, duration);
  }
}

// ============================================================
// 排序
// ============================================================

export async function updateSortOrders(orders: { id: string; sortOrder: number }[]) {
  try {
    await apiClient.put("/api/comics/reorder", { orders });
  } catch {
    // ignore
  }
}

// ============================================================
// 分类管理
// ============================================================

export async function addComicCategories(comicId: string, categorySlugs: string[]) {
  try {
    await apiClient.post(`/api/comics/${comicId}/categories`, { categorySlugs });
  } catch {
    // ignore
  }
}

export async function setComicCategories(comicId: string, categorySlugs: string[]) {
  try {
    await apiClient.put(`/api/comics/${comicId}/categories`, { categorySlugs });
  } catch {
    // ignore
  }
}

export async function removeComicCategory(comicId: string, categorySlug: string) {
  try {
    await apiClient.delete(`/api/comics/${comicId}/categories`, { categorySlug });
  } catch {
    // ignore
  }
}

/**
 * 清除漫画的所有分类（利用 PUT 设置空数组）
 */
export async function clearAllComicCategories(comicId: string) {
  try {
    await setComicCategories(comicId, []);
  } catch {
    // ignore
  }
}

// ============================================================
// 元数据编辑
// ============================================================

export interface ComicMetadataUpdate {
  title?: string;
  author?: string;
  publisher?: string;
  year?: number | null;
  description?: string;
  language?: string;
  genre?: string;
}

/**
 * 更新漫画/小说的元数据字段
 */
export async function updateComicMetadata(
  comicId: string,
  metadata: ComicMetadataUpdate
): Promise<boolean> {
  try {
    await apiClient.put(`/api/comics/${comicId}/metadata`, metadata);
    return true;
  } catch {
    return false;
  }
}

/**
 * 设置漫画/小说的阅读状态
 * @param status - "want" | "reading" | "finished" | "shelved" | "" (清除状态)
 */
export async function setReadingStatus(
  comicId: string,
  status: string
): Promise<boolean> {
  try {
    await apiClient.put(`/api/comics/${comicId}/reading-status`, { status });
    return true;
  } catch (e: unknown) {
    const err = e as { status?: number };
    if (err?.status === 403) throw e;
    return false;
  }
}