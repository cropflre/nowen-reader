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
  Globe,
  Bookmark,
  Zap,
  Pencil,
  Undo2,
  Save,
  Wand2,
  Copy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MessageCircle,
  Send,
  Bot,
  Eraser,
  Command,
  HelpCircle,
  BookMarked,
  Lightbulb,
  Wrench,
  GraduationCap,
  CircleHelp,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useAIStatus } from "@/hooks/useAIStatus";
import { useScraperStore } from "@/hooks/useScraperStore";
import { MetadataSearch } from "@/components/MetadataSearch";
import { GroupMetadataSearch } from "@/components/GroupMetadataSearch";
import { updateComicMetadata, removeComicTag } from "@/api/comics";
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
  applyNameToAll,
  undoBatchEditNames,
  saveBatchRename,
  aiRename,
  setLibrarySort,
  toggleAIChat,
  closeAIChat,
  openAIChat,
  setAIChatInput,
  sendAIChatMessage,
  clearAIChatMessages,
  abortAIChat,
  startGuide,
  nextGuideStep,
  prevGuideStep,
  skipGuide,
  finishGuide,
  GUIDE_STEPS,
  checkAutoStartGuide,
  openHelpPanel,
  closeHelpPanel,
  setHelpSearchQuery,
  resetGuide,
  openCollectionPanel,
  closeCollectionPanel,
  loadCollectionGroups,
  loadCollectionDetail,
  clearCollectionDetail,
  createCollection,
  updateCollection,
  deleteCollection,
  addComicsToCollection,
  removeComicFromCollection,
  reorderCollectionComics,
  autoDetectCollections,
  batchCreateCollections,
  openAddToGroupDialog,
  closeAddToGroupDialog,
  setCollectionEditingId,
  setCollectionEditingName,
  setCollectionCreateDialog,
  startBatchSelected as startBatchSelectedAction,
  // 文件夹模式
  setViewMode,
  setSelectedFolderPath,
  setFolderSearch,
  loadFolderTree,
  startFolderScrape,
  cancelFolderScrape,
  // 系列模式
  loadScraperGroups,
  setScraperGroupFocusedId,
  setScraperGroupSearch,
  setScraperGroupMetaFilter,
  setScraperGroupSortBy,
  toggleSelectGroup,
  selectAllVisibleGroups,
  clearGroupSelection,
  startGroupBatchScrape,
  cancelGroupBatchScrape,
  clearGroupBatchDone,
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
import type { MetaFilter, LibraryItem, BatchEditNameEntry, LibrarySortBy, AIChatMessage, CollectionGroup, CollectionGroupDetail, CollectionGroupComic, AutoDetectSuggestion, MetadataFolderNode, MetadataFolderFile, ViewMode, ScraperGroup, GroupMetaFilter, GroupSortBy, GroupDirtyIssue, GroupCleanupResult } from "@/lib/scraper-store";
import { FolderOpen, FolderPlus, Layers, Plus, Minus, FolderTree, Folder, List } from "lucide-react";

/* ── 文件夹树搜索/筛选辅助函数 ── */
function filterMetadataFolderTree(
  nodes: MetadataFolderNode[],
  search: string
): MetadataFolderNode[] {
  if (!search) return nodes;
  const searchLower = search.toLowerCase();

  function matchNode(node: MetadataFolderNode): MetadataFolderNode | null {
    const nameMatch = node.name.toLowerCase().includes(searchLower);
    const matchedFiles = (node.files || []).filter(
      (f) =>
        f.title.toLowerCase().includes(searchLower) ||
        f.filename.toLowerCase().includes(searchLower)
    );
    const matchedChildren: MetadataFolderNode[] = [];
    for (const child of node.children || []) {
      const matched = matchNode(child);
      if (matched) matchedChildren.push(matched);
    }
    if (matchedChildren.length > 0 || matchedFiles.length > 0 || (nameMatch && node.fileCount > 0)) {
      return {
        ...node,
        children: matchedChildren,
        files: matchedFiles.length > 0 ? matchedFiles : node.files,
      };
    }
    return null;
  }

  return nodes.map(matchNode).filter(Boolean) as MetadataFolderNode[];
}

function highlightSearchText(text: string, search: string) {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-accent/30 text-accent font-medium rounded px-0.5">
        {text.slice(idx, idx + search.length)}
      </span>
      {text.slice(idx + search.length)}
    </>
  );
}

