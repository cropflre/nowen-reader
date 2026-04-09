"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  Database,
  Sparkles,
  Search,
  Play,
  Square,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Brain,
  FileText,
  Tag,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Library,
  Trash2,
  BookOpen,
  CheckSquare,
  Filter,
  Eye,
  X,
  User,
  Zap,
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MessageCircle,
  Bot,
  HelpCircle,
  CircleHelp,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useAIStatus } from "@/hooks/useAIStatus";
import { useScraperStore } from "@/hooks/useScraperStore";
import { GroupMetadataSearch } from "@/components/GroupMetadataSearch";
import GroupDetailPanel from "@/components/GroupDetailPanel";
import {
  loadStats,
  startBatch,
  cancelBatch,
  setBatchMode,
  setScrapeScope,
  setShowResults,
  setUpdateTitle,
  setSkipCover,
  loadLibrary,
  setLibrarySearch,
  setLibraryMetaFilter,
  setLibraryContentType,
  setLibraryPage,
  setLibraryPageSize,
  toggleSelectItem,
  selectAllVisible,
  deselectAll,
  startBatchSelected,
  clearSelectedMetadata,
  setFocusedItem,
  enterBatchEditMode,
  exitBatchEditMode,
  setBatchEditName,
  setLibrarySort,
  toggleAIChat,
  closeAIChat,
  openAIChat,
  startGuide,
  checkAutoStartGuide,
  openHelpPanel,
  closeHelpPanel,
  openCollectionPanel,
  closeCollectionPanel,
  loadCollectionGroups,
  openAddToGroupDialog,
  closeAddToGroupDialog,
  // 文件夹模式
  setViewMode,
  setSelectedFolderPath,
  setFolderSearch,
  loadFolderTree,
  // 系列模式
  loadScraperGroups,
  setScraperGroupFocusedId,
  setScraperGroupSearch,
  setScraperGroupContentType,
  setScraperGroupMetaFilter,
  setScraperGroupSortBy,
  toggleSelectGroup,
  selectAllVisibleGroups,
  clearGroupSelection,
  startGroupBatchScrape,
  cancelGroupBatchScrape,
  clearGroupBatchDone,
  // 批量在线刮削
  openGroupBatchScrapeDialog,
  closeGroupBatchScrapeDialog,
  setGroupBatchScrapeMode,
  toggleGroupBatchScrapeField,
  setGroupBatchScrapeAllFields,
  setGroupBatchScrapeOverwrite,
  setGroupBatchScrapeSyncTags,
  setGroupBatchScrapeSyncToVolumes,
  toggleGroupBatchScrapeSource,
  previewGroupBatchScrape,
  applyGroupBatchScrape,
  clearGroupBatchScrapeResult,
  BATCH_SCRAPE_FIELDS,
  // 系列分页
  setGroupPage,
  setGroupPageSize,
  // 脏数据检测与清理
  detectDirtyData,
  runCleanup,
  fixGroupName,
  clearCleanupResult,
  clearDirtyIssues,
} from "@/lib/scraper-store";
import type { LibraryItem, BatchEditNameEntry, AIChatMessage, CollectionGroup, CollectionGroupDetail, MetadataFolderNode, ViewMode, ScraperGroup, GroupMetaFilter, GroupSortBy, GroupDirtyIssue, GroupCleanupResult, BatchScrapePreviewItem, BatchScrapeResultSummary, MetaFilter, LibrarySortBy } from "@/lib/scraper-store";
import { FolderOpen, FolderPlus, Layers, Plus, Minus, FolderTree, Folder, List } from "lucide-react";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { ResizeDivider } from "@/components/ResizeDivider";
import { useGlobalSyncEvent } from "@/hooks/useSyncEvent";

import {
  filterMetadataFolderTree,
  highlightSearchText,
  MetadataFolderTreeItem,
} from "@/components/scraper/FolderTreeItem";
import { FolderScrapePanel } from "@/components/scraper/FolderScrapePanel";
import { GuideOverlay } from "@/components/scraper/GuideOverlay";
import { HelpPanel } from "@/components/scraper/HelpPanel";
import { AIChatPanel } from "@/components/scraper/AIChatPanel";
import { BatchEditPanel } from "@/components/scraper/BatchEditPanel";
import { DetailPanel } from "@/components/scraper/DetailPanel";
import { CollectionPanel } from "@/components/scraper/CollectionPanel";
import { AddToCollectionDialog } from "@/components/scraper/AddToCollectionDialog";

