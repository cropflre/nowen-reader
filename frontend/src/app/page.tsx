"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import ComicCard from "@/components/ComicCard";
import TagFilter from "@/components/TagFilter";
import StatsBar from "@/components/StatsBar";
import CategoryFilter from "@/components/CategoryFilter";
import BatchToolbar from "@/components/BatchToolbar";
import { RecommendationStrip } from "@/components/Recommendations";
import { ContinueReading } from "@/components/ContinueReading";
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
import { CheckSquare, CheckCheck, LayoutGrid, List, Copy, Upload, Image, BookOpen, Brain, Loader2, Layers, Trash2, X } from "lucide-react";
import DuplicateDetector from "@/components/DuplicateDetector";
import GroupCard from "@/components/GroupCard";
import MergeGroupDialog from "@/components/MergeGroupDialog";

import AddToGroupDialog from "@/components/AddToGroupDialog";
import ComicContextMenu from "@/components/ComicContextMenu";
import GroupContextMenu from "@/components/GroupContextMenu";
import ScrollReveal from "@/components/ScrollReveal";
import { useToast } from "@/components/Toast";
import { useAIStatus } from "@/hooks/useAIStatus";
import type { ComicGroup } from "@/hooks/useComicTypes";
import { fetchGroups, fetchGroupedComicMap, createGroup, updateGroup, deleteGroup } from "@/api/groups";
import { toggleComicFavorite, deleteComicById } from "@/api/comics";
import { useAuth } from "@/lib/auth-context";

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
    author: api.author || undefined,
  };
}

