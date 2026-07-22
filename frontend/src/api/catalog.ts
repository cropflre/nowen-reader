import { apiClient } from "@/lib/apiClient";

export type CatalogItemKind = "comic" | "series";

export interface CatalogItem {
  id: string;
  kind: CatalogItemKind;
  title: string;
  coverUrl: string;
  itemCount: number;
  libraryId: string;
}

export interface CatalogItemResult {
  items: CatalogItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface FetchCatalogItemsOptions {
  contentType: "comic" | "novel";
  search?: string;
  page: number;
  pageSize: number;
  sortOrder?: "asc" | "desc";
  libraryIds?: string[];
  signal?: AbortSignal;
}

export async function fetchCatalogItems({
  contentType,
  search,
  page,
  pageSize,
  sortOrder = "asc",
  libraryIds,
  signal,
}: FetchCatalogItemsOptions): Promise<CatalogItemResult> {
  const params = new URLSearchParams({
    contentType,
    page: String(page),
    pageSize: String(pageSize),
    sortBy: "title",
    sortOrder,
  });
  if (search) params.set("search", search);
  if (libraryIds?.length) params.set("libraryIds", libraryIds.join(","));
  return apiClient.get<CatalogItemResult>(`/api/catalog/items?${params}`, { signal });
}
