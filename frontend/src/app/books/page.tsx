"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import ComicCard from "@/components/ComicCard";
import TagFilter from "@/components/TagFilter";
import StatsBar from "@/components/StatsBar";
import CategoryFilter from "@/components/CategoryFilter";
import BatchToolbar from "@/components/BatchToolbar";
import {
  useComics,
  uploadComics,
  ApiComic,
  batchOperation,
  updateSortOrders,
  useCategories,
} from "@/hooks/useComics";
import { Comic } from "@/types/comic";
import { useTranslation, useLocale } from "@/lib/i18n";
import { CheckSquare, CheckCheck, LayoutGrid, List, Copy, Upload, Image, BookOpen, Brain, Loader2, Eye, EyeOff, Settings2 } from "lucide-react";
import DuplicateDetector from "@/components/DuplicateDetector";
import MergeGroupDialog from "@/components/MergeGroupDialog";
import UploadDialog from "@/components/UploadDialog";
import { LibraryTabsBar } from "@/components/home/LibraryTabsBar";
import MobileBottomNav from "@/components/MobileBottomNav";

import AddToGroupDialog from "@/components/AddToGroupDialog";
import ComicContextMenu from "@/components/ComicContextMenu";
import ScrollReveal from "@/components/ScrollReveal";
import { useToast } from "@/components/Toast";
import { useAIStatus } from "@/hooks/useAIStatus";
import { createGroup } from "@/api/groups";
import { toggleComicFavorite, deleteComicById } from "@/api/comics";
import { fetchLibraries, fetchAccessibleLibraries, type Library } from "@/api/libraries";
import { useAuth } from "@/lib/auth-context";
import { calculateReadingProgress, isReadingFinished } from "@/lib/progress";
import { seriesIdFromShelfId } from "@/lib/series-id";

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
    titleSortKey: api.titleSortKey,
    coverUrl: api.coverUrl,
    coverAspectRatio: api.coverAspectRatio || 0,
    tags: (api.tags || []).map((t) => t.name),
    tagData: api.tags || [],
    pageCount: api.pageCount,
    fileSize: api.fileSize,
    addedAt: api.addedAt || undefined,
    progress:
      api.pageCount > 0
        ? calculateReadingProgress(api.lastReadPage, api.pageCount)
        : 0,
    lastRead: api.lastReadAt || undefined,
    isFavorite: api.isFavorite,
    rating: api.rating ?? undefined,
    lastReadPage: api.lastReadPage,
    sortOrder: api.sortOrder,
    totalReadTime: api.totalReadTime,
    categories: api.categories || [],
    filename: api.filename,
    author: api.author || undefined,
  };
}


