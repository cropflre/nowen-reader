"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import Navbar from "@/components/Navbar";
import ComicCard from "@/components/ComicCard";
import TagFilter from "@/components/TagFilter";
import StatsBar from "@/components/StatsBar";
import CategoryFilter from "@/components/CategoryFilter";
import BatchToolbar from "@/components/BatchToolbar";
import { RecommendationStrip } from "@/components/Recommendations";
import { ContinueReading } from "@/components/ContinueReading";
import ShelfManager from "@/components/ShelfManager";
import {
  useComics,
  uploadComics,
  ApiComic,
  batchOperation,
  updateSortOrders,
  useCategories,
} from "@/hooks/useComics";
import { Comic } from "@/types/comic";
import { useTranslation } from "@/lib/i18n";
import { CheckSquare, CheckCheck, LayoutGrid, List, Copy, Upload, Download } from "lucide-react";
import DuplicateDetector from "@/components/DuplicateDetector";

const DEFAULT_PAGE_SIZE = 24;

/** Debounce hook: delays value updates to avoid rapid-fire API calls */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// Convert API comic to display comic
function apiToComic(api: ApiComic): Comic {
  return {
    id: api.id,
    title: api.title,
    coverUrl: api.coverUrl,
    tags: (api.tags || []).map((t) => t.name),
    tagData: api.tags || [],
    pageCount: api.pageCount,
    progress:
      api.pageCount > 0
        ? Math.round((api.lastReadPage / api.pageCount) * 100)
        : 0,
    lastRead: api.lastReadAt || undefined,
    isFavorite: api.isFavorite,
    rating: api.rating ?? undefined,
    lastReadPage: api.lastReadPage,
    sortOrder: api.sortOrder,
    totalReadTime: api.totalReadTime,
    categories: api.categories || [],
    filename: api.filename,
  };
}

