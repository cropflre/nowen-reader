import { apiClient } from "@/lib/apiClient";
import type { SeriesDetail, SeriesSummary } from "@/types/series";

export async function fetchSeriesDetail(id: string): Promise<SeriesDetail> {
  return apiClient.get<SeriesDetail>(`/api/series/${encodeURIComponent(id)}`);
}

export async function fetchSeries(libraryIds?: string[], search?: string): Promise<SeriesSummary[]> {
  const params = new URLSearchParams();
  if (libraryIds?.length) params.set("libraryIds", libraryIds.join(","));
  if (search) params.set("search", search);
  const query = params.toString();
  const response = await apiClient.get<{ series: SeriesSummary[] }>(`/api/series${query ? `?${query}` : ""}`);
  return response.series || [];
}

export async function updateSeries(
  id: string,
  body: { title?: string; coverComicId?: string; manualLocked?: boolean },
): Promise<void> {
  await apiClient.put(`/api/series/${encodeURIComponent(id)}`, body);
}

export async function updateSeriesStructure(
  id: string,
  items: Array<{ comicId: string; sectionId?: string; sortIndex: number }>,
): Promise<void> {
  await apiClient.put(`/api/series/${encodeURIComponent(id)}/structure`, { items });
}

export async function setSeriesTags(id: string, tags: string[]): Promise<SeriesSummary["tags"]> {
  const response = await apiClient.put<{ tags: SeriesSummary["tags"] }>(
    `/api/series/${encodeURIComponent(id)}/tags`, { tags },
  );
  return response.tags;
}

export async function rebuildSeries(libraryId?: string): Promise<void> {
  const suffix = libraryId ? `?libraryId=${encodeURIComponent(libraryId)}` : "";
  await apiClient.post(`/api/series/rebuild${suffix}`);
}

export async function redetectSeries(id: string): Promise<void> {
  await apiClient.post(`/api/series/${encodeURIComponent(id)}/re-detect`);
}

export async function removeSeriesRelationship(id: string): Promise<void> {
  await apiClient.delete(`/api/series/${encodeURIComponent(id)}`);
}
