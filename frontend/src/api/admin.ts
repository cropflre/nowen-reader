/**
 * 数据管理模块 API
 * 对应后端 /api/admin/storage/*
 *
 * 本文件分两层：
 *   1) 底层 fetch 函数（与后端契约一一对应）
 *   2) adminAPI 适配层 + 扁平化数据结构（供 DataAdminPanel 等组件使用）
 */

// ============================================================
// 共享：HTTP 工具
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

// ============================================================
// 业务类型（对外，扁平化）
// ============================================================

export interface CacheBucket {
  key: string; // thumbnails / pages / converted / other
  label: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  dirCount: number;
  oldestAt: number;
  newestAt: number;
  exists: boolean;
}

export interface TableSize {
  name: string;
  rowCount: number;
  sizeBytes: number;
  bytesEst: number; // 与 sizeBytes 等价，组件按 bytesEst 读
}

/**
 * 数据库统计（组件视角）
 *  - wastedBytes / hasDbStat 由 reclaimableMB / 是否有表统计推导
 */
export interface DBStat {
  path: string;
  mainBytes: number;
  walBytes: number;
  shmBytes: number;
  totalBytes: number;
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  reclaimableMB: number;
  wastedBytes: number;
  hasDbStat: boolean;
  journalMode: string;
  integrityOK: boolean;
  tables: TableSize[];
}

/** 兼容旧名称导出 */
export type DBInfo = DBStat;

export interface DiskInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  available: boolean;
  usedPercent: number;
  /** 不可用时的错误说明（前端展示用，可选） */
  error?: string;
}

export interface StorageThreshold {
  cacheMaxMB: number;
  dbMaxMB: number;
  diskFreeMinMB: number;
}

export interface StorageOverview {
  generatedAt: number;
  dataDir: string;
  /** 缓存（保持后端对象形态） */
  cache: {
    totalBytes: number;
    fileCount: number;
    buckets: CacheBucket[];
  };
  /** 缓存总占用字节（= cache.totalBytes，便捷字段） */
  cacheTotal: number;
  /** 缓存文件总数（= cache.fileCount，便捷字段） */
  cacheFileCount: number;
  database: DBStat;
  disk: DiskInfo;
  threshold: StorageThreshold;
  warnings: string[];
}

export interface StorageSample {
  ts: number; // unix sec
  cacheBytes: number;
  dbBytes: number;
  diskFree: number;
}

export interface StorageHistoryResponse {
  days: number;
  count: number;
  samples: StorageSample[];
}

// ============================================================
// 后端原始返回类型（内部）
// ============================================================

interface RawTableSize {
  name: string;
  rowCount: number;
  sizeBytes: number;
}

interface RawDBInfo {
  path: string;
  mainBytes: number;
  walBytes: number;
  shmBytes: number;
  totalBytes: number;
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  reclaimableMB: number;
  journalMode: string;
  integrityOK: boolean;
  tables: RawTableSize[];
}

interface RawDiskInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  available: boolean;
  usedPercent: number;
}

interface RawStorageOverview {
  generatedAt: number;
  dataDir: string;
  cache: {
    totalBytes: number;
    fileCount: number;
    buckets: CacheBucket[];
  };
  database: RawDBInfo;
  disk: RawDiskInfo;
  threshold?: Partial<StorageThreshold>;
  warnings?: string[];
}

// ============================================================
// 底层 fetch 函数
// ============================================================

async function rawGetOverview(fresh = false): Promise<RawStorageOverview> {
  const res = await fetch(`/api/admin/storage${fresh ? "?fresh=1" : ""}`, {
    credentials: "include",
  });
  return safeJson<RawStorageOverview>(res);
}

async function rawGetHistory(days = 30): Promise<StorageHistoryResponse> {
  const d = Math.max(1, Math.min(90, Math.floor(days)));
  const res = await fetch(`/api/admin/storage/history?days=${d}`, {
    credentials: "include",
  });
  return safeJson<StorageHistoryResponse>(res);
}

interface RawClearCacheRequest {
  target: "thumbnails" | "pages" | "converted" | "other" | "all";
  olderThanDays?: number;
  largerThanMB?: number;
  orphanOnly?: boolean;
}