export default function Home() {
  const t = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [uploading, setUploading] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<string>("title");
  const [sortOrder, setSortOrder] = useState<string>("asc");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  // Batch selection
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Duplicate detection
  const [showDuplicates, setShowDuplicates] = useState(false);

  // Shelf
  const [selectedShelfId, setSelectedShelfId] = useState<number | null>(null);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Load pageSize from site settings
  useEffect(() => {
    fetch("/api/site-settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.pageSize) setPageSize(data.pageSize);
      })
      .catch(() => {});
  }, []);

  // Fetch real comics from API with pagination + server-side filtering
  const { comics: apiComics, loading, fetching, total: apiTotal, totalPages, refetch } = useComics({
    page: currentPage,
    pageSize,
    search: debouncedSearch || undefined,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    favoritesOnly: favoritesOnly || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    category: selectedCategory || undefined,
  });
  const { categories, refetch: refetchCategories, initCategories } = useCategories();

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedTags, favoritesOnly, selectedCategory, sortBy, sortOrder]);

  // Use real comics if API has been initialized (even if current page is empty due to filters)
  const useRealData = apiTotal > 0 || apiComics.length > 0 || initializedRef.current;
  if (useRealData && !initializedRef.current) {
    initializedRef.current = true;
  }
  const displayComics: Comic[] = useMemo(() => {
    return apiComics.map(apiToComic);
  }, [apiComics]);

  // Extract all unique tags — fetch from API for complete global tags
  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((data) => {
        const tags = Array.isArray(data) ? data : data.tags;
        if (Array.isArray(tags)) {
          setAllTags(tags.map((t: { name: string }) => t.name).sort());
        }
      })
      .catch(() => {});
  }, [apiComics]);

  // Filter comics (server-side filtering is primary)
  const filteredComics = useMemo(() => {
    return displayComics;
  }, [displayComics]);

  // Sort comics (server-side sorting is primary)
  const sortedComics = useMemo(() => {
    return filteredComics;
  }, [filteredComics]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  // Upload handler
  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setUploading(true);
      try {
        const result = await uploadComics(files);
        if (result.success) {
          await refetch();
        }
        alert(result.message);
      } catch {
        alert(t.home.uploadFailed);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [refetch]
  );

  // Batch selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === sortedComics.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedComics.map((c) => c.id)));
    }
  }, [sortedComics, selectedIds.size]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    await batchOperation("delete", ids);
    exitBatchMode();
    await refetch();
  }, [selectedIds, exitBatchMode, refetch]);

  const handleBatchFavorite = useCallback(async () => {
    await batchOperation("favorite", Array.from(selectedIds), { isFavorite: true });
    exitBatchMode();
    await refetch();
  }, [selectedIds, exitBatchMode, refetch]);

  const handleBatchUnfavorite = useCallback(async () => {
    await batchOperation("unfavorite", Array.from(selectedIds));
    exitBatchMode();
    await refetch();
  }, [selectedIds, exitBatchMode, refetch]);

  const handleBatchAddTags = useCallback(
    async (tags: string[]) => {
      await batchOperation("addTags", Array.from(selectedIds), { tags });
      exitBatchMode();
      await refetch();
    },
    [selectedIds, exitBatchMode, refetch]
  );

  const handleBatchSetCategory = useCallback(
    async (categorySlugs: string[]) => {
      await batchOperation("setCategory", Array.from(selectedIds), { categorySlugs });
      exitBatchMode();
      await refetch();
      refetchCategories();
    },
    [selectedIds, exitBatchMode, refetch, refetchCategories]
  );

  // Drag & Drop handlers
  const handleDragStart = useCallback((id: string) => {
    setDragId(id);
  }, []);

  const handleDragOver = useCallback((id: string) => {
    setDragOverId(id);
  }, []);

  const handleDragEnd = useCallback(async () => {
    if (!dragId || !dragOverId || dragId === dragOverId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    const items = [...sortedComics];
    const fromIndex = items.findIndex((c) => c.id === dragId);
    const toIndex = items.findIndex((c) => c.id === dragOverId);

    if (fromIndex === -1 || toIndex === -1) {
      setDragId(null);
      setDragOverId(null);
      return;
    }

    // Reorder
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);

    // Build new sort orders
    const orders = items.map((c, i) => ({ id: c.id, sortOrder: i }));

    // Switch to custom sort to see the effect
    setSortBy("custom");
    setSortOrder("asc");

    setDragId(null);
    setDragOverId(null);

    await updateSortOrders(orders);
    await refetch();
  }, [dragId, dragOverId, sortedComics, refetch]);

  return (
    <div className="min-h-screen bg-background">
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".zip,.cbz,.cbr,.rar,.7z,.cb7,.pdf,.txt,.epub,.mobi,.azw3"
        className="hidden"
        onChange={handleFileChange}
      />

      <Navbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onUpload={handleUpload}
        uploading={uploading}
      />

      {/* Main Content */}
      <main className={`mx-auto max-w-[1800px] px-3 sm:px-6 pt-20 sm:pt-24 ${batchMode ? "pb-32" : "pb-12"}`}>
        {/* Data Source Indicator — 空库提示 */}
        {!loading && displayComics.length === 0 && apiTotal === 0 && !debouncedSearch && selectedTags.length === 0 && !favoritesOnly && !selectedCategory && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <span className="text-sm text-amber-400">
              {t.home.mockDataNotice}{" "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">
                .zip
              </code>{" "}
              /{" "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">
                .cbz
              </code>{" "}
              {t.home.mockDataNotice2}{" "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">
                comics/
              </code>{" "}
              {t.home.mockDataNotice3}
            </span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
          </div>
        )}

        {!loading && (
          <>
            {/* 继续阅读横条 */}
            <ContinueReading />

            {/* Recommendations */}
            <RecommendationStrip />

            {/* Stats + Sort Controls */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-4">
              <StatsBar
                totalComics={apiTotal}
                filteredCount={apiTotal}
              />

              {/* Sort & Filter Controls — horizontally scrollable on mobile */}
              <div className="w-full sm:w-auto overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                <div className="flex items-center gap-2 sm:gap-3 min-w-max">
                {/* Detect Duplicates */}
                <button
                  onClick={() => setShowDuplicates(true)}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 sm:px-3 text-xs font-medium text-muted transition-all hover:text-foreground"
                  title={t.duplicates.detect}
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.duplicates.detect}</span>
                </button>

                {/* Export Data */}
                <div className="relative group/export">
                  <button
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 sm:px-3 text-xs font-medium text-muted transition-all hover:text-foreground"
                    title={t.dataExport?.title || "导出数据"}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t.dataExport?.title || "导出"}</span>
                  </button>
                  <div className="absolute right-0 top-full z-50 mt-1 hidden min-w-[160px] rounded-lg bg-card border border-border/60 p-1 shadow-xl group-hover/export:block">
                    <a
                      href="/api/export/json"
                      download
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground hover:bg-card-hover"
                    >
                      📄 {t.dataExport?.jsonFull || "JSON 完整备份"}
                    </a>
                    <a
                      href="/api/export/csv/comics"
                      download
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground hover:bg-card-hover"
                    >
                      📊 {t.dataExport?.csvComics || "CSV 漫画库"}
                    </a>
                    <a
                      href="/api/export/csv/sessions"
                      download
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground hover:bg-card-hover"
                    >
                      📈 {t.dataExport?.csvSessions || "CSV 阅读记录"}
                    </a>
                  </div>
                </div>

                {/* Batch Mode Toggle */}
                <button
                  onClick={() => {
                    if (batchMode) exitBatchMode();
                    else setBatchMode(true);
                  }}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 sm:px-3 text-xs font-medium transition-all ${
                    batchMode
                      ? "bg-accent text-white"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                  title={t.navbar.batch}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{batchMode ? t.navbar.exitBatch : t.navbar.batch}</span>
                </button>

                {/* Select All (only in batch mode) */}
                {batchMode && (
                  <button
                    onClick={handleSelectAll}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 sm:px-3 text-xs font-medium transition-all ${
                      selectedIds.size === sortedComics.length && sortedComics.length > 0
                        ? "bg-accent/20 text-accent"
                        : "bg-card text-muted hover:text-foreground"
                    }`}
                    title={t.navbar.selectAll}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t.navbar.selectAll}</span>
                  </button>
                )}

                <div className="h-5 w-px bg-border/40" />

                {/* Favorites toggle */}
                <button
                  onClick={() => setFavoritesOnly(!favoritesOnly)}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 sm:px-3 text-xs font-medium transition-all ${
                    favoritesOnly
                      ? "bg-rose-500/20 text-rose-400"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  <span>{favoritesOnly ? "♥" : "♡"}</span>
                  <span className="hidden sm:inline">{t.home.favorites}</span>
                </button>

                {/* Sort selector */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="h-8 rounded-lg bg-card px-2 text-xs text-foreground outline-none"
                >
                  <option value="title">{t.home.sortByTitle}</option>
                  <option value="addedAt">{t.home.sortByAdded}</option>
                  <option value="lastReadAt">{t.home.sortByLastRead}</option>
                  <option value="rating">{t.home.sortByRating}</option>
                  <option value="custom">{t.home.sortByCustom}</option>
                </select>

                <button
                  onClick={() =>
                    setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-card text-muted transition-colors hover:text-foreground"
                  title={sortOrder === "asc" ? t.home.ascending : t.home.descending}
                >
                  {sortOrder === "asc" ? "↑" : "↓"}
                </button>

                <div className="h-5 w-px bg-border/40" />

                {/* View Toggle */}
                <div className="flex items-center rounded-lg border border-border/60 bg-card/50 p-0.5">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200 ${
                      viewMode === "grid"
                        ? "bg-accent text-white shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className={`flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200 ${
                      viewMode === "list"
                        ? "bg-accent text-white shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                </div>
                </div>
              </div>
            </div>

            {/* 书架管理器 */}
            <div className="mt-4">
              <ShelfManager
                  selectedShelfId={selectedShelfId}
                  onShelfSelect={setSelectedShelfId}
                  selectedComicIds={batchMode && selectedIds.size > 0 ? Array.from(selectedIds) : undefined}
                  onBatchMoveComplete={() => { exitBatchMode(); refetch(); }}
              />
            </div>

            {/* Category Filter */}
            {categories.length > 0 && (
              <div className="mt-4">
                <CategoryFilter
                  categories={categories}
                  selectedCategory={selectedCategory}
                  onCategorySelect={setSelectedCategory}
                />
              </div>
            )}

            {/* Tag Filter */}
            {allTags.length > 0 && (
              <div className="mt-4 mb-8">
                <TagFilter
                  allTags={allTags}
                  selectedTags={selectedTags}
                  onTagToggle={handleTagToggle}
                  onClearAll={() => setSelectedTags([])}
                  onTagsTranslated={() => {
                    refetch();
                    // Refresh global tags after translation
                    fetch("/api/tags")
                      .then((r) => r.json())
                      .then((data) => {
                        const tags = Array.isArray(data) ? data : data.tags;
                        if (Array.isArray(tags)) {
                          setAllTags(tags.map((t: { name: string }) => t.name).sort());
                        }
                      })
                      .catch(() => {});
                  }}
                />
              </div>
            )}

            {/* Comics Grid */}
            <div className={`transition-opacity duration-200 ${fetching ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
            {sortedComics.length > 0 ? (
              <div
                className={
                  viewMode === "grid"
                    ? "grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                    : "grid grid-cols-1 gap-2 sm:gap-3"
                }
              >
                {sortedComics.map((comic) => (
                  <ComicCard
                    key={comic.id}
                    comic={comic}
                    isReal={useRealData}
                    viewMode={viewMode}
                    batchMode={batchMode}
                    isSelected={selectedIds.has(comic.id)}
                    onSelect={toggleSelect}
                    draggable={sortBy === "custom" && !batchMode}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    isDragOver={dragOverId === comic.id}
                    tagData={comic.tagData}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 sm:py-32 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-card">
                  <span className="text-4xl">{apiTotal === 0 ? "📚" : "🔍"}</span>
                </div>
                <h3 className="mb-2 text-lg font-medium text-foreground/80">
                  {apiTotal === 0
                    ? t.home.emptyLibrary
                    : t.home.noMatchingComics}
                </h3>
                <p className="max-w-sm text-sm text-muted mb-5">
                  {apiTotal === 0
                    ? t.home.emptyLibraryHint
                    : t.home.noMatchingHint}
                </p>
                {/* 引导性操作按钮 */}
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {apiTotal === 0 ? (
                    <>
                      <button
                        onClick={handleUpload}
                        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                      >
                        <Upload className="h-4 w-4" />
                        {t.dataExport?.uploadFiles || "上传文件"}
                      </button>
                      <button
                        onClick={() => {
                          fetch("/api/sync", { method: "POST" }).then(() => refetch());
                        }}
                        className="flex items-center gap-2 rounded-lg border border-border/60 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card"
                      >
                        🔄 {t.dataExport?.scanDirs || "扫描目录"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setSelectedTags([]);
                        setFavoritesOnly(false);
                        setSelectedCategory(null);
                        setSelectedShelfId(null);
                      }}
                      className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      ✖ {t.dataExport?.clearFilters || "清除筛选条件"}
                    </button>
                  )}
                </div>
              </div>
            )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 sm:mt-8 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.firstPage}
                >
                  «
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.prevPage}
                >
                  ‹
                </button>

                {(() => {
                  const pages: (number | string)[] = [];
                  const maxVisible = typeof window !== "undefined" && window.innerWidth < 640 ? 5 : 7;
                  if (totalPages <= maxVisible) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (currentPage > 3) pages.push("...");
                    const start = Math.max(2, currentPage - 1);
                    const end = Math.min(totalPages - 1, currentPage + 1);
                    for (let i = start; i <= end; i++) pages.push(i);
                    if (currentPage < totalPages - 2) pages.push("...");
                    pages.push(totalPages);
                  }
                  return pages.map((p, idx) =>
                    typeof p === "string" ? (
                      <span key={`ellipsis-${idx}`} className="px-0.5 sm:px-1 text-muted">
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={`flex h-8 min-w-[32px] sm:h-9 sm:min-w-[36px] items-center justify-center rounded-lg px-1.5 sm:px-2 text-xs sm:text-sm font-medium transition-colors ${
                          currentPage === p
                            ? "bg-accent text-white"
                            : "border border-border/60 text-muted hover:border-border hover:text-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.nextPage}
                >
                  ›
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.lastPage}
                >
                  »
                </button>

                <span className="ml-2 sm:ml-3 text-xs text-muted">
                  {currentPage} / {totalPages}
                </span>

                <div className="hidden sm:flex ml-4 items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5 text-muted" />
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      const newSize = parseInt(e.target.value);
                      setPageSize(newSize);
                      setCurrentPage(1);
                      fetch("/api/site-settings")
                        .then((r) => r.json())
                        .then((data) => {
                          fetch("/api/site-settings", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ...data, pageSize: newSize }),
                          });
                        })
                        .catch(() => {});
                    }}
                    className="rounded-lg border border-border/60 bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-accent/50 transition-colors"
                  >
                    {[12, 24, 36, 48, 60, 96].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Batch Toolbar */}
      {batchMode && selectedIds.size > 0 && (
        <BatchToolbar
          selectedCount={selectedIds.size}
          onCancel={exitBatchMode}
          onDelete={handleBatchDelete}
          onFavorite={handleBatchFavorite}
          onUnfavorite={handleBatchUnfavorite}
          onAddTags={handleBatchAddTags}
          onSetCategory={handleBatchSetCategory}
        />
      )}

      {/* Duplicate Detector */}
      <DuplicateDetector
        open={showDuplicates}
        onClose={() => setShowDuplicates(false)}
        onDeleted={refetch}
      />
    </div>
  );
}
