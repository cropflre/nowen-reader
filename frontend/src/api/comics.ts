/**
 * Comics API — 所有独立的 API 调用函数
 * 从 useComics.ts 中拆分出来的纯函数层
 */

/**
 * 上传文件到服务器
 */
export async function uploadComics(
  files: FileList | File[]
): Promise<{ success: boolean; message: string; successCount: number; totalCount: number }> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
  return {
    success: res.ok && (data.successCount ?? 0) > 0,
    message: data.message || data.error || "Unknown error",
    successCount: data.successCount ?? 0,
    totalCount: data.totalCount ?? Array.from(files).length,
  };
}

/**
 * 保存阅读进度
 */
export async function saveReadingProgress(comicId: string, page: number) {
  try {
    await fetch(`/api/comics/${comicId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
    });
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
    const res = await fetch(`/api/comics/${comicId}/favorite`, {
      method: "PUT",
    });
    if (res.ok) {
      const data = await res.json();
      return data.isFavorite;
    }
  } catch {
    // ignore
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
    await fetch(`/api/comics/${comicId}/rating`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
  } catch {
    // ignore
  }
}

/**
 * 为漫画添加标签
 */
export async function addComicTags(comicId: string, tags: string[]) {
  try {
    await fetch(`/api/comics/${comicId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
  } catch {
    // ignore
  }
}

/**
 * 从漫画移除标签
 */
export async function removeComicTag(comicId: string, tag: string) {
  try {
    await fetch(`/api/comics/${comicId}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
  } catch {
    // ignore
  }
}

/**
 * 清除漫画的所有标签（调用后端批量清除接口，单次请求）
 */
export async function clearAllComicTags(comicId: string) {
  try {
    await fetch(`/api/comics/${comicId}/tags/clear-all`, {
      method: "DELETE",
    });
  } catch {
    // ignore
  }
}

/**
 * 批量操作
 * @param params - 额外参数（如 deleteFiles: true, tags: [...] 等）
 */
export async function batchOperation(
  action: string,
  comicIds: string[],
  params?: Record<string, unknown>
) {
  try {
    const res = await fetch("/api/comics/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, comicIds, ...params }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 删除单个漫画
 * @param deleteFiles - 是否同时删除磁盘文件（默认 false，仅删除数据库记录）
 * 返回 { success, error? } 包含具体错误信息
 */
export async function deleteComicById(comicId: string, deleteFiles = false): Promise<{ success: boolean; error?: string }> {
  try {
    const url = deleteFiles
      ? `/api/comics/${comicId}/delete?deleteFiles=true`
      : `/api/comics/${comicId}/delete`;
    const res = await fetch(url, {
      method: "DELETE",
    });
    if (res.ok) {
      return { success: true };
    }
    // 尝试解析后端返回的具体错误信息
    try {
      const data = await res.json();
      const detail = data.error || `HTTP ${res.status}`;
      return { success: false, error: detail };
    } catch {
      return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ============================================================
// 阅读会话
// ============================================================

export async function startSession(comicId: string, startPage: number): Promise<number | null> {
  try {
    const res = await fetch("/api/stats/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicId, startPage }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.sessionId;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function endSession(sessionId: number, endPage: number, duration: number) {
  try {
    await fetch("/api/stats/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, endPage, duration }),
    });
  } catch {
    // ignore
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
    await fetch("/api/comics/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders }),
    });
  } catch {
    // ignore
  }
}

// ============================================================
// 分类管理
// ============================================================

export async function addComicCategories(comicId: string, categorySlugs: string[]) {
  try {
    await fetch(`/api/comics/${comicId}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categorySlugs }),
    });
  } catch {
    // ignore
  }
}

export async function setComicCategories(comicId: string, categorySlugs: string[]) {
  try {
    await fetch(`/api/comics/${comicId}/categories`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categorySlugs }),
    });
  } catch {
    // ignore
  }
}

export async function removeComicCategory(comicId: string, categorySlug: string) {
  try {
    await fetch(`/api/comics/${comicId}/categories`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categorySlug }),
    });
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
    const res = await fetch(`/api/comics/${comicId}/metadata`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });
    return res.ok;
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
    const res = await fetch(`/api/comics/${comicId}/reading-status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