export interface ClearCacheResult {
  success: boolean;
  deleted: number;
  freedBytes: number;
}

async function rawClearCache(req: RawClearCacheRequest): Promise<ClearCacheResult> {
  const res = await fetch("/api/admin/storage/cache/clear", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return safeJson<ClearCacheResult>(res);
}

export interface DBOpResult {
  success: boolean;
  durationMs: number;
  beforeBytes?: number;
  afterBytes?: number;
  freedBytes?: number;
}

async function rawCheckpoint(): Promise<DBOpResult> {
  const res = await fetch("/api/admin/storage/db/checkpoint", {
    method: "POST",
    credentials: "include",
  });
  return safeJson<DBOpResult>(res);
}

async function rawAnalyze(): Promise<DBOpResult> {
  const res = await fetch("/api/admin/storage/db/analyze", {
    method: "POST",
    credentials: "include",
  });
  return safeJson<DBOpResult>(res);
}

async function rawVacuum(): Promise<DBOpResult> {
  const res = await fetch("/api/admin/storage/db/vacuum", {
    method: "POST",
    credentials: "include",
  });
  return safeJson<DBOpResult>(res);
}

interface RawIntegrityResult {
  success: boolean;
  ok: boolean;
  messages: string[];
  durationMs: number;
}

async function rawIntegrity(): Promise<RawIntegrityResult> {
  const res = await fetch("/api/admin/storage/db/integrity", {
    method: "POST",
    credentials: "include",
  });
  return safeJson<RawIntegrityResult>(res);
}

async function rawUpdateThreshold(
  t: StorageThreshold
): Promise<{ success: boolean; threshold: StorageThreshold }> {
  const res = await fetch("/api/admin/storage/threshold", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(t),
  });
  return safeJson<{ success: boolean; threshold: StorageThreshold }>(res);
}

// ============================================================
// 适配层：转换工具
// ============================================================

const DEFAULT_THRESHOLD: StorageThreshold = {
  cacheMaxMB: 0,
  dbMaxMB: 0,
  diskFreeMinMB: 0,
};

function adaptDBInfo(d: RawDBInfo): DBStat {
  const wastedBytes = Math.round((d.reclaimableMB || 0) * 1024 * 1024);
  const tables: TableSize[] = (d.tables || []).map((t) => ({
    name: t.name,
    rowCount: t.rowCount,
    sizeBytes: t.sizeBytes,
    bytesEst: t.sizeBytes,
  }));
  return {
    path: d.path,
    mainBytes: d.mainBytes,
    walBytes: d.walBytes,
    shmBytes: d.shmBytes,
    totalBytes: d.totalBytes,
    pageSize: d.pageSize,
    pageCount: d.pageCount,
    freelistCount: d.freelistCount,
    reclaimableMB: d.reclaimableMB,
    wastedBytes,
    hasDbStat: tables.some((t) => t.sizeBytes > 0),
    journalMode: d.journalMode,
    integrityOK: d.integrityOK,
    tables,
  };
}

function adaptDiskInfo(d: RawDiskInfo): DiskInfo {
  return {
    path: d.path,
    totalBytes: d.totalBytes,
    freeBytes: d.freeBytes,
    usedBytes: d.usedBytes,
    available: d.available,
    usedPercent: d.usedPercent,
    error: d.available ? undefined : "无法获取磁盘信息",
  };
}

function adaptThreshold(t?: Partial<StorageThreshold>): StorageThreshold {
  return {
    cacheMaxMB: t?.cacheMaxMB ?? 0,
    dbMaxMB: t?.dbMaxMB ?? 0,
    diskFreeMinMB: t?.diskFreeMinMB ?? 0,
  };
}

function adaptOverview(raw: RawStorageOverview): StorageOverview {
  const cache = {
    totalBytes: raw.cache?.totalBytes ?? 0,
    fileCount: raw.cache?.fileCount ?? 0,
    buckets: raw.cache?.buckets ?? [],
  };
  return {
    generatedAt: raw.generatedAt,
    dataDir: raw.dataDir,
    cache,
    cacheTotal: cache.totalBytes,
    cacheFileCount: cache.fileCount,
    database: adaptDBInfo(raw.database),
    disk: adaptDiskInfo(raw.disk),
    threshold: adaptThreshold(raw.threshold),
    warnings: raw.warnings ?? [],
  };
}