/* ── 文件夹树节点组件 ── */
function MetadataFolderTreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  searchTerm = "",
}: {
  node: MetadataFolderNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  searchTerm?: string;
}) {
  const [expanded, setExpanded] = useState(depth < 1 || !!searchTerm);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedPath === node.path;
  const isExpanded = searchTerm ? true : expanded;

  const metaPercent = node.fileCount > 0 ? Math.round((node.withMeta / node.fileCount) * 100) : 0;

  return (
    <div>
      <div
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors cursor-pointer ${
          isSelected
            ? "bg-accent/10 border-l-2 border-l-accent"
            : "hover:bg-white/5 border-l-2 border-l-transparent"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          onSelect(isSelected ? null : node.path);
          if (hasChildren) setExpanded(!expanded);
        }}
      >
        {/* 展开/收起箭头 */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {hasChildren ? (
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          ) : (
            <span className="h-1 w-1 rounded-full bg-muted/30" />
          )}
        </span>

        {/* 文件夹图标 */}
        {isExpanded && hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-amber-400/60" />
        )}

        {/* 文件夹名 */}
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {highlightSearchText(node.name, searchTerm)}
        </span>

        {/* 元数据完成度 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="h-1.5 w-10 rounded-full bg-border/30 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                metaPercent === 100 ? "bg-emerald-500" : metaPercent > 0 ? "bg-accent/60" : "bg-amber-500/40"
              }`}
              style={{ width: `${metaPercent}%` }}
            />
          </div>
          <span className={`text-[10px] font-medium ${
            metaPercent === 100 ? "text-emerald-500" : metaPercent > 0 ? "text-accent" : "text-amber-500"
          }`}>
            {node.withMeta}/{node.fileCount}
          </span>
        </div>
      </div>

      {/* 子节点 */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <MetadataFolderTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              searchTerm={searchTerm}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 文件夹刮削控制面板 ── */
function FolderScrapePanel({
  folderPath,
  folderTree,
  scrapeRunning,
  scrapeProgress,
  scrapeDone,
  batchMode,
  scraperT,
}: {
  folderPath: string;
  folderTree: MetadataFolderNode[] | null;
  scrapeRunning: boolean;
  scrapeProgress: { current: number; total: number; status: string; filename: string } | null;
  scrapeDone: { total: number; success: number; failed: number } | null;
  batchMode: string;
  scraperT: Record<string, string>;
}) {
  // 查找选中的文件夹节点
  const findNode = (nodes: MetadataFolderNode[], path: string): MetadataFolderNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.children) {
        const found = findNode(n.children, path);
        if (found) return found;
      }
    }
    return null;
  };

  const selectedNode = folderTree ? findNode(folderTree, folderPath) : null;
  if (!selectedNode) return null;

  const metaPercent = selectedNode.fileCount > 0
    ? Math.round((selectedNode.withMeta / selectedNode.fileCount) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
      {/* 文件夹信息 */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 flex-shrink-0">
          <FolderOpen className="h-5 w-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{selectedNode.name}</div>
          <div className="text-[10px] text-muted truncate">{folderPath}</div>
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-card/50 p-2 text-center">
          <div className="text-lg font-bold text-foreground">{selectedNode.fileCount}</div>
          <div className="text-[10px] text-muted">总文件</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-2 text-center">
          <div className="text-lg font-bold text-emerald-500">{selectedNode.withMeta}</div>
          <div className="text-[10px] text-muted">已刮削</div>
        </div>
        <div className="rounded-lg bg-amber-500/10 p-2 text-center">
          <div className="text-lg font-bold text-amber-500">{selectedNode.missingMeta}</div>
          <div className="text-[10px] text-muted">缺失</div>
        </div>
      </div>

      {/* 元数据完成度进度条 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted">元数据完成度</span>
          <span className={`text-[11px] font-medium ${metaPercent === 100 ? "text-emerald-500" : "text-accent"}`}>
            {metaPercent}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-border/30 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              metaPercent === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-accent to-emerald-500"
            }`}
            style={{ width: `${metaPercent}%` }}
          />
        </div>
      </div>

      {/* 文件列表预览 */}
      {selectedNode.files && selectedNode.files.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          <div className="text-[11px] text-muted font-medium mb-1">文件列表</div>
          {selectedNode.files.map((file) => (
            <div key={file.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] hover:bg-white/5 transition-colors">
              {file.hasMetadata ? (
                <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" />
              ) : (
                <AlertCircle className="h-3 w-3 shrink-0 text-amber-500" />
              )}
              <span className="flex-1 truncate text-muted">{file.title}</span>
              {file.metadataSource && (
                <span className="text-[9px] text-muted/50 shrink-0">{file.metadataSource}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 刮削操作按钮 */}
      {!scrapeRunning ? (
        <div className="space-y-2">
          <button
            onClick={() => startFolderScrape(folderPath, "missing")}
            disabled={selectedNode.missingMeta === 0}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent hover:bg-accent-hover text-white py-2 text-xs font-medium transition-all disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            刮削缺失项 ({selectedNode.missingMeta})
          </button>
          <button
            onClick={() => startFolderScrape(folderPath, "all")}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-border/40 bg-card hover:bg-card-hover text-foreground py-2 text-xs font-medium transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            全部重新刮削 ({selectedNode.fileCount})
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* 刮削进度 */}
          {scrapeProgress && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-muted">
                  {scrapeProgress.status === "processing" ? "处理中..." : `${scrapeProgress.current}/${scrapeProgress.total}`}
                </span>
                <span className="text-[11px] text-accent font-medium">
                  {scrapeProgress.total > 0 ? Math.round((scrapeProgress.current / scrapeProgress.total) * 100) : 0}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${scrapeProgress.total > 0 ? (scrapeProgress.current / scrapeProgress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="text-[10px] text-muted mt-1 truncate">{scrapeProgress.filename}</div>
            </div>
          )}
          <button
            onClick={cancelFolderScrape}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-500/10 text-red-400 py-2 text-xs font-medium transition-all hover:bg-red-500/20"
          >
            <Square className="h-3.5 w-3.5" />
            停止刮削
          </button>
        </div>
      )}

      {/* 刮削完成结果 */}
      {scrapeDone && !scrapeRunning && (
        <div className="rounded-lg bg-card/50 p-3 space-y-1">
          <div className="text-xs font-medium text-foreground">刮削完成</div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-muted">总计: <span className="text-foreground font-medium">{scrapeDone.total}</span></span>
            <span className="text-emerald-500">成功: {scrapeDone.success}</span>
            <span className="text-red-400">失败: {scrapeDone.failed}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 引导遮罩组件 ── */
function GuideOverlay({
  scraperT,
  currentStep,
}: {
  scraperT: Record<string, string>;
  currentStep: number;
}) {
  const step = GUIDE_STEPS[currentStep];
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const totalSteps = GUIDE_STEPS.length;
  const maskId = useRef(`guide-mask-${Math.random().toString(36).slice(2, 8)}`).current;

  // 计算目标元素位置的函数
  const updateTargetRect = useCallback(() => {
    if (!step) { setTargetRect(null); return; }
    const el = document.querySelector(step.targetSelector);
    if (el) {
      // 检查元素是否实际可见（排除 display:none / visibility:hidden / 零尺寸）
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect(rect);
      } else {
        setTargetRect(null);
      }
    } else {
      setTargetRect(null);
    }
  }, [step]);

  // 当步骤切换时：滚动到目标元素并计算位置
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      // 仅在目标元素不在视口内时才滚动
      const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!inView) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      // 延迟计算位置（等待 scroll 完成）
      const timer = setTimeout(updateTargetRect, 350);
      return () => clearTimeout(timer);
    } else {
      // 目标元素不存在 → 自动跳过该步骤
      setTargetRect(null);
      const skipTimer = setTimeout(() => {
        if (currentStep < totalSteps - 1) {
          nextGuideStep();
        } else {
          finishGuide();
        }
      }, 100);
      return () => clearTimeout(skipTimer);
    }
  }, [currentStep, step, totalSteps, updateTargetRect]);

  // 监听窗口 resize 和 scroll 以实时刷新遮罩位置
  useEffect(() => {
    if (!step) return;

    const handleUpdate = () => { updateTargetRect(); };
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true); // true 捕获阶段，兼容内部滚动容器

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [step, updateTargetRect]);

  if (!step) return null;

  const stepLabel = (scraperT.guideStepOf || "步骤 {current}/{total}")
    .replace("{current}", String(currentStep + 1))
    .replace("{total}", String(totalSteps));

  // 计算弹窗位置（增加视口边界安全检测）
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)", position: "fixed", zIndex: 10002 };

    const gap = 16;
    const tooltipW = 360;
    const tooltipH = 260; // 预估高度
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const style: React.CSSProperties = { position: "fixed", zIndex: 10002 };

    switch (step.placement) {
      case "bottom": {
        const top = targetRect.bottom + gap;
        style.top = top + tooltipH > vh ? Math.max(16, targetRect.top - tooltipH - gap) : top;
        style.left = Math.max(16, Math.min(targetRect.left, vw - tooltipW - 16));
        break;
      }
      case "top": {
        const bottom = vh - targetRect.top + gap;
        if (targetRect.top - gap - tooltipH < 0) {
          // 上方空间不足，改到下方
          style.top = targetRect.bottom + gap;
        } else {
          style.bottom = bottom;
        }
        style.left = Math.max(16, Math.min(targetRect.left, vw - tooltipW - 16));
        break;
      }
      case "left": {
        style.top = Math.max(16, Math.min(targetRect.top, vh - tooltipH - 16));
        const right = vw - targetRect.left + gap;
        if (targetRect.left - gap - tooltipW < 0) {
          // 左侧空间不足，改到右侧
          style.left = targetRect.right + gap;
        } else {
          style.right = right;
        }
        break;
      }
      case "right": {
        style.top = Math.max(16, Math.min(targetRect.top, vh - tooltipH - 16));
        const left = targetRect.right + gap;
        if (left + tooltipW > vw) {
          // 右侧空间不足，改到左侧
          style.right = vw - targetRect.left + gap;
        } else {
          style.left = left;
        }
        break;
      }
    }
    return style;
  };

  return (
    <div className="fixed inset-0 z-[10000]" style={{ pointerEvents: "auto" }}>
      {/* 暗色遮罩（排除高亮区域）— 点击遮罩区域不做任何操作 */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 10000, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 6}
                y={targetRect.top - 6}
                width={targetRect.width + 12}
                height={targetRect.height + 12}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {/* 高亮区域的透明交互层 — 允许用户点击高亮区域 */}
      {targetRect && (
        <div
          className="fixed"
          style={{
            zIndex: 10001,
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            pointerEvents: "auto",
          }}
        />
      )}

      {/* 高亮边框 */}
      {targetRect && (
        <div
          className="fixed border-2 border-accent rounded-xl pointer-events-none"
          style={{
            zIndex: 10001,
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            boxShadow: "0 0 0 4px rgba(var(--accent-rgb, 99 102 241) / 0.3), 0 0 20px rgba(var(--accent-rgb, 99 102 241) / 0.2)",
            animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      )}

      {/* 提示卡片 */}
      <div
        style={getTooltipStyle()}
        className="w-[360px] rounded-2xl bg-card border border-border/60 shadow-2xl p-5 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-300"
      >
        {/* 步骤指示器 */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-accent bg-accent/10 rounded-full px-2.5 py-0.5">
            {stepLabel}
          </span>
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep ? "w-4 bg-accent" : i < currentStep ? "w-1.5 bg-accent/40" : "w-1.5 bg-border/60"
                }`}
              />
            ))}
          </div>
        </div>

        {/* 标题 + 描述 */}
        <div className="space-y-1.5">
          <h4 className="text-sm font-bold text-foreground leading-tight">
            {scraperT[step.titleKey] || step.titleKey}
          </h4>
          <p className="text-xs text-muted leading-relaxed">
            {scraperT[step.descKey] || step.descKey}
          </p>
        </div>

        {/* 操作提示（可选） */}
        {step.actionKey && (
          <div className="flex items-start gap-2 rounded-lg bg-accent/5 border border-accent/20 p-2.5">
            <Lightbulb className="h-3.5 w-3.5 text-accent flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-accent/80 leading-relaxed">
              {scraperT[step.actionKey] || step.actionKey}
            </p>
          </div>
        )}

        {/* 导航按钮 */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={skipGuide}
            className="text-[11px] text-muted hover:text-foreground transition-colors"
          >
            {scraperT.guideSkip || "跳过教程"}
          </button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={prevGuideStep}
                className="flex items-center gap-1 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-medium text-muted hover:text-foreground hover:bg-card-hover transition-all"
              >
                <ChevronLeft className="h-3 w-3" />
                {scraperT.guidePrev || "上一步"}
              </button>
            )}
            <button
              onClick={currentStep < totalSteps - 1 ? nextGuideStep : finishGuide}
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-accent-hover transition-all"
            >
              {currentStep < totalSteps - 1
                ? (scraperT.guideNext || "下一步")
                : (scraperT.guideFinish || "完成")
              }
              {currentStep < totalSteps - 1 && <ChevronRight className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 帮助面板组件 ── */
function HelpPanel({
  scraperT,
  searchQuery,
  onClose,
}: {
  scraperT: Record<string, string>;
  searchQuery: string;
  onClose: () => void;
}) {
  type HelpCategory = "faq" | "tips" | "troubleshoot";
  const [activeCategory, setActiveCategory] = useState<HelpCategory>("faq");

  // FAQ 数据
  const faqItems = [
    { q: scraperT.helpFaq1Q || "什么是元数据刮削？", a: scraperT.helpFaq1A || "" },
    { q: scraperT.helpFaq2Q || "标准模式和AI模式有什么区别？", a: scraperT.helpFaq2A || "" },
    { q: scraperT.helpFaq3Q || "刮削失败怎么办？", a: scraperT.helpFaq3A || "" },
    { q: scraperT.helpFaq4Q || "可以只刮削部分书籍吗？", a: scraperT.helpFaq4A || "" },
    { q: scraperT.helpFaq5Q || "如何编辑错误的元数据？", a: scraperT.helpFaq5A || "" },
  ];

  // Tips
  const tips = [
    scraperT.helpTip1 || "💡 使用AI模式刮削时，先确保在设置中配置了AI服务",
    scraperT.helpTip2 || "💡 文件名越接近正式书名，匹配率越高",
    scraperT.helpTip3 || "💡 通过AI助手可以用自然语言控制操作",
    scraperT.helpTip4 || "💡 点击书籍封面可查看详情并进行精准刮削",
    scraperT.helpTip5 || "💡 排序功能可以按刮削状态排序",
  ];

  // Troubleshoot
  const troubleshootItems = [
    { q: scraperT.helpTrouble1Q || "刮削一直显示失败", a: scraperT.helpTrouble1A || "" },
    { q: scraperT.helpTrouble2Q || "AI模式不可用", a: scraperT.helpTrouble2A || "" },
    { q: scraperT.helpTrouble3Q || "刮削结果不准确", a: scraperT.helpTrouble3A || "" },
  ];

  // 搜索过滤
  const lowerQ = searchQuery.toLowerCase();
  const filteredFaq = lowerQ ? faqItems.filter((f) => f.q.toLowerCase().includes(lowerQ) || f.a.toLowerCase().includes(lowerQ)) : faqItems;
  const filteredTips = lowerQ ? tips.filter((t) => t.toLowerCase().includes(lowerQ)) : tips;
  const filteredTroubleshoot = lowerQ ? troubleshootItems.filter((t) => t.q.toLowerCase().includes(lowerQ) || t.a.toLowerCase().includes(lowerQ)) : troubleshootItems;

  const hasResults = filteredFaq.length > 0 || filteredTips.length > 0 || filteredTroubleshoot.length > 0;

  // FAQ 展开/折叠
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [expandedTrouble, setExpandedTrouble] = useState<number | null>(null);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0 bg-gradient-to-r from-emerald-500/5 to-teal-500/5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
            <CircleHelp className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {scraperT.helpTitle || "帮助中心"}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { resetGuide(); startGuide(); onClose(); }}
            className="flex items-center gap-1 rounded-lg text-[10px] font-medium text-muted hover:text-accent hover:bg-accent/5 px-2 py-1 transition-all"
            title={scraperT.guideRestartBtn || "重新引导"}
          >
            <GraduationCap className="h-3 w-3" />
            {scraperT.guideRestartBtn || "重新引导"}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-4 py-2.5 border-b border-border/20">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setHelpSearchQuery(e.target.value)}
            placeholder={scraperT.helpSearchPlaceholder || "搜索帮助文档..."}
            className="w-full rounded-lg bg-card-hover/50 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder-muted/50 outline-none border border-border/40 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
          />
        </div>
      </div>

      {/* 分类标签 */}
      {!lowerQ && (
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border/10">
          {(["faq", "tips", "troubleshoot"] as HelpCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                activeCategory === cat
                  ? "bg-emerald-500 text-white"
                  : "bg-card-hover text-muted hover:text-foreground"
              }`}
            >
              {cat === "faq" && <><BookMarked className="h-3 w-3" />{scraperT.helpFaqTitle || "常见问题"}</>}
              {cat === "tips" && <><Lightbulb className="h-3 w-3" />{scraperT.helpTipsTitle || "使用技巧"}</>}
              {cat === "troubleshoot" && <><Wrench className="h-3 w-3" />{scraperT.helpTroubleshootTitle || "故障排除"}</>}
            </button>
          ))}
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {!hasResults ? (
          <div className="text-center py-8 text-xs text-muted">
            {scraperT.helpNoResults || "没有找到匹配的帮助内容"}
          </div>
        ) : (
          <>
            {/* FAQ */}
            {(lowerQ || activeCategory === "faq") && filteredFaq.length > 0 && (
              <div className="space-y-1.5">
                {lowerQ && (
                  <h5 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
                    {scraperT.helpFaqTitle || "常见问题"}
                  </h5>
                )}
                {filteredFaq.map((item, idx) => (
                  <div key={idx} className="rounded-xl border border-border/30 overflow-hidden">
                    <button
                      onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-card-hover/30 transition-colors"
                    >
                      <span className="text-xs font-medium text-foreground pr-2">{item.q}</span>
                      {expandedFaq === idx
                        ? <ChevronUp className="h-3.5 w-3.5 text-muted flex-shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-muted flex-shrink-0" />
                      }
                    </button>
                    {expandedFaq === idx && (
                      <div className="px-3.5 pb-3 border-t border-border/10">
                        <p className="text-xs text-muted leading-relaxed pt-2">{item.a}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Tips */}
            {(lowerQ || activeCategory === "tips") && filteredTips.length > 0 && (
              <div className="space-y-1.5">
                {lowerQ && (
                  <h5 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
                    {scraperT.helpTipsTitle || "使用技巧"}
                  </h5>
                )}
                {filteredTips.map((tip, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-border/30 bg-amber-500/5 px-3.5 py-2.5"
                  >
                    <p className="text-xs text-foreground/80 leading-relaxed">{tip}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Troubleshoot */}
            {(lowerQ || activeCategory === "troubleshoot") && filteredTroubleshoot.length > 0 && (
              <div className="space-y-1.5">
                {lowerQ && (
                  <h5 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
                    {scraperT.helpTroubleshootTitle || "故障排除"}
                  </h5>
                )}
                {filteredTroubleshoot.map((item, idx) => (
                  <div key={idx} className="rounded-xl border border-border/30 overflow-hidden">
                    <button
                      onClick={() => setExpandedTrouble(expandedTrouble === idx ? null : idx)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-card-hover/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 pr-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                        <span className="text-xs font-medium text-foreground">{item.q}</span>
                      </div>
                      {expandedTrouble === idx
                        ? <ChevronUp className="h-3.5 w-3.5 text-muted flex-shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-muted flex-shrink-0" />
                      }
                    </button>
                    {expandedTrouble === idx && (
                      <div className="px-3.5 pb-3 border-t border-border/10">
                        <p className="text-xs text-muted leading-relaxed pt-2">{item.a}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── AI 聊天面板组件 ── */
function AIChatPanel({
  messages,
  loading,
  input,
  scraperT,
  onClose,
}: {
  messages: AIChatMessage[];
  loading: boolean;
  input: string;
  scraperT: Record<string, string>;
  onClose: () => void;
}) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    sendAIChatMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 快捷指令
  const quickCommands = [
    { label: scraperT.aiChatQuickScrapeAll || "刮削缺失项", prompt: "请帮我刮削所有缺失元数据的书籍", icon: "zap" },
    { label: scraperT.aiChatQuickSetAI || "切换AI模式", prompt: "切换到AI智能刮削模式", icon: "brain" },
    { label: scraperT.aiChatQuickStats || "查看统计", prompt: "告诉我当前书库的元数据统计情况", icon: "chart" },
    { label: scraperT.aiChatQuickHelp || "使用帮助", prompt: "请告诉我如何使用元数据刮削功能", icon: "help" },
    { label: scraperT.aiChatQuickSelectAll || "全选当页", prompt: "全选当前页面的所有书籍", icon: "check" },
    { label: scraperT.aiChatQuickFilter || "筛选缺失", prompt: "筛选出缺失元数据的书籍", icon: "filter" },
  ];

  const visibleMessages = messages.filter((m) => m.role !== "system" || m.commandResult);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0 bg-gradient-to-r from-violet-500/5 to-purple-500/5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {scraperT.aiChatTitle || "AI 刮削助手"}
            </h3>
            <p className="text-[10px] text-muted -mt-0.5">
              {scraperT.aiChatSubtitle || "智能对话 · 指令控制"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearAIChatMessages}
              disabled={loading}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
              title={scraperT.aiChatClear || "清空对话"}
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {visibleMessages.length === 0 ? (
          /* 空状态 — 欢迎词 + 快捷指令 */
          <div className="flex flex-col items-center justify-center h-full space-y-4 py-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10">
              <Bot className="h-8 w-8 text-purple-400" />
            </div>
            <div className="text-center space-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                {scraperT.aiChatEmpty || "你好！我是你的刮削助手 🤖"}
              </h4>
              <p className="text-xs text-muted leading-relaxed max-w-[280px]">
                {scraperT.aiChatEmptyDesc || "你可以问我关于元数据刮削的问题，或者直接用自然语言下指令。试试看吧！"}
              </p>
            </div>

            {/* 快捷指令网格 */}
            <div className="grid grid-cols-2 gap-1.5 w-full max-w-[340px]">
              {quickCommands.map((cmd) => (
                <button
                  key={cmd.prompt}
                  onClick={() => sendAIChatMessage(cmd.prompt)}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-card-hover/30 px-2.5 py-2 text-[11px] font-medium text-muted hover:text-foreground hover:border-purple-500/30 hover:bg-purple-500/5 transition-all disabled:opacity-50 text-left"
                >
                  {cmd.icon === "zap" && <Zap className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                  {cmd.icon === "brain" && <Brain className="h-3 w-3 text-purple-500 flex-shrink-0" />}
                  {cmd.icon === "chart" && <Database className="h-3 w-3 text-blue-500 flex-shrink-0" />}
                  {cmd.icon === "help" && <HelpCircle className="h-3 w-3 text-emerald-500 flex-shrink-0" />}
                  {cmd.icon === "check" && <CheckSquare className="h-3 w-3 text-accent flex-shrink-0" />}
                  {cmd.icon === "filter" && <Filter className="h-3 w-3 text-orange-500 flex-shrink-0" />}
                  <span className="truncate">{cmd.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* 消息列表 */
          visibleMessages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                /* 用户消息 */
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 shadow-sm">
                    <p className="text-xs text-white leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : msg.role === "system" && msg.commandResult ? (
                /* 指令执行结果 */
                <div className="flex justify-center">
                  <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-medium ${
                    msg.commandResult.success
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-red-500/10 text-red-500"
                  }`}>
                    <Command className="h-3 w-3" />
                    {msg.commandResult.message}
                  </div>
                </div>
              ) : (
                /* 助手消息 */
                <div className="flex gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex-shrink-0 mt-0.5">
                    <Bot className="h-3 w-3 text-white" />
                  </div>
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-card-hover/60 border border-border/20 px-3.5 py-2 shadow-sm">
                    <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                      {loading && msg === visibleMessages[visibleMessages.length - 1] && !msg.content && (
                        <span className="inline-flex gap-1 ml-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 快捷指令条（有消息时显示在输入框上方） */}
      {visibleMessages.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border/10 overflow-x-auto scrollbar-hide">
          {quickCommands.slice(0, 4).map((cmd) => (
            <button
              key={cmd.prompt}
              onClick={() => sendAIChatMessage(cmd.prompt)}
              disabled={loading}
              className="flex-shrink-0 rounded-full border border-border/30 bg-card-hover/30 px-2.5 py-1 text-[10px] text-muted hover:text-foreground hover:border-purple-500/30 transition-all disabled:opacity-50"
            >
              {cmd.label}
            </button>
          ))}
        </div>
      )}

      {/* 输入区域 */}
      <div className="flex items-end gap-2 px-3 py-3 border-t border-border/30 flex-shrink-0 bg-card/30">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setAIChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={scraperT.aiChatPlaceholder || "输入问题或指令..."}
          disabled={loading}
          rows={1}
          className="flex-1 rounded-xl bg-card-hover/50 px-3.5 py-2 text-xs text-foreground placeholder-muted/50 outline-none border border-border/40 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none max-h-24 disabled:opacity-50"
          style={{ minHeight: "36px" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 96) + "px";
          }}
        />
        {loading ? (
          <button
            onClick={abortAIChat}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500 text-white shadow-sm transition-colors hover:bg-red-600 flex-shrink-0"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-sm transition-all hover:shadow-md disabled:opacity-40 flex-shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── 批量编辑面板组件 ── */
function BatchEditPanel({
  entries,
  scraperT,
  saving,
  results,
  aiLoading,
  aiConfigured,
  onExit,
}: {
  entries: Map<string, BatchEditNameEntry>;
  scraperT: Record<string, string>;
  saving: boolean;
  results: { comicId: string; status: string; newTitle?: string; message?: string }[] | null;
  aiLoading: boolean;
  aiConfigured: boolean;
  onExit: () => void;
}) {
  const [aiPrompt, setAiPrompt] = useState("");
  const [applyAllInput, setApplyAllInput] = useState("");
  const [showApplyAll, setShowApplyAll] = useState(false);

  const entriesArr = Array.from(entries.values());
  const changedCount = entriesArr.filter((e) => e.newTitle.trim() !== e.oldTitle).length;
  const successCount = results?.filter((r) => r.status === "success").length ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">
            {scraperT.batchEditTitle || "批量编辑名称"}
          </h3>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            {entries.size} {scraperT.libItems || "项"}
          </span>
        </div>
        <button
          onClick={onExit}
          disabled={saving}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* AI 智能命名区域 - 仅在AI已配置时显示 */}
        {aiConfigured ? (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-purple-500" />
            <h4 className="text-xs font-semibold text-foreground">{scraperT.aiRenameTitle || "AI 智能命名"}</h4>
          </div>
          <p className="text-[11px] text-muted leading-relaxed">
            {scraperT.aiRenameDesc || "输入命名需求，AI会为所有选中书籍生成合适的名称"}
          </p>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={scraperT.aiRenamePlaceholder || "例如：提取纯净书名、去除方括号标记、格式统一为「作者 - 书名」..."}
            disabled={aiLoading || saving}
            className="w-full rounded-lg bg-card-hover/50 px-3 py-2 text-xs text-foreground placeholder-muted/50 outline-none border border-border/40 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none disabled:opacity-50"
            rows={2}
          />
          <button
            onClick={async () => {
              if (aiPrompt.trim()) {
                const err = await aiRename(aiPrompt.trim());
                if (err) {
                  alert(err);
                }
              }
            }}
            disabled={aiLoading || !aiPrompt.trim() || saving}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-all shadow-sm disabled:opacity-50 hover:shadow-md"
          >
            {aiLoading ? (
              <><Loader2 className="h-3 w-3 animate-spin" />{scraperT.aiRenameLoading || "AI 生成中..."}</>
            ) : (
              <><Brain className="h-3 w-3" />{scraperT.aiRenameBtn || "AI 生成名称"}</>
            )}
          </button>
        </div>
        ) : (
        <div className="rounded-xl border border-border/30 bg-muted/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-muted" />
            <h4 className="text-xs font-semibold text-muted">{scraperT.aiRenameTitle || "AI 智能命名"}</h4>
          </div>
          <p className="text-[11px] text-muted leading-relaxed">
            {scraperT.aiNotConfiguredHint || "请先在设置中配置AI服务"}
          </p>
        </div>
        )}

        {/* 一键应用同一名称 */}
        <div className="rounded-xl border border-border/40 bg-card p-3 space-y-2">
          <button
            onClick={() => setShowApplyAll(!showApplyAll)}
            className="flex w-full items-center justify-between text-xs font-medium text-foreground"
          >
            <div className="flex items-center gap-1.5">
              <Copy className="h-3.5 w-3.5 text-muted" />
              <span>{scraperT.applyAllTitle || "一键应用相同名称"}</span>
            </div>
            {showApplyAll ? <ChevronUp className="h-3 w-3 text-muted" /> : <ChevronDown className="h-3 w-3 text-muted" />}
          </button>
          {showApplyAll && (
            <div className="flex gap-1.5 mt-1">
              <input
                type="text"
                value={applyAllInput}
                onChange={(e) => setApplyAllInput(e.target.value)}
                placeholder={scraperT.applyAllPlaceholder || "输入统一名称..."}
                disabled={saving}
                className="flex-1 rounded-lg bg-card-hover/50 px-2.5 py-1.5 text-xs text-foreground placeholder-muted/50 outline-none border border-border/40 focus:border-accent/50 transition-all disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && applyAllInput.trim()) {
                    applyNameToAll(applyAllInput.trim());
                  }
                }}
              />
              <button
                onClick={() => {
                  if (applyAllInput.trim()) applyNameToAll(applyAllInput.trim());
                }}
                disabled={!applyAllInput.trim() || saving}
                className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {scraperT.applyBtn || "应用"}
              </button>
            </div>
          )}
        </div>

        {/* 编辑列表 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-foreground">
              {scraperT.batchEditList || "名称编辑"}
              {changedCount > 0 && (
                <span className="ml-1.5 text-accent text-[10px]">
                  ({changedCount} {scraperT.batchEditChanged || "项已修改"})
                </span>
              )}
            </h4>
            <button
              onClick={undoBatchEditNames}
              disabled={saving}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Undo2 className="h-3 w-3" />
              {scraperT.batchEditUndo || "还原全部"}
            </button>
          </div>

          <div className="space-y-1 max-h-[400px] overflow-y-auto rounded-xl border border-border/30 divide-y divide-border/10">
            {entriesArr.map((entry) => {
              const isChanged = entry.newTitle.trim() !== entry.oldTitle;
              const result = results?.find((r) => r.comicId === entry.comicId);
              return (
                <div key={entry.comicId} className="px-3 py-2 space-y-1">
                  {/* 文件名参考 */}
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-muted flex-shrink-0" />
                    <span className="text-[10px] text-muted/60 truncate" title={entry.filename}>
                      {entry.filename}
                    </span>
                  </div>
                  {/* 编辑输入框 */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={entry.newTitle}
                      onChange={(e) => setBatchEditName(entry.comicId, e.target.value)}
                      disabled={saving}
                      className={`flex-1 rounded-md px-2 py-1 text-xs text-foreground outline-none border transition-all disabled:opacity-50 ${
                        isChanged
                          ? "bg-accent/5 border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/20"
                          : "bg-card-hover/40 border-border/30 focus:border-border/60"
                      }`}
                    />
                    {/* 状态标识 */}
                    {result ? (
                      result.status === "success" ? (
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <span title={result.message}><XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" /></span>
                      )
                    ) : isChanged ? (
                      <div className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                    ) : null}
                  </div>
                  {/* 原名参考 */}
                  {isChanged && (
                    <div className="flex items-center gap-1 text-[10px] text-muted/50">
                      <span>{scraperT.batchEditOldName || "原名"}:</span>
                      <span className="line-through truncate">{entry.oldTitle}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 保存结果摘要 */}
        {results && (
          <div className="rounded-xl bg-card p-3 border border-border/30">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground mb-2">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              {scraperT.batchEditSaved || "保存完成"}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-500/10 p-2 text-center">
                <div className="text-sm font-bold text-emerald-500">{successCount}</div>
                <div className="text-[10px] text-muted">{scraperT.resultSuccess || "成功"}</div>
              </div>
              <div className="rounded-lg bg-red-500/10 p-2 text-center">
                <div className="text-sm font-bold text-red-500">{(results?.length ?? 0) - successCount}</div>
                <div className="text-[10px] text-muted">{scraperT.resultFailed || "失败"}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border/30 flex-shrink-0">
        <button
          onClick={onExit}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1 rounded-xl border border-border/40 py-2 text-xs font-medium text-muted hover:text-foreground hover:bg-card-hover transition-all disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          {scraperT.cancelEdit || "取消"}
        </button>
        <button
          onClick={saveBatchRename}
          disabled={saving || changedCount === 0}
          className="flex-1 flex items-center justify-center gap-1 rounded-xl bg-accent py-2 text-xs font-medium text-white shadow-lg shadow-accent/25 transition-all hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />{scraperT.batchEditSaving || "保存中..."}</>
          ) : (
            <><Save className="h-3.5 w-3.5" />{scraperT.batchEditSaveBtn || "保存"} ({changedCount})</>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── 详情面板组件 ── */
function DetailPanel({
  item,
  scraperT,
  isAdmin,
  onClose,
  onRefresh,
}: {
  item: LibraryItem;
  scraperT: Record<string, string>;
  isAdmin: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(item.title);
  const [titleSaving, setTitleSaving] = useState(false);
  const [removingTag, setRemovingTag] = useState<string | null>(null);

  // 保存标题
  const handleSaveTitle = async () => {
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === item.title) {
      setEditingTitle(false);
      setTitleInput(item.title);
      return;
    }
    setTitleSaving(true);
    try {
      const ok = await updateComicMetadata(item.id, { title: trimmed });
      if (ok) {
        onRefresh();
        loadLibrary();
      }
    } finally {
      setTitleSaving(false);
      setEditingTitle(false);
    }
  };

  // 删除标签
  const handleRemoveTag = async (tagName: string) => {
    setRemovingTag(tagName);
    try {
      await removeComicTag(item.id, tagName);
      onRefresh();
      loadLibrary();
    } finally {
      setRemovingTag(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground truncate flex-1 mr-2">
          {scraperT.detailTitle || "书籍详情"}
        </h3>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 封面 + 基本信息 */}
        <div className="flex gap-4">
          <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted/10 shadow-lg">
            <Image
              src={`/api/comics/${item.id}/thumbnail`}
              alt=""
              fill
              className="object-cover"
              sizes="96px"
              unoptimized
            />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {/* 可编辑标题 */}
            {editingTitle ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle();
                    if (e.key === "Escape") { setEditingTitle(false); setTitleInput(item.title); }
                  }}
                  autoFocus
                  disabled={titleSaving}
                  className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-sm font-bold text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50"
                />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleSaveTitle}
                    disabled={titleSaving}
                    className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    {titleSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle className="h-2.5 w-2.5" />}
                    {scraperT.saveTitle || "保存"}
                  </button>
                  <button
                    onClick={() => { setEditingTitle(false); setTitleInput(item.title); }}
                    disabled={titleSaving}
                    className="flex items-center gap-1 rounded-md bg-card-hover px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-2.5 w-2.5" />
                    {scraperT.cancelEdit || "取消"}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`group flex items-start gap-1 ${isAdmin ? "cursor-pointer" : ""}`}
                onClick={() => { if (isAdmin) { setTitleInput(item.title); setEditingTitle(true); } }}
                title={isAdmin ? (scraperT.editTitleHint || "点击编辑书名") : undefined}
              >
                <h4 className="text-base font-bold text-foreground leading-tight line-clamp-2 flex-1">{item.title}</h4>
                {isAdmin && (
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0">
                    <svg className="h-3.5 w-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </span>
                )}
              </div>
            )}
            {item.filename !== item.title && (
              <p className="text-xs text-muted/60 truncate" title={item.filename}>{item.filename}</p>
            )}

            {/* 元数据状态 badge */}
            {item.hasMetadata ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <CheckCircle className="h-3.5 w-3.5" />
                {item.metadataSource}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {scraperT.detailNoMeta || "缺失元数据"}
              </span>
            )}

            {/* 类型 */}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                item.contentType === "novel"
                  ? "bg-blue-500/10 text-blue-400"
                  : "bg-orange-500/10 text-orange-400"
              }`}
            >
              {item.contentType === "novel" ? (
                <><BookOpen className="h-3 w-3" />{scraperT.libTypeNovel || "小说"}</>
              ) : (
                <><FileText className="h-3 w-3" />{scraperT.libTypeComic || "漫画"}</>
              )}
            </span>
          </div>
        </div>

        {/* 元数据信息 */}
        {item.hasMetadata && (
          <div className="space-y-2.5 rounded-xl bg-card-hover/30 p-3">
            {item.author && (
              <div className="flex items-start gap-2">
                <User className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                <div className="text-xs text-foreground/80">{item.author}</div>
              </div>
            )}
            {item.year && (
              <div className="flex items-start gap-2">
                <Clock className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                <div className="text-xs text-foreground/80">{item.year}</div>
              </div>
            )}
            {item.genre && (
              <div className="flex items-start gap-2">
                <Bookmark className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {item.genre.split(",").map((g) => (
                    <span key={g.trim()} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{g.trim()}</span>
                  ))}
                </div>
              </div>
            )}
            {item.description && (
              <div className="flex items-start gap-2">
                <FileText className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                <p className="text-xs text-foreground/70 leading-relaxed line-clamp-4">{item.description}</p>
              </div>
            )}
            {item.tags && item.tags.length > 0 && (
              <div className="flex items-start gap-2">
                <Tag className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((t) => (
                    <span
                      key={t.name}
                      className="group/tag inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition-all"
                      style={{ backgroundColor: t.color ? `${t.color}20` : undefined, color: t.color || undefined }}
                    >
                      {t.name}
                      {isAdmin && (
                        <button
                          onClick={() => handleRemoveTag(t.name)}
                          disabled={removingTag === t.name}
                          className="ml-0.5 opacity-0 group-hover/tag:opacity-100 transition-opacity hover:text-red-400 disabled:opacity-50"
                          title={scraperT.deleteTag || "删除标签"}
                        >
                          {removingTag === t.name ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <X className="h-2.5 w-2.5" />
                          )}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 分隔线 */}
        <div className="border-t border-border/20" />

        {/* 内嵌 MetadataSearch 组件 — 精准刮削 */}
        {isAdmin && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-accent" />
              <h4 className="text-sm font-semibold text-foreground">{scraperT.detailSearchTitle || "精准刮削"}</h4>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              {scraperT.detailSearchDesc || "搜索在线数据源，选择最匹配的结果应用到此书"}
            </p>
            <MetadataSearch
              comicId={item.id}
              comicTitle={item.title}
              filename={item.filename}
              comicType={item.contentType}
              onApplied={() => {
                onRefresh();
                loadLibrary();
                loadStats();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 合集管理面板组件 ── */
function CollectionPanel({
  scraperT,
  groups,
  groupsLoading,
  detail,
  detailLoading,
  autoSuggestions,
  autoLoading,
  createDialogOpen,
  editingId,
  editingName,
  selectedIds,
  onClose,
}: {
  scraperT: Record<string, string>;
  groups: CollectionGroup[];
  groupsLoading: boolean;
  detail: CollectionGroupDetail | null;
  detailLoading: boolean;
  autoSuggestions: AutoDetectSuggestion[];
  autoLoading: boolean;
  createDialogOpen: boolean;
  editingId: number | null;
  editingName: string;
  selectedIds: Set<string>;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [showAutoDetect, setShowAutoDetect] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

  // ── 合集详情视图 ──
  if (detail) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="flex items-center gap-2 p-4 border-b border-border/30 flex-shrink-0">
          <button
            onClick={clearCollectionDetail}
            className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-card-hover text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            {editingId === detail.id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setCollectionEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editingName.trim()) {
                      updateCollection(detail.id, editingName.trim());
                    } else if (e.key === "Escape") {
                      setCollectionEditingId(null);
                    }
                  }}
                  className="flex-1 rounded-lg border border-accent/50 bg-card-hover/50 px-2 py-1 text-sm text-foreground outline-none"
                  autoFocus
                />
                <button
                  onClick={() => editingName.trim() && updateCollection(detail.id, editingName.trim())}
                  className="text-accent hover:text-accent-hover"
                >
                  <CheckCircle className="h-4 w-4" />
                </button>
                <button onClick={() => setCollectionEditingId(null)} className="text-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground truncate">{detail.name}</h3>
                <span className="text-[10px] text-muted px-1.5 py-0.5 rounded bg-card-hover">
                  {(scraperT.collectionItemCount || "{count} 本").replace("{count}", String(detail.comicCount))}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollectionEditingId(detail.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
            title={scraperT.collectionEdit || "编辑"}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
          <button
            onClick={() => {
              // 选中合集内所有漫画，然后触发刮削
              const ids = detail.comics.map(c => c.id);
              ids.forEach(id => {
                if (!selectedIds.has(id)) toggleSelectItem(id);
              });
              closeCollectionPanel();
              startBatchSelectedAction();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent transition-all hover:bg-accent/20"
          >
            <Play className="h-3 w-3" />
            {scraperT.collectionScrapeAll || "刮削整个合集"}
          </button>
        </div>

        {/* 漫画列表 */}
        <div className="flex-1 overflow-y-auto">
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : detail.comics.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted">
              {scraperT.collectionEmpty || "暂无内容"}
            </div>
          ) : (
            <div className="divide-y divide-border/10">
              {detail.comics.map((comic, idx) => (
                <div key={comic.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-card-hover/30 transition-colors group">
                  <span className="text-[10px] text-muted w-5 text-right flex-shrink-0">{idx + 1}</span>
                  <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded border border-border/30 bg-muted/10">
                    <Image
                      src={`/api/comics/${comic.id}/thumbnail`}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="28px"
                      unoptimized
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{comic.title}</div>
                    <div className="text-[10px] text-muted truncate">{comic.filename}</div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {idx > 0 && (
                      <button
                        onClick={() => {
                          const ids = detail.comics.map(c => c.id);
                          [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
                          reorderCollectionComics(detail.id, ids);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-foreground hover:bg-card-hover"
                        title={scraperT.collectionMoveUp || "上移"}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                    )}
                    {idx < detail.comics.length - 1 && (
                      <button
                        onClick={() => {
                          const ids = detail.comics.map(c => c.id);
                          [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
                          reorderCollectionComics(detail.id, ids);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-foreground hover:bg-card-hover"
                        title={scraperT.collectionMoveDown || "下移"}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={() => removeComicFromCollection(detail.id, comic.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-red-400 hover:bg-red-500/10"
                      title={scraperT.collectionRemoveItem || "移除"}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 智能检测视图 ──
  if (showAutoDetect) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-border/30 flex-shrink-0">
          <button onClick={() => setShowAutoDetect(false)} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-card-hover text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">{scraperT.collectionAutoDetect || "智能检测"}</h3>
            <p className="text-[10px] text-muted">{scraperT.collectionAutoDetectDesc || "自动识别可合并的系列漫画"}</p>
          </div>
          {!autoLoading && autoSuggestions.length === 0 && (
            <button
              onClick={autoDetectCollections}
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-accent-hover"
            >
              <Zap className="h-3 w-3" />
              {scraperT.collectionAutoDetect || "开始检测"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {autoLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="text-xs text-muted">正在分析...</span>
            </div>
          ) : autoSuggestions.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted">
              {scraperT.collectionAutoEmpty || "未发现可合并的系列"}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  {scraperT.collectionSuggestions || "检测到的系列"} ({autoSuggestions.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (selectedSuggestions.size === autoSuggestions.length) {
                        setSelectedSuggestions(new Set());
                      } else {
                        setSelectedSuggestions(new Set(autoSuggestions.map((_, i) => i)));
                      }
                    }}
                    className="text-[10px] text-accent hover:underline"
                  >
                    {selectedSuggestions.size === autoSuggestions.length ? "取消全选" : "全选"}
                  </button>
                  <button
                    onClick={() => {
                      const selected = selectedSuggestions.size > 0
                        ? autoSuggestions.filter((_, i) => selectedSuggestions.has(i))
                        : autoSuggestions;
                      batchCreateCollections(selected);
                    }}
                    disabled={autoSuggestions.length === 0}
                    className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-medium text-white transition-all hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {selectedSuggestions.size > 0
                      ? `${scraperT.collectionAutoApplySelected || "创建选中"} (${selectedSuggestions.size})`
                      : scraperT.collectionAutoApplyAll || "全部创建"
                    }
                  </button>
                </div>
              </div>
              {autoSuggestions.map((suggestion, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-3 space-y-2 transition-all cursor-pointer ${
                    selectedSuggestions.has(idx)
                      ? "border-accent/50 bg-accent/5"
                      : "border-border/40 bg-card hover:border-border/60"
                  }`}
                  onClick={() => {
                    const next = new Set(selectedSuggestions);
                    if (next.has(idx)) next.delete(idx); else next.add(idx);
                    setSelectedSuggestions(next);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-4 w-4 rounded border flex items-center justify-center ${
                        selectedSuggestions.has(idx) ? "bg-accent border-accent" : "border-border/60"
                      }`}>
                        {selectedSuggestions.has(idx) && <CheckCircle className="h-3 w-3 text-white" />}
                      </div>
                      <span className="text-xs font-semibold text-foreground">{suggestion.name}</span>
                    </div>
                    <span className="text-[10px] text-muted px-1.5 py-0.5 rounded bg-card-hover">
                      {suggestion.comicIds.length} 本
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {suggestion.titles.slice(0, 5).map((title, ti) => (
                      <span key={ti} className="text-[10px] text-muted bg-card-hover rounded px-1.5 py-0.5 truncate max-w-[150px]">
                        {title}
                      </span>
                    ))}
                    {suggestion.titles.length > 5 && (
                      <span className="text-[10px] text-muted">+{suggestion.titles.length - 5}</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── 合集列表视图 ──
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between p-4 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">{scraperT.collectionTitle || "合集管理"}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setShowAutoDetect(true);
              if (autoSuggestions.length === 0) autoDetectCollections();
            }}
            className="flex items-center gap-1 rounded-lg bg-purple-500/10 px-2 py-1 text-[11px] font-medium text-purple-400 transition-all hover:bg-purple-500/20"
          >
            <Zap className="h-3 w-3" />
            {scraperT.collectionAutoDetect || "智能检测"}
          </button>
          <button
            onClick={() => setCollectionCreateDialog(true)}
            className="flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition-all hover:bg-accent/20"
          >
            <FolderPlus className="h-3 w-3" />
            {scraperT.collectionCreate || "创建"}
          </button>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 创建合集对话框 */}
      {createDialogOpen && (
        <div className="p-4 border-b border-border/20 bg-accent/5 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                createCollection(newName.trim());
                setNewName("");
              } else if (e.key === "Escape") {
                setCollectionCreateDialog(false);
                setNewName("");
              }
            }}
            placeholder={scraperT.collectionCreatePlaceholder || "输入合集名称..."}
            className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setCollectionCreateDialog(false); setNewName(""); }}
              className="rounded-lg px-3 py-1 text-xs text-muted hover:text-foreground transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => { if (newName.trim()) { createCollection(newName.trim()); setNewName(""); } }}
              disabled={!newName.trim()}
              className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {/* 合集列表 */}
      <div className="flex-1 overflow-y-auto">
        {groupsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <FolderOpen className="h-8 w-8 text-muted mx-auto" />
            <div className="text-xs text-muted">{scraperT.collectionEmpty || "暂无合集"}</div>
            <div className="text-[10px] text-muted/60">{scraperT.collectionEmptyHint || "可通过智能检测自动发现系列，或手动创建合集"}</div>
          </div>
        ) : (
          <div className="divide-y divide-border/10">
            {groups.map((group) => (
              <div
                key={group.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-card-hover/30 cursor-pointer transition-colors group"
                onClick={() => loadCollectionDetail(group.id)}
              >
                <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg border border-border/30 bg-muted/10">
                  {group.coverUrl ? (
                    <Image
                      src={group.coverUrl}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="40px"
                      unoptimized
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Layers className="h-4 w-4 text-muted" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {editingId === group.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setCollectionEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editingName.trim()) updateCollection(group.id, editingName.trim());
                          else if (e.key === "Escape") setCollectionEditingId(null);
                        }}
                        className="flex-1 rounded border border-accent/50 bg-card-hover/50 px-1.5 py-0.5 text-xs text-foreground outline-none"
                        autoFocus
                      />
                      <button onClick={() => editingName.trim() && updateCollection(group.id, editingName.trim())} className="text-accent"><CheckCircle className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setCollectionEditingId(null)} className="text-muted"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs font-medium text-foreground truncate">{group.name}</div>
                      <div className="text-[10px] text-muted">
                        {(scraperT.collectionItemCount || "{count} 本").replace("{count}", String(group.comicCount))}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setCollectionEditingId(group.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-foreground hover:bg-card-hover"
                    title={scraperT.collectionEdit || "编辑"}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm((scraperT.collectionDeleteConfirm || '确定要删除合集「{name}」吗？').replace("{name}", group.name))) {
                        deleteCollection(group.id);
                      }
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-red-400 hover:bg-red-500/10"
                    title={scraperT.collectionDelete || "删除"}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted/40 flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 添加到合集弹窗组件 ── */
function AddToCollectionDialog({
  scraperT,
  groups,
  selectedIds,
  onClose,
}: {
  scraperT: Record<string, string>;
  groups: CollectionGroup[];
  selectedIds: Set<string>;
  onClose: () => void;
}) {
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border/50 shadow-2xl w-[380px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">{scraperT.collectionAddToGroup || "添加到合集"}</h3>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 创建新合集 */}
        <div className="p-3 border-b border-border/20">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && newGroupName.trim()) {
                  setCreating(true);
                  await createCollection(newGroupName.trim(), Array.from(selectedIds));
                  setCreating(false);
                  setNewGroupName("");
                  onClose();
                }
              }}
              placeholder={scraperT.collectionCreatePlaceholder || "创建新合集..."}
              className="flex-1 rounded-lg border border-border/40 bg-card-hover/50 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent/50"
            />
            <button
              onClick={async () => {
                if (newGroupName.trim()) {
                  setCreating(true);
                  await createCollection(newGroupName.trim(), Array.from(selectedIds));
                  setCreating(false);
                  setNewGroupName("");
                  onClose();
                }
              }}
              disabled={!newGroupName.trim() || creating}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {scraperT.collectionCreate || "创建"}
            </button>
          </div>
        </div>

        {/* 已有合集列表 */}
        <div className="flex-1 overflow-y-auto max-h-[400px]">
          {groups.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted">{scraperT.collectionEmpty || "暂无合集"}</div>
          ) : (
            <div className="divide-y divide-border/10">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={async () => {
                    await addComicsToCollection(group.id, Array.from(selectedIds));
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card-hover/50 transition-colors text-left"
                >
                  <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg border border-border/30 bg-muted/10">
                    {group.coverUrl ? (
                      <Image src={group.coverUrl} alt="" fill className="object-cover" sizes="32px" unoptimized />
                    ) : (
                      <div className="flex items-center justify-center h-full"><Layers className="h-3 w-3 text-muted" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{group.name}</div>
                    <div className="text-[10px] text-muted">
                      {(scraperT.collectionItemCount || "{count} 本").replace("{count}", String(group.comicCount))}
                    </div>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-accent flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
    // 系列分页
    groupPage,
    groupPageSize,
    groupBatchRunning,
    groupBatchProgress,
    groupBatchDone,
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
        <div className="flex-1 flex flex-col min-w-0 border-r border-border/30">
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

        {/* ── 右侧面板：详情 / 刮削控制 / 进度 / AI聊天 / 帮助 ── */}
        <div data-guide="scrape-panel" className="w-[480px] xl:w-[560px] flex-shrink-0 hidden md:flex flex-col bg-card/20 overflow-hidden">
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
            /* ── 系列详情模式 ── */
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0">
                <h3 className="text-sm font-semibold text-foreground truncate flex-1 mr-2">
                  系列详情
                </h3>
                <button
                  onClick={() => setScraperGroupFocusedId(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 封面 + 基本信息 */}
                <div className="flex gap-4">
                  <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted/10 shadow-lg">
                    {focusedGroup.coverUrl ? (
                      <Image
                        src={focusedGroup.coverUrl}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="96px"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Layers className="h-8 w-8 text-muted/40" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <h4 className="text-base font-bold text-foreground leading-tight line-clamp-2">{focusedGroup.name}</h4>
                    {focusedGroup.author && (
                      <p className="text-xs text-muted/60 flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {focusedGroup.author}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-400">
                        <Layers className="h-3 w-3" />
                        {focusedGroup.comicCount} 卷
                      </span>
                      {focusedGroup.hasMetadata ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                          <CheckCircle className="h-3 w-3" />
                          已有元数据
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                          <AlertCircle className="h-3 w-3" />
                          缺失元数据
                        </span>
                      )}
                      {focusedGroup.status && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                          {focusedGroup.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 元数据详情 */}
                {(focusedGroup.genre || focusedGroup.year || focusedGroup.publisher || focusedGroup.language) && (
                  <div className="rounded-xl bg-card-hover/30 p-3 space-y-1.5">
                    {focusedGroup.genre && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted/50 w-12 flex-shrink-0">类型</span>
                        <span className="text-foreground/70">{focusedGroup.genre}</span>
                      </div>
                    )}
                    {focusedGroup.year && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted/50 w-12 flex-shrink-0">年份</span>
                        <span className="text-foreground/70">{focusedGroup.year}</span>
                      </div>
                    )}
                    {focusedGroup.publisher && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted/50 w-12 flex-shrink-0">出版社</span>
                        <span className="text-foreground/70">{focusedGroup.publisher}</span>
                      </div>
                    )}
                    {focusedGroup.language && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted/50 w-12 flex-shrink-0">语言</span>
                        <span className="text-foreground/70">{focusedGroup.language}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 标签 */}
                {focusedGroup.tags && (
                  <div className="flex flex-wrap gap-1">
                    {focusedGroup.tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                      <span key={tag} className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {focusedGroup.description && (
                  <div className="rounded-xl bg-card-hover/30 p-3">
                    <p className="text-xs text-foreground/70 leading-relaxed line-clamp-6">{focusedGroup.description}</p>
                  </div>
                )}

                {focusedGroup.updatedAt && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted/40">
                    <Clock className="h-3 w-3" />
                    最后更新: {new Date(focusedGroup.updatedAt).toLocaleString()}
                  </div>
                )}

                {/* 系列刮削入口 */}
                <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    <h3 className="text-sm font-semibold text-foreground">系列元数据刮削</h3>
                  </div>
                  <p className="text-xs text-muted">
                    从 AniList、Bangumi 等在线数据库搜索系列信息，或使用 AI 智能识别。支持选择性应用字段和标签同步。
                  </p>
                  <GroupMetadataSearch
                    groupId={focusedGroup.id}
                    groupName={focusedGroup.name}
                    onApplied={async (success) => {
                      if (success) {
                        // 刷新系列列表
                        loadScraperGroups();
                      }
                    }}
                  />
                </div>

                {/* 快捷操作 */}
                <div className="flex gap-2">
                  <a
                    href={`/group/${focusedGroup.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-card-hover/50 px-3 py-2 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    查看系列详情
                  </a>
                </div>
              </div>
            </div>
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
