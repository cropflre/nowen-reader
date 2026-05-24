
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  HardDrive,
  FileText,
  BookOpen,
  Image as ImageIcon,
  BarChart3,
  TrendingUp,
  Globe,
  User,
  Package,
  Database,
  Tag,
  ChevronDown,
  ChevronUp,
  FolderTree,
  Folder,
  FolderOpen,
  ChevronRight,
  Search,
  CheckCircle2,
  ExternalLink,
  ExpandIcon,
  ShrinkIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ============================================================
// Types
// ============================================================

interface FileStats {
  totalFiles: number;
  totalSize: number;
  totalPages: number;
  comicCount: number;
  novelCount: number;
  avgFileSize: number;
  avgPageCount: number;
  withMetadata: number;
  withoutMetadata: number;
  formatStats: { format: string; count: number; totalSize: number }[];
  sizeDistribution: { range: string; count: number }[];
  pageDistribution: { range: string; count: number }[];
  languageStats: { language: string; count: number }[];
  addedTimeline: { month: string; count: number }[];
  largestFiles: FileItem[];
  mostPages: FileItem[];
  authorStats: { author: string; count: number }[];
}

interface FileItem {
  id: string;
  title: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  type: string;
}

interface FolderFileItem {
  id: string;
  title: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  type: string;
  lastRead: number;
}

interface FolderTreeNode {
  name: string;
  path: string;
  fileCount: number;
  totalSize: number;
  totalPages: number;
  comicCount: number;
  novelCount: number;
  readCount: number;
  children: FolderTreeNode[];
  files?: FolderFileItem[];
}

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const FORMAT_COLORS: Record<string, string> = {
  CBZ: "bg-blue-500",
  ZIP: "bg-sky-500",
  CBR: "bg-orange-500",
  RAR: "bg-amber-500",
  CB7: "bg-violet-500",
  "7Z": "bg-purple-500",
  PDF: "bg-red-500",
  EPUB: "bg-emerald-500",
  MOBI: "bg-teal-500",
  AZW3: "bg-cyan-500",
  TXT: "bg-slate-400",
  OTHER: "bg-gray-500",
};

const FORMAT_TEXT_COLORS: Record<string, string> = {
  CBZ: "text-blue-400",
  ZIP: "text-sky-400",
  CBR: "text-orange-400",
  RAR: "text-amber-400",
  CB7: "text-violet-400",
  "7Z": "text-purple-400",
  PDF: "text-red-400",
  EPUB: "text-emerald-400",
  MOBI: "text-teal-400",
  AZW3: "text-cyan-400",
  TXT: "text-slate-400",
  OTHER: "text-gray-400",
};

// ============================================================
// Component
// ============================================================