// ============================================================
// adminAPI：组件统一入口
// ============================================================

/** 组件友好的 ClearCache 请求（语义化 action） */
export type ClearCacheAction =
  | { action: "clear-bucket"; buckets: string[]; includeSubdir?: boolean }
  | { action: "clear-older-than"; days: number }
  | { action: "clear-larger-than"; minSizeMB: number }
  | { action: "clear-orphan" };

async function clearCacheAdapter(req: ClearCacheAction): Promise<ClearCacheResult> {
  switch (req.action) {
    case "clear-bucket": {
      // 多桶时逐个调用，结果合并
      const targets = req.buckets.length > 0 ? req.buckets : ["all"];
      let deleted = 0;
      let freedBytes = 0;
      let success = true;
      for (const t of targets) {
        const r = await rawClearCache({
          target: t as RawClearCacheRequest["target"],
        });
        deleted += r.deleted || 0;
        freedBytes += r.freedBytes || 0;
        success = success && !!r.success;
      }
      return { success, deleted, freedBytes };
    }
    case "clear-older-than":
      return rawClearCache({ target: "all", olderThanDays: req.days });
    case "clear-larger-than":
      return rawClearCache({ target: "all", largerThanMB: req.minSizeMB });
    case "clear-orphan":
      return rawClearCache({ target: "all", orphanOnly: true });
  }
}

export const adminAPI = {
  async getOverview(fresh = false): Promise<StorageOverview> {
    const raw = await rawGetOverview(fresh);
    return adaptOverview(raw);
  },

  getHistory(days = 30): Promise<StorageHistoryResponse> {
    return rawGetHistory(days);
  },

  clearCache(req: ClearCacheAction): Promise<ClearCacheResult> {
    return clearCacheAdapter(req);
  },

  checkpointDB(): Promise<DBOpResult> {
    return rawCheckpoint();
  },

  analyzeDB(): Promise<DBOpResult> {
    return rawAnalyze();
  },

  vacuumDB(): Promise<DBOpResult> {
    return rawVacuum();
  },

  async integrityCheckDB(): Promise<{
    success: boolean;
    ok: boolean;
    details: string[];
    durationMs: number;
  }> {
    const r = await rawIntegrity();
    return {
      success: r.success,
      ok: r.ok,
      details: r.messages ?? [],
      durationMs: r.durationMs,
    };
  },

  /** 后端暂未提供 REINDEX 接口，回退到 ANALYZE（语义最接近） */
  reindexDB(): Promise<DBOpResult> {
    return rawAnalyze();
  },

  updateThreshold(
    t: StorageThreshold
  ): Promise<{ success: boolean; threshold: StorageThreshold }> {
    return rawUpdateThreshold(t);
  },
};

// ============================================================
// 兼容旧调用点：保留命名导出
// ============================================================

export const fetchStorageOverview = (fresh = false) => adminAPI.getOverview(fresh);
export const fetchStorageHistory = (days = 30) => adminAPI.getHistory(days);
export const clearCacheBucket = (req: RawClearCacheRequest) => rawClearCache(req);
export const dbCheckpoint = () => adminAPI.checkpointDB();
export const dbAnalyze = () => adminAPI.analyzeDB();
export const dbVacuum = () => adminAPI.vacuumDB();
export const dbIntegrityCheck = () => rawIntegrity();
export const updateStorageThreshold = (t: StorageThreshold) =>
  adminAPI.updateThreshold(t);
export async function fetchDBInfo(): Promise<DBStat> {
  const res = await fetch("/api/admin/storage/database", { credentials: "include" });
  const raw = await safeJson<RawDBInfo>(res);
  return adaptDBInfo(raw);
}

// ============================================================
// Helpers
// ============================================================

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = n / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(2)} ${units[i]}`;
}

export function formatTimestamp(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString("zh-CN", { hour12: false });
}
