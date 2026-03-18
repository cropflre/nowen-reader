/**
 * Series API — 系列分组相关的 API 调用
 */

export interface SeriesListItem {
  seriesName: string;
  volumeCount: number;
  totalPages: number;
  coverUrl: string;
  coverComicId: string;
  latestReadAt: string | null;
  authors: string;
}

export interface SeriesListResult {
  series: SeriesListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SeriesVolumeInfo {
  comicId: string;
  title: string;
  seriesIndex: number | null;
  pageCount: number;
  lastReadPage: number;
}

export interface SeriesDetailResult {
  seriesName: string;
  comics: import("@/hooks/useComicTypes").ApiComic[];
  volumes: SeriesVolumeInfo[];
  totalPages: number;
  progress: number;
}

/**
 * 获取系列列表（分组聚合）
 */
export async function fetchSeriesList(opts?: {
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
}): Promise<SeriesListResult> {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  if (opts?.sortBy) params.set("sortBy", opts.sortBy);
  if (opts?.sortOrder) params.set("sortOrder", opts.sortOrder);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));

  const qs = params.toString();
  const res = await fetch(`/api/series${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch series list");
  return res.json();
}

/**
 * 获取系列详情（含所有卷漫画）
 */
export async function fetchSeriesDetail(seriesName: string): Promise<SeriesDetailResult> {
  const res = await fetch(`/api/series/${encodeURIComponent(seriesName)}`);
  if (!res.ok) throw new Error("Failed to fetch series detail");
  return res.json();
}

/**
 * 手动分配系列
 */
export async function assignSeries(
  comicIds: string[],
  seriesName: string,
  opts?: { seriesIndex?: number; autoIndex?: boolean }
): Promise<boolean> {
  try {
    const res = await fetch("/api/series/assign", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comicIds,
        seriesName,
        seriesIndex: opts?.seriesIndex,
        autoIndex: opts?.autoIndex ?? false,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 移除系列关联
 */
export async function removeSeries(comicIds: string[]): Promise<boolean> {
  try {
    const res = await fetch("/api/series/remove", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comicIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