/* ── 主页面 ── */
export default function ScraperPage() {
  const router = useRouter();
  const t = useTranslation();
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scraperT = (t as any).scraper || {};

  const {
    stats,
    statsLoading,
    batchRunning,
    batchMode,
    scrapeScope,
    updateTitle,
    skipCover,
    currentProgress,
    batchDone,
    completedItems,
    showResults,
    libraryItems,
    libraryLoading,
    librarySearch,
    libraryMetaFilter,
    libraryContentType,
    libraryPage,
    libraryPageSize,
    libraryTotalPages,
    libraryTotal,
    selectedIds,
    focusedItemId,
    batchEditMode,
    batchEditNames,
    batchEditSaving,
    batchEditResults,
    aiRenameLoading,
    librarySortBy,
    librarySortOrder,
    aiChatOpen,
    aiChatMessages,
    aiChatLoading,
    aiChatInput,
    guideActive,
    guideCurrentStep,
    guideDismissed,
    helpPanelOpen,
    helpSearchQuery,
    // 合集管理
    collectionPanelOpen,
    collectionGroups,
    collectionGroupsLoading,
    collectionDetail,
    collectionDetailLoading,
    collectionAutoSuggestions,
    collectionAutoLoading,
    collectionCreateDialog,
    collectionAddToGroupDialog,
    collectionEditingId,
    collectionEditingName,
    // 文件夹模式
    viewMode,
    folderTree,
    folderTreeLoading,
    selectedFolderPath,
    folderSearch,
    folderScrapeRunning,
    folderScrapeProgress,
    folderScrapeDone,
    // 系列模式
    scraperGroups,
    scraperGroupsLoading,
    scraperGroupFocusedId,
    scraperGroupSelectedIds,
    scraperGroupMetaFilter,
    scraperGroupSortBy,
    scraperGroupSortAsc,
    scraperGroupSearch,
    scraperGroupContentType,
    // 系列分页
    groupPage,
    groupPageSize,
    groupBatchRunning,
    groupBatchProgress,
    groupBatchDone,
    // 批量在线刮削
    groupBatchScrapeDialogOpen,
    groupBatchScrapeMode,
    groupBatchScrapeFields,
    groupBatchScrapeOverwrite,
    groupBatchScrapeSyncTags,
    groupBatchScrapeSyncToVolumes,
    groupBatchScrapeSources,
    groupBatchScrapePreview,
    groupBatchScrapePreviewLoading,
    groupBatchScrapeApplying,
    groupBatchScrapeResult,
    // 脏数据检测与清理
    dirtyIssues,
    dirtyStats,
    dirtyDetecting,
    dirtyCleaning,
    cleanupResult,
  } = useScraperStore();

  const isAdmin = user?.role === "admin";
  const { aiConfigured } = useAIStatus();
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  // 首次挂载加载
  useEffect(() => {
    if (!stats && !statsLoading) loadStats();
    loadLibrary();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 监听来自详情页/其他标签页的同步事件，自动刷新列表
  useGlobalSyncEvent((event) => {
    // 刷新列表数据
    loadLibrary();
    loadStats();
    // 如果当前正在查看被修改的漫画，也刷新详情
    if (focusedItemId === event.comicId) {
      loadLibrary();
    }
  }, { ignoreSource: "scraper" });

  // 首次使用引导检测
  useEffect(() => {
    if (stats && !guideDismissed && !guideActive) {
      checkAutoStartGuide();
    }
  }, [stats, guideDismissed, guideActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // 当筛选/分页/搜索变化时重新加载
  useEffect(() => {
    loadLibrary();
  }, [libraryPage, libraryPageSize, libraryMetaFilter, libraryContentType, librarySortBy, librarySortOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => loadLibrary(), 300);
    return () => clearTimeout(timer);
  }, [librarySearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const progressPercent = currentProgress
    ? Math.round((currentProgress.current / currentProgress.total) * 100)
    : 0;

  const metaPercent =
    stats && stats.total > 0
      ? Math.round((stats.withMetadata / stats.total) * 100)
      : 0;

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") loadLibrary();
    },
    []
  );

  // 当前聚焦的详情项
  const focusedItem = focusedItemId
    ? libraryItems.find((item) => item.id === focusedItemId) ?? null
    : null;

  // 当前聚焦的系列
  const focusedGroup = scraperGroupFocusedId
    ? scraperGroups.find((g) => g.id === scraperGroupFocusedId) ?? null
    : null;

  // 系列列表筛选 + 排序 + 分页
  const getFilteredSortedGroups = useCallback((): { items: ScraperGroup[]; total: number; totalPages: number } => {
    let list = [...scraperGroups];
    // 搜索过滤
    if (scraperGroupSearch) {
      const q = scraperGroupSearch.toLowerCase();
      list = list.filter((g) =>
        g.name.toLowerCase().includes(q) ||
        g.author.toLowerCase().includes(q) ||
        g.genre.toLowerCase().includes(q) ||
        g.tags.toLowerCase().includes(q)
      );
    }
    // 元数据状态过滤
    if (scraperGroupMetaFilter === "hasMeta") {
      list = list.filter((g) => g.hasMetadata);
    } else if (scraperGroupMetaFilter === "missingMeta") {
      list = list.filter((g) => !g.hasMetadata);
    }
    // 排序
    list.sort((a, b) => {
      let cmp = 0;
      if (scraperGroupSortBy === "name") {
        cmp = a.name.localeCompare(b.name, "zh");
      } else if (scraperGroupSortBy === "updatedAt") {
        cmp = (a.updatedAt || "").localeCompare(b.updatedAt || "");
      } else if (scraperGroupSortBy === "comicCount") {
        cmp = a.comicCount - b.comicCount;
      }
      return scraperGroupSortAsc ? cmp : -cmp;
    });
    // 分页
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / groupPageSize));
    const start = (groupPage - 1) * groupPageSize;
    const items = list.slice(start, start + groupPageSize);
    return { items, total, totalPages };
  }, [scraperGroups, scraperGroupSearch, scraperGroupMetaFilter, scraperGroupSortBy, scraperGroupSortAsc, groupPage, groupPageSize]);

  // 滚动引用
  const listRef = useRef<HTMLDivElement>(null);

  // 右侧面板可拖拽宽度
  const {
    width: rightPanelWidth,
    isDragging: isResizing,
    handleMouseDown: handleResizeMouseDown,
    resetWidth: resetRightPanelWidth,
  } = useResizablePanel({
    storageKey: "scraper-right-panel-width",
    defaultWidth: 520,
    minWidth: 360,
    maxWidth: 800,
    side: "right",
  });

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* ═══════════ Header ═══════════ */}
      <header data-guide="header" className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-2xl flex-shrink-0">
        <div className="mx-auto flex h-14 sm:h-16 max-w-[1800px] items-center gap-3 px-3 sm:px-6">
          <button
            onClick={() => router.push("/")}
            className="group flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-border/50 text-muted transition-all hover:border-accent/40 hover:text-accent hover:bg-accent/5"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-purple-500/20">
              <Database className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-foreground">
                {scraperT.title || "元数据刮削"}
              </h1>
              <p className="hidden sm:block text-xs text-muted -mt-0.5">
                {scraperT.subtitle || "自动获取封面、简介、标签等信息"}
              </p>
            </div>
          </div>

          {/* 统计信息 */}
          <div className="ml-auto flex items-center gap-3">
            {stats && (
              <div className="hidden sm:flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted" />
                  <span className="text-muted">{scraperT.statsTotal || "总计"}</span>
                  <span className="font-bold text-foreground">{stats.total}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-bold text-emerald-500">{stats.withMetadata}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="font-bold text-amber-500">{stats.missing}</span>
                </div>
                {/* 进度条 */}
                <div className="w-20 h-1.5 rounded-full bg-border/30 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all duration-700"
                    style={{ width: `${metaPercent}%` }}
                  />
                </div>
                <span className="font-medium text-accent">{metaPercent}%</span>
              </div>
            )}
            <button
              onClick={loadStats}
              disabled={statsLoading}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════ 主体：左右分栏 ═══════════ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── 左侧面板：书库列表 ── */}
        <div className={`flex-1 flex flex-col min-w-0 ${isResizing ? '' : 'border-r border-border/30'}`}>
          {/* 搜索 & 筛选 */}
          <div data-guide="filter-bar" className="flex-shrink-0 p-3 sm:p-4 space-y-3 border-b border-border/20 bg-card/30">
            {/* 视图模式切换 + 搜索框 */}
            <div className="flex items-center gap-2">
              {/* 模式切换 */}
              <div className="flex rounded-lg border border-border/40 overflow-hidden flex-shrink-0">
                <button
                  onClick={() => setViewMode("list")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    viewMode === "list"
                      ? "bg-accent text-white"
                      : "text-muted hover:text-foreground hover:bg-white/5"
                  }`}
                  title="列表模式"
                >
                  <List className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">列表</span>
                </button>
                <button
                  onClick={() => setViewMode("folder")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    viewMode === "folder"
                      ? "bg-amber-500 text-white"
                      : "text-muted hover:text-foreground hover:bg-white/5"
                  }`}
                  title="文件夹模式"
                >
                  <FolderTree className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">文件夹</span>
                </button>
                <button
                  onClick={() => setViewMode("group")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    viewMode === "group"
                      ? "bg-purple-500 text-white"
                      : "text-muted hover:text-foreground hover:bg-white/5"
                  }`}
                  title="系列模式"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">系列</span>
                </button>
              </div>
              {/* 搜索框 */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <input
                  type="text"
                  value={viewMode === "folder" ? folderSearch : viewMode === "group" ? scraperGroupSearch : librarySearch}
                  onChange={(e) => viewMode === "folder" ? setFolderSearch(e.target.value) : viewMode === "group" ? setScraperGroupSearch(e.target.value) : setLibrarySearch(e.target.value)}
                  onKeyDown={viewMode === "list" ? handleSearchKeyDown : undefined}
                  placeholder={viewMode === "folder" ? "搜索文件夹或文件名..." : viewMode === "group" ? "搜索系列名称..." : (scraperT.libSearchPlaceholder || "搜索书名、文件名...")}
                  className="w-full rounded-xl bg-card-hover/50 pl-10 pr-4 py-2 text-sm text-foreground placeholder-muted/50 outline-none border border-border/40 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
            </div>

            {/* 筛选（仅列表模式） */}
            {viewMode === "list" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(["all", "missing", "with"] as MetaFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setLibraryMetaFilter(f)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                    libraryMetaFilter === f
                      ? f === "missing" ? "bg-amber-500 text-white" : f === "with" ? "bg-emerald-500 text-white" : "bg-accent text-white"
                      : "bg-card-hover text-muted hover:text-foreground"
                  }`}
                >
                  {f === "all" && (scraperT.libFilterAll || "全部")}
                  {f === "missing" && (scraperT.libFilterMissing || "缺失")}
                  {f === "with" && (scraperT.libFilterWith || "已有")}
                </button>
              ))}

              <div className="h-3 w-px bg-border/40 mx-0.5" />

              {(["comic", "novel"] as string[]).map((ct) => (
                <button
                  key={ct}
                  onClick={() => setLibraryContentType(ct)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                    libraryContentType === ct
                      ? "bg-purple-500 text-white"
                      : "bg-card-hover text-muted hover:text-foreground"
                  }`}
                >
                  {ct === "comic" && (scraperT.libTypeComic || "漫画")}
                  {ct === "novel" && (scraperT.libTypeNovel || "小说")}
                </button>
              ))}

              <div className="h-3 w-px bg-border/40 mx-0.5" />

              {/* 排序 */}
              {(([
                ["title", scraperT.sortByTitle || "名称"],
                ["fileSize", scraperT.sortByFileSize || "大小"],
                ["updatedAt", scraperT.sortByUpdatedAt || "更新时间"],
                ["metaStatus", scraperT.sortByMetaStatus || "刮削状态"],
              ] as [LibrarySortBy, string][]).map(([field, label]) => {
                const isActive = librarySortBy === field;
                return (
                  <button
                    key={field}
                    onClick={() => setLibrarySort(field)}
                    className={`flex items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                      isActive
                        ? "bg-sky-500 text-white"
                        : "bg-card-hover text-muted hover:text-foreground"
                    }`}
                    title={`${scraperT.sortBy || "排序"}: ${label}`}
                  >
                    {label}
                    {isActive && (
                      librarySortOrder === "asc"
                        ? <ArrowUp className="h-3 w-3 ml-0.5" />
                        : <ArrowDown className="h-3 w-3 ml-0.5" />
                    )}
                    {!isActive && <ArrowUpDown className="h-2.5 w-2.5 ml-0.5 opacity-40" />}
                  </button>
                );
              }))}
            </div>
            )}

            {/* 多选操作栏 */}
            {isAdmin && viewMode === "list" && (
              <div data-guide="select-bar" className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => (selectedIds.size === libraryItems.length && libraryItems.length > 0 ? deselectAll() : selectAllVisible())}
                    className="flex items-center gap-1 rounded-lg bg-card-hover px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
                  >
                    <CheckSquare className="h-3 w-3" />
                    {selectedIds.size > 0 ? (scraperT.libDeselectAll || "取消") : (scraperT.libSelectAll || "全选")}
                  </button>
                  {selectedIds.size > 0 && (
                    <span className="text-[11px] text-accent font-medium">
                      {selectedIds.size} {scraperT.libItems || "项"}
                    </span>
                  )}
                </div>

                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={enterBatchEditMode}
                      disabled={batchRunning || batchEditMode}
                      className="flex items-center gap-1 rounded-lg bg-purple-500/10 px-2 py-1 text-[11px] font-medium text-purple-400 transition-all disabled:opacity-50 hover:bg-purple-500/20"
                    >
                      <Pencil className="h-3 w-3" />
                      {scraperT.batchEditBtn || "批量命名"}
                    </button>
                    <button
                      onClick={startBatchSelected}
                      disabled={batchRunning}
                      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-white transition-all disabled:opacity-50 ${
                        batchMode === "ai"
                          ? "bg-gradient-to-r from-violet-500 to-purple-600"
                          : "bg-accent hover:bg-accent-hover"
                      }`}
                    >
                      <Play className="h-3 w-3" />
                      {scraperT.libScrapeSelected || "刮削"}
                    </button>
                    <button
                      onClick={openAddToGroupDialog}
                      className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Layers className="h-3 w-3" />
                      {scraperT.collectionAddSelected || "加入合集"}
                    </button>
                    <button
                      onClick={clearSelectedMetadata}
                      className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      {scraperT.libClearMeta || "清除"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 书库列表 / 文件夹树 / 系列列表 */}
          {viewMode === "folder" ? (
            /* ── 文件夹树形视图 ── */
            <div className="flex-1 overflow-y-auto min-h-0 p-3">
              {folderTreeLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                </div>
              ) : !folderTree || folderTree.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">暂无文件夹层级数据</div>
              ) : (
                <div className="space-y-0.5">
                  {filterMetadataFolderTree(folderTree, folderSearch).map((node) => (
                    <MetadataFolderTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedFolderPath}
                      onSelect={setSelectedFolderPath}
                      searchTerm={folderSearch}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : viewMode === "group" ? (
            /* ── 系列列表视图 ── */
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
              {/* 系列筛选/排序/批量操作栏 */}
              <div className="flex-shrink-0 border-b border-border/20 px-3 py-2 space-y-2">
                {/* 元数据状态筛选 + 排序 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(["all", "hasMeta", "missingMeta"] as GroupMetaFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setScraperGroupMetaFilter(f)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        scraperGroupMetaFilter === f
                          ? f === "hasMeta" ? "bg-emerald-500/20 text-emerald-400"
                            : f === "missingMeta" ? "bg-amber-500/20 text-amber-400"
                            : "bg-accent/20 text-accent"
                          : "text-muted hover:text-foreground hover:bg-white/5"
                      }`}
                    >
                      {f === "all" ? "全部" : f === "hasMeta" ? "✓ 已有" : "⚠ 缺失"}
                    </button>
                  ))}
                  {/* 内容类型筛选 */}
                  <div className="h-3 w-px bg-border/40 mx-0.5" />
                  {(["", "comic", "novel"] as string[]).map((ct) => (
                    <button
                      key={ct || "all-ct"}
                      onClick={() => setScraperGroupContentType(ct)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        scraperGroupContentType === ct
                          ? ct === "novel" ? "bg-emerald-500/20 text-emerald-400"
                            : ct === "comic" ? "bg-blue-500/20 text-blue-400"
                            : "bg-accent/20 text-accent"
                          : "text-muted/60 hover:text-foreground hover:bg-white/5"
                      }`}
                    >
                      {ct === "" ? "全部类型" : ct === "comic" ? "📖 漫画" : "📚 小说"}
                    </button>
                  ))}
                  <div className="flex-1" />
                  {/* 排序 */}
                  {(["name", "updatedAt", "comicCount"] as GroupSortBy[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setScraperGroupSortBy(s)}
                      className={`flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[10px] transition-colors ${
                        scraperGroupSortBy === s ? "text-accent" : "text-muted/60 hover:text-muted"
                      }`}
                      title={s === "name" ? "按名称排序" : s === "updatedAt" ? "按更新时间排序" : "按卷数排序"}
                    >
                      {s === "name" ? "名称" : s === "updatedAt" ? "更新" : "卷数"}
                      {scraperGroupSortBy === s && (
                        scraperGroupSortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      )}
                    </button>
                  ))}
                </div>
                {/* 批量操作栏 */}
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const visibleIds = getFilteredSortedGroups().items.map((g) => g.id);
                        selectAllVisibleGroups(visibleIds);
                      }}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      <CheckSquare className="h-3 w-3" />
                      {scraperGroupSelectedIds.size > 0
                        ? `已选 ${scraperGroupSelectedIds.size}`
                        : "全选"}
                    </button>
                    {scraperGroupSelectedIds.size > 0 && (
                      <>
                        <button
                          onClick={() => clearGroupSelection()}
                          className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => startGroupBatchScrape(Array.from(scraperGroupSelectedIds))}
                          disabled={groupBatchRunning}
                          className="flex items-center gap-1 rounded-md bg-purple-500/20 px-2.5 py-1 text-[11px] font-medium text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
                        >
                          <Brain className="h-3 w-3" />
                          AI 批量刮削 ({scraperGroupSelectedIds.size})
                        </button>
                        <button
                          onClick={() => openGroupBatchScrapeDialog("online")}
                          disabled={groupBatchRunning || groupBatchScrapeApplying}
                          className="flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                        >
                          <Database className="h-3 w-3" />
                          批量在线刮削 ({scraperGroupSelectedIds.size})
                        </button>
                      </>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={() => detectDirtyData()}
                      disabled={dirtyDetecting}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                      title="检测脏数据"
                    >
                      {dirtyDetecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
                      <span className="hidden sm:inline">检测</span>
                    </button>
                    <button
                      onClick={() => loadScraperGroups()}
                      disabled={scraperGroupsLoading}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      <RefreshCw className={`h-3 w-3 ${scraperGroupsLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                )}
                {/* 批量刮削进度 */}
                {groupBatchRunning && groupBatchProgress && (
                  <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-purple-400 font-medium flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        AI 刮削中... {groupBatchProgress.current}/{groupBatchProgress.total}
                      </span>
                      <button
                        onClick={() => cancelGroupBatchScrape()}
                        className="rounded px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                    <div className="text-[10px] text-muted truncate">正在处理: {groupBatchProgress.currentName}</div>
                    <div className="h-1 rounded-full bg-purple-500/20 overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all duration-300"
                        style={{ width: `${(groupBatchProgress.current / groupBatchProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* 批量刮削完成 */}
                {groupBatchDone && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 flex items-center justify-between">
                    <span className="text-[11px] text-emerald-400">
                      ✓ 刮削完成: {groupBatchDone.success}/{groupBatchDone.total} 成功
                      {groupBatchDone.failed > 0 && <span className="text-amber-400 ml-1">({groupBatchDone.failed} 失败)</span>}
                    </span>
                    <button
                      onClick={() => clearGroupBatchDone()}
                      className="rounded p-0.5 text-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {/* 脏数据检测结果 */}
                {dirtyStats && dirtyIssues.length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3" />
                        发现 {dirtyIssues.length} 个数据问题
                      </span>
                      <button
                        onClick={() => clearDirtyIssues()}
                        className="rounded p-0.5 text-muted hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {/* 问题统计 */}
                    <div className="flex flex-wrap gap-1.5">
                      {(dirtyStats.empty_group ?? 0) > 0 && (
                        <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                          空系列 {dirtyStats.empty_group}
                        </span>
                      )}
                      {(dirtyStats.orphan_link ?? 0) > 0 && (
                        <span className="rounded-md bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-400">
                          孤立关联 {dirtyStats.orphan_link}
                        </span>
                      )}
                      {(dirtyStats.dirty_name ?? 0) > 0 && (
                        <span className="rounded-md bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">
                          脏名称 {dirtyStats.dirty_name}
                        </span>
                      )}
                      {(dirtyStats.duplicate_name ?? 0) > 0 && (
                        <span className="rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400">
                          疑似重复 {dirtyStats.duplicate_name}
                        </span>
                      )}
                    </div>
                    {/* 问题详情列表 */}
                    <div className="max-h-[200px] overflow-y-auto space-y-1">
                      {dirtyIssues.map((issue, idx) => (
                        <div key={idx} className="rounded-md bg-card/50 p-2 text-[10px] space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-foreground/80 leading-relaxed">{issue.description}</span>
                            {issue.type === "dirty_name" && issue.cleanedName && (
                              <button
                                onClick={() => fixGroupName(issue.groupId, issue.cleanedName!)}
                                className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                              >
                                修复
                              </button>
                            )}
                          </div>
                          <div className="text-muted/50">{issue.suggestion}</div>
                        </div>
                      ))}
                    </div>
                    {/* 一键清理按钮 */}
                    {dirtyIssues.some((i) => i.autoFixable) && (
                      <button
                        onClick={() => runCleanup(["full"])}
                        disabled={dirtyCleaning}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-[11px] font-medium text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                      >
                        {dirtyCleaning ? (
                          <><Loader2 className="h-3 w-3 animate-spin" /> 清理中...</>
                        ) : (
                          <><Trash2 className="h-3 w-3" /> 一键清理可自动修复的问题</>
                        )}
                      </button>
                    )}
                  </div>
                )}
                {/* 脏数据无问题 */}
                {dirtyStats && dirtyIssues.length === 0 && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 flex items-center justify-between">
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle className="h-3 w-3" />
                      数据质量良好，未发现问题
                    </span>
                    <button
                      onClick={() => clearDirtyIssues()}
                      className="rounded p-0.5 text-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {/* 清理完成结果 */}
                {cleanupResult && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-emerald-400">✓ 清理完成</span>
                      <button
                        onClick={() => clearCleanupResult()}
                        className="rounded p-0.5 text-muted hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      {cleanupResult.emptyGroupsDeleted > 0 && (
                        <span className="text-emerald-400">删除空系列 {cleanupResult.emptyGroupsDeleted}</span>
                      )}
                      {cleanupResult.orphanLinksRemoved > 0 && (
                        <span className="text-emerald-400">清理孤立关联 {cleanupResult.orphanLinksRemoved}</span>
                      )}
                      {cleanupResult.dirtyNamesFixed > 0 && (
                        <span className="text-emerald-400">修复名称 {cleanupResult.dirtyNamesFixed}</span>
                      )}
                      {cleanupResult.emptyGroupsDeleted === 0 && cleanupResult.orphanLinksRemoved === 0 && cleanupResult.dirtyNamesFixed === 0 && (
                        <span className="text-muted/60">没有需要清理的数据</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* 系列列表 */}
              {scraperGroupsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                </div>
              ) : scraperGroups.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">暂无系列数据，请先在主页创建系列</div>
              ) : (() => {
                const { items: filtered, total: groupTotal, totalPages: groupTotalPages } = getFilteredSortedGroups();
                return filtered.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted">没有匹配的系列</div>
                ) : (
                  <>
                  <div className="flex-1 overflow-y-auto divide-y divide-border/10">
                    {filtered.map((group) => {
                      const isFocused = scraperGroupFocusedId === group.id;
                      const isSelected = scraperGroupSelectedIds.has(group.id);
                      return (
                        <div
                          key={group.id}
                          className={`flex items-center gap-2.5 px-3 sm:px-4 py-2.5 transition-colors cursor-pointer ${
                            isFocused
                              ? "bg-purple-500/10 border-l-2 border-l-purple-500"
                              : isSelected
                                ? "bg-purple-500/5 border-l-2 border-l-purple-500/40"
                                : "hover:bg-card-hover/30 border-l-2 border-l-transparent"
                          }`}
                          onClick={() => setScraperGroupFocusedId(isFocused ? null : group.id)}
                        >
                          {/* 多选框 */}
                          {isAdmin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleSelectGroup(group.id); }}
                              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors ${
                                isSelected
                                  ? "border-purple-500 bg-purple-500 text-white"
                                  : "border-border/40 text-transparent hover:border-muted"
                              }`}
                            >
                              {isSelected && <CheckCircle className="h-3 w-3" />}
                            </button>
                          )}
                          {/* 封面 */}
                          <div className="relative h-12 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-border/30 bg-muted/10">
                            {group.coverUrl ? (
                              <Image
                                src={group.coverUrl}
                                alt=""
                                fill
                                className="object-cover"
                                sizes="36px"
                                unoptimized
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Layers className="h-4 w-4 text-muted/40" />
                              </div>
                            )}
                          </div>
                          {/* 信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-foreground leading-tight truncate" title={group.name}>{group.name}</div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {group.author && (
                                <span className="text-[11px] text-muted/60 truncate max-w-[100px]">{group.author}</span>
                              )}
                              <span className="text-[10px] text-muted/40">{group.comicCount} 卷</span>
                              {group.contentType === "novel" && (
                                <span className="text-[10px] text-emerald-400/70">📚</span>
                              )}
                              {group.genre && (
                                <span className="text-[10px] text-purple-400/60 truncate max-w-[80px]">{group.genre}</span>
                              )}
                              {group.updatedAt && (
                                <span className="text-[10px] text-muted/30">{new Date(group.updatedAt).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          {/* 元数据状态 */}
                          <div className="flex-shrink-0">
                            {group.hasMetadata ? (
                              <CheckCircle className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-amber-400" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* 系列分页 */}
                  {groupTotalPages >= 1 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-border/20 px-3 sm:px-4 py-2.5 flex-shrink-0">
                      {/* 左侧: 总数 + 每页条数 */}
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-muted whitespace-nowrap">
                          共 {groupTotal} 个系列
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-muted whitespace-nowrap">每页</span>
                          <select
                            value={groupPageSize}
                            onChange={(e) => setGroupPageSize(Number(e.target.value))}
                            className="rounded-md border border-border/40 bg-card-hover/50 px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-accent/50 transition-colors cursor-pointer"
                          >
                            {[20, 50, 100].map((size) => (
                              <option key={size} value={size}>{size}</option>
                            ))}
                          </select>
                          <span className="text-[11px] text-muted whitespace-nowrap">条</span>
                        </div>
                      </div>

                      {/* 右侧: 页码导航 + 跳转 */}
                      <div className="flex items-center gap-1">
                        {/* 首页 */}
                        <button
                          disabled={groupPage <= 1}
                          onClick={() => setGroupPage(1)}
                          className="flex h-7 items-center justify-center rounded-lg px-1.5 text-[11px] text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                          title="首页"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                          <ChevronLeft className="h-3.5 w-3.5 -ml-2" />
                        </button>
                        {/* 上一页 */}
                        <button
                          disabled={groupPage <= 1}
                          onClick={() => setGroupPage(groupPage - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>

                        {/* 页码按钮 */}
                        {(() => {
                          const pages: (number | string)[] = [];
                          const total = groupTotalPages;
                          const current = groupPage;

                          if (total <= 7) {
                            for (let i = 1; i <= total; i++) pages.push(i);
                          } else {
                            pages.push(1);
                            if (current > 3) pages.push("...");
                            const start = Math.max(2, current - 1);
                            const end = Math.min(total - 1, current + 1);
                            for (let i = start; i <= end; i++) pages.push(i);
                            if (current < total - 2) pages.push("...");
                            pages.push(total);
                          }

                          return pages.map((p, idx) =>
                            typeof p === "string" ? (
                              <span key={`g-ellipsis-${idx}`} className="flex h-7 w-5 items-center justify-center text-[11px] text-muted">
                                ···
                              </span>
                            ) : (
                              <button
                                key={p}
                                onClick={() => setGroupPage(p)}
                                className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1 text-[11px] font-medium transition-all ${
                                  p === current
                                    ? "bg-accent text-white shadow-sm"
                                    : "text-muted hover:bg-card-hover hover:text-foreground"
                                }`}
                              >
                                {p}
                              </button>
                            )
                          );
                        })()}

                        {/* 下一页 */}
                        <button
                          disabled={groupPage >= groupTotalPages}
                          onClick={() => setGroupPage(groupPage + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        {/* 末页 */}
                        <button
                          disabled={groupPage >= groupTotalPages}
                          onClick={() => setGroupPage(groupTotalPages)}
                          className="flex h-7 items-center justify-center rounded-lg px-1.5 text-[11px] text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                          title="末页"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                          <ChevronRight className="h-3.5 w-3.5 -ml-2" />
                        </button>

                        {/* 分隔 */}
                        <div className="h-4 w-px bg-border/30 mx-1" />

                        {/* 页码跳转 */}
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-muted whitespace-nowrap">跳至</span>
                          <input
                            type="number"
                            min={1}
                            max={groupTotalPages}
                            defaultValue={groupPage}
                            key={`gp-${groupPage}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const val = parseInt((e.target as HTMLInputElement).value, 10);
                                if (!isNaN(val) && val >= 1 && val <= groupTotalPages) {
                                  setGroupPage(val);
                                }
                              }
                            }}
                            onBlur={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val) && val >= 1 && val <= groupTotalPages && val !== groupPage) {
                                setGroupPage(val);
                              }
                            }}
                            className="w-12 rounded-md border border-border/40 bg-card-hover/50 px-1.5 py-0.5 text-center text-[11px] text-foreground outline-none focus:border-accent/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-[11px] text-muted whitespace-nowrap">页</span>
                        </div>
                      </div>
                    </div>
                  )}
                  </>
                );
              })()}
            </div>
          ) : (<>
          {/* 书库列表 */}
          <div ref={listRef} data-guide="book-list" className="flex-1 overflow-y-auto min-h-0">
            {libraryLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              </div>
            ) : libraryItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted">{scraperT.libEmpty || "没有找到匹配的内容"}</div>
            ) : (
              <div className="divide-y divide-border/10">
                {libraryItems.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  const isFocused = focusedItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2.5 px-3 sm:px-4 py-2.5 transition-colors cursor-pointer ${
                        isFocused
                          ? "bg-accent/10 border-l-2 border-l-accent"
                          : isSelected
                            ? "bg-accent/5"
                            : "hover:bg-card-hover/30"
                      } ${!isFocused ? "border-l-2 border-l-transparent" : ""}`}
                      onClick={() => setFocusedItem(isFocused ? null : item.id)}
                    >
                      {/* 多选框 */}
                      {isAdmin && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectItem(item.id);
                          }}
                          className={`flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded border-[1.5px] transition-all cursor-pointer ${
                            isSelected ? "border-accent bg-accent" : "border-muted/40 hover:border-muted/60"
                          }`}
                        >
                          {isSelected && (
                            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      )}

                      {/* 封面 */}
                      <div className="relative h-11 w-8 flex-shrink-0 overflow-hidden rounded-lg border border-border/30 bg-muted/10">
                        <Image
                          src={`/api/comics/${item.id}/thumbnail`}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="32px"
                          unoptimized
                        />
                      </div>

                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        {batchEditMode && batchEditNames.has(item.id) ? (
                          /* 批量编辑模式 - 内联输入框 */
                          <input
                            type="text"
                            value={batchEditNames.get(item.id)!.newTitle}
                            onChange={(e) => {
                              e.stopPropagation();
                              setBatchEditName(item.id, e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            disabled={batchEditSaving}
                            className={`w-full rounded-md px-1.5 py-0.5 text-[13px] font-medium text-foreground outline-none border transition-all disabled:opacity-50 ${
                              batchEditNames.get(item.id)!.newTitle.trim() !== batchEditNames.get(item.id)!.oldTitle
                                ? "bg-accent/5 border-accent/40 focus:border-accent"
                                : "bg-transparent border-transparent hover:border-border/40 focus:border-border/60 focus:bg-card-hover/30"
                            }`}
                          />
                        ) : (
                        <div className="text-[13px] font-medium text-foreground leading-tight overflow-x-auto whitespace-nowrap scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }} title={item.title}>{item.title}</div>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {item.author && (
                            <span className="text-[10px] text-muted/70 truncate max-w-[120px]">{item.author}</span>
                          )}
                        </div>
                      </div>

                      {/* 状态标识 */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.contentType === "novel" ? (
                          <BookOpen className="h-3 w-3 text-blue-400" />
                        ) : (
                          <FileText className="h-3 w-3 text-orange-400" />
                        )}
                        {item.hasMetadata ? (
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 分页 — 固定在左侧面板底部 */}
          {libraryTotalPages >= 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-border/20 px-3 sm:px-4 py-2.5 flex-shrink-0">
              {/* 左侧: 总数 + 每页条数 */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted whitespace-nowrap">
                  {scraperT.libTotalItems || "共"} {libraryTotal} {scraperT.libItems || "项"}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted whitespace-nowrap">{scraperT.paginationPerPage || "每页"}</span>
                  <select
                    value={libraryPageSize}
                    onChange={(e) => setLibraryPageSize(Number(e.target.value))}
                    className="rounded-md border border-border/40 bg-card-hover/50 px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-accent/50 transition-colors cursor-pointer"
                  >
                    {[20, 50, 100].map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted whitespace-nowrap">{scraperT.paginationUnit || "条"}</span>
                </div>
              </div>

              {/* 右侧: 页码导航 + 跳转 */}
              <div className="flex items-center gap-1">
                {/* 首页 */}
                <button
                  disabled={libraryPage <= 1}
                  onClick={() => setLibraryPage(1)}
                  className="flex h-7 items-center justify-center rounded-lg px-1.5 text-[11px] text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                  title={scraperT.paginationFirst || "首页"}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <ChevronLeft className="h-3.5 w-3.5 -ml-2" />
                </button>
                {/* 上一页 */}
                <button
                  disabled={libraryPage <= 1}
                  onClick={() => setLibraryPage(libraryPage - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>

                {/* 页码按钮 */}
                {(() => {
                  const pages: (number | string)[] = [];
                  const total = libraryTotalPages;
                  const current = libraryPage;

                  if (total <= 7) {
                    for (let i = 1; i <= total; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (current > 3) pages.push("...");
                    const start = Math.max(2, current - 1);
                    const end = Math.min(total - 1, current + 1);
                    for (let i = start; i <= end; i++) pages.push(i);
                    if (current < total - 2) pages.push("...");
                    pages.push(total);
                  }

                  return pages.map((p, idx) =>
                    typeof p === "string" ? (
                      <span key={`ellipsis-${idx}`} className="flex h-7 w-5 items-center justify-center text-[11px] text-muted">
                        ···
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setLibraryPage(p)}
                        className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1 text-[11px] font-medium transition-all ${
                          p === current
                            ? "bg-accent text-white shadow-sm"
                            : "text-muted hover:bg-card-hover hover:text-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}

                {/* 下一页 */}
                <button
                  disabled={libraryPage >= libraryTotalPages}
                  onClick={() => setLibraryPage(libraryPage + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                {/* 末页 */}
                <button
                  disabled={libraryPage >= libraryTotalPages}
                  onClick={() => setLibraryPage(libraryTotalPages)}
                  className="flex h-7 items-center justify-center rounded-lg px-1.5 text-[11px] text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-30 transition-colors"
                  title={scraperT.paginationLast || "末页"}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                  <ChevronRight className="h-3.5 w-3.5 -ml-2" />
                </button>

                {/* 分隔 */}
                <div className="h-4 w-px bg-border/30 mx-1" />

                {/* 页码跳转 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted whitespace-nowrap">{scraperT.paginationGoto || "跳至"}</span>
                  <input
                    type="number"
                    min={1}
                    max={libraryTotalPages}
                    defaultValue={libraryPage}
                    key={libraryPage}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = parseInt((e.target as HTMLInputElement).value, 10);
                        if (!isNaN(val) && val >= 1 && val <= libraryTotalPages) {
                          setLibraryPage(val);
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 1 && val <= libraryTotalPages && val !== libraryPage) {
                        setLibraryPage(val);
                      }
                    }}
                    className="w-12 rounded-md border border-border/40 bg-card-hover/50 px-1.5 py-0.5 text-center text-[11px] text-foreground outline-none focus:border-accent/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[11px] text-muted whitespace-nowrap">{scraperT.paginationPage || "页"}</span>
                </div>
              </div>
            </div>
          )}
        </>)}
        </div>

        {/* ── 可拖拽分隔条 ── */}
        <div className="hidden md:flex h-full">
          <ResizeDivider
            isDragging={isResizing}
            onMouseDown={handleResizeMouseDown}
            onReset={resetRightPanelWidth}
          />
        </div>

        {/* ── 右侧面板：详情 / 刮削控制 / 进度 / AI聊天 / 帮助 ── */}
        <div data-guide="scrape-panel" className="flex-shrink-0 hidden md:flex flex-col bg-card/20 overflow-hidden" style={{ width: rightPanelWidth }}>
          {helpPanelOpen ? (
            /* ── 帮助面板 ── */
            <HelpPanel
              scraperT={scraperT}
              searchQuery={helpSearchQuery}
              onClose={closeHelpPanel}
            />
          ) : collectionPanelOpen ? (
            /* ── 合集管理面板 ── */
            <CollectionPanel
              scraperT={scraperT}
              groups={collectionGroups}
              groupsLoading={collectionGroupsLoading}
              detail={collectionDetail}
              detailLoading={collectionDetailLoading}
              autoSuggestions={collectionAutoSuggestions}
              autoLoading={collectionAutoLoading}
              createDialogOpen={collectionCreateDialog}
              editingId={collectionEditingId}
              editingName={collectionEditingName}
              selectedIds={selectedIds}
              onClose={closeCollectionPanel}
            />
          ) : aiChatOpen ? (
            /* ── AI 聊天模式 ── */
            <AIChatPanel
              messages={aiChatMessages}
              loading={aiChatLoading}
              input={aiChatInput}
              scraperT={scraperT}
              onClose={closeAIChat}
            />
          ) : batchEditMode ? (
            /* ── 批量编辑模式 ── */
            <BatchEditPanel
              entries={batchEditNames}
              scraperT={scraperT}
              saving={batchEditSaving}
              results={batchEditResults}
              aiLoading={aiRenameLoading}
              aiConfigured={aiConfigured}
              onExit={exitBatchEditMode}
            />
          ) : focusedGroup ? (
            /* ── 系列详情模式（支持手动编辑） ── */
            <GroupDetailPanel
              key={focusedGroup.id}
              group={focusedGroup}
              onClose={() => setScraperGroupFocusedId(null)}
            />
          ) : focusedItem ? (
            /* ── 详情模式 ── */
            <DetailPanel
              key={`${focusedItem.id}-${detailRefreshKey}`}
              item={focusedItem}
              scraperT={scraperT}
              isAdmin={isAdmin}
              onClose={() => setFocusedItem(null)}
              onRefresh={() => setDetailRefreshKey((k) => k + 1)}
            />
          ) : (
            /* ── 刮削控制 + 进度模式 ── */
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 批量操作面板 */}
              {isAdmin && (
                <div className="rounded-xl border border-border/40 bg-card p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent" />
                    <h3 className="text-sm font-semibold text-foreground">{scraperT.operationTitle || "批量刮削"}</h3>
                  </div>

                  {/* 模式选择 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={batchRunning}
                      onClick={() => setBatchMode("standard")}
                      className={`flex items-center gap-2 rounded-lg border p-3 transition-all text-left ${
                        batchMode === "standard"
                          ? "border-accent/50 bg-accent/5 ring-1 ring-accent/20"
                          : "border-border/40 hover:border-border/60"
                      } disabled:opacity-50`}
                    >
                      <Search className="h-4 w-4 text-accent flex-shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-foreground">{scraperT.modeStandard || "标准"}</div>
                        <div className="text-[10px] text-muted mt-0.5">{scraperT.modeStandardShort || "在线源搜索匹配"}</div>
                      </div>
                    </button>
                    <button
                      disabled={batchRunning || !aiConfigured}
                      onClick={() => setBatchMode("ai")}
                      className={`flex items-center gap-2 rounded-lg border p-3 transition-all text-left ${
                        batchMode === "ai"
                          ? "border-purple-500/50 bg-purple-500/5 ring-1 ring-purple-500/20"
                          : "border-border/40 hover:border-border/60"
                      } disabled:opacity-50`}
                      title={!aiConfigured ? (scraperT.aiNotConfiguredHint || "请先在设置中配置AI服务") : undefined}
                    >
                      <Brain className="h-4 w-4 text-purple-500 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-foreground">{scraperT.modeAI || "AI 智能"}</div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {!aiConfigured
                            ? (scraperT.aiNotConfiguredShort || "需配置AI")
                            : (scraperT.modeAIShort || "AI识别+搜索+补全")}
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* 范围 + 选项 */}
                  <div className="flex items-center gap-2">
                    <button
                      disabled={batchRunning}
                      onClick={() => setScrapeScope("missing")}
                      className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
                        scrapeScope === "missing" ? "bg-accent text-white" : "bg-card-hover text-muted"
                      } disabled:opacity-50`}
                    >
                      <AlertCircle className="h-3 w-3" />
                      {scraperT.scopeMissing || "仅缺失"}
                    </button>
                    <button
                      disabled={batchRunning}
                      onClick={() => setScrapeScope("all")}
                      className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
                        scrapeScope === "all" ? "bg-accent text-white" : "bg-card-hover text-muted"
                      } disabled:opacity-50`}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {scraperT.scopeAll || "全部"}
                    </button>
                  </div>

                  {/* 更新书名 toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">{scraperT.updateTitleLabel || "同时更新书名"}</span>
                    <button
                      disabled={batchRunning}
                      onClick={() => setUpdateTitle(!updateTitle)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                        updateTitle ? "bg-accent" : "bg-border"
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${updateTitle ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>

                  {/* P2-A: 不替换封面 toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">{scraperT.skipCoverLabel || "不替换书籍封面"}</span>
                    <button
                      disabled={batchRunning}
                      onClick={() => setSkipCover(!skipCover)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                        skipCover ? "bg-accent" : "bg-border"
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${skipCover ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>

                  {/* 开始/停止按钮 */}
                  {!batchRunning ? (
                    <button
                      onClick={startBatch}
                      disabled={!stats || stats.total === 0}
                      className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-white transition-all shadow-lg disabled:opacity-50 ${
                        batchMode === "ai"
                          ? "bg-gradient-to-r from-violet-500 to-purple-600 shadow-purple-500/25"
                          : "bg-accent shadow-accent/25"
                      }`}
                    >
                      <Zap className="h-4 w-4" />
                      {scraperT.startBtn || "开始刮削"}
                    </button>
                  ) : (
                    <button
                      onClick={cancelBatch}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-500/25"
                    >
                      <Square className="h-4 w-4" />
                      {scraperT.stopBtn || "停止"}
                    </button>
                  )}
                </div>
              )}

              {/* 实时进度 */}
              {(batchRunning || batchDone) && (
                <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {batchRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      ) : (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      )}
                      <h3 className="text-sm font-semibold text-foreground">
                        {batchRunning ? (scraperT.progressTitle || "进度") : (scraperT.progressDone || "完成")}
                      </h3>
                    </div>
                    {currentProgress && batchRunning && (
                      <span className="text-xs text-muted">{currentProgress.current}/{currentProgress.total}</span>
                    )}
                  </div>

                  {/* 进度条 */}
                  {batchRunning && currentProgress && (
                    <div className="space-y-1.5">
                      <div className="h-2 rounded-full bg-border/30 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            batchMode === "ai" ? "bg-gradient-to-r from-violet-500 to-purple-500" : "bg-gradient-to-r from-accent to-emerald-500"
                          }`}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted">
                        <span>{progressPercent}%</span>
                        <span>{scraperT.progressRemaining || "剩余"} {currentProgress.total - currentProgress.current}</span>
                      </div>
                    </div>
                  )}

                  {/* 当前处理项 */}
                  {batchRunning && currentProgress && (
                    <div className="flex items-center gap-2.5 rounded-lg bg-card-hover/50 p-2.5">
                      <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded border border-border/30 bg-muted/10">
                        <Image
                          src={`/api/comics/${currentProgress.comicId}/thumbnail`}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="28px"
                          unoptimized
                        />
                      </div>
                      <div className="flex h-7 w-7 items-center justify-center rounded bg-accent/10 flex-shrink-0">
                        {currentProgress.step === "recognize" && <Eye className="h-3.5 w-3.5 text-purple-500 animate-pulse" />}
                        {currentProgress.step === "parse" && <Brain className="h-3.5 w-3.5 text-purple-500 animate-pulse" />}
                        {currentProgress.step === "search" && <Search className="h-3.5 w-3.5 text-accent animate-pulse" />}
                        {currentProgress.step === "apply" && <CheckCircle className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />}
                        {currentProgress.step === "ai-complete" && <Sparkles className="h-3.5 w-3.5 text-purple-500 animate-pulse" />}
                        {!currentProgress.step && <Clock className="h-3.5 w-3.5 text-muted animate-pulse" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{currentProgress.filename}</div>
                        <div className="text-[10px] text-muted">
                          {currentProgress.step === "recognize" && (scraperT.stepRecognize || "AI 识别漫画内容...")}
                          {currentProgress.step === "parse" && (scraperT.stepParse || "AI 解析文件名...")}
                          {currentProgress.step === "search" && (scraperT.stepSearch || "在线搜索...")}
                          {currentProgress.step === "apply" && (scraperT.stepApply || "应用元数据...")}
                          {currentProgress.step === "ai-complete" && (scraperT.stepAIComplete || "AI 补全...")}
                          {!currentProgress.step && (scraperT.stepProcessing || "处理中...")}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 完成摘要 */}
                  {batchDone && (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-emerald-500/10 p-2 text-center">
                        <div className="text-base font-bold text-emerald-500">{batchDone.success}</div>
                        <div className="text-[10px] text-muted">{scraperT.resultSuccess || "成功"}</div>
                      </div>
                      <div className="rounded-lg bg-red-500/10 p-2 text-center">
                        <div className="text-base font-bold text-red-500">{batchDone.failed}</div>
                        <div className="text-[10px] text-muted">{scraperT.resultFailed || "失败"}</div>
                      </div>
                      <div className="rounded-lg bg-muted/10 p-2 text-center">
                        <div className="text-base font-bold text-muted">{batchDone.total}</div>
                        <div className="text-[10px] text-muted">{scraperT.resultTotal || "总数"}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 结果列表 */}
              {completedItems.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
                  <button
                    onClick={() => setShowResults(!showResults)}
                    className="flex w-full items-center justify-between p-3 hover:bg-card-hover/50 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-accent" />
                      <span className="text-xs font-semibold text-foreground">{scraperT.resultListTitle || "结果"}</span>
                      <span className="text-[10px] text-muted">({completedItems.length})</span>
                    </div>
                    {showResults ? <ChevronUp className="h-3.5 w-3.5 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-muted" />}
                  </button>

                  {showResults && (
                    <div className="divide-y divide-border/10 max-h-[400px] overflow-y-auto">
                      {completedItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 px-3 py-2 hover:bg-card-hover/30 transition-colors">
                          <div className="flex-shrink-0">
                            {item.status === "success" ? (
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                            ) : item.status === "skipped" ? (
                              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                            ) : item.status === "warning" ? (
                              <AlertCircle className="h-3.5 w-3.5 text-orange-500" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-500" />
                            )}
                          </div>
                          <div className="relative h-8 w-6 flex-shrink-0 overflow-hidden rounded border border-border/30 bg-muted/10">
                            <Image
                              src={`/api/comics/${item.comicId}/thumbnail`}
                              alt=""
                              fill
                              className="object-cover"
                              sizes="24px"
                              unoptimized
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-foreground truncate">{item.matchTitle || item.filename}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {item.source && (
                                <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">{item.source}</span>
                              )}
                              {item.message && <span className="text-[9px] text-muted truncate">{item.message}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 空状态提示 */}
              {!batchRunning && !batchDone && completedItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/40 bg-card/20 p-6 text-center space-y-2">
                  <div className="flex justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/10 to-purple-500/10">
                      <Eye className="h-6 w-6 text-purple-400" />
                    </div>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground">{scraperT.rightPanelHint || "点击左侧书籍查看详情"}</h4>
                  <p className="text-xs text-muted leading-relaxed">
                    {scraperT.rightPanelDesc || "选择一本书查看元数据详情并进行精准刮削，或使用上方批量操作对全库/选中项统一刮削"}
                  </p>
                </div>
              )}

              {/* 合集管理入口 */}
              {isAdmin && (
                <button
                  onClick={openCollectionPanel}
                  className="w-full flex items-center gap-3 rounded-xl border border-border/40 bg-card p-4 text-left transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5 group"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 flex-shrink-0 transition-colors group-hover:bg-emerald-500/20">
                    <Layers className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground">{scraperT.collectionTitle || "合集管理"}</div>
                    <div className="text-[10px] text-muted">{scraperT.collectionDesc || "管理漫画系列分组与元数据关联"}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted/40 flex-shrink-0" />
                </button>
              )}

              {/* 文件夹刮削面板（文件夹模式下选中文件夹时显示） */}
              {viewMode === "folder" && selectedFolderPath && (
                <FolderScrapePanel
                  folderPath={selectedFolderPath}
                  folderTree={folderTree}
                  scrapeRunning={folderScrapeRunning}
                  scrapeProgress={folderScrapeProgress}
                  scrapeDone={folderScrapeDone}
                  batchMode={batchMode}
                  scraperT={scraperT}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 移动端批量编辑浮层 ── */}
      {batchEditMode && (
        <div className="fixed inset-0 z-50 md:hidden bg-background">
          <BatchEditPanel
            entries={batchEditNames}
            scraperT={scraperT}
            saving={batchEditSaving}
            results={batchEditResults}
            aiLoading={aiRenameLoading}
            aiConfigured={aiConfigured}
            onExit={exitBatchEditMode}
          />
        </div>
      )}

      {/* ── 移动端详情浮层 ── */}
      {focusedItem && (
        <div className="fixed inset-0 z-50 md:hidden bg-background">
          <DetailPanel
            key={`mobile-${focusedItem.id}-${detailRefreshKey}`}
            item={focusedItem}
            scraperT={scraperT}
            isAdmin={isAdmin}
            onClose={() => setFocusedItem(null)}
            onRefresh={() => setDetailRefreshKey((k) => k + 1)}
          />
        </div>
      )}

      {/* ── 移动端 AI 聊天浮层 ── */}
      {aiChatOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-background">
          <AIChatPanel
            messages={aiChatMessages}
            loading={aiChatLoading}
            input={aiChatInput}
            scraperT={scraperT}
            onClose={closeAIChat}
          />
        </div>
      )}

      {/* ── 悬浮 AI 助手按钮 ── */}
      {isAdmin && aiConfigured && !aiChatOpen && (
        <button
          onClick={openAIChat}
          data-guide="ai-chat-btn"
          className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-xl shadow-purple-500/30 transition-all hover:shadow-2xl hover:shadow-purple-500/40 hover:scale-105 active:scale-95 md:hidden"
          title={scraperT.aiChatBtnLabel || "AI 助手"}
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}

      {/* ── 桌面端悬浮 AI 助手按钮（当右侧面板不是AI聊天时显示） ── */}
      {isAdmin && aiConfigured && !aiChatOpen && (
        <button
          onClick={openAIChat}
          data-guide="ai-chat-btn"
          className="fixed bottom-6 right-6 z-40 hidden md:flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 px-4 text-white shadow-xl shadow-purple-500/30 transition-all hover:shadow-2xl hover:shadow-purple-500/40 hover:scale-[1.02] active:scale-[0.98]"
          title={scraperT.aiChatBtnLabel || "AI 助手"}
        >
          <Bot className="h-4 w-4" />
          <span className="text-xs font-medium">{scraperT.aiChatBtnLabel || "AI 助手"}</span>
        </button>
      )}

      {/* ── 帮助按钮（桌面端左下角） ── */}
      {isAdmin && !helpPanelOpen && (
        <button
          onClick={openHelpPanel}
          className="fixed bottom-6 left-6 z-40 hidden md:flex h-9 items-center gap-1.5 rounded-xl bg-card border border-border/50 px-3 text-muted shadow-lg transition-all hover:text-foreground hover:border-emerald-500/40 hover:shadow-xl"
          title={scraperT.helpTitle || "帮助中心"}
        >
          <CircleHelp className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium">{scraperT.helpTitle || "帮助"}</span>
        </button>
      )}

      {/* ── 移动端帮助浮层 ── */}
      {helpPanelOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-background">
          <HelpPanel
            scraperT={scraperT}
            searchQuery={helpSearchQuery}
            onClose={closeHelpPanel}
          />
        </div>
      )}

      {/* ── 添加到合集弹窗 ── */}
      {collectionAddToGroupDialog && selectedIds.size > 0 && (
        <AddToCollectionDialog
          scraperT={scraperT}
          groups={collectionGroups}
          selectedIds={selectedIds}
          onClose={closeAddToGroupDialog}
        />
      )}

      {/* ── 批量在线刮削对话框 ── */}
      {groupBatchScrapeDialogOpen && scraperGroupSelectedIds.size > 0 && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 animate-backdrop-in" onClick={() => closeGroupBatchScrapeDialog()}>
          <div className="w-[95vw] max-w-2xl rounded-2xl border border-border bg-card shadow-2xl animate-modal-in max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between border-b border-border/30 px-5 py-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-accent" />
                <h3 className="text-base font-semibold text-foreground">
                  批量在线刮削
                </h3>
                <span className="text-xs text-muted bg-accent/10 px-2 py-0.5 rounded-full">
                  {scraperGroupSelectedIds.size} 个系列
                </span>
              </div>
              <button onClick={() => closeGroupBatchScrapeDialog()} className="rounded-lg p-1.5 text-muted hover:text-foreground hover:bg-card-hover transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 配置区域 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 数据源选择 */}
              <div>
                <label className="text-xs font-medium text-foreground/80 mb-1.5 block">数据源</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "anilist", name: "AniList", icon: "🅰" },
                    { id: "bangumi", name: "Bangumi", icon: "🅱" },
                    { id: "mangadex", name: "MangaDex", icon: "📖" },
                    { id: "mangaupdates", name: "MangaUpdates", icon: "📋" },
                    { id: "kitsu", name: "Kitsu", icon: "🦊" },
                  ].map((src) => (
                    <button
                      key={src.id}
                      onClick={() => toggleGroupBatchScrapeSource(src.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 transition-colors ${
                        groupBatchScrapeSources.includes(src.id)
                          ? "bg-accent/20 text-accent ring-1 ring-accent/30"
                          : "bg-card-hover text-muted opacity-50"
                      }`}
                    >
                      <span>{src.icon}</span>
                      <span>{src.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 应用字段选择 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-foreground/80">应用字段</label>
                  <button
                    onClick={() => setGroupBatchScrapeAllFields(groupBatchScrapeFields.size !== BATCH_SCRAPE_FIELDS.length)}
                    className="text-[10px] text-accent/70 hover:text-accent"
                  >
                    {groupBatchScrapeFields.size === BATCH_SCRAPE_FIELDS.length ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {BATCH_SCRAPE_FIELDS.map((field) => (
                    <button
                      key={field.id}
                      onClick={() => toggleGroupBatchScrapeField(field.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                        groupBatchScrapeFields.has(field.id)
                          ? field.id === "title"
                            ? "bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/30"
                            : "bg-accent/20 text-accent"
                          : "bg-card-hover text-muted opacity-50"
                      }`}
                      title={field.id === "title" ? "⚠️ 启用后将覆盖系列名称" : undefined}
                    >
                      {field.id === "title" && groupBatchScrapeFields.has(field.id) ? `⚠ ${field.label}` : field.label}
                    </button>
                  ))}
                </div>
                {groupBatchScrapeFields.has("title") && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-500">
                    <AlertTriangle className="h-3 w-3" />
                    <span>已启用标题字段：系列名称将被刮削结果替换</span>
                  </div>
                )}
              </div>

              {/* 选项 */}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupBatchScrapeOverwrite}
                    onChange={(e) => setGroupBatchScrapeOverwrite(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-accent"
                  />
                  <span className="text-xs text-muted">覆盖现有数据</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupBatchScrapeSyncTags}
                    onChange={(e) => setGroupBatchScrapeSyncTags(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-accent"
                  />
                  <span className="text-xs text-muted">同步标签到所有卷</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupBatchScrapeSyncToVolumes}
                    onChange={(e) => setGroupBatchScrapeSyncToVolumes(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-accent"
                  />
                  <span className="text-xs text-muted">同步元数据到所有卷</span>
                </label>
              </div>

              {/* 预览结果 */}
              {groupBatchScrapePreviewLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                  <span className="ml-2 text-sm text-muted">正在搜索元数据...</span>
                </div>
              )}

              {groupBatchScrapePreview && !groupBatchScrapePreviewLoading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-foreground/80">
                      预览结果 ({groupBatchScrapePreview.filter((r) => r.success).length}/{groupBatchScrapePreview.length} 找到匹配)
                    </h4>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto space-y-1.5 rounded-xl border border-border/30 p-2">
                    {groupBatchScrapePreview.map((item) => (
                      <div
                        key={item.groupId}
                        className={`rounded-lg p-2.5 text-xs ${
                          item.success
                            ? "bg-emerald-500/5 border border-emerald-500/20"
                            : "bg-red-500/5 border border-red-500/20"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {item.success ? (
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                            )}
                            <span className="font-medium text-foreground truncate">{item.groupName}</span>
                            <span className="text-muted/50 flex-shrink-0">{item.volumes} 卷</span>
                          </div>
                          {item.metadata?.source && (
                            <span className="text-[10px] text-accent/60 bg-accent/10 px-1.5 py-0.5 rounded flex-shrink-0">
                              {item.metadata.source}
                            </span>
                          )}
                        </div>
                        {item.success && item.metadata && (
                          <div className="mt-1.5 pl-5.5 space-y-0.5 text-[11px]">
                            {item.metadata.title && groupBatchScrapeFields.has("title") && (
                              <div className="flex gap-1.5">
                                <span className="text-muted/50 w-10 flex-shrink-0">标题</span>
                                <span className="text-foreground/70 truncate">{item.metadata.title}</span>
                              </div>
                            )}
                            {item.metadata.author && groupBatchScrapeFields.has("author") && (
                              <div className="flex gap-1.5">
                                <span className="text-muted/50 w-10 flex-shrink-0">作者</span>
                                <span className="text-foreground/70 truncate">{item.metadata.author}</span>
                              </div>
                            )}
                            {item.metadata.genre && groupBatchScrapeFields.has("genre") && (
                              <div className="flex gap-1.5">
                                <span className="text-muted/50 w-10 flex-shrink-0">类型</span>
                                <span className="text-foreground/70 truncate">{item.metadata.genre}</span>
                              </div>
                            )}
                            {item.metadata.description && groupBatchScrapeFields.has("description") && (
                              <div className="flex gap-1.5">
                                <span className="text-muted/50 w-10 flex-shrink-0">简介</span>
                                <span className="text-foreground/70 line-clamp-1">{item.metadata.description}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {!item.success && item.error && (
                          <div className="mt-1 pl-5.5 text-[11px] text-red-400/70">{item.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 应用结果 */}
              {groupBatchScrapeResult && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">批量刮削完成</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="text-foreground/70">总计: {groupBatchScrapeResult.total}</span>
                    <span className="text-emerald-400">成功: {groupBatchScrapeResult.success}</span>
                    {groupBatchScrapeResult.failed > 0 && (
                      <span className="text-red-400">失败: {groupBatchScrapeResult.failed}</span>
                    )}
                    <span className="text-accent">已应用: {groupBatchScrapeResult.applied}</span>
                  </div>
                  {/* 失败详情 */}
                  {groupBatchScrapeResult.results.filter((r) => !r.success).length > 0 && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[11px] text-red-400/70">失败详情:</span>
                      {groupBatchScrapeResult.results.filter((r) => !r.success).map((r) => (
                        <div key={r.groupId} className="text-[11px] text-red-400/60 pl-2">
                          • {r.groupName}: {r.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between border-t border-border/30 px-5 py-3 flex-shrink-0">
              <div className="text-xs text-muted">
                {groupBatchScrapePreview
                  ? `${groupBatchScrapePreview.filter((r) => r.success).length} 个系列找到匹配结果`
                  : `将为 ${scraperGroupSelectedIds.size} 个系列搜索在线元数据`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => closeGroupBatchScrapeDialog()}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-card-hover transition-colors"
                >
                  关闭
                </button>
                {!groupBatchScrapeResult && (
                  <>
                    {!groupBatchScrapePreview ? (
                      <button
                        onClick={() => previewGroupBatchScrape(Array.from(scraperGroupSelectedIds))}
                        disabled={groupBatchScrapePreviewLoading || groupBatchScrapeSources.length === 0}
                        className="flex items-center gap-1.5 rounded-lg bg-accent/20 px-4 py-1.5 text-xs font-medium text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                      >
                        {groupBatchScrapePreviewLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        预览
                      </button>
                    ) : (
                      <button
                        onClick={() => applyGroupBatchScrape(Array.from(scraperGroupSelectedIds))}
                        disabled={groupBatchScrapeApplying || groupBatchScrapePreview.filter((r) => r.success).length === 0}
                        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-colors disabled:opacity-50"
                      >
                        {groupBatchScrapeApplying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        确认应用 ({groupBatchScrapePreview.filter((r) => r.success).length})
                      </button>
                    )}
                  </>
                )}
                {groupBatchScrapeResult && (
                  <button
                    onClick={() => {
                      closeGroupBatchScrapeDialog();
                      clearGroupSelection();
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-4 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    完成
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 引导遮罩 ── */}
      {guideActive && (
        <GuideOverlay
          scraperT={scraperT}
          currentStep={guideCurrentStep}
        />
      )}
    </div>
  );
}
