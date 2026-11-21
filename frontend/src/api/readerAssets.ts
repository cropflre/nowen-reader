import { apiClient } from "@/lib/apiClient";
import { apiPath } from "@/lib/base-path";

export const COMIC_LAYOUT_OVERRIDE_KEYS = [
  "mode",
  "direction",
  "doubleCoverAlone",
  "doublePageNoGap",
  "fitMode",
] as const;

export type ComicLayoutOverrideKey = (typeof COMIC_LAYOUT_OVERRIDE_KEYS)[number];

export interface ServerUserBookmark {
  id: string;
  comicId: string;
  pageIndex: number;
  positionRatio: number;
  chapterTitle: string;
  name: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertBookmarkInput {
  id?: string;
  pageIndex?: number;
  chapterIndex?: number;
  positionRatio?: number;
  chapterTitle?: string;
  name?: string;
  note?: string;
  createdAt?: number;
  timestamp?: number;
  updatedAt?: number;
}

export interface ServerUserHighlight {
  id: string;
  comicId: string;
  chapterIndex: number;
  chapterTitle: string;
  text: string;
  note: string;
  color: string;
  startOffset: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertHighlightInput {
  id?: string;
  chapterIndex: number;
  chapterTitle?: string;
  text: string;
  note?: string;
  color?: string;
  startOffset?: number;
  createdAt?: number;
  timestamp?: number;
  updatedAt?: number;
}

export interface ReaderPreferencesResponse {
  globalComic: Record<string, unknown>;
  globalNovel: Record<string, unknown>;
  seriesOverride: Record<string, unknown> | null;
  comicOverride: Record<string, unknown> | null;
  resolvedComic: Record<string, unknown>;
}

export async function listBookmarks(comicId: string): Promise<ServerUserBookmark[]> {
  const data = await apiClient.get<{ bookmarks?: ServerUserBookmark[] }>(
    `/api/comics/${encodeURIComponent(comicId)}/bookmarks`
  );
  return data.bookmarks ?? [];
}

export async function upsertBookmark(
  comicId: string,
  input: UpsertBookmarkInput
): Promise<ServerUserBookmark | null> {
  const data = await apiClient.post<{ bookmark?: ServerUserBookmark }>(
    `/api/comics/${encodeURIComponent(comicId)}/bookmarks`,
    input
  );
  return data.bookmark ?? null;
}

export async function updateBookmark(
  comicId: string,
  bookmarkId: string,
  patch: { name: string; note: string }
): Promise<ServerUserBookmark | null> {
  const data = await apiClient.put<{ bookmark?: ServerUserBookmark }>(
    `/api/comics/${encodeURIComponent(comicId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    patch
  );
  return data.bookmark ?? null;
}

export async function deleteBookmark(comicId: string, bookmarkId: string): Promise<void> {
  await apiClient.delete(
    `/api/comics/${encodeURIComponent(comicId)}/bookmarks/${encodeURIComponent(bookmarkId)}`
  );
}

export async function importBookmarks(
  comicId: string,
  bookmarks: UpsertBookmarkInput[]
): Promise<ServerUserBookmark[]> {
  const data = await apiClient.post<{ bookmarks?: ServerUserBookmark[] }>(
    `/api/comics/${encodeURIComponent(comicId)}/bookmarks/import`,
    { bookmarks }
  );
  return data.bookmarks ?? [];
}

export async function listHighlights(comicId: string): Promise<ServerUserHighlight[]> {
  const data = await apiClient.get<{ highlights?: ServerUserHighlight[] }>(
    `/api/comics/${encodeURIComponent(comicId)}/highlights`
  );
  return data.highlights ?? [];
}

export async function upsertHighlight(
  comicId: string,
  input: UpsertHighlightInput
): Promise<ServerUserHighlight | null> {
  const data = await apiClient.post<{ highlight?: ServerUserHighlight }>(
    `/api/comics/${encodeURIComponent(comicId)}/highlights`,
    input
  );
  return data.highlight ?? null;
}

export async function updateHighlight(
  comicId: string,
  highlightId: string,
  patch: { note: string; color?: string }
): Promise<ServerUserHighlight | null> {
  const data = await apiClient.put<{ highlight?: ServerUserHighlight }>(
    `/api/comics/${encodeURIComponent(comicId)}/highlights/${encodeURIComponent(highlightId)}`,
    patch
  );
  return data.highlight ?? null;
}

export async function deleteHighlight(comicId: string, highlightId: string): Promise<void> {
  await apiClient.delete(
    `/api/comics/${encodeURIComponent(comicId)}/highlights/${encodeURIComponent(highlightId)}`
  );
}

export async function importHighlights(
  comicId: string,
  highlights: UpsertHighlightInput[]
): Promise<ServerUserHighlight[]> {
  const data = await apiClient.post<{ highlights?: ServerUserHighlight[] }>(
    `/api/comics/${encodeURIComponent(comicId)}/highlights/import`,
    { highlights }
  );
  return data.highlights ?? [];
}

export function getHighlightsExportUrl(comicId: string, format: "markdown" = "markdown"): string {
  return apiPath(
    `/api/comics/${encodeURIComponent(comicId)}/highlights/export?format=${encodeURIComponent(format)}`
  );
}

export async function getReaderPreferences(params?: {
  comicId?: string;
  seriesId?: string;
}): Promise<ReaderPreferencesResponse> {
  const query = new URLSearchParams();
  if (params?.comicId) query.set("comicId", params.comicId);
  if (params?.seriesId) query.set("seriesId", params.seriesId);
  const qs = query.toString();
  return apiClient.get<ReaderPreferencesResponse>(
    `/api/user/reader-preferences${qs ? `?${qs}` : ""}`
  );
}

export async function saveReaderPreference(
  scope: string,
  prefs: Record<string, unknown>
): Promise<void> {
  await apiClient.put("/api/user/reader-preferences", { scope, prefs });
}

export async function deleteReaderPreference(scope: string): Promise<void> {
  await apiClient.delete(
    `/api/user/reader-preferences?scope=${encodeURIComponent(scope)}`
  );
}
