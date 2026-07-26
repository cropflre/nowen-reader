import { apiPath } from "@/lib/base-path";
/**
 * 书库管理 API
 * 对应后端 /api/admin/libraries/*
 */

// ============================================================
// 类型定义
// ============================================================

export interface Library {
  id: string;
  name: string;
  type: "comic" | "novel" | "mixed";
  rootPath: string;
  rootPaths?: string[]; // 多目录支持，包含主路径和额外路径
  enabled: boolean;
  sortOrder: number;
  defaultAccess: "public" | "private";
  scanEnabled: boolean;
  lastScanAt: string | null;
  lastScanAdded: number;
  lastScanTotal: number;
  createdAt: string;
  updatedAt: string;
  comicCount: number;
  canManage?: boolean;
}

export interface LibraryDeleteResult {
  success: boolean;
  libraryId: string;
  libraryName: string;
  deletedContents: number;
  thumbnailCacheDeleted: number;
  pageCacheDeleted: number;
  deleteSourceFiles: false;
}

export interface UserLibraryAccess {
  libraryId: string;
  canView: boolean;
  canDownload: boolean;
  canManage: boolean;
}

export interface LibraryRootConflict {
  path: string;
  libraryId: string;
  libraryName: string;
  otherLibraryId: string;
  otherLibraryName: string;
}

export interface OwnershipIssue {
  physicalPath: string;
  targetLibraryId: string;
  targetLibraryName: string;
  targetRelativePath: string;
  targetId: string;
  action: "move" | "merge";
  resolvable: boolean;
  records: Array<{
    id: string;
    title: string;
    libraryId: string;
    libraryName: string;
    relativePath: string;
  }>;
}

export interface LibraryOwnershipPreview {
  issues: OwnershipIssue[];
  rootConflicts: LibraryRootConflict[];
  issueCount: number;
  duplicateRows: number;
  canReconcile: boolean;
}

export interface LibraryOwnershipReconcileResult {
  issueCount: number;
  reconciled: number;
  mergedRows: number;
  movedRows: number;
  blocked: number;
}

// ============================================================
// API 函数
// ============================================================

async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// 获取所有书库
export async function fetchLibraries(): Promise<Library[]> {
  const res = await fetch(apiPath("/api/admin/libraries"));
  const data = await safeJson<{ libraries: Library[] }>(res);
  return data.libraries || [];
}

// 创建书库
export async function createLibrary(library: {
  name: string;
  type: "comic" | "novel" | "mixed";
  rootPath?: string;
  rootPaths?: string[];
  enabled?: boolean;
  sortOrder?: number;
  defaultAccess?: "public" | "private";
  scanEnabled?: boolean;
}): Promise<Library> {
  const res = await fetch(apiPath("/api/admin/libraries"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(library),
  });
  const data = await safeJson<{ library: Library }>(res);
  return data.library;
}

// 更新书库
export async function updateLibrary(
  id: string,
  updates: Partial<{
    name: string;
    type: "comic" | "novel" | "mixed";
    rootPath: string;
    rootPaths?: string[];
    enabled: boolean;
    sortOrder: number;
    defaultAccess: "public" | "private";
    scanEnabled: boolean;
  }>
): Promise<Library> {
  const res = await fetch(apiPath(`/api/admin/libraries/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  const data = await safeJson<{ library: Library }>(res);
  return data.library;
}

// 删除书库：删除书库记录、内容索引和派生缓存，不删除本地原始文件。
export async function deleteLibrary(id: string): Promise<LibraryDeleteResult> {
  const res = await fetch(apiPath(`/api/admin/libraries/${id}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<LibraryDeleteResult>;
}

export interface LibraryAccess {
  libraryId: string;
  canView: boolean;
  canDownload: boolean;
  canManage: boolean;
}

// 获取用户的书库访问权限
export async function fetchUserLibraryAccess(userId: string): Promise<{
  userId: string;
  libraries: Array<Library & LibraryAccess>;
}> {
  const res = await fetch(apiPath(`/api/admin/users/${userId}/library-access`));
  return safeJson(res);
}

// 扫描单个书库
export async function scanLibrary(
  id: string
): Promise<{ added: number; removed: number; library: Library }> {
  const res = await fetch(apiPath(`/api/admin/libraries/${id}/scan`), {
    method: "POST",
  });
  return safeJson(res);
}

// 扫描当前用户拥有管理权限的书库（管理员与 canManage 用户均可调用）。
export async function scanManagedLibrary(
  id: string
): Promise<{ added: number; removed: number; library: Library }> {
  const res = await fetch(apiPath(`/api/libraries/${id}/scan`), {
    method: "POST",
  });
  return safeJson(res);
}

export async function previewLibraryOwnership(): Promise<LibraryOwnershipPreview> {
  const res = await fetch(apiPath("/api/admin/libraries/ownership-preview"));
  return safeJson(res);
}

export async function reconcileLibraryOwnership(rootOwners: Record<string, string> = {}): Promise<LibraryOwnershipReconcileResult> {
  const res = await fetch(apiPath("/api/admin/libraries/ownership-reconcile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, rootOwners }),
  });
  const data = await safeJson<{ result: LibraryOwnershipReconcileResult }>(res);
  return data.result;
}

// 设置用户的书库访问权限
export async function setUserLibraryAccess(
  userId: string,
  libraryAccess: LibraryAccess[]
): Promise<void> {
  const res = await fetch(apiPath(`/api/admin/users/${userId}/library-access`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryAccess }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

// 获取当前用户可访问的书库（非 admin 接口）。漫画书库的标签数量按“作品卡片
// + 独立内容”计算，而不是把同一作品下的每个 PDF 都当成一本。
export async function fetchAccessibleLibraries(): Promise<Library[]> {
  const res = await fetch(apiPath("/api/libraries/accessible"));
  const data = await safeJson<{ libraries: Library[] }>(res);
  const libraries = data.libraries || [];

  try {
    const seriesRes = await fetch(apiPath("/api/series"));
    if (!seriesRes.ok) return libraries;
    const seriesData = await seriesRes.json() as {
      series?: Array<{ libraryId: string; itemCount: number }>;
    };
    const groupedSavings = new Map<string, number>();
    for (const series of seriesData.series || []) {
      groupedSavings.set(
        series.libraryId,
        (groupedSavings.get(series.libraryId) || 0) + Math.max(0, series.itemCount - 1),
      );
    }
    return libraries.map((library) => ({
      ...library,
      comicCount: Math.max(0, (library.comicCount || 0) - (groupedSavings.get(library.id) || 0)),
    }));
  } catch {
    // 分层接口不可用时保留原始计数，不阻断书库加载。
    return libraries;
  }
}
