import { apiPath } from "@/lib/base-path";
import * as comicListHook from "@/hooks/useComicList";
const { notifyLibraryAccessChanged } = comicListHook;
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
  seriesDepth?: number;
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
  rawComicCount?: number;
  shelfCount?: number;
  canManage?: boolean;
}

export interface SeriesLayoutLockConflict {
  kind: "series" | "section";
  seriesId: string;
  sectionId?: string;
  title: string;
  rootRelativePath: string;
  reason: string;
}

export interface SeriesLayoutWorkSample {
  title: string;
  rootRelativePath: string;
  itemCount: number;
  sectionCount: number;
  singleChapter: boolean;
  matchKind: "exact_path" | "member_set_1to1" | "restored_history" | "created";
}

export interface SeriesLayoutArchivedSample {
  id: string;
  title: string;
  rootRelativePath: string;
  itemCount: number;
  hasManualMetadata: boolean;
}

export interface SeriesLayoutShallowSample {
  comicId: string;
  title: string;
  relativePath: string;
}

export interface SeriesLayoutPreview {
  libraryId: string;
  libraryName: string;
  currentSeriesDepth: number;
  targetSeriesDepth: number;
  unchanged: boolean;
  sourceRevision: string;
  totalComicFiles: number;
  oldSeriesCount: number;
  newSeriesCount: number;
  oldShelfCount: number;
  newShelfCount: number;
  singleChapterSeriesCount: number;
  shallowStandaloneCount: number;
  matchedSeriesCount: number;
  restoredFromHistoryCount: number;
  createdSeriesCount: number;
  archivedSeriesCount: number;
  archivedWithMetadataCount: number;
  hasLockConflicts: boolean;
  lockConflicts: SeriesLayoutLockConflict[];
  warnings: string[];
  samples: {
    works: SeriesLayoutWorkSample[];
    archivedSeries: SeriesLayoutArchivedSample[];
    shallowItems: SeriesLayoutShallowSample[];
  };
}

export interface SeriesLayoutSnapshotSummary {
  id: string;
  libraryId: string;
  schemaVersion: number;
  reason: string;
  previousSeriesDepth: number;
  nextSeriesDepth: number;
  sourceRevisionBefore: number;
  sourceRevisionAfter: number;
  postStateDigest: string;
  seriesCountBefore: number;
  seriesCountAfter: number;
  archivedSeriesCount: number;
  matchedSeriesCount: number;
  createdByUserId?: string;
  restoredFromSnapshotId?: string;
  restoredAt?: string | null;
  createdAt: string;
}

export class LibraryApiError extends Error {
  status: number;
  code?: string;
  currentSourceRevision?: string;
  lockConflicts?: SeriesLayoutLockConflict[];

  constructor(
    message: string,
    status: number,
    details?: {
      code?: string;
      currentSourceRevision?: string;
      lockConflicts?: SeriesLayoutLockConflict[];
    }
  ) {
    super(message);
    this.name = "LibraryApiError";
    this.status = status;
    this.code = details?.code;
    this.currentSourceRevision = details?.currentSourceRevision;
    this.lockConflicts = details?.lockConflicts;
  }
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
    let code: string | undefined;
    let currentSourceRevision: string | undefined;
    let lockConflicts: SeriesLayoutLockConflict[] | undefined;
    try {
      const data = await res.json();
      msg = data.error || msg;
      if (typeof data.code === "string") code = data.code;
      if (typeof data.currentSourceRevision === "string") {
        currentSourceRevision = data.currentSourceRevision;
      }
      if (Array.isArray(data.lockConflicts)) {
        lockConflicts = data.lockConflicts as SeriesLayoutLockConflict[];
      }
    } catch {
      // ignore
    }
    throw new LibraryApiError(msg, res.status, {
      code,
      currentSourceRevision,
      lockConflicts,
    });
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
  seriesDepth?: number;
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
  notifyLibraryAccessChanged();
  return data.library;
}

// 更新书库
export async function updateLibrary(
  id: string,
  updates: Partial<{
    name: string;
    type: "comic" | "novel" | "mixed";
    seriesDepth: number;
    expectedSourceRevision: string;
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
  notifyLibraryAccessChanged();
  return data.library;
}

export async function previewLibrarySeriesLayout(
  id: string,
  seriesDepth: number,
  signal?: AbortSignal
): Promise<SeriesLayoutPreview> {
  const res = await fetch(apiPath(`/api/admin/libraries/${id}/series-layout-preview`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seriesDepth }),
    signal,
  });
  return safeJson<SeriesLayoutPreview>(res);
}

export async function fetchLibrarySeriesSnapshots(
  id: string,
  limit = 50
): Promise<SeriesLayoutSnapshotSummary[]> {
  const res = await fetch(apiPath(`/api/admin/libraries/${id}/series-layout-snapshots?limit=${limit}`));
  const data = await safeJson<{ snapshots: SeriesLayoutSnapshotSummary[] }>(res);
  return data.snapshots || [];
}

export function getLibrarySeriesSnapshotExportUrl(libraryId: string, snapshotId: string): string {
  return apiPath(`/api/admin/libraries/${encodeURIComponent(libraryId)}/series-layout-snapshots/${encodeURIComponent(snapshotId)}/export`);
}