/** 安全读取 localStorage 中的字符串数组，损坏时 fallback 到 [] */
function readStringArrayFromLocalStorage(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export default function BooksPage() {
  const t = useTranslation();
  const router = useRouter();
  const { locale: rawLocale } = useLocale();
  const locale = rawLocale === "zh-CN" ? "zh" : "en";
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // 会话筛选条件保持（sessionStorage）
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("homeFilter:search") || "";
    }
    return "";
  });
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("homeFilter:tags");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("viewMode");
      if (saved === "grid" || saved === "list") return saved;
    }
    return "grid";
  });
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>(() =>
    readStringArrayFromLocalStorage("home:selectedLibraryIds")
  );
  const [hiddenLibraryIds, setHiddenLibraryIds] = useState<string[]>(() =>
    readStringArrayFromLocalStorage("home:hiddenLibraryIds")
  );
  const [uploading, setUploading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState("");
  const [libraries, setLibraries] = useState<Library[]>([]);

  // Accessible libraries for homepage tabs (all logged-in users)
  const [accessibleLibraries, setAccessibleLibraries] = useState<Library[]>([]);

  const hasManageableLibrary = useMemo(() => {
    return isAdmin || (accessibleLibraries?.some(lib => lib.canManage) ?? false);
  }, [isAdmin, accessibleLibraries]);

  // Load libraries for upload selector (admin only)
  useEffect(() => {
    if (!hasManageableLibrary) return;
    fetchLibraries()
      .then(setLibraries)
      .catch(() => {});
  }, [hasManageableLibrary]);

  useEffect(() => {
    fetchAccessibleLibraries()
      .then((libs) => {
        setAccessibleLibraries(libs);
        const validIds = new Set(libs.map((l) => l.id));
        // 清理 selectedLibraryIds 中失效的 ID
        setSelectedLibraryIds((prev) => {
          if (prev.length === 0) return prev;
          const cleaned = prev.filter((id) => validIds.has(id));
          if (cleaned.length !== prev.length) {
            localStorage.setItem("home:selectedLibraryIds", JSON.stringify(cleaned));
          }
          return cleaned.length !== prev.length ? cleaned : prev;
        });
        // 清理 hiddenLibraryIds 中失效的 ID
        setHiddenLibraryIds((prev) => {
          if (prev.length === 0) return prev;
          const cleaned = prev.filter((id) => validIds.has(id));
          if (cleaned.length !== prev.length) {
            localStorage.setItem("home:hiddenLibraryIds", JSON.stringify(cleaned));
          }
          return cleaned.length !== prev.length ? cleaned : prev;
        });
      })
      .catch(() => {});
  }, []);

  const handleLibraryTabsChange = useCallback((ids: string[]) => {
    setSelectedLibraryIds(ids);
    localStorage.setItem("home:selectedLibraryIds", JSON.stringify(ids));
    setCurrentPage(1);
  }, []);

  const handleToggleLibraryVisible = useCallback((id: string) => {
    setHiddenLibraryIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      localStorage.setItem("home:hiddenLibraryIds", JSON.stringify(next));
      // 如果隐藏了当前选中的书库，自动移除选择
      if (next.includes(id)) {
        setSelectedLibraryIds((prevSel) => {
          const nextSel = prevSel.filter((x) => x !== id);
          localStorage.setItem("home:selectedLibraryIds", JSON.stringify(nextSel));
          return nextSel;
        });
      }
      return next;
    });
  }, []);

  const handleShowAllLibraries = useCallback(() => {
    setHiddenLibraryIds([]);
    localStorage.setItem("home:hiddenLibraryIds", "[]");
  }, []);

  const visibleLibraries = accessibleLibraries.filter((lib) => !hiddenLibraryIds.includes(lib.id));

  const [scanningLibrary, setScanningLibrary] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("homeFilter:favorites") === "true";
    }
    return false;
  });
  const [sortBy, setSortBy] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("homeFilter:sortBy") || "title";
    }
    return "title";
  });
  const [sortOrder, setSortOrder] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("homeFilter:sortOrder") || "asc";
    }
    return "asc";
  });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("homeFilter:category") || null;
    }
    return null;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  // AI 语义搜索 (Phase 4)
  const { aiConfigured } = useAIStatus();
  const [aiSearchMode, setAiSearchMode] = useState(false);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState<{comicId:string;title:string;score:number;reason:string;matchedOn:string[]}[]>([]);

  // Batch selection
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Duplicate detection
  const [showDuplicates, setShowDuplicates] = useState(false);

  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const [showAddToGroup, setShowAddToGroup] = useState(false);

  // AI 批量标签状态
  const [aiTagsLoading, setAiTagsLoading] = useState(false);
  const [aiCategoryLoading, setAiCategoryLoading] = useState(false);

  // 挂载保护：防止首次挂载时 effect 将页码重置为1并清除 sessionStorage
  const pageResetGuardRef = useRef(true);

  // 受保护的页码 setter：在挂载保护期内阻止将页码重置为1
  const safeSetCurrentPage = useCallback((v: number | ((prev: number) => number)) => {
    if (pageResetGuardRef.current && typeof v === 'number' && v === 1) return;
    setCurrentPage(v as number);
  }, []);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    comic: Comic;
  } | null>(null);
  // 右键"加入合集"时暂存的漫画ID
  const [contextAddToGroupIds, setContextAddToGroupIds] = useState<string[] | null>(null);

  // 内容类型 Tab
  const [readingStatusFilter, setReadingStatusFilter] = useState<string>(() => {
    return sessionStorage.getItem("homeFilter:readingStatus") || "";
  });
  const [uncategorized, setUncategorized] = useState(() => sessionStorage.getItem("homeFilter:uncategorized") === "true");
  const [untagged, setUntagged] = useState(() => sessionStorage.getItem("homeFilter:untagged") === "true");

  // 筛选条件变更时同步到 sessionStorage
  useEffect(() => {
    sessionStorage.setItem("homeFilter:search", searchQuery);
  }, [searchQuery]);
  useEffect(() => {
    sessionStorage.setItem("homeFilter:tags", JSON.stringify(selectedTags));
  }, [selectedTags]);
  useEffect(() => {
    sessionStorage.setItem("homeFilter:favorites", String(favoritesOnly));
  }, [favoritesOnly]);
  useEffect(() => {
    sessionStorage.setItem("homeFilter:sortBy", sortBy);
  }, [sortBy]);
  useEffect(() => {
    sessionStorage.setItem("homeFilter:sortOrder", sortOrder);
  }, [sortOrder]);
  useEffect(() => {
    sessionStorage.setItem("homeFilter:category", selectedCategory || "");
  }, [selectedCategory]);

  useEffect(() => {
    sessionStorage.setItem("homeFilter:readingStatus", readingStatusFilter);
  }, [readingStatusFilter]);

  useEffect(() => {
    sessionStorage.setItem("homeFilter:uncategorized", String(uncategorized));
  }, [uncategorized]);

  useEffect(() => {
    sessionStorage.setItem("homeFilter:untagged", String(untagged));
  }, [untagged]);
  useEffect(() => {
    localStorage.setItem("home:selectedLibraryIds", JSON.stringify(selectedLibraryIds));
  }, [selectedLibraryIds]);
  useEffect(() => {
    localStorage.setItem("home:hiddenLibraryIds", JSON.stringify(hiddenLibraryIds));
  }, [hiddenLibraryIds]);

  // AI 语义搜索 handler
  const handleAiSearch = useCallback(async (query: string) => {
    if (!query.trim() || aiSearchLoading) return;
    setAiSearchLoading(true);
    setAiSearchResults([]);
    try {
      const res = await fetch("/api/ai/semantic-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, targetLang: locale }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSearchResults(data.results || []);
      }
    } catch { /* ignore */ }
    finally { setAiSearchLoading(false); }
  }, [aiSearchLoading, locale]);

  // 当 AI 模式下搜索词变化时触发 AI 搜索
  useEffect(() => {
    if (aiSearchMode && debouncedSearch && debouncedSearch.length >= 2) {
      handleAiSearch(debouncedSearch);
    }
    if (!debouncedSearch) {
      setAiSearchResults([]);
    }
  }, [aiSearchMode, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps



  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 删除动画状态
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  // Pagination — 优先从 sessionStorage 恢复（最可靠），其次从 URL 恢复
  const [currentPage, setCurrentPage] = useState(() => {
    if (typeof window !== "undefined") {
      // 优先从 sessionStorage 恢复
      const saved = sessionStorage.getItem("homePage");
      if (saved) {
        const n = parseInt(saved, 10);
        if (n > 0) return n;
      }
      // 其次从 URL 查询参数读取
      const p = new URLSearchParams(window.location.search).get("page");
      if (p) {
        const n = parseInt(p, 10);
        if (n > 0) return n;
      }
    }
    return 1;
  });
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // viewMode 持久化
  useEffect(() => {
    localStorage.setItem("viewMode", viewMode);
  }, [viewMode]);

  const { categories, refetch: refetchCategories, initCategories } = useCategories();

  // 挂载保护期结束后解除保护（延迟 600ms，确保所有首次 effect 都已执行完毕）
  useEffect(() => {
    const timer = setTimeout(() => {
      pageResetGuardRef.current = false;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // 分页变化时同步 URL 并持久化到 sessionStorage（确保从其他页面返回时可恢复）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (currentPage > 1) {
      params.set("page", String(currentPage));
      sessionStorage.setItem("homePage", String(currentPage));
    } else {
      params.delete("page");
      // 挂载保护期内不清除 sessionStorage（防止首次挂载时误清除已保存的页码）
      if (!pageResetGuardRef.current) {
        sessionStorage.removeItem("homePage");
      }
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [currentPage]);

  // Load pageSize from site settings
  useEffect(() => {
    fetch("/api/site-settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.pageSize) setPageSize(data.pageSize);
      })
      .catch(() => {});
  }, []);

  // 书库展示逻辑作品：目录作品折叠为一项，散本保持独立，并由服务端排序分页。
  const { comics: apiComics, loading, fetching, total: apiTotal, totalPages, refetch } = useComics({
    seriesView: true,
    page: currentPage,
    pageSize,
    search: debouncedSearch || undefined,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    favoritesOnly: favoritesOnly || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    category: selectedCategory || undefined,
    readingStatus: readingStatusFilter || undefined,
    uncategorized: uncategorized || undefined,
    untagged: untagged || undefined,
    libraryIds: selectedLibraryIds.length > 0 ? selectedLibraryIds : undefined,
  });

  // 只显示有内容的分类（count > 0）
  const effectiveCategories = categories.filter(c => c.count > 0);

  const activePage = currentPage;
  const setActivePage = setCurrentPage;

  // Reset to page 1 when filters change（使用受保护的 setter，在挂载保护期内不会重置页码）
  const filterKeyRef = useRef(
    JSON.stringify([debouncedSearch, selectedTags, favoritesOnly, selectedCategory, sortBy, sortOrder, readingStatusFilter, uncategorized, untagged, selectedLibraryIds])
  );
  useEffect(() => {
    const newKey = JSON.stringify([debouncedSearch, selectedTags, favoritesOnly, selectedCategory, sortBy, sortOrder, readingStatusFilter, uncategorized, untagged, selectedLibraryIds]);
    if (filterKeyRef.current === newKey) return; // 值没变，不重置
    filterKeyRef.current = newKey;
    safeSetCurrentPage(1);
  }, [debouncedSearch, selectedTags, favoritesOnly, selectedCategory, sortBy, sortOrder, readingStatusFilter, uncategorized, untagged, selectedLibraryIds, safeSetCurrentPage]);

  // Use real comics if API has been initialized (even if current page is empty due to filters)
  const useRealData = apiTotal > 0 || apiComics.length > 0 || initializedRef.current;
  if (useRealData && !initializedRef.current) {
    initializedRef.current = true;
  }
  const displayComics: Comic[] = useMemo(() => {
    return apiComics.map(apiToComic);
  }, [apiComics]);

  // Extract all unique tags — fetch from API once on mount (not on every apiComics change)
  const [allTags, setAllTags] = useState<string[]>([]);
  const fetchTags = useCallback(() => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((data) => {
        const tags = Array.isArray(data) ? data : data.tags;
        if (Array.isArray(tags)) {
          setAllTags(tags.map((t: { name: string }) => t.name).sort());
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Filter comics (server-side filtering is primary)
  const filteredComics = useMemo(() => {
    return displayComics;
  }, [displayComics]);

  // ── 滚动位置保存 & 恢复 ──
  // 离开页面时保存滚动位置
  useEffect(() => {
    const handleBeforeUnload = () => {
      sessionStorage.setItem("homeScrollY", String(window.scrollY));
    };
    // 使用 visibilitychange 和 beforeunload 双重保存
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        sessionStorage.setItem("homeScrollY", String(window.scrollY));
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      // 组件卸载时保存（SPA 内部导航）
      sessionStorage.setItem("homeScrollY", String(window.scrollY));
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // 数据加载完成后恢复滚动位置（仅首次加载时恢复一次）
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    if (loading || fetching) return;
    // 数据已加载完成，尝试恢复滚动位置
    const savedY = sessionStorage.getItem("homeScrollY");
    if (savedY) {
      const y = parseInt(savedY, 10);
      if (!isNaN(y) && y > 0) {
        // 延迟恢复，确保 DOM 已渲染
        requestAnimationFrame(() => {
          window.scrollTo(0, y);
        });
      }
    }
    scrollRestoredRef.current = true;
  }, [loading, fetching]);

  // Sort comics (server-side sorting is primary)
  const sortedComics = useMemo(() => {
    return filteredComics;
  }, [filteredComics]);

  const effectiveTotalPages = Math.max(1, totalPages);

  useEffect(() => {
    if (!loading && !fetching && !pageResetGuardRef.current && currentPage > effectiveTotalPages) {
      setCurrentPage(effectiveTotalPages);
    }
  }, [currentPage, effectiveTotalPages, loading, fetching]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  // Upload handler
  const handleUpload = useCallback(() => {
    setUploadDialogOpen(true);
  }, []);

  // 手动扫描文库
  const handleScanLibrary = useCallback(async () => {
    setScanningLibrary(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      // 等待一小段时间让后端完成扫描
      await new Promise(resolve => setTimeout(resolve, 2000));
      await refetch();
    } catch {
      // 扫描失败不影响体验
    } finally {
      setScanningLibrary(false);
    }
  }, [refetch]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setUploading(true);
      try {
        const libId = selectedLibraryId || undefined;
        const result = await uploadComics(files, undefined, libId);
        if (result.success) {
          // 触发后端扫描，确保新文件入库
          try {
            await fetch("/api/sync", { method: "POST" });
          } catch {
            // 扫描失败不影响提示
          }
          await refetch();
          toast.success(
            `${t.home.uploadSuccess || "上传成功"}: ${result.successCount}/${result.totalCount}`
          );
        } else {
          toast.error(result.message || t.home.uploadFailed);
        }
      } catch {
        toast.error(t.home.uploadFailed);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [refetch, toast, t, selectedLibraryId]
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
    const allComicIds = new Set(sortedComics.map((c) => c.id));
    const allComicsSelected = selectedIds.size === allComicIds.size;
    if (allComicsSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(allComicIds);
    }
  }, [sortedComics, selectedIds.size]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBatchDelete = useCallback(async (deleteFiles?: boolean) => {
    const ids = Array.from(selectedIds);
    // 先播放删除动画
    setRemovingIds(new Set(ids));
    // 等动画播完后再真正删除
    setTimeout(async () => {
      await batchOperation("delete", ids, deleteFiles ? { deleteFiles: true } : undefined);
      setRemovingIds(new Set());
      exitBatchMode();
      await refetch();
    }, 400);
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

  // AI 批量标签标注
  const handleAIBatchSuggestTags = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setAiTagsLoading(true);
    try {
      const res = await fetch("/api/ai/batch-suggest-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comicIds: ids,
          targetLang: locale === "en" ? "en" : "zh",
          apply: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No reader");
      let successCount = 0;
      let failCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              successCount = data.success || successCount;
              failCount = data.failed || failCount;
            } else if (data.suggestedTags) {
              successCount++;
            } else if (data.error) {
              failCount++;
            }
          } catch {
            // ignore
          }
        }
      }
      toast.success(
        `${t.batch?.aiSuggestTagsDone || "AI 标签完成"}: ${successCount} ✓${failCount > 0 ? ` / ${failCount} ✗` : ""}`
      );
      exitBatchMode();
      await refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "AI tags failed");
    } finally {
      setAiTagsLoading(false);
    }
  }, [selectedIds, exitBatchMode, refetch, toast, t, locale]);

  // AI 批量分类
  const handleAIBatchSuggestCategory = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setAiCategoryLoading(true);
    try {
      const res = await fetch("/api/ai/batch-suggest-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comicIds: ids,
          targetLang: locale === "en" ? "en" : "zh",
          apply: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Request failed");
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No reader");
      let successCount = 0;
      let failCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              successCount = data.success || successCount;
              failCount = data.failed || failCount;
            } else if (data.suggestedCategories) {
              successCount++;
            } else if (data.error) {
              failCount++;
            }
          } catch {
            // ignore
          }
        }
      }
      toast.success(
        `${t.batch?.aiSuggestCategoryDone || "AI 分类完成"}: ${successCount} ✓${failCount > 0 ? ` / ${failCount} ✗` : ""}`
      );
      exitBatchMode();
      await refetch();
      refetchCategories();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "AI category failed");
    } finally {
      setAiCategoryLoading(false);
    }
  }, [selectedIds, exitBatchMode, refetch, refetchCategories, toast, t, locale]);

  const handleBatchSetCategory = useCallback(
    async (categorySlugs: string[]) => {
      await batchOperation("setCategory", Array.from(selectedIds), { categorySlugs });
      exitBatchMode();
      await refetch();
      refetchCategories();
    },
    [selectedIds, exitBatchMode, refetch, refetchCategories]
  );


  const handleBatchRemoveTags = useCallback(
    async (tags: string[]) => {
      await batchOperation("removeTags", Array.from(selectedIds), { tags });
      exitBatchMode();
      await refetch();
    },
    [selectedIds, exitBatchMode, refetch]
  );

  const handleBatchSetReadingStatus = useCallback(
    async (status: string) => {
      await batchOperation("setReadingStatus", Array.from(selectedIds), { readingStatus: status });
      exitBatchMode();
      await refetch();
    },
    [selectedIds, exitBatchMode, refetch]
  );

  // 合并为合集
  const handleMergeToGroup = useCallback(
    async (groupName: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length < 2) return;
      const comicIds: string[] = [];
      const seriesIds: string[] = [];
      for (const id of ids) {
        const seriesId = seriesIdFromShelfId(id);
        if (seriesId) seriesIds.push(seriesId);
        else comicIds.push(id);
      }
      const result = await createGroup(groupName, comicIds, seriesIds);
      if (result.success) {
        toast.success(t.comicGroup?.created?.replace("{count}", "1") || "已创建 1 个合集");
        exitBatchMode();
      }
    },
    [selectedIds, exitBatchMode, toast, t]
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

  const selectedHasSeries = useMemo(
    () => Array.from(selectedIds).some((id) => seriesIdFromShelfId(id) !== null),
    [selectedIds]
  );
  const pageHasSeries = useMemo(
    () => sortedComics.some((comic) => seriesIdFromShelfId(comic.id) !== null),
    [sortedComics]
  );

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: "var(--theme-background)" }}>

      <Navbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onUpload={handleUpload}
        uploading={uploading}
        aiSearchMode={aiSearchMode}
        onAiSearchModeChange={aiConfigured ? setAiSearchMode : undefined}
        onScanLibrary={handleScanLibrary}
        scanning={scanningLibrary}
      />

      {/* Main Content */}
      <div className={`mx-auto w-full max-w-[1760px] px-6 sm:px-8 lg:px-10 2xl:px-14 pt-14 sm:pt-16 xl:grid xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6 ${batchMode ? "pb-32" : "pb-20 sm:pb-12"}`}>
      <main className="min-w-0 space-y-4 pt-6 sm:pt-8">
        {/* Data Source Indicator — 空库提示 */}
        {!loading && displayComics.length === 0 && apiTotal === 0 && !debouncedSearch && selectedTags.length === 0 && !favoritesOnly && !selectedCategory && selectedLibraryIds.length === 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <span className="text-sm text-amber-400">
              {t.home.mockDataNotice}{" "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">.zip</code>{" / "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">.cbz</code>{" / "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">.epub</code>{" / "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">.txt</code>{" "}
              {t.home.mockDataNotice2}{" "}
              <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs">
                comics/
              </code>{" "}
              {t.home.mockDataNotice3}
            </span>
          </div>
        )}

        {/* Loading — 骨架屏 */}
        {loading && (
          <div className="space-y-6">
            <section className="home-hero dashboard-glass rounded-2xl p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <div className="skeleton-shimmer mb-2 h-6 w-40 rounded" />
                  <div className="skeleton-shimmer h-4 w-64 max-w-full rounded" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="skeleton-shimmer h-9 w-20 rounded-lg" />
                  <div className="skeleton-shimmer h-9 w-20 rounded-lg" />
                </div>
              </div>
            </section>

            {/* 骨架：Tab 栏 */}
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton-shimmer h-8 w-16 rounded-lg" />
              ))}
            </div>
            {/* 骨架：漫画网格 */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-xl bg-card">
                  <div className="skeleton-shimmer aspect-[5/7] w-full" />
                  <div className="space-y-2 p-3">
                    <div className="skeleton-shimmer h-4 w-3/4 rounded" />
                    <div className="flex gap-1.5">
                      <div className="skeleton-shimmer h-4 w-12 rounded-md" />
                      <div className="skeleton-shimmer h-4 w-10 rounded-md" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && (
          <>
            {/* 书库筛选 + 视图切换 */}
            <div className="flex items-center justify-between gap-1 sm:gap-1.5 mb-4">
              <div className="flex items-center gap-1 sm:gap-1.5">
                {/* Library Tabs — accessible library filter */}
                {visibleLibraries.length > 0 && (
                  <LibraryTabsBar
                    libraries={visibleLibraries}
                    selectedIds={selectedLibraryIds}
                    onChange={handleLibraryTabsChange}
                    hiddenIds={hiddenLibraryIds}
                    onToggleVisible={handleToggleLibraryVisible}
                    onShowAll={handleShowAllLibraries}
                    allLibraries={accessibleLibraries}
                  />
                )}
              </div>

              {/* View Toggle — 在此处始终可见 */}
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

            {/* Library Control Console */}
            <section className="rounded-xl dashboard-glass px-3 py-2.5 sm:px-4 sm:py-3 space-y-2">
            {/* Stats + Sort Controls */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-2 sm:gap-3">
              <StatsBar
                totalComics={apiTotal}
                filteredCount={apiTotal}
              />

              {/* Sort & Filter Controls — horizontally scrollable on mobile */}
              <div className="w-full sm:w-auto overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-max">
                {/* Detect Duplicates */}
                <button
                  onClick={() => setShowDuplicates(true)}
                  className="motion-button flex h-8 items-center gap-1.5 rounded-lg border border-border/40 bg-card px-2.5 sm:px-3 text-xs font-medium text-muted transition-all hover:text-foreground"
                  title={t.duplicates.detect}
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.duplicates.detect}</span>
                </button>

                {/* Batch Mode Toggle — 仅管理员可见 */}
                {hasManageableLibrary && (
                <button
                  onClick={() => {
                    if (batchMode) exitBatchMode();
                    else setBatchMode(true);
                  }}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 sm:px-3 text-xs font-medium transition-all ${
                    batchMode
                      ? "motion-button bg-accent text-white shadow-sm shadow-accent/25"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                  title={t.navbar.batch}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{batchMode ? t.navbar.exitBatch : t.navbar.batch}</span>
                </button>
                )}

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

                {/* Reading Status filter */}
                <select
                  value={readingStatusFilter}
                  onChange={(e) => setReadingStatusFilter(e.target.value)}
                  className="h-8 rounded-lg bg-card px-2 text-xs text-foreground outline-none"
                >
                  <option value="">{t.home.allStatuses}</option>
                  <option value="want">{t.home.statusWant}</option>
                  <option value="reading">{t.home.statusReading}</option>
                  <option value="finished">{t.home.statusFinished}</option>
                </select>

                {/* Uncategorized filter */}
                <button
                  onClick={() => { setUncategorized(!uncategorized); if (!uncategorized) setSelectedCategory(null); }}
                  className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-all ${
                    uncategorized
                      ? "bg-orange-500/20 text-orange-400"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  未分类
                </button>

                {/* Untagged filter */}
                <button
                  onClick={() => { setUntagged(!untagged); if (!untagged) setSelectedTags([]); }}
                  className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-all ${
                    untagged
                      ? "bg-orange-500/20 text-orange-400"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  无标签
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
                  className="motion-button flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-card text-muted transition-colors hover:text-foreground"
                  title={sortOrder === "asc" ? t.home.ascending : t.home.descending}
                >
                  {sortOrder === "asc" ? "↑" : "↓"}
                </button>
                </div>
              </div>
            </div>

            {/* Category Filter */}
            {effectiveCategories.length > 0 && (
              <div className="mt-1.5">
                <CategoryFilter
                  categories={effectiveCategories}
                  selectedCategory={selectedCategory}
                  onCategorySelect={setSelectedCategory}
                />
              </div>
            )}

            {/* Tag Filter */}
            <div className="mt-1.5">
              <TagFilter
                allTags={allTags}
                selectedTags={selectedTags}
                onTagToggle={handleTagToggle}
                onClearAll={() => setSelectedTags([])}
                onTagsTranslated={() => {
                  refetch();
                  // Refresh global tags after translation
                  fetchTags();
                }}
              />
            </div>

              {/* Clear filters — visible when any filter is active */}
              {(favoritesOnly || readingStatusFilter || uncategorized || untagged || selectedCategory || selectedTags.length > 0 || selectedLibraryIds.length > 0) && (
                <div className="flex items-center">
                  <button
                    onClick={() => {
                      setFavoritesOnly(false);
                      setReadingStatusFilter("");
                      setUncategorized(false);
                      setUntagged(false);
                      setSelectedCategory(null);
                      setSelectedTags([]);
                      setSelectedLibraryIds([]);
                    }}
                    className="motion-button flex h-8 items-center gap-1.5 rounded-lg border border-border/40 px-3 text-xs font-medium text-muted transition-colors hover:text-foreground hover:border-border"
                  >
                    ✖ {t.dataExport?.clearFilters || "清除筛选"}
                  </button>
                </div>
              )}
            </section>

            {/* AI Semantic Search Results (Phase 4) */}
            {aiSearchMode && debouncedSearch && (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-medium text-purple-400">
                    {t.navbar?.aiSearchTitle || "AI 语义搜索结果"}
                  </span>
                  {aiSearchLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />}
                </div>
                {aiSearchResults.length > 0 ? (
                  <div className="space-y-2">
                    {aiSearchResults.map((result) => (
                      <a
                        key={result.comicId}
                        href={`/comic/${result.comicId}`}
                        className="flex items-center gap-4 rounded-xl border border-purple-500/15 bg-purple-500/5 p-3 transition-all hover:border-purple-500/30 hover:bg-purple-500/10"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/15">
                          <span className="text-xs font-bold text-purple-400">{Math.round(result.score)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{result.title}</p>
                          {result.reason && (
                            <p className="mt-0.5 text-xs text-purple-400/70 line-clamp-1">{result.reason}</p>
                          )}
                        </div>
                        {result.matchedOn && result.matchedOn.length > 0 && (
                          <div className="flex shrink-0 gap-1">
                            {result.matchedOn.slice(0, 3).map((m) => (
                              <span key={m} className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] text-purple-400/60">
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                ) : !aiSearchLoading ? (
                  <p className="text-xs text-muted/50 py-4 text-center">
                    {t.navbar?.aiSearchNoResults || "未找到匹配结果，试试换个描述方式"}
                  </p>
                ) : null}
              </div>
            )}

            {/* Library Content Header */}
            <div className="mt-6 mb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-1">
              <div>
                <h2 className="text-base font-semibold text-foreground text-balance">
                  全部作品
                </h2>
                <p className="text-[11px] text-muted mt-0.5">
                  {`${apiTotal} 项作品`}
                  {activePage > 1 ? ` · 第 ${activePage} 页` : ""}
                </p>
              </div>
            </div>
            {/* Comics Grid */}
            <div className={`transition-opacity duration-200 ${fetching ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
            {sortedComics.length > 0 ? (
              <div
                className={
                  viewMode === "grid"
                    ? "grid grid-cols-2 gap-2.5 sm:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
                    : "grid grid-cols-1 gap-2 sm:gap-3"
                }
              >
                {sortedComics.map((comic, index) => (
                    <ScrollReveal key={comic.id} disabled={index < 20} delay={index >= 20 ? (index - 20) % 6 * 50 : 0}>
                    <ComicCard
                      comic={comic}
                      isReal={useRealData}
                      viewMode={viewMode}
                      batchMode={batchMode}
                      isSelected={selectedIds.has(comic.id)}
                      onSelect={toggleSelect}
                      draggable={sortBy === "custom" && !batchMode && !pageHasSeries}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      isDragOver={dragOverId === comic.id}
                      isDragging={dragId === comic.id}
                      tagData={comic.tagData}
                      animationIndex={index < 20 ? index : undefined}
                      isRemoving={removingIds.has(comic.id)}
                      onContextMenu={(e, c) => {
                        setContextMenu({ x: e.clientX, y: e.clientY, comic: c });
                      }}
                    />
                    </ScrollReveal>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 sm:py-32 text-center">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-card">
                  <span className="text-4xl">{favoritesOnly ? "❤️" : apiTotal === 0 ? "📚" : "🔍"}</span>
                </div>
                <h3 className="mb-2 text-lg font-medium text-foreground/80">
                  {apiTotal === 0 ? t.home.emptyLibrary : t.home.noMatchingComics}
                </h3>
                <p className="max-w-sm text-sm text-muted mb-5">
                  {apiTotal === 0
                    ? selectedLibraryIds.length > 0
                      ? "当前书库还没有内容，你可以切换到全部，或去书库管理中扫描/导入内容。"
                      : t.home.emptyLibraryHint
                    : t.home.noMatchingHint}
                </p>
                {/* 引导性操作按钮 */}
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {favoritesOnly ? (
                    <button
                      onClick={() => setFavoritesOnly(false)}
                      className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      ✖ {t.dataExport?.clearFilters || "清除筛选条件"}
                    </button>
                  ) : apiTotal === 0 ? (
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
                        setReadingStatusFilter("");
                        setUncategorized(false);
                        setUntagged(false);
                        setSelectedCategory(null);
                        setSelectedLibraryIds([]);
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
            {effectiveTotalPages > 1 && (
              <div className="mt-6 sm:mt-8 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => setActivePage(1)}
                  disabled={activePage === 1}
                  className="motion-button flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.firstPage}
                >
                  «
                </button>
                <button
                  onClick={() => setActivePage((p) => Math.max(1, p - 1))}
                  disabled={activePage === 1}
                  className="motion-button flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.prevPage}
                >
                  ‹
                </button>

                {(() => {
                  const pages: (number | string)[] = [];
                  const maxVisible = typeof window !== "undefined" && window.innerWidth < 640 ? 5 : 7;
                  if (effectiveTotalPages <= maxVisible) {
                    for (let i = 1; i <= effectiveTotalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (activePage > 3) pages.push("...");
                    const start = Math.max(2, activePage - 1);
                    const end = Math.min(effectiveTotalPages - 1, activePage + 1);
                    for (let i = start; i <= end; i++) pages.push(i);
                    if (activePage < effectiveTotalPages - 2) pages.push("...");
                    pages.push(effectiveTotalPages);
                  }
                  return pages.map((p, idx) =>
                    typeof p === "string" ? (
                      <span key={`ellipsis-${idx}`} className="px-0.5 sm:px-1 text-muted">
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setActivePage(p)}
                        className={`flex h-8 min-w-[32px] sm:h-9 sm:min-w-[36px] items-center justify-center rounded-lg px-1.5 sm:px-2 text-xs sm:text-sm font-medium transition-colors ${
                          activePage === p
                            ? "bg-accent text-white"
                            : "motion-button border border-border/60 text-muted hover:border-border hover:text-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}

                <button
                  onClick={() => setActivePage((p) => Math.min(effectiveTotalPages, p + 1))}
                  disabled={activePage === effectiveTotalPages}
                  className="motion-button flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.nextPage}
                >
                  ›
                </button>
                <button
                  onClick={() => setActivePage(effectiveTotalPages)}
                  disabled={activePage === effectiveTotalPages}
                  className="motion-button flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.lastPage}
                >
                  »
                </button>

                <span className="ml-2 sm:ml-3 text-xs text-muted">
                  {activePage} / {effectiveTotalPages}
                </span>

                {/* 页码跳转 */}
                <div className="ml-2 sm:ml-3 flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={effectiveTotalPages}
                    placeholder={t.home.pageInputPlaceholder || "页码"}
                    className="w-14 sm:w-16 rounded-lg border border-border/60 bg-card px-2 py-1 text-xs text-center text-foreground outline-none focus:border-accent/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = parseInt((e.target as HTMLInputElement).value, 10);
                        if (val >= 1 && val <= effectiveTotalPages) {
                          setActivePage(val);
                          (e.target as HTMLInputElement).value = "";
                          (e.target as HTMLInputElement).blur();
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val >= 1 && val <= effectiveTotalPages) {
                        setActivePage(val);
                        e.target.value = "";
                      }
                    }}
                  />
                  <button
                    onClick={(e) => {
                      const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement;
                      const val = parseInt(input?.value, 10);
                      if (val >= 1 && val <= effectiveTotalPages) {
                        setActivePage(val);
                        input.value = "";
                      }
                    }}
                    className="motion-button rounded-lg border border-border/60 px-2 py-1 text-xs text-muted hover:text-foreground hover:border-border transition-colors"
                  >
                    {t.home.goToPage || "跳转"}
                  </button>
                </div>

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
                    className="motion-button rounded-lg border border-border/60 bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-accent/50 transition-colors"
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
    </div>

      {/* Batch Toolbar */}
      {batchMode && selectedIds.size > 0 && (
        <BatchToolbar
          selectedCount={selectedIds.size}
          onCancel={exitBatchMode}
          onDelete={selectedHasSeries ? undefined : handleBatchDelete}
          onFavorite={selectedHasSeries ? undefined : handleBatchFavorite}
          onUnfavorite={selectedHasSeries ? undefined : handleBatchUnfavorite}
          onAddTags={selectedHasSeries ? undefined : handleBatchAddTags}
          onSetCategory={selectedHasSeries ? undefined : handleBatchSetCategory}
          onRemoveTags={selectedHasSeries ? undefined : handleBatchRemoveTags}
          onSetReadingStatus={selectedHasSeries ? undefined : handleBatchSetReadingStatus}
          onMergeGroup={selectedIds.size >= 2 ? () => setShowMergeDialog(true) : undefined}
          onAddToGroup={() => setShowAddToGroup(true)}
          onAISuggestTags={aiConfigured && !selectedHasSeries ? handleAIBatchSuggestTags : undefined}
          aiTagsLoading={aiTagsLoading}
          onAISuggestCategory={aiConfigured && !selectedHasSeries ? handleAIBatchSuggestCategory : undefined}
          aiCategoryLoading={aiCategoryLoading}
          isAdmin={hasManageableLibrary}
        />
      )}

      {/* Merge Group Dialog */}
      {showMergeDialog && (
        <MergeGroupDialog
          selectedCount={selectedIds.size}
          onConfirm={(name) => {
            handleMergeToGroup(name);
            setShowMergeDialog(false);
          }}
          onClose={() => setShowMergeDialog(false)}
        />
      )}

      {/* Add to Group Dialog */}
      {showAddToGroup && (
        <AddToGroupDialog
          comicIds={Array.from(selectedIds)}
          onClose={() => setShowAddToGroup(false)}
          onDone={() => {
            setShowAddToGroup(false);
            exitBatchMode();
            toast.success(t.comicGroup?.addToGroup || "已加入合集");
          }}
        />
      )}
      {/* 漫画右键菜单 */}
      {contextMenu && (
        <ComicContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          comicId={contextMenu.comic.id}
          comicTitle={contextMenu.comic.title}
          isFavorite={contextMenu.comic.isFavorite}
          isAdmin={hasManageableLibrary}
          canFavorite={!seriesIdFromShelfId(contextMenu.comic.id)}
          canDelete={!seriesIdFromShelfId(contextMenu.comic.id)}
          onClose={() => setContextMenu(null)}
          onRead={(id) => {
            const c = sortedComics.find((c) => c.id === id);
            if (c) {
              const isNovel = c.type === "novel" || (!c.type && c.filename && /\.(txt|epub|mobi|azw3|html|htm)$/i.test(c.filename));
              router.push(isNovel ? `/novel/${id}` : `/reader/${id}`);
            }
          }}
          onDetail={(id) => router.push(`/comic/${id}`)}
          onToggleFavorite={async (id) => {
            const result = await toggleComicFavorite(id);
            if (result !== null) {
              await refetch();
            } else {
              toast.error(t.contextMenu?.favoriteFailed || "操作失败，请重试");
            }
          }}
          onAddToGroup={(id) => {
            setContextAddToGroupIds([id]);
          }}
          onDelete={async (id) => {
            // 先播放删除动画
            setRemovingIds(new Set([id]));
            setTimeout(async () => {
              const result = await deleteComicById(id);
              setRemovingIds(new Set());
              if (result.success) {
                await refetch();
                toast.success(t.comicDetail?.deleteSuccess || "已删除");
              } else {
                toast.error(result.error || "删除失败");
              }
            }, 400);
          }}
        />
      )}

      {/* 右键菜单"加入合集"弹窗 */}
      {contextAddToGroupIds && (
        <AddToGroupDialog
          comicIds={contextAddToGroupIds}
          onClose={() => setContextAddToGroupIds(null)}
          onDone={() => {
            setContextAddToGroupIds(null);
            toast.success(t.comicGroup?.addToGroup || "已加入合集");
          }}
        />
      )}

      {/* Duplicate Detector */}
      <DuplicateDetector
        open={showDuplicates}
        onClose={() => setShowDuplicates(false)}
        onDeleted={refetch}
      />

      {/* Unified Upload Dialog */}
      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        defaultLibraryId={selectedLibraryId}
        onUploaded={async () => { await refetch(); }}
      />
    </div>
  );
}