export default function FileStatsPanel() {
  const [stats, setStats] = useState<FileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandLargest, setExpandLargest] = useState(false);
  const [expandMostPages, setExpandMostPages] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "folder-tree">("overview");
  const [folderTree, setFolderTree] = useState<FolderTreeNode[] | null>(null);
  const [folderTreeLoading, setFolderTreeLoading] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<"all" | "comic" | "novel">("all");
  const [expandAll, setExpandAll] = useState(false);

  useEffect(() => {
    fetch("/api/stats/files")
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 切换到文件夹树视图时懒加载数据
  useEffect(() => {
    if (activeTab === "folder-tree" && !folderTree) {
      setFolderTreeLoading(true);
      fetch("/api/stats/folder-tree")
        .then((r) => r.json())
        .then((data) => setFolderTree(data))
        .catch(() => setFolderTree([]))
        .finally(() => setFolderTreeLoading(false));
    }
  }, [activeTab, folderTree]);

  // 格式百分比
  const formatPercentages = useMemo(() => {
    if (!stats?.formatStats?.length) return [];
    const total = stats.formatStats.reduce((s, f) => s + f.count, 0);
    return stats.formatStats.map((f) => ({
      ...f,
      pct: total > 0 ? Math.round((f.count / total) * 100) : 0,
    }));
  }, [stats?.formatStats]);

  // 入库时间线最大值
  const maxTimelineCount = useMemo(() => {
    if (!stats?.addedTimeline?.length) return 1;
    return Math.max(...stats.addedTimeline.map((t) => t.count), 1);
  }, [stats?.addedTimeline]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted">无法加载文件统计</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Tab 切换 ── */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "overview"
              ? "bg-accent text-white"
              : "bg-card text-muted hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          总览统计
        </button>
        <button
          onClick={() => setActiveTab("folder-tree")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "folder-tree"
              ? "bg-accent text-white"
              : "bg-card text-muted hover:text-foreground"
          }`}
        >
          <FolderTree className="h-3.5 w-3.5" />
          文件夹统计
        </button>
      </div>

      {/* ── 文件夹树视图 ── */}
      {activeTab === "folder-tree" && (
        <div className="rounded-xl bg-card p-4 sm:p-6">
          {/* 标题 + 搜索 + 筛选 */}
          <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FolderTree className="h-4 w-4 text-muted" />
                文件夹层级统计
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExpandAll(!expandAll)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
                  title={expandAll ? "全部折叠" : "全部展开"}
                >
                  {expandAll ? <ShrinkIcon className="h-3.5 w-3.5" /> : <ExpandIcon className="h-3.5 w-3.5" />}
                  {expandAll ? "折叠" : "展开"}
                </button>
              </div>
            </div>
            {/* 搜索框 */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="搜索文件夹或文件名..."
                  className="w-full rounded-lg border border-border/50 bg-background py-1.5 pl-8 pr-3 text-xs text-foreground outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              {/* 类型筛选 */}
              <div className="flex rounded-lg border border-border/50 overflow-hidden">
                {(["all", "comic", "novel"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFolderFilter(f)}
                    className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                      folderFilter === f
                        ? "bg-accent text-white"
                        : "text-muted hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {f === "all" ? "全部" : f === "comic" ? "漫画" : "小说"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {folderTreeLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-accent" />
            </div>
          ) : !folderTree || folderTree.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">暂无文件夹层级数据（所有文件均在根目录下）</p>
          ) : (
            <div className="space-y-0.5">
              {filterFolderTree(folderTree, folderSearch, folderFilter).map((node) => (
                <FolderTreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  forceExpand={expandAll || folderSearch.length > 0}
                  searchTerm={folderSearch}
                  typeFilter={folderFilter}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab !== "overview" ? null : (<>

      {/* ── 总体概览 ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <OverviewCard
          icon={<Package className="h-4 w-4 sm:h-5 sm:w-5 text-accent" />}
          iconBg="bg-accent/15"
          label="总文件数"
          value={stats.totalFiles.toLocaleString()}
        />
        <OverviewCard
          icon={<HardDrive className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-400" />}
          iconBg="bg-emerald-500/15"
          label="总占用空间"
          value={formatBytes(stats.totalSize)}
        />
        <OverviewCard
          icon={<ImageIcon className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400" />}
          iconBg="bg-amber-500/15"
          label="漫画"
          value={stats.comicCount.toLocaleString()}
          sub={`${stats.totalPages.toLocaleString()} 页`}
        />
        <OverviewCard
          icon={<BookOpen className="h-4 w-4 sm:h-5 sm:w-5 text-violet-400" />}
          iconBg="bg-violet-500/15"
          label="小说"
          value={stats.novelCount.toLocaleString()}
        />
      </div>

      {/* ── 副卡片 ── */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-muted mb-2">
            <Database className="h-4 w-4 text-cyan-400" />
            <span className="text-xs">平均大小</span>
          </div>
          <p className="text-lg sm:text-xl font-bold text-foreground">
            {formatBytes(stats.avgFileSize)}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-muted mb-2">
            <FileText className="h-4 w-4 text-pink-400" />
            <span className="text-xs">平均页数</span>
          </div>
          <p className="text-lg sm:text-xl font-bold text-foreground">
            {stats.avgPageCount}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-muted mb-2">
            <Tag className="h-4 w-4 text-rose-400" />
            <span className="text-xs">有元数据</span>
          </div>
          <p className="text-lg sm:text-xl font-bold text-foreground">
            {stats.withMetadata}
            <span className="text-xs font-normal text-muted ml-1">
              / {stats.totalFiles}
            </span>
          </p>
        </div>
      </div>

      {/* ── 格式分布 ── */}
      {formatPercentages.length > 0 && (
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
            <BarChart3 className="h-4 w-4 text-muted" />
            格式分布
          </h2>
          {/* 堆叠条 */}
          <div className="mb-4 flex h-5 w-full overflow-hidden rounded-full bg-background">
            {formatPercentages.map((f) => (
              <div
                key={f.format}
                className={`${FORMAT_COLORS[f.format] || "bg-gray-500"} transition-all`}
                style={{ width: `${Math.max(f.pct, 1)}%` }}
                title={`${f.format}: ${f.pct}% (${f.count})`}
              />
            ))}
          </div>
          {/* 详细列表 */}
          <div className="space-y-2.5">
            {formatPercentages.map((f) => {
              const maxCount = formatPercentages[0]?.count || 1;
              return (
                <div key={f.format} className="flex items-center gap-3">
                  <span className={`w-12 shrink-0 text-xs font-mono font-bold ${FORMAT_TEXT_COLORS[f.format] || "text-gray-400"}`}>
                    {f.format}
                  </span>
                  <div className="flex-1 h-6 rounded-md bg-background overflow-hidden relative">
                    <div
                      className={`h-full rounded-md ${FORMAT_COLORS[f.format] || "bg-gray-500"} opacity-60 transition-all`}
                      style={{ width: `${(f.count / maxCount) * 100}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-foreground">
                      {f.count} 个
                    </span>
                  </div>
                  <span className="shrink-0 w-20 text-right text-xs text-muted">
                    {formatBytes(f.totalSize)}
                  </span>
                  <span className="shrink-0 w-10 text-right text-xs text-muted/60">
                    {f.pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 大小分布 + 页数分布 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 大小分布 */}
        {stats.sizeDistribution.length > 0 && (
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <HardDrive className="h-4 w-4 text-muted" />
              大小分布
            </h2>
            <div className="space-y-2">
              {(() => {
                const maxC = Math.max(...stats.sizeDistribution.map((s) => s.count), 1);
                return stats.sizeDistribution.map((s) => (
                  <div key={s.range} className="flex items-center gap-3">
                    <span className="shrink-0 w-24 text-xs text-muted">{s.range}</span>
                    <div className="flex-1 h-5 rounded-md bg-background overflow-hidden relative">
                      <div
                        className="h-full rounded-md bg-accent/50 transition-all"
                        style={{ width: `${Math.max((s.count / maxC) * 100, 3)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-foreground">
                        {s.count}
                      </span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* 页数分布 */}
        {stats.pageDistribution.length > 0 && (
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <FileText className="h-4 w-4 text-muted" />
              页数分布（漫画）
            </h2>
            <div className="space-y-2">
              {(() => {
                const maxC = Math.max(...stats.pageDistribution.map((s) => s.count), 1);
                return stats.pageDistribution.map((p) => (
                  <div key={p.range} className="flex items-center gap-3">
                    <span className="shrink-0 w-24 text-xs text-muted">{p.range}</span>
                    <div className="flex-1 h-5 rounded-md bg-background overflow-hidden relative">
                      <div
                        className="h-full rounded-md bg-emerald-500/50 transition-all"
                        style={{ width: `${Math.max((p.count / maxC) * 100, 3)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-foreground">
                        {p.count}
                      </span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ── 入库时间线 ── */}
      {stats.addedTimeline.length > 0 && (
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
            <TrendingUp className="h-4 w-4 text-muted" />
            入库趋势（近 24 个月）
          </h2>
          <div className="flex items-end gap-[3px] sm:gap-1.5" style={{ height: 140 }}>
            {stats.addedTimeline.map((t) => (
              <div key={t.month} className="group relative flex flex-1 flex-col items-center">
                <div
                  className="w-full min-w-[4px] sm:min-w-[8px] rounded-t bg-accent/50 transition-colors group-hover:bg-accent"
                  style={{
                    height: `${Math.max((t.count / maxTimelineCount) * 100, 4)}%`,
                  }}
                />
                <div className="pointer-events-none absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block whitespace-nowrap">
                  {t.month}: {t.count} 个
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted">
            <span>{stats.addedTimeline[0]?.month}</span>
            <span>{stats.addedTimeline[stats.addedTimeline.length - 1]?.month}</span>
          </div>
        </div>
      )}

      {/* ── 语言分布 + 作者 Top 10 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 语言分布 */}
        {stats.languageStats.length > 0 && (
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <Globe className="h-4 w-4 text-muted" />
              语言分布
            </h2>
            <div className="space-y-2">
              {(() => {
                const maxC = Math.max(...stats.languageStats.map((l) => l.count), 1);
                return stats.languageStats.map((l, i) => {
                  const colors = [
                    "bg-accent/50", "bg-emerald-500/50", "bg-amber-500/50",
                    "bg-rose-500/50", "bg-violet-500/50", "bg-cyan-500/50",
                    "bg-pink-500/50", "bg-lime-500/50",
                  ];
                  return (
                    <div key={l.language} className="flex items-center gap-3">
                      <span className="shrink-0 w-16 text-xs text-muted truncate">{l.language}</span>
                      <div className="flex-1 h-5 rounded-md bg-background overflow-hidden relative">
                        <div
                          className={`h-full rounded-md ${colors[i % colors.length]} transition-all`}
                          style={{ width: `${Math.max((l.count / maxC) * 100, 3)}%` }}
                        />
                        <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-foreground">
                          {l.count}
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* 作者 Top 10 */}
        {stats.authorStats.length > 0 && (
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <User className="h-4 w-4 text-muted" />
              作者 Top 10
            </h2>
            <div className="space-y-2">
              {stats.authorStats.map((a, i) => {
                const maxC = stats.authorStats[0]?.count || 1;
                return (
                  <div key={a.author} className="flex items-center gap-3">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold ${
                      i === 0 ? "bg-amber-500/20 text-amber-400" :
                      i === 1 ? "bg-slate-400/20 text-slate-300" :
                      i === 2 ? "bg-amber-700/20 text-amber-600" :
                      "bg-muted/10 text-muted"
                    }`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground truncate">{a.author}</span>
                        <span className="shrink-0 ml-2 text-xs text-muted">{a.count} 部</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background">
                        <div className="h-full rounded-full bg-accent/50" style={{ width: `${(a.count / maxC) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Top 10 最大文件 ── */}
      {stats.largestFiles.length > 0 && (
        <CollapsibleFileList
          title="最大文件 Top 10"
          icon={<HardDrive className="h-4 w-4 text-rose-400" />}
          files={stats.largestFiles}
          expanded={expandLargest}
          onToggle={() => setExpandLargest(!expandLargest)}
          valueFormatter={(f) => formatBytes(f.fileSize)}
        />
      )}

      {/* ── Top 10 页数最多 ── */}
      {stats.mostPages.length > 0 && (
        <CollapsibleFileList
          title="页数最多 Top 10"
          icon={<FileText className="h-4 w-4 text-violet-400" />}
          files={stats.mostPages}
          expanded={expandMostPages}
          onToggle={() => setExpandMostPages(!expandMostPages)}
          valueFormatter={(f) => `${f.pageCount} 页`}
        />
      )}

      </>)}
    </div>
  );
}

// ============================================================
// 文件夹树搜索/筛选辅助函数
// ============================================================

function filterFolderTree(
  nodes: FolderTreeNode[],
  search: string,
  typeFilter: "all" | "comic" | "novel"
): FolderTreeNode[] {
  if (!search && typeFilter === "all") return nodes;

  const searchLower = search.toLowerCase();

  function matchNode(node: FolderTreeNode): FolderTreeNode | null {
    const nameMatch = !search || node.name.toLowerCase().includes(searchLower);

    const matchedFiles = (node.files || []).filter((f) => {
      const typeMatch = typeFilter === "all" || f.type === typeFilter;
      const searchMatch = !search ||
        f.title.toLowerCase().includes(searchLower) ||
        f.filename.toLowerCase().includes(searchLower);
      return typeMatch && searchMatch;
    });

    const matchedChildren: FolderTreeNode[] = [];
    for (const child of node.children || []) {
      const matched = matchNode(child);
      if (matched) matchedChildren.push(matched);
    }

    if (matchedChildren.length > 0 || matchedFiles.length > 0 || (nameMatch && node.fileCount > 0)) {
      let fileCount = node.fileCount;
      let comicCount = node.comicCount;
      let novelCount = node.novelCount;
      if (typeFilter !== "all") {
        fileCount = typeFilter === "comic" ? node.comicCount : node.novelCount;
        comicCount = typeFilter === "comic" ? node.comicCount : 0;
        novelCount = typeFilter === "novel" ? node.novelCount : 0;
      }
      if (fileCount === 0 && matchedChildren.length === 0) return null;

      return {
        ...node,
        children: matchedChildren,
        files: matchedFiles.length > 0 ? matchedFiles : node.files,
        fileCount,
        comicCount,
        novelCount,
      };
    }

    return null;
  }

  return nodes.map(matchNode).filter(Boolean) as FolderTreeNode[];
}

function highlightText(text: string, search: string) {
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

// ============================================================
// Sub-components
// ============================================================

function FolderFileRow({
  file,
  searchTerm,
}: {
  file: FolderFileItem;
  searchTerm: string;
}) {
  const router = useRouter();
  const isRead = file.lastRead > 0 && file.pageCount > 0 && file.lastRead >= file.pageCount - 1;
  const readProgress = file.pageCount > 0 ? Math.round((file.lastRead / file.pageCount) * 100) : 0;

  return (
    <div
      onClick={() => {
        if (file.type === "novel") {
          router.push(`/novel/${file.id}`);
        } else {
          router.push(`/comic/${file.id}`);
        }
      }}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 cursor-pointer group"
    >
      {file.type === "novel" ? (
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-violet-400/60" />
      ) : (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-amber-400/60" />
      )}
      <span className="flex-1 truncate text-xs text-muted group-hover:text-foreground transition-colors">
        {highlightText(file.title, searchTerm)}
      </span>
      {isRead ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : readProgress > 0 ? (
        <span className="shrink-0 text-[10px] text-accent">{readProgress}%</span>
      ) : null}
      {file.pageCount > 0 && (
        <span className="shrink-0 text-[10px] text-muted/50">{file.pageCount}p</span>
      )}
      <span className="hidden sm:inline shrink-0 text-[10px] text-muted/50 w-14 text-right">
        {formatBytes(file.fileSize)}
      </span>
      <ExternalLink className="h-3 w-3 shrink-0 text-muted/30 group-hover:text-accent transition-colors" />
    </div>
  );
}

function FolderTreeItem({
  node,
  depth,
  forceExpand = false,
  searchTerm = "",
  typeFilter = "all",
}: {
  node: FolderTreeNode;
  depth: number;
  forceExpand?: boolean;
  searchTerm?: string;
  typeFilter?: "all" | "comic" | "novel";
}) {
  const [expanded, setExpanded] = useState(depth < 1 || forceExpand);
  const [showFiles, setShowFiles] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const hasFiles = node.files && node.files.length > 0;

  // 当外部"全部展开/全部折叠"或搜索状态变化时，同步本地 expanded：
  // - forceExpand=true  → 强制展开本节点（搜索匹配 / 一键展开）
  // - forceExpand=false → 强制折叠本节点（一键折叠 / 清空搜索）
  // 同步完成后，用户仍可单独点击节点再次切换（不会被卡住）。
  useEffect(() => {
    setExpanded(forceExpand);
    if (!forceExpand) {
      // 一键折叠时同时收起"查看文件列表"
      setShowFiles(false);
    }
  }, [forceExpand]);

  const isExpanded = expanded;

  const readPercent = node.fileCount > 0 ? Math.round(((node.readCount || 0) / node.fileCount) * 100) : 0;

  const filteredFiles = (node.files || []).filter(
    (f) => typeFilter === "all" || f.type === typeFilter
  );

  return (
    <div>
      <div
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5 ${
          hasChildren || hasFiles ? "cursor-pointer" : "cursor-default"
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          } else if (hasFiles) {
            setShowFiles(!showFiles);
          }
        }}
      >
        {/* 展开/收起箭头 */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {hasChildren || hasFiles ? (
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted transition-transform ${
                isExpanded || showFiles ? "rotate-90" : ""
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
        <span className="flex-1 truncate text-sm text-foreground">
          {highlightText(node.name, searchTerm)}
        </span>

        {/* 阅读进度条 */}
        {(node.readCount || 0) > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 shrink-0" title={`已读 ${node.readCount}/${node.fileCount}`}>
            <div className="h-1.5 w-12 rounded-full bg-background overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  readPercent === 100 ? "bg-emerald-500" : "bg-accent/60"
                }`}
                style={{ width: `${readPercent}%` }}
              />
            </div>
            <span className="text-[10px] text-muted">{readPercent}%</span>
          </div>
        )}

        {/* 统计信息 */}
        <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <Package className="h-3 w-3" />
            {node.fileCount}
          </span>
          {node.comicCount > 0 && (
            <span className="flex items-center gap-1 text-amber-400/70">
              <ImageIcon className="h-3 w-3" />
              {node.comicCount}
            </span>
          )}
          {node.novelCount > 0 && (
            <span className="flex items-center gap-1 text-violet-400/70">
              <BookOpen className="h-3 w-3" />
              {node.novelCount}
            </span>
          )}
          <span className="hidden sm:inline w-16 text-right">{formatBytes(node.totalSize)}</span>
          {node.totalPages > 0 && (
            <span className="hidden sm:inline w-14 text-right">{node.totalPages.toLocaleString()}p</span>
          )}
        </div>
      </div>

      {/* 子节点 */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              forceExpand={forceExpand}
              searchTerm={searchTerm}
              typeFilter={typeFilter}
            />
          ))}
        </div>
      )}

      {/* 叶子节点的文件列表（无子文件夹时自动展示） */}
      {(isExpanded || showFiles) && hasFiles && !hasChildren && (
        <div style={{ paddingLeft: `${depth * 20 + 28}px` }}>
          {filteredFiles.map((file) => (
            <FolderFileRow key={file.id} file={file} searchTerm={searchTerm} />
          ))}
        </div>
      )}

      {/* 有子节点时的文件列表展开按钮 */}
      {isExpanded && hasFiles && hasChildren && (
        <button
          onClick={() => setShowFiles(!showFiles)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-muted hover:text-foreground transition-colors"
          style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
        >
          <FileText className="h-3 w-3" />
          {showFiles ? "隐藏文件列表" : `查看 ${filteredFiles.length} 个文件`}
        </button>
      )}

      {/* 有子节点时的文件列表 */}
      {showFiles && hasFiles && hasChildren && (
        <div style={{ paddingLeft: `${(depth + 1) * 20 + 28}px` }}>
          {filteredFiles.map((file) => (
            <FolderFileRow key={file.id} file={file} searchTerm={searchTerm} />
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewCard({
  icon, iconBg, label, value, sub,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2 text-muted">
        <div className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <span className="text-xs sm:text-sm">{label}</span>
      </div>
      <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground">
        {value}
      </p>
      {sub && (
        <p className="text-[10px] sm:text-xs text-muted mt-1">{sub}</p>
      )}
    </div>
  );
}

function CollapsibleFileList({
  title, icon, files, expanded, onToggle, valueFormatter,
}: {
  title: string;
  icon: React.ReactNode;
  files: FileItem[];
  expanded: boolean;
  onToggle: () => void;
  valueFormatter: (f: FileItem) => string;
}) {
  const visibleFiles = expanded ? files : files.slice(0, 5);

  return (
    <div className="rounded-xl bg-card p-4 sm:p-6">
      <button
        onClick={onToggle}
        className="mb-3 flex w-full items-center justify-between text-sm font-medium text-foreground hover:text-accent transition-colors"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
      </button>
      <div className="space-y-2">
        {visibleFiles.map((f, i) => (
          <div key={f.id} className="flex items-center gap-3 rounded-lg bg-background/50 px-3 py-2.5">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
              i === 0 ? "bg-amber-500/20 text-amber-400" :
              i === 1 ? "bg-slate-400/20 text-slate-300" :
              i === 2 ? "bg-amber-700/20 text-amber-600" :
              "bg-muted/10 text-muted"
            }`}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm text-foreground">{f.title}</p>
              <p className="truncate text-[10px] text-muted/60">{f.filename}</p>
            </div>
            <span className="shrink-0 rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
              {valueFormatter(f)}
            </span>
          </div>
        ))}
      </div>
      {files.length > 5 && !expanded && (
        <button
          onClick={onToggle}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs text-muted hover:text-foreground transition-colors"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          展开全部（{files.length}）
        </button>
      )}
    </div>
  );
}
