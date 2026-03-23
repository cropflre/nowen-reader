"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Layers,
  Search,
  Plus,
  Wand2,
  Trash2,
  LayoutGrid,
  LayoutList,
  SortAsc,
  SortDesc,
  BookOpen,
  FolderPlus,
  RefreshCw,
  ChevronDown,
  X,
  Check,
  Loader2,
  CheckSquare,
  Square,
  Merge,
  Download,
  CheckCheck,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import {
  fetchGroups,
  createGroup,
  deleteGroup,
  batchDeleteGroups,
  mergeGroups,
  exportGroups,
} from "@/api/groups";
import type { ComicGroup } from "@/hooks/useComicTypes";
import AutoDetectPanel from "@/components/AutoDetectPanel";

// ============================================================
// 类型与工具函数
// ============================================================

type SortField = "name" | "comicCount" | "updatedAt" | "createdAt";
type SortOrder = "asc" | "desc";
type ViewMode = "grid" | "list";
type ContentFilter = "comic" | "novel";

// ============================================================
// 合集管理页面
// ============================================================

export default function CollectionsPage() {
  const t = useTranslation();
  const toast = useToast();

  // 分组数据
  const [groups, setGroups] = useState<ComicGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 视图与筛选
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("collections-viewMode") as ViewMode) || "grid";
    }
    return "grid";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("comic");
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // 批量选择
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const [merging, setMerging] = useState(false);

  // 分页状态（优先从 sessionStorage 恢复，因为 Next.js 客户端导航后 URL 参数可能丢失）
  const COLLECTIONS_PAGE_SIZE = 24;
  const [currentPage, setCurrentPage] = useState(() => {
    if (typeof window !== "undefined") {
      // 优先从 sessionStorage 恢复（最可靠来源，不受 Next.js 路由影响）
      const saved = sessionStorage.getItem("collectionsPage");
      if (saved) {
        const n = parseInt(saved, 10);
        if (n > 0) return n;
      }
      // 其次尝试从 URL 查询参数 page 读取
      const p = new URLSearchParams(window.location.search).get("page");
      if (p) {
        const n = parseInt(p, 10);
        if (n > 0) return n;
      }
    }
    return 1;
  });
  // 挂载保护：防止首次挂载时 effect 将页码重置为1并清除 sessionStorage
  const pageResetGuardRef = useRef(true);

  // 受保护的页码 setter：在挂载保护期内阻止将页码重置为1
  const safeSetCurrentPage = useCallback((v: number | ((prev: number) => number)) => {
    if (pageResetGuardRef.current && typeof v === 'number' && v === 1) return;
    setCurrentPage(v as number);
  }, []);

  // 弹窗状态
  const [showAutoDetect, setShowAutoDetect] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tGroup = (t as any).comicGroup || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tCollections = (t as any).collections || {};

  // 挂载保护期结束后解除保护
  useEffect(() => {
    const timer = setTimeout(() => {
      pageResetGuardRef.current = false;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // ── 持久化视图模式 ──
  useEffect(() => {
    localStorage.setItem("collections-viewMode", viewMode);
  }, [viewMode]);

  // ── 加载分组数据 ──
  const loadGroups = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchGroups(contentFilter);
      setGroups(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [contentFilter]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // ── 点击外部关闭排序下拉 ──
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setShowSortDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── 分页持久化：页码变化时同步到 sessionStorage 和 URL 参数 ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (currentPage > 1) {
      sessionStorage.setItem("collectionsPage", String(currentPage));
      params.set("page", String(currentPage));
    } else {
      params.delete("page");
      // 挂载保护期内不清除 sessionStorage（防止首次挂载时误清除已保存的页码）
      if (!pageResetGuardRef.current) {
        sessionStorage.removeItem("collectionsPage");
      }
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [currentPage]);

  // ── 过滤 + 排序 ──
  const filteredAndSorted = useMemo(() => {
    let result = [...groups];

    // 搜索过滤
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((g) => g.name.toLowerCase().includes(q));
    }

    // 排序
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name, "zh-CN");
          break;
        case "comicCount":
          cmp = a.comicCount - b.comicCount;
          break;
        case "updatedAt":
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [groups, searchQuery, sortField, sortOrder]);

  // ── 分页计算 ──
  const collectionsTotalPages = Math.max(1, Math.ceil(filteredAndSorted.length / COLLECTIONS_PAGE_SIZE));
  const pagedCollections = useMemo(() => {
    const start = (currentPage - 1) * COLLECTIONS_PAGE_SIZE;
    return filteredAndSorted.slice(start, start + COLLECTIONS_PAGE_SIZE);
  }, [filteredAndSorted, currentPage, COLLECTIONS_PAGE_SIZE]);

  // 搜索/排序/筛选变化时重置到第1页（使用受保护的 setter，在挂载保护期内不会重置页码）
  const filterKeyRef = useRef(
    JSON.stringify([searchQuery, sortField, sortOrder, contentFilter])
  );
  useEffect(() => {
    const newKey = JSON.stringify([searchQuery, sortField, sortOrder, contentFilter]);
    if (filterKeyRef.current === newKey) return; // 值没变（含首次挂载），不重置
    filterKeyRef.current = newKey;
    safeSetCurrentPage(1);
  }, [searchQuery, sortField, sortOrder, contentFilter, safeSetCurrentPage]);

  // 确保当前页码不超出范围（比如删除后总页数减少）
  // 注意：数据加载中时跳过检查，避免 groups 为空数组时 totalPages=1 导致误重置已从 sessionStorage 恢复的页码
  // 同时在挂载保护期内也跳过检查
  useEffect(() => {
    if (!loading && !pageResetGuardRef.current && currentPage > collectionsTotalPages) {
      setCurrentPage(collectionsTotalPages);
    }
  }, [currentPage, collectionsTotalPages, loading]);

  // ── 创建分组 ──
  const handleCreate = useCallback(async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const result = await createGroup(createName.trim());
      if (result.success) {
        toast.success(tGroup.createGroup || "分组已创建");
        setShowCreateDialog(false);
        setCreateName("");
        loadGroups();
      }
    } finally {
      setCreating(false);
    }
  }, [createName, loadGroups, toast, tGroup]);

  // ── 删除分组 ──
  const handleDelete = useCallback(async () => {
    if (deleteConfirmId === null) return;
    setDeleting(true);
    try {
      const ok = await deleteGroup(deleteConfirmId);
      if (ok) {
        toast.success(tGroup.deleteSuccess || "分组已删除");
        setGroups((prev) => prev.filter((g) => g.id !== deleteConfirmId));
        setDeleteConfirmId(null);
      }
    } finally {
      setDeleting(false);
    }
  }, [deleteConfirmId, toast, tGroup]);

  // ── 排序选项 ──
  const sortOptions: { field: SortField; label: string }[] = [
    { field: "name", label: tCollections.sortByName || "按名称" },
    { field: "comicCount", label: tCollections.sortByCount || "按作品数" },
    { field: "updatedAt", label: tCollections.sortByUpdated || "按更新时间" },
    { field: "createdAt", label: tCollections.sortByCreated || "按创建时间" },
  ];

  const deleteTarget = groups.find((g) => g.id === deleteConfirmId);

  // ── 批量操作 ──
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredAndSorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSorted.map((g) => g.id)));
    }
  }, [selectedIds.size, filteredAndSorted]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    try {
      const result = await batchDeleteGroups(Array.from(selectedIds));
      if (result.success) {
        toast.success(
          (tCollections.batchDeleteSuccess || "成功删除 {count} 个合集").replace("{count}", String(result.deleted))
        );
        setGroups((prev) => prev.filter((g) => !selectedIds.has(g.id)));
        setSelectedIds(new Set());
        setShowBatchDeleteConfirm(false);
      }
    } finally {
      setBatchDeleting(false);
    }
  }, [selectedIds, toast, tCollections]);

  const handleMerge = useCallback(async () => {
    if (selectedIds.size < 2 || !mergeName.trim()) return;
    setMerging(true);
    try {
      const result = await mergeGroups(Array.from(selectedIds), mergeName.trim());
      if (result.success) {
        toast.success(tCollections.mergeSuccess || "合集已合并");
        setShowMergeDialog(false);
        setMergeName("");
        setSelectedIds(new Set());
        loadGroups();
      }
    } finally {
      setMerging(false);
    }
  }, [selectedIds, mergeName, toast, tCollections, loadGroups]);

  const handleExport = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const data = await exportGroups(Array.from(selectedIds));
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `collections-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(tCollections.exportSuccess || "导出成功");
      } else {
        toast.error(tCollections.exportFailed || "导出失败");
      }
    } catch {
      toast.error(tCollections.exportFailed || "导出失败");
    }
  }, [selectedIds, toast, tCollections]);

  return (
    <div className="min-h-screen bg-background">
      {/* ── 顶部导航栏 ── */}
      <div className="sticky top-0 z-30 border-b border-border/30 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
          {/* 第一行：返回 + 标题 + 操作 */}
          <div className="flex h-14 sm:h-16 items-center gap-3">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>

            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Layers className="h-5 w-5 text-accent flex-shrink-0" />
              <h1 className="text-lg font-bold text-foreground truncate">
                {tCollections.title || "合集管理"}
              </h1>
              <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent flex-shrink-0">
                {filteredAndSorted.length}
              </span>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* 刷新 */}
              <button
                onClick={() => loadGroups(true)}
                disabled={refreshing}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
                title={tCollections.refresh || "刷新"}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>

              {/* 批量管理 */}
              {groups.length > 0 && (
                <button
                  onClick={() => batchMode ? exitBatchMode() : setBatchMode(true)}
                  className={`hidden sm:flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    batchMode
                      ? "bg-accent text-white"
                      : "border border-border/50 text-muted hover:text-foreground hover:bg-card"
                  }`}
                >
                  <CheckSquare className="h-4 w-4" />
                  {batchMode ? (tCollections.batchModeExit || "退出批量") : (tCollections.batchMode || "批量管理")}
                </button>
              )}

              {/* 智能分组 */}
              {!batchMode && (
                <button
                  onClick={() => setShowAutoDetect(true)}
                  className="hidden sm:flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
                >
                  <Wand2 className="h-4 w-4" />
                  {tGroup.autoDetect || "智能分组"}
                </button>
              )}

              {/* 手动创建 */}
              {!batchMode && (
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">{tGroup.createGroup || "新建合集"}</span>
                </button>
              )}
            </div>
          </div>

          {/* 批量操作工具栏 */}
          {batchMode && (
            <div className="flex items-center gap-2 pb-2 border-b border-accent/20 mb-2 animate-card-in">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-card transition-colors"
              >
                {selectedIds.size === filteredAndSorted.length && filteredAndSorted.length > 0 ? (
                  <CheckCheck className="h-3.5 w-3.5 text-accent" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {selectedIds.size === filteredAndSorted.length && filteredAndSorted.length > 0
                  ? (tCollections.deselectAll || "取消全选")
                  : (tCollections.selectAll || "全选")}
              </button>

              {selectedIds.size > 0 && (
                <span className="text-xs font-medium text-accent">
                  {(tCollections.selectedCount || "已选 {count} 个").replace("{count}", String(selectedIds.size))}
                </span>
              )}

              <div className="flex-1" />

              {/* 合并 */}
              <button
                onClick={() => {
                  if (selectedIds.size < 2) {
                    toast.error(tCollections.mergeNeedTwo || "至少需要选择两个合集才能合并");
                    return;
                  }
                  // 使用第一个选中分组的名称作为默认合并名
                  const firstSelected = groups.find((g) => selectedIds.has(g.id));
                  setMergeName(firstSelected?.name || "");
                  setShowMergeDialog(true);
                }}
                disabled={selectedIds.size < 2}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Merge className="h-3.5 w-3.5" />
                {tCollections.batchMerge || "合并"}
              </button>

              {/* 导出 */}
              <button
                onClick={handleExport}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                {tCollections.batchExport || "导出"}
              </button>

              {/* 批量删除 */}
              <button
                onClick={() => setShowBatchDeleteConfirm(true)}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tCollections.batchDelete || "批量删除"}
              </button>
            </div>
          )}

          {/* 第二行：搜索 + 筛选 + 排序 + 视图切换 */}
          <div className="flex items-center gap-2 pb-3">
            {/* 搜索框 */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tGroup.searchGroupHint || "搜索合集..."}
                className="h-9 w-full rounded-lg border border-border/50 bg-card/50 pl-9 pr-8 text-sm text-foreground placeholder:text-muted/50 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* 内容类型筛选 */}
            <div className="hidden sm:flex items-center rounded-lg border border-border/50 bg-card/50 p-0.5">
              {(["comic", "novel"] as ContentFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setContentFilter(filter)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    contentFilter === filter
                      ? "bg-accent text-white"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {filter === "comic"
                    ? (tCollections.filterComic || "漫画")
                    : (tCollections.filterNovel || "小说")}
                </button>
              ))}
            </div>

            {/* 排序下拉 */}
            <div className="relative" ref={sortDropdownRef}>
              <button
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border/50 bg-card/50 px-3 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                {sortOrder === "asc" ? (
                  <SortAsc className="h-3.5 w-3.5" />
                ) : (
                  <SortDesc className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {sortOptions.find((o) => o.field === sortField)?.label}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {showSortDropdown && (
                <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-border/50 bg-card py-1 shadow-xl z-50">
                  {sortOptions.map((opt) => (
                    <button
                      key={opt.field}
                      onClick={() => {
                        if (sortField === opt.field) {
                          setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                        } else {
                          setSortField(opt.field);
                          setSortOrder("asc");
                        }
                        setShowSortDropdown(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-xs transition-colors ${
                        sortField === opt.field
                          ? "text-accent bg-accent/5"
                          : "text-foreground/80 hover:bg-card-hover"
                      }`}
                    >
                      {opt.label}
                      {sortField === opt.field && (
                        <span className="text-[10px] text-accent">
                          {sortOrder === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 视图切换 */}
            <div className="flex items-center rounded-lg border border-border/50 bg-card/50 p-0.5">
              <button
                onClick={() => setViewMode("grid")}
                className={`rounded-md p-1.5 transition-colors ${
                  viewMode === "grid"
                    ? "bg-accent text-white"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`rounded-md p-1.5 transition-colors ${
                  viewMode === "list"
                    ? "bg-accent text-white"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <LayoutList className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 主体内容 ── */}
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6">
          {/* 移动端批量管理入口 */}
        {groups.length > 0 && (
          <div className="flex sm:hidden items-center gap-2 mb-3">
            <button
              onClick={() => batchMode ? exitBatchMode() : setBatchMode(true)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                batchMode
                  ? "bg-accent text-white"
                  : "bg-card text-muted"
              }`}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {batchMode ? (tCollections.batchModeExit || "退出批量") : (tCollections.batchMode || "批量管理")}
            </button>
            {batchMode && selectedIds.size > 0 && (
              <>
                <span className="text-xs font-medium text-accent">
                  {(tCollections.selectedCount || "已选 {count} 个").replace("{count}", String(selectedIds.size))}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    if (selectedIds.size < 2) {
                      toast.error(tCollections.mergeNeedTwo || "至少需要选择两个合集才能合并");
                      return;
                    }
                    const firstSelected = groups.find((g) => selectedIds.has(g.id));
                    setMergeName(firstSelected?.name || "");
                    setShowMergeDialog(true);
                  }}
                  disabled={selectedIds.size < 2}
                  className="p-2 rounded-lg text-blue-400 hover:bg-blue-500/10 disabled:opacity-40"
                >
                  <Merge className="h-4 w-4" />
                </button>
                <button onClick={handleExport} className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10">
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowBatchDeleteConfirm(true)}
                  className="p-2 rounded-lg text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        )}

        {/* 移动端内容筛选 */}
        <div className="flex sm:hidden items-center gap-2 mb-4">
          {(["comic", "novel"] as ContentFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setContentFilter(filter)}
              className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${
                contentFilter === filter
                  ? "bg-accent text-white"
                  : "bg-card text-muted"
              }`}
            >
              {filter === "comic"
                ? (tCollections.filterComic || "漫画")
                : (tCollections.filterNovel || "小说")}
            </button>
          ))}
          {/* 移动端智能分组按钮 */}
          <button
            onClick={() => setShowAutoDetect(true)}
            className="flex items-center justify-center rounded-lg bg-amber-500/10 p-2 text-amber-400"
          >
            <Wand2 className="h-4 w-4" />
          </button>
        </div>

        {/* 加载状态 */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
            <p className="text-sm text-muted">{tCollections.loading || "加载中..."}</p>
          </div>
        ) : filteredAndSorted.length === 0 ? (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center py-24">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-card">
              {searchQuery ? (
                <Search className="h-10 w-10 text-muted/30" />
              ) : (
                <Layers className="h-10 w-10 text-muted/30" />
              )}
            </div>
            <h3 className="mb-2 text-base font-semibold text-foreground/80">
              {searchQuery
                ? (tGroup.noMatchGroup || "没有匹配的合集")
                : (tCollections.emptyTitle || "还没有合集")}
            </h3>
            <p className="mb-6 max-w-sm text-center text-sm text-muted">
              {searchQuery
                ? (tCollections.emptySearchHint || "尝试其他关键词或清除搜索")
                : (tCollections.emptyHint || "使用智能分组自动发现同系列作品，或手动创建合集")}
            </p>
            {!searchQuery && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowAutoDetect(true)}
                  className="flex items-center gap-2 rounded-xl bg-amber-500/15 px-5 py-2.5 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/25"
                >
                  <Wand2 className="h-4 w-4" />
                  {tGroup.autoDetect || "智能分组"}
                </button>
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  <FolderPlus className="h-4 w-4" />
                  {tGroup.createGroup || "手动创建"}
                </button>
              </div>
            )}
          </div>
        ) : viewMode === "grid" ? (
          /* ── 网格视图 ── */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {pagedCollections.map((group, index) => (
              <CollectionGridCard
                key={group.id}
                group={group}
                index={index}
                onDelete={(id) => setDeleteConfirmId(id)}
                t={tGroup}
                tCollections={tCollections}
                batchMode={batchMode}
                selected={selectedIds.has(group.id)}
                onToggleSelect={toggleSelect}
                contentFilter={contentFilter}
              />
            ))}
          </div>
        ) : (
          /* ── 列表视图 ── */
          <div className="space-y-2">
            {pagedCollections.map((group, index) => (
              <CollectionListCard
                key={group.id}
                group={group}
                index={index}
                onDelete={(id) => setDeleteConfirmId(id)}
                t={tGroup}
                tCollections={tCollections}
                batchMode={batchMode}
                selected={selectedIds.has(group.id)}
                onToggleSelect={toggleSelect}
                contentFilter={contentFilter}
              />
            ))}
          </div>
        )}

        {/* ── 分页导航 ── */}
        {collectionsTotalPages > 1 && (
          <div className="mt-6 sm:mt-8 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
            {/* 首页 */}
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              title={tCollections.firstPage || "首页"}
            >
              «
            </button>
            {/* 上一页 */}
            <button
              onClick={() => setCurrentPage((p: number) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              title={tCollections.prevPage || "上一页"}
            >
              ‹
            </button>

            {/* 页码按钮 */}
            {(() => {
              const pages: (number | string)[] = [];
              const maxVisible = typeof window !== "undefined" && window.innerWidth < 640 ? 5 : 7;
              if (collectionsTotalPages <= maxVisible) {
                for (let i = 1; i <= collectionsTotalPages; i++) pages.push(i);
              } else {
                pages.push(1);
                if (currentPage > 3) pages.push("...");
                const start = Math.max(2, currentPage - 1);
                const end = Math.min(collectionsTotalPages - 1, currentPage + 1);
                for (let i = start; i <= end; i++) pages.push(i);
                if (currentPage < collectionsTotalPages - 2) pages.push("...");
                pages.push(collectionsTotalPages);
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

            {/* 下一页 */}
            <button
              onClick={() => setCurrentPage((p: number) => Math.min(collectionsTotalPages, p + 1))}
              disabled={currentPage === collectionsTotalPages}
              className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              title={tCollections.nextPage || "下一页"}
            >
              ›
            </button>
            {/* 末页 */}
            <button
              onClick={() => setCurrentPage(collectionsTotalPages)}
              disabled={currentPage === collectionsTotalPages}
              className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-border/60 text-sm text-muted transition-colors hover:border-border hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              title={tCollections.lastPage || "末页"}
            >
              »
            </button>

            {/* 页码信息 */}
            <span className="ml-2 sm:ml-3 text-xs text-muted">
              {currentPage} / {collectionsTotalPages}
            </span>

            {/* 页码跳转输入框 */}
            <div className="ml-2 sm:ml-3 flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={collectionsTotalPages}
                placeholder={tCollections.pageInputPlaceholder || "页码"}
                className="w-14 sm:w-16 rounded-lg border border-border/60 bg-card px-2 py-1 text-xs text-center text-foreground outline-none focus:border-accent/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = parseInt((e.target as HTMLInputElement).value, 10);
                    if (val >= 1 && val <= collectionsTotalPages) {
                      setCurrentPage(val);
                      (e.target as HTMLInputElement).value = "";
                      (e.target as HTMLInputElement).blur();
                    }
                  }
                }}
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val >= 1 && val <= collectionsTotalPages) {
                    setCurrentPage(val);
                    e.target.value = "";
                  }
                }}
              />
              <button
                onClick={(e) => {
                  const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement;
                  const val = parseInt(input?.value, 10);
                  if (val >= 1 && val <= collectionsTotalPages) {
                    setCurrentPage(val);
                    input.value = "";
                  }
                }}
                className="rounded-lg border border-border/60 px-2 py-1 text-xs text-muted hover:text-foreground hover:border-border transition-colors"
              >
                {tCollections.goToPage || "跳转"}
              </button>
            </div>

            {/* 总数信息 */}
            <span className="ml-2 text-xs text-muted hidden sm:inline">
              {(tCollections.totalCollections || "共 {count} 个合集").replace("{count}", String(filteredAndSorted.length))}
            </span>
          </div>
        )}
      </main>

      {/* ── 智能分组面板 ── */}
      <AutoDetectPanel
        open={showAutoDetect}
        onClose={() => setShowAutoDetect(false)}
        onCreated={() => loadGroups()}
        contentType={contentFilter}
      />

      {/* ── 手动创建合集弹窗 ── */}
      {showCreateDialog && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in"
            onClick={() => {
              setShowCreateDialog(false);
              setCreateName("");
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-modal-in">
            <div className="flex items-center gap-2 mb-4">
              <FolderPlus className="h-5 w-5 text-accent" />
              <h3 className="text-lg font-semibold text-foreground">
                {tCollections.createTitle || "新建合集"}
              </h3>
            </div>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder={tGroup.groupNamePlaceholder || "输入合集名称..."}
              className="w-full rounded-xl bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 outline-none focus:ring-1 focus:ring-accent/50 mb-5"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateDialog(false);
                  setCreateName("");
                }}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground hover:bg-card-hover"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleCreate}
                disabled={!createName.trim() || creating}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {t.common.save || "创建"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 删除确认弹窗 ── */}
      {deleteConfirmId !== null && deleteTarget && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in"
            onClick={() => setDeleteConfirmId(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-[60] w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-modal-in">
            <h3 className="text-lg font-semibold text-foreground">
              {tGroup.confirmDelete || "确认删除合集"}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {(tGroup.confirmDeleteMsg || "确定要删除合集「{name}」吗？合集内的作品不会被删除。").replace(
                "{name}",
                deleteTarget.name
              )}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t.common.delete}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 批量删除确认弹窗 ── */}
      {showBatchDeleteConfirm && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in"
            onClick={() => setShowBatchDeleteConfirm(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-modal-in">
            <h3 className="text-lg font-semibold text-foreground">
              {tCollections.batchDeleteConfirm || "确认批量删除"}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {(tCollections.batchDeleteMsg || "确定要删除选中的 {count} 个合集吗？合集内的作品不会被删除。").replace(
                "{count}",
                String(selectedIds.size)
              )}
            </p>
            {/* 列出被选中的合集名称 */}
            <div className="mt-3 max-h-32 overflow-y-auto space-y-1">
              {groups.filter((g) => selectedIds.has(g.id)).map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-xs text-foreground/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  <span className="truncate">{g.name}</span>
                  <span className="text-muted ml-auto flex-shrink-0">{g.comicCount} {tCollections.works || "部作品"}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground hover:bg-card-hover"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {batchDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t.common.delete}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 合并弹窗 ── */}
      {showMergeDialog && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in"
            onClick={() => { setShowMergeDialog(false); setMergeName(""); }}
          />
          <div className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-modal-in">
            <div className="flex items-center gap-2 mb-4">
              <Merge className="h-5 w-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-foreground">
                {tCollections.mergeTitle || "合并合集"}
              </h3>
            </div>
            <p className="text-sm text-muted mb-4">
              {(tCollections.mergeHint || "将选中的 {count} 个合集合并为一个新合集").replace(
                "{count}",
                String(selectedIds.size)
              )}
            </p>
            {/* 将要合并的合集列表 */}
            <div className="mb-4 max-h-24 overflow-y-auto space-y-1">
              {groups.filter((g) => selectedIds.has(g.id)).map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-xs text-foreground/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  <span className="truncate">{g.name}</span>
                  <span className="text-muted ml-auto flex-shrink-0">{g.comicCount} {tCollections.works || "部作品"}</span>
                </div>
              ))}
            </div>
            <label className="block text-xs font-medium text-muted mb-1.5">
              {tCollections.mergeNameLabel || "合并后的名称"}
            </label>
            <input
              type="text"
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleMerge()}
              placeholder={tCollections.mergeNamePlaceholder || "输入新合集名称..."}
              className="w-full rounded-xl bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 outline-none focus:ring-1 focus:ring-accent/50 mb-5"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowMergeDialog(false); setMergeName(""); }}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground hover:bg-card-hover"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleMerge}
                disabled={!mergeName.trim() || merging}
                className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {merging ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Merge className="h-4 w-4" />
                )}
                {tCollections.batchMerge || "合并"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// 网格卡片组件
// ============================================================

function CollectionGridCard({
  group,
  index,
  onDelete,
  t,
  tCollections,
  batchMode,
  selected,
  onToggleSelect,
  contentFilter,
}: {
  group: ComicGroup;
  index: number;
  onDelete: (id: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tCollections: any;
  batchMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  contentFilter: string;
}) {
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const handleCardClick = (e: React.MouseEvent) => {
    if (batchMode) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(group.id);
    }
  };

  return (
    <div
      className={`group relative animate-card-in ${batchMode ? "cursor-pointer" : ""} ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-background rounded-xl" : ""}`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (batchMode) { onToggleSelect(group.id); return; }
        setShowMenu(true);
      }}
      onClick={handleCardClick}
    >
      <Link href={batchMode ? "#" : `/group/${group.id}?contentType=${contentFilter}`} className="block" onClick={batchMode ? handleCardClick : undefined}>
        <div className="relative overflow-hidden rounded-xl bg-card transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:shadow-accent/10">
          {/* 封面区域 */}
          <div className="relative aspect-[5/7] w-full overflow-hidden">
            {/* 骨架屏 */}
            {!coverLoaded && group.coverUrl && (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-muted/30 to-muted/10" />
            )}
            {group.coverUrl ? (
              <Image
                src={group.coverUrl}
                alt={group.name}
                fill
                unoptimized
                className={`object-cover transition-all duration-500 group-hover:scale-110 ${
                  coverLoaded ? "opacity-100" : "opacity-0"
                }`}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                onLoad={() => setCoverLoaded(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/20 to-accent/5">
                <Layers className="h-12 w-12 text-accent/40" />
              </div>
            )}

            {/* 渐变叠层 */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80 transition-opacity group-hover:opacity-100" />

            {/* 底部信息 */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-white shadow-lg">
                📚 {group.comicCount} {t.volumes || "卷"}
              </span>
            </div>

            {/* Hover 播放按钮 */}
            {!batchMode && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                <div className="flex h-14 w-14 scale-75 items-center justify-center rounded-full bg-accent/90 shadow-lg shadow-accent/30 backdrop-blur-sm transition-transform duration-300 group-hover:scale-100">
                  <BookOpen className="h-6 w-6 text-white" />
                </div>
              </div>
            )}

            {/* 批量选择复选框 */}
            {batchMode && (
              <div className="absolute top-2 left-2 z-10">
                <div className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors ${
                  selected
                    ? "bg-accent border-accent text-white"
                    : "bg-black/40 border-white/60 text-transparent backdrop-blur-sm"
                }`}>
                  <Check className="h-3.5 w-3.5" />
                </div>
              </div>
            )}
          </div>

          {/* 卡片底部信息 */}
          <div className="p-3">
            <h3 className="mb-1 truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
              {group.name}
            </h3>
            <p className="text-[10px] text-muted">
              {group.comicCount} {tCollections.works || "部作品"}
            </p>
          </div>
        </div>
      </Link>

      {/* 右键菜单 / 长按菜单 */}
      {showMenu && !batchMode && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setShowMenu(false)} />
          <div className="absolute right-2 top-2 z-50 w-36 rounded-xl border border-border/50 bg-card py-1 shadow-xl">
            <Link
              href={`/group/${group.id}?contentType=${contentFilter}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-card-hover"
              onClick={() => setShowMenu(false)}
            >
              <BookOpen className="h-3.5 w-3.5" />
              {tCollections.viewDetail || "查看详情"}
            </Link>
            <button
              onClick={() => {
                setShowMenu(false);
                onDelete(group.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.deleteGroup || "删除合集"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// 列表卡片组件
// ============================================================

function CollectionListCard({
  group,
  index,
  onDelete,
  t,
  tCollections,
  batchMode,
  selected,
  onToggleSelect,
  contentFilter,
}: {
  group: ComicGroup;
  index: number;
  onDelete: (id: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tCollections: any;
  batchMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  contentFilter: string;
}) {
  const handleRowClick = (e: React.MouseEvent) => {
    if (batchMode) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(group.id);
    }
  };

  return (
    <div
      className={`group animate-card-in ${batchMode ? "cursor-pointer" : ""}`}
      style={{ animationDelay: `${Math.min(index, 20) * 20}ms` }}
      onClick={handleRowClick}
    >
      <div className={`flex items-center gap-4 rounded-xl bg-card p-3 transition-all hover:bg-card-hover hover:shadow-lg hover:shadow-accent/5 ${
        selected ? "ring-2 ring-accent" : ""
      }`}>
        {/* 批量选择复选框 */}
        {batchMode && (
          <div className="flex-shrink-0">
            <div className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors ${
              selected
                ? "bg-accent border-accent text-white"
                : "bg-card border-border text-transparent"
            }`}>
              <Check className="h-3.5 w-3.5" />
            </div>
          </div>
        )}

        {/* 封面缩略图 */}
        <Link href={batchMode ? "#" : `/group/${group.id}?contentType=${contentFilter}`} className="flex-shrink-0" onClick={batchMode ? handleRowClick : undefined}>
          <div className="relative h-20 w-14 overflow-hidden rounded-lg">
            {group.coverUrl ? (
              <Image
                src={group.coverUrl}
                alt={group.name}
                fill
                unoptimized
                className="object-cover transition-transform duration-300 group-hover:scale-110"
                sizes="56px"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/20 to-accent/5">
                <Layers className="h-6 w-6 text-accent/40" />
              </div>
            )}
            {/* 角标 */}
            <div className="absolute bottom-0 right-0 rounded-tl-md bg-accent px-1 py-0.5 text-[8px] font-bold text-white">
              {group.comicCount}
            </div>
          </div>
        </Link>

        {/* 信息区域 */}
        <Link href={batchMode ? "#" : `/group/${group.id}?contentType=${contentFilter}`} className="flex-1 min-w-0" onClick={batchMode ? handleRowClick : undefined}>
          <h3 className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground mb-1">
            {group.name}
          </h3>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {group.comicCount} {tCollections.works || "部作品"}
            </span>
            <span>
              {new Date(group.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </Link>

        {/* 操作按钮 */}
        {!batchMode && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <Link
              href={`/group/${group.id}?contentType=${contentFilter}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-accent/10 hover:text-accent group-hover:opacity-100"
            >
              <BookOpen className="h-4 w-4" />
            </Link>
            <button
              onClick={() => onDelete(group.id)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