export default function Home() {
  const t = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [uploading, setUploading] = useState(false);
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
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());

  // Duplicate detection
  const [showDuplicates, setShowDuplicates] = useState(false);

  // Comic Groups (自定义合并分组)
  const [groups, setGroups] = useState<ComicGroup[]>([]);
  const [groupedComicMap, setGroupedComicMap] = useState<Record<string, number[]>>({});
  const [showGroupView, setShowGroupView] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("showGroupView") === "true";
    }
    return false;
  });
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const [showAddToGroup, setShowAddToGroup] = useState(false);

  // AI 批量标签状态
  const [aiTagsLoading, setAiTagsLoading] = useState(false);
  const [aiCategoryLoading, setAiCategoryLoading] = useState(false);

  // 分组视图分页（优先从 sessionStorage 恢复，因为 Next.js 客户端导航后 URL 参数可能丢失）
  const [groupPage, setGroupPage] = useState(() => {
    if (typeof window !== "undefined") {
      // 优先从 sessionStorage 恢复（最可靠来源，不受 Next.js 路由影响）
      const saved = sessionStorage.getItem("homeGroupPage");
      if (saved) {
        const n = parseInt(saved, 10);
        if (n > 0) return n;
      }
      // 其次尝试从 URL 查询参数 gpage 读取
      const gp = new URLSearchParams(window.location.search).get("gpage");
      if (gp) {
        const n = parseInt(gp, 10);
        if (n > 0) return n;
      }
    }
    return 1;
  });
  const GROUP_PAGE_SIZE = 24;
  // 用于跳过 showGroupView effect 首次挂载时的重置
  const showGroupViewMountedRef = useRef(false);
  // 挂载保护：防止首次挂载时 effect 将页码重置为1并清除 sessionStorage
  const pageResetGuardRef = useRef(true);

  // 受保护的页码 setter：在挂载保护期内阻止将页码重置为1
  const safeSetGroupPage = useCallback((v: number | ((prev: number) => number)) => {
    if (pageResetGuardRef.current && typeof v === 'number' && v === 1) return;
    setGroupPage(v as number);
  }, []);
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
  // 右键"加入分组"时暂存的漫画ID
  const [contextAddToGroupIds, setContextAddToGroupIds] = useState<string[] | null>(null);

  // 分组右键菜单状态
  const [groupContextMenu, setGroupContextMenu] = useState<{
    x: number;
    y: number;
    group: ComicGroup;
  } | null>(null);
  // 分组重命名对话框
  const [renameGroup, setRenameGroup] = useState<{ id: number; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // 内容类型 Tab
  const [contentType, setContentType] = useState<"comic" | "novel">(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("homeFilter:contentType");
      if (saved === "comic" || saved === "novel") return saved;
    }
    return "comic";
  });

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
    sessionStorage.setItem("homeFilter:contentType", contentType);
  }, [contentType]);

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
  const [removingGroupIds, setRemovingGroupIds] = useState<Set<number>>(new Set());

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

  // 分组视图持久化
  useEffect(() => {
    localStorage.setItem("showGroupView", String(showGroupView));
  }, [showGroupView]);

  // 加载分组数据（按 contentType 过滤）
  const loadGroups = useCallback(async () => {
    const [grps, gmap] = await Promise.all([fetchGroups(contentType || undefined), fetchGroupedComicMap()]);
    setGroups(grps);
    setGroupedComicMap(gmap);
  }, [contentType]);

  // 分组视图分页计算
  const groupTotalPages = Math.max(1, Math.ceil(groups.length / GROUP_PAGE_SIZE));
  const pagedGroups = useMemo(() => {
    const start = (groupPage - 1) * GROUP_PAGE_SIZE;
    return groups.slice(start, start + GROUP_PAGE_SIZE);
  }, [groups, groupPage, GROUP_PAGE_SIZE]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

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

  // 分组视图分页变化时持久化到 sessionStorage 和 URL 参数（确保从分组详情页返回时可恢复）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (groupPage > 1) {
      sessionStorage.setItem("homeGroupPage", String(groupPage));
      params.set("gpage", String(groupPage));
    } else {
      // 挂载保护期内不清除 sessionStorage（防止首次挂载时误清除已保存的页码）
      if (!pageResetGuardRef.current) {
        sessionStorage.removeItem("homeGroupPage");
      }
      params.delete("gpage");
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [groupPage]);

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
    contentType: contentType || undefined,
    excludeGrouped: showGroupView || undefined,
  });
  const { categories, refetch: refetchCategories, initCategories } = useCategories();

  // 根据当前 contentType 决定分页总页数
  const effectiveTotalPages = showGroupView ? groupTotalPages : totalPages;
  // 统一分页操作：分组视图用 groupPage，漫画视图用 currentPage
  const activePage = showGroupView ? groupPage : currentPage;
  const setActivePage = showGroupView ? setGroupPage : setCurrentPage;

  // Reset to page 1 when filters change（使用受保护的 setter，在挂载保护期内不会重置页码）
  const filterKeyRef = useRef(
    JSON.stringify([debouncedSearch, selectedTags, favoritesOnly, selectedCategory, sortBy, sortOrder, contentType])
  );
  useEffect(() => {
    const newKey = JSON.stringify([debouncedSearch, selectedTags, favoritesOnly, selectedCategory, sortBy, sortOrder, contentType]);
    if (filterKeyRef.current === newKey) return; // 值没变，不重置
    filterKeyRef.current = newKey;
    safeSetCurrentPage(1);
    safeSetGroupPage(1);
  }, [debouncedSearch, selectedTags, favoritesOnly, selectedCategory, sortBy, sortOrder, contentType, safeSetCurrentPage, safeSetGroupPage]);

  // 分组视图切换时重置分组分页（使用受保护的 setter，挂载保护期内不会重置）
  useEffect(() => {
    if (!showGroupViewMountedRef.current) {
      showGroupViewMountedRef.current = true;
      return;
    }
    safeSetGroupPage(1);
  }, [showGroupView, safeSetGroupPage]);

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
        const result = await uploadComics(files);
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
    [refetch, toast, t]
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
    const allGroupIds = showGroupView && currentPage === 1 && !debouncedSearch
      ? new Set(groups.map((g) => g.id))
      : new Set<number>();
    const allComicsSelected = selectedIds.size === allComicIds.size;
    const allGroupsSelected = allGroupIds.size === 0 || selectedGroupIds.size === allGroupIds.size;
    if (allComicsSelected && allGroupsSelected) {
      setSelectedIds(new Set());
      setSelectedGroupIds(new Set());
    } else {
      setSelectedIds(allComicIds);
      setSelectedGroupIds(allGroupIds);
    }
  }, [sortedComics, selectedIds.size, selectedGroupIds.size, groups, showGroupView, currentPage, debouncedSearch]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
    setSelectedGroupIds(new Set());
  }, []);

  // 分组批量选择
  const toggleGroupSelect = useCallback((id: number) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 分组批量删除
  const handleBatchDeleteGroups = useCallback(async () => {
    const ids = Array.from(selectedGroupIds);
    // 先播放删除动画
    setRemovingGroupIds(new Set(ids));
    setTimeout(async () => {
      let deleted = 0;
      for (const id of ids) {
        const ok = await deleteGroup(id);
        if (ok) deleted++;
      }
      setRemovingGroupIds(new Set());
      if (deleted > 0) {
        await loadGroups();
        await refetch();
        toast.success((t.comicGroup?.deleteSuccess || "分组已删除") + ` (${deleted})`);
      }
      setSelectedGroupIds(new Set());
    }, 400);
  }, [selectedGroupIds, loadGroups, refetch, toast, t]);

  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    // 先播放删除动画
    setRemovingIds(new Set(ids));
    // 等动画播完后再真正删除
    setTimeout(async () => {
      await batchOperation("delete", ids);
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

  // 合并为分组
  const handleMergeToGroup = useCallback(
    async (groupName: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length < 2) return;
      const result = await createGroup(groupName, ids);
      if (result.success) {
        toast.success(t.comicGroup?.created?.replace("{count}", "1") || "已创建 1 个分组");
        exitBatchMode();
        await loadGroups();
        setShowGroupView(true);
      }
    },
    [selectedIds, exitBatchMode, loadGroups, toast, t]
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
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
accept=".zip,.cbz,.cbr,.rar,.7z,.cb7,.pdf,.txt,.epub,.mobi,.azw3,.html,.htm"
        className="hidden"
        onChange={handleFileChange}
      />

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
      <main className={`mx-auto max-w-[1800px] px-3 sm:px-6 pt-20 sm:pt-24 ${batchMode ? "pb-32" : "pb-20 sm:pb-12"}`}>
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

        {/* Loading — 骨架屏 */}
        {loading && (
          <div className="space-y-6">
            {/* 骨架：Tab 栏 */}
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton-shimmer h-8 w-16 rounded-lg" />
              ))}
            </div>
            {/* 骨架：漫画网格 */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
            {/* 内容类型 Tab + 视图切换 */}
            <div className="flex items-center justify-between gap-1 sm:gap-1.5 mb-4">
              <div className="flex items-center gap-1 sm:gap-1.5">
                {([
                  { key: "comic", label: t.contentTab.comic, icon: Image },
                  { key: "novel", label: t.contentTab.novel, icon: BookOpen },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setContentType(tab.key)}
                    className={`flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium transition-all duration-200 ${
                      contentType === tab.key
                        ? "bg-accent text-white shadow-sm shadow-accent/25"
                        : "bg-card text-muted hover:text-foreground hover:bg-card-hover"
                    }`}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                ))}
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

            {/* 继续阅读横条 */}
            <ContinueReading contentType={contentType} />

            {/* Recommendations */}
            <RecommendationStrip contentType={contentType} />

            {/* Stats + Sort Controls */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-4">
              <StatsBar
                totalComics={showGroupView ? groups.length : apiTotal}
                filteredCount={showGroupView ? groups.length : apiTotal}
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

                {/* Group View Toggle — 始终显示 */}
                <button
                    onClick={() => setShowGroupView(!showGroupView)}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 sm:px-3 text-xs font-medium transition-all ${
                      showGroupView
                        ? "bg-accent/20 text-accent"
                        : "bg-card text-muted hover:text-foreground"
                    }`}
                    title={t.comicGroup?.groups || "分组"}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {groups.length > 0
                        ? `${t.comicGroup?.groups || "分组"} (${groups.length})`
                        : (t.comicGroup?.groups || "分组")}
                    </span>
                  </button>



                {/* Batch Mode Toggle — 仅管理员可见 */}
                {isAdmin && (
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
                )}

                {/* Select All (only in batch mode) */}
                {batchMode && (
                  <button
                    onClick={handleSelectAll}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 sm:px-3 text-xs font-medium transition-all ${
                      selectedIds.size === sortedComics.length && sortedComics.length > 0 &&
                      (!showGroupView || !groups.length || selectedGroupIds.size === groups.length)
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
                </div>
              </div>
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
            <div className="mt-4 mb-8">
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

            {/* Comics Grid */}
            <div className={`transition-opacity duration-200 ${fetching ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
            {/* 分组视图模式：只显示分组卡片 */}
            {showGroupView && !debouncedSearch ? (
              pagedGroups.length > 0 ? (
                <div
                  className={
                    viewMode === "grid"
                      ? "grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                      : "grid grid-cols-1 gap-2 sm:gap-3"
                  }
                >
                  {pagedGroups.map((group, index) => (
                    <ScrollReveal key={`group-${group.id}`} disabled={index < 20} delay={index >= 20 ? (index - 20) % 6 * 50 : 0}>
                    <GroupCard
                      group={group}
                      viewMode={viewMode}
                      contentType={contentType}
                      batchMode={batchMode}
                      isSelected={selectedGroupIds.has(group.id)}
                      onSelect={toggleGroupSelect}
                      animationIndex={index < 20 ? index : undefined}
                      isRemoving={removingGroupIds.has(group.id)}
                      onContextMenu={(e, g) => {
                        setGroupContextMenu({ x: e.clientX, y: e.clientY, group: g });
                      }}
                    />
                    </ScrollReveal>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-24 sm:py-32 text-center">
                  <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-card">
                    <Layers className="h-10 w-10 text-muted/30" />
                  </div>
                  <h3 className="mb-2 text-lg font-medium text-foreground/80">
                    {t.comicGroup?.noGroups || "还没有分组"}
                  </h3>
                  <p className="max-w-sm text-sm text-muted mb-5">
                    {t.comicGroup?.noGroupsHint || "可以通过智能分组或批量选择漫画来创建分组"}
                  </p>
                </div>
              )
            ) : sortedComics.length > 0 ? (
              <div
                className={
                  viewMode === "grid"
                    ? "grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                    : "grid grid-cols-1 gap-2 sm:gap-3"
                }
              >
                {/* 漫画卡片 */}
                {sortedComics
                  .map((comic, index) => (
                    <ScrollReveal key={comic.id} disabled={index < 20} delay={index >= 20 ? (index - 20) % 6 * 50 : 0}>
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
                        setContentType("comic");
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
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.firstPage}
                >
                  «
                </button>
                <button
                  onClick={() => setActivePage((p) => Math.max(1, p - 1))}
                  disabled={activePage === 1}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
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
                            : "border border-border/60 text-muted hover:border-border hover:text-foreground"
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
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title={t.home.nextPage}
                >
                  ›
                </button>
                <button
                  onClick={() => setActivePage(effectiveTotalPages)}
                  disabled={activePage === effectiveTotalPages}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
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
                    className="rounded-lg border border-border/60 px-2 py-1 text-xs text-muted hover:text-foreground hover:border-border transition-colors"
                  >
                    {t.home.goToPage || "跳转"}
                  </button>
                </div>

                {!showGroupView && (
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
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* 分组批量操作栏 — 固定在底部，当漫画也被选中时叠在BatchToolbar上方 */}
      {batchMode && selectedGroupIds.size > 0 && (
        <div className={`fixed left-0 right-0 z-50 border-t border-border/50 bg-background/95 px-3 sm:px-6 py-2 sm:py-3 backdrop-blur-xl ${
          selectedIds.size > 0 ? "bottom-[52px] sm:bottom-[56px]" : "bottom-0 safe-bottom"
        }`}>
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <Layers className="h-4 w-4 text-accent" />
              <span className="text-sm font-medium text-foreground">
                {t.batch.selected} <span className="text-accent">{selectedGroupIds.size}</span> {t.comicGroup?.groups || "分组"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* 批量删除分组 — 仅管理员可见 */}
              {isAdmin && (
              <button
                onClick={handleBatchDeleteGroups}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.contextMenu?.deleteGroup || "删除分组"}</span>
              </button>
              )}
              {/* 仅当没选漫画时显示取消按钮（漫画操作栏有自己的取消按钮） */}
              {selectedIds.size === 0 && (
                <button
                  onClick={exitBatchMode}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-xs font-medium text-muted transition-colors hover:bg-card-hover"
                >
                  <X className="h-3.5 w-3.5" />
                  {t.common.cancel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
          onMergeGroup={selectedIds.size >= 2 ? () => setShowMergeDialog(true) : undefined}
          onAddToGroup={() => setShowAddToGroup(true)}
          onAISuggestTags={aiConfigured ? handleAIBatchSuggestTags : undefined}
          aiTagsLoading={aiTagsLoading}
          onAISuggestCategory={aiConfigured ? handleAIBatchSuggestCategory : undefined}
          aiCategoryLoading={aiCategoryLoading}
          isAdmin={isAdmin}
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
          contentType={contentType}
          onClose={() => setShowAddToGroup(false)}
          onDone={() => {
            setShowAddToGroup(false);
            exitBatchMode();
            loadGroups();
            toast.success(t.comicGroup?.addToGroup || "已加入分组");
          }}
        />
      )}



      {/* 分组右键菜单 */}
      {groupContextMenu && (
        <GroupContextMenu
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          groupId={groupContextMenu.group.id}
          groupName={groupContextMenu.group.name}
          onClose={() => setGroupContextMenu(null)}
          onOpen={(id) => router.push(`/group/${id}`)}
          onRename={(id, currentName) => {
            setRenameGroup({ id, name: currentName });
            setRenameValue(currentName);
          }}
          onDelete={async (id) => {
            // 先播放删除动画
            setRemovingGroupIds(new Set([id]));
            setTimeout(async () => {
              const ok = await deleteGroup(id);
              setRemovingGroupIds(new Set());
              if (ok) {
                await loadGroups();
                toast.success(t.comicGroup?.deleteSuccess || "分组已删除");
                await refetch();
              }
            }, 400);
          }}
          isAdmin={isAdmin}
        />
      )}

      {/* 分组重命名对话框 */}
      {renameGroup && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-backdrop-in" onClick={() => setRenameGroup(null)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-2xl animate-modal-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-foreground">
              {t.contextMenu?.renameGroup || "重命名分组"}
            </h3>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && renameValue.trim() && renameValue.trim() !== renameGroup.name) {
                  const ok = await updateGroup(renameGroup.id, renameValue.trim());
                  if (ok) {
                    await loadGroups();
                    toast.success(t.contextMenu?.renameSuccess || "已重命名");
                  }
                  setRenameGroup(null);
                }
                if (e.key === "Escape") setRenameGroup(null);
              }}
              className="w-full rounded-xl border border-border/60 bg-background px-4 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
              placeholder={t.comicGroup?.groupName || "分组名称"}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRenameGroup(null)}
                className="rounded-lg px-4 py-2 text-sm text-muted transition-colors hover:bg-card-hover hover:text-foreground"
              >
                {t.comicDetail?.cancel || "取消"}
              </button>
              <button
                onClick={async () => {
                  if (renameValue.trim() && renameValue.trim() !== renameGroup.name) {
                    const ok = await updateGroup(renameGroup.id, renameValue.trim());
                    if (ok) {
                      await loadGroups();
                      toast.success(t.contextMenu?.renameSuccess || "已重命名");
                    }
                  }
                  setRenameGroup(null);
                }}
                disabled={!renameValue.trim() || renameValue.trim() === renameGroup.name}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:pointer-events-none"
              >
                {t.comicDetail?.confirm || "确认"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 漫画右键菜单 */}
      {contextMenu && (
        <ComicContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          comicId={contextMenu.comic.id}
          comicTitle={contextMenu.comic.title}
          isFavorite={contextMenu.comic.isFavorite}
          isAdmin={isAdmin}
          onClose={() => setContextMenu(null)}
          onRead={(id) => {
            const c = sortedComics.find((c) => c.id === id);
            if (c) {
              const isNovel = c.filename && /\.(txt|epub|mobi|azw3|html|htm)$/i.test(c.filename);
              router.push(isNovel ? `/novel/${id}` : `/reader/${id}`);
            }
          }}
          onDetail={(id) => router.push(`/comic/${id}`)}
          onToggleFavorite={async (id) => {
            await toggleComicFavorite(id);
            await refetch();
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

      {/* 右键菜单“加入分组”弹窗 */}
      {contextAddToGroupIds && (
        <AddToGroupDialog
          comicIds={contextAddToGroupIds}
          contentType={contentType}
          onClose={() => setContextAddToGroupIds(null)}
          onDone={() => {
            setContextAddToGroupIds(null);
            loadGroups();
            toast.success(t.comicGroup?.addToGroup || "已加入分组");
          }}
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