export async function restoreLibrarySeriesSnapshot(
  libraryId: string,
  snapshotId: string
): Promise<{
  success: boolean;
  restoredSnapshotId: string;
  library: Library;
  backupSnapshot: SeriesLayoutSnapshotSummary;
}> {
  const res = await fetch(
    apiPath(`/api/admin/libraries/${encodeURIComponent(libraryId)}/series-layout-snapshots/${encodeURIComponent(snapshotId)}/restore`),
    { method: "POST" }
  );
  const data = await safeJson<{
    success: boolean;
    restoredSnapshotId: string;
    library: Library;
    backupSnapshot: SeriesLayoutSnapshotSummary;
  }>(res);
  notifyLibraryAccessChanged();
  return data;
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
  const data = await res.json() as LibraryDeleteResult;
  notifyLibraryAccessChanged();
  return data;
}

export interface LibraryAccess {
  libraryId: string;
  canView: boolean;
  canDownload: boolean;
  canManage: boolean;
}

export interface PermissionSource {
  type: "direct" | "group" | "public" | "admin";
  id?: string;
  name: string;
  canView: boolean;
  canDownload: boolean;
  canManage: boolean;
}

export interface EffectiveLibraryAccess {
  canView: boolean;
  canDownload: boolean;
  canManage: boolean;
  effectiveCanView: boolean;
  effectiveCanDownload: boolean;
  effectiveCanManage: boolean;
  permissionSources: PermissionSource[];
}

// 获取用户的书库访问权限
export async function fetchUserLibraryAccess(userId: string): Promise<{
  userId: string;
  libraries: Array<Library & EffectiveLibraryAccess>;
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
  return (data.libraries || []).map((library) => ({
    ...library,
    seriesDepth: library.seriesDepth ?? 1,
    rawComicCount: library.comicCount,
    comicCount: library.shelfCount ?? library.comicCount,
  }));
}

export interface LibraryDirectoryBreadcrumb {
  name: string;
  path: string;
}

export interface LibraryDirectoryNode {
  name: string;
  path: string;
  depth: number;
  workCount: number;
  hasChildren: boolean;
  coverUrl: string;
}

export interface LibraryDirectoryListResponse {
  libraryId: string;
  seriesDepth: number;
  maxDirectoryDepth: number;
  parent: string;
  breadcrumbs: LibraryDirectoryBreadcrumb[];
  directories: LibraryDirectoryNode[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DIRECTORIES_CACHE_TTL = 15 * 60_000;
const MAX_DIRECTORIES_CACHE_ENTRIES = 30;
const directoriesCache = new Map<string, { data: LibraryDirectoryListResponse; ts: number }>();

function buildDirectoriesCacheKey(
  libraryId: string,
  parent: string,
  page: number,
  pageSize: number,
  stateOverride?: { scope: string; revision: number }
): string {
  const state = stateOverride ?? comicListHook.getComicCacheState?.() ?? { scope: "", revision: 0 };
  return `${state.scope}::rev=${state.revision}::lib=${libraryId}::parent=${parent}::p=${page}::ps=${pageSize}`;
}

export function getCachedLibraryDirectories(
  libraryId: string,
  options?: { parent?: string; page?: number; pageSize?: number }
): LibraryDirectoryListResponse | null {
  if (!libraryId) return null;
  const key = buildDirectoriesCacheKey(
    libraryId,
    options?.parent ?? "",
    options?.page ?? 1,
    options?.pageSize ?? 100
  );
  const entry = directoriesCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DIRECTORIES_CACHE_TTL) {
    directoriesCache.delete(key);
    return null;
  }
  return entry.data;
}

export function clearLibraryDirectoriesCache(): void {
  directoriesCache.clear();
}

export async function fetchLibraryDirectories(
  libraryId: string,
  options?: {
    parent?: string;
    page?: number;
    pageSize?: number;
    signal?: AbortSignal;
  }
): Promise<LibraryDirectoryListResponse> {
  const parent = options?.parent ?? "";
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 100;
  const initialState = comicListHook.getComicCacheState?.() ?? { scope: "", revision: 0 };

  const queryParts: string[] = [];
  if (parent) queryParts.push(`parent=${encodeURIComponent(parent)}`);
  if (page !== 1) queryParts.push(`page=${encodeURIComponent(String(page))}`);
  if (pageSize !== 100) queryParts.push(`pageSize=${encodeURIComponent(String(pageSize))}`);
  const qs = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

  const res = await fetch(
    apiPath(`/api/libraries/${encodeURIComponent(libraryId)}/directories${qs}`),
    { signal: options?.signal }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      directoriesCache.clear();
      comicListHook.invalidateComicsCache?.();
    }
    return safeJson<LibraryDirectoryListResponse>(res);
  }
  const data = await safeJson<LibraryDirectoryListResponse>(res);
  const normalized: LibraryDirectoryListResponse = {
    libraryId: data.libraryId || libraryId,
    seriesDepth: data.seriesDepth ?? 1,
    maxDirectoryDepth: data.maxDirectoryDepth ?? 0,
    parent: data.parent ?? parent,
    breadcrumbs: data.breadcrumbs || [],
    directories: data.directories || [],
    total: data.total ?? 0,
    page: data.page ?? page,
    pageSize: data.pageSize ?? pageSize,
    totalPages: data.totalPages ?? 1,
  };
  const currentState = comicListHook.getComicCacheState?.() ?? { scope: "", revision: 0 };
  if (
    currentState.scope === initialState.scope &&
    currentState.revision === initialState.revision
  ) {
    if (directoriesCache.size >= MAX_DIRECTORIES_CACHE_ENTRIES) {
      const oldest = directoriesCache.keys().next().value;
      if (oldest !== undefined) directoriesCache.delete(oldest);
    }
    directoriesCache.set(
      buildDirectoriesCacheKey(libraryId, parent, page, pageSize, currentState),
      { data: normalized, ts: Date.now() }
    );
  }
  return normalized;
}
