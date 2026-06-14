"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  HardDrive,
  Database,
  FolderOpen,
  FileText,
  Monitor,
  Shield,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Server,
  Wrench,
  Eye,
  EyeOff,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface DiagnosticItem {
  id: string;
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  detail?: string;
  hint?: string;
}

interface DiagnosticReport {
  generatedAt: string;
  os: string;
  arch: string;
  items: DiagnosticItem[];
  summary: {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
  };
}

type DiagnosticCategory = "filesystem" | "tools" | "database" | "runtime" | "storage";

interface CategoryDef {
  key: DiagnosticCategory;
  label: string;
  icon: React.ReactNode;
  prefixes: string[];
}

// ============================================================
// Constants
// ============================================================

const CATEGORIES: CategoryDef[] = [
  {
    key: "filesystem",
    label: "文件系统",
    icon: <FolderOpen className="h-4 w-4" />,
    prefixes: ["scan-dir", "scan-dirs", "data-dir", "cache-dir"],
  },
  {
    key: "tools",
    label: "渲染与工具",
    icon: <Wrench className="h-4 w-4" />,
    prefixes: ["pdf", "thumbnail", "vips", "convert", "ffmpeg"],
  },
  {
    key: "database",
    label: "数据库",
    icon: <Database className="h-4 w-4" />,
    prefixes: ["database", "comic-count"],
  },
  {
    key: "runtime",
    label: "运行环境",
    icon: <Server className="h-4 w-4" />,
    prefixes: ["docker", "environment", "go-version"],
  },
  {
    key: "storage",
    label: "存储空间",
    icon: <HardDrive className="h-4 w-4" />,
    prefixes: ["disk", "cache-size"],
  },
];

// ============================================================
// Helpers
// ============================================================

function classifyItem(item: DiagnosticItem): DiagnosticCategory {
  const id = item.id.toLowerCase();
  for (const cat of CATEGORIES) {
    for (const prefix of cat.prefixes) {
      if (id.startsWith(prefix) || id.includes(prefix)) return cat.key;
    }
  }
  return "runtime";
}

function healthScore(summary: { total: number; ok: number; warnings: number; errors: number }): number {
  if (summary.total === 0) return 100;
  // Errors cost more than warnings
  const deductions = summary.errors * 15 + summary.warnings * 5;
  return Math.max(0, Math.round(((summary.total * 10 - deductions) / (summary.total * 10)) * 100));
}

function healthLabel(score: number): string {
  if (score >= 95) return "优秀";
  if (score >= 80) return "良好";
  if (score >= 60) return "注意";
  return "需要处理";
}

function healthColor(score: number): string {
  if (score >= 95) return "text-emerald-500";
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

function statusBg(status: string): string {
  switch (status) {
    case "warning":
      return "border-amber-500/30 bg-amber-500/5 dark:border-amber-500/20";
    case "error":
      return "border-red-500/30 bg-red-500/5 dark:border-red-500/20";
    default:
      return "";
  }
}

function StatusIcon({ status, size = "h-4 w-4" }: { status: string; size?: string }) {
  switch (status) {
    case "ok":
      return <CheckCircle className={`${size} text-emerald-500`} />;
    case "warning":
      return <AlertTriangle className={`${size} text-amber-500`} />;
    case "error":
      return <XCircle className={`${size} text-red-500`} />;
    default:
      return <Activity className={`${size} text-muted`} />;
  }
}

// ============================================================
// Main component
// ============================================================

export default function NASDiagnosticsPanel() {
  const router = useRouter();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [copyFeedback, setCopyFeedback] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system/diagnostics", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Categorize items
  const categorized = useMemo(() => {
    if (!report) return new Map<DiagnosticCategory, DiagnosticItem[]>();
    const map = new Map<DiagnosticCategory, DiagnosticItem[]>();
    for (const item of report.items) {
      const cat = classifyItem(item);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return map;
  }, [report]);

  // Issues (warnings + errors)
  const issues = useMemo(() => {
    if (!report) return [];
    return report.items.filter((i) => i.status !== "ok");
  }, [report]);

  // Expand categories with issues by default
  useEffect(() => {
    if (!report) return;
    const catsWithIssues = new Set<string>();
    for (const [cat, items] of categorized) {
      if (items.some((i) => i.status !== "ok")) catsWithIssues.add(cat);
    }
    setExpandedCats(catsWithIssues);
  }, [report, categorized]);

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleCopy = async () => {
    if (!report) return;
    const lines: string[] = [
      `系统诊断报告`,
      `检测时间: ${new Date(report.generatedAt).toLocaleString("zh-CN")}`,
      `平台: ${report.os}/${report.arch}`,
      `总计: ${report.summary.total}  通过: ${report.summary.ok}  警告: ${report.summary.warnings}  错误: ${report.summary.errors}`,
      ``,
    ];
    for (const item of report.items) {
      const icon = item.status === "ok" ? "✓" : item.status === "warning" ? "⚠" : "✗";
      lines.push(`${icon} [${item.name}] ${item.message}`);
      if (item.detail) lines.push(`  路径: ${item.detail}`);
      if (item.hint) lines.push(`  建议: ${item.hint}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // fallback
    }
  };

  const score = report ? healthScore(report.summary) : 0;

  // ============================================================
  // Loading state
  // ============================================================
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 rounded-2xl bg-muted" />
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-16 rounded-2xl bg-muted" />
        <div className="h-16 rounded-2xl bg-muted" />
      </div>
    );
  }

  // ============================================================
  // Error state
  // ============================================================
  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <XCircle className="mx-auto h-10 w-10 text-red-400" />
        <h3 className="mt-3 text-sm font-semibold text-foreground">诊断加载失败</h3>
        <p className="mt-1 text-xs text-muted">{error}</p>
        <button
          onClick={loadReport}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-2 text-sm text-red-500 hover:bg-red-500/20 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          重试
        </button>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="space-y-5">
      {/* ── Layer 1: Health Overview ── */}
      <div className="rounded-2xl border border-border/40 bg-card/70 backdrop-blur-xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: score + status */}
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5">
              <span className={`text-3xl font-bold tracking-tight ${healthColor(score)}`}>
                {score}
              </span>
              <span className="text-[10px] text-muted">健康分</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">系统健康</h2>
              <p className={`text-sm font-medium ${healthColor(score)}`}>
                {healthLabel(score)}
              </p>
              {issues.length > 0 ? (
                <p className="text-xs text-amber-500">发现 {issues.length} 个需要处理的问题</p>
              ) : (
                <p className="text-xs text-emerald-500">所有检测项通过</p>
              )}
            </div>
          </div>

          {/* Right: meta + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-lg bg-background/50 px-3 py-1.5 text-xs text-muted">
              <Monitor className="mr-1.5 inline h-3 w-3" />
              {report.os}/{report.arch}
            </div>
            <div className="rounded-lg bg-background/50 px-3 py-1.5 text-xs text-muted">
              {report.summary.total} 项检测
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-background/50 px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              <Copy className="h-3 w-3" />
              {copyFeedback ? "已复制" : "复制报告"}
            </button>
            <button
              onClick={loadReport}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              重新检测
            </button>
          </div>
        </div>

        {/* Summary badges */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
            <CheckCircle className="h-3 w-3" />
            {report.summary.ok} 通过
          </span>
          {report.summary.warnings > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              {report.summary.warnings} 警告
            </span>
          )}
          {report.summary.errors > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-500">
              <XCircle className="h-3 w-3" />
              {report.summary.errors} 错误
            </span>
          )}
        </div>
      </div>

      {/* ── Layer 2: Issues (priority) ── */}
      {issues.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            需要处理
          </h3>
          {issues.map((item) => (
            <IssueCard key={item.id} item={item} onNavigateSettings={() => router.push("/settings?tab=site")} />
          ))}
        </div>
      )}

      {/* ── Layer 3: Category groups ── */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Activity className="h-4 w-4 text-muted" />
          分类诊断
        </h3>
        {CATEGORIES.map((cat) => {
          const items = categorized.get(cat.key) ?? [];
          if (items.length === 0) return null;
          const hasIssue = items.some((i) => i.status !== "ok");
          const okCount = items.filter((i) => i.status === "ok").length;
          const issueCount = items.length - okCount;
          const expanded = expandedCats.has(cat.key);

          return (
            <div
              key={cat.key}
              className={`rounded-xl border transition-colors ${
                hasIssue ? "border-amber-500/20 bg-amber-500/5 dark:border-amber-500/10" : "border-border/30 bg-card/50"
              }`}
            >
              <button
                onClick={() => toggleCat(cat.key)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card-hover rounded-xl"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  {cat.icon}
                </span>
                <span className="flex-1 text-sm font-medium text-foreground">{cat.label}</span>
                <span className="flex items-center gap-1.5">
                  {issueCount > 0 && (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500">
                      {issueCount}
                    </span>
                  )}
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                    {okCount}
                  </span>
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 text-muted transition-transform" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted transition-transform" />
                  )}
                </span>
              </button>
              {expanded && (
                <div className="border-t border-border/20 px-4 pb-3 pt-2 space-y-1.5">
                  {items.map((item) => (
                    <CompactItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Layer 4: Full list toggle ── */}
      <div className="space-y-3">
        <button
          onClick={() => setShowAll((v) => !v)}
          className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          {showAll ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showAll ? "收起完整列表" : "显示全部检测项"}
        </button>
        {showAll && (
          <div className="space-y-1.5">
            {report.items.map((item) => (
              <CompactItemRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Timestamp */}
      <p className="text-xs text-muted text-right">
        检测时间: {new Date(report.generatedAt).toLocaleString("zh-CN")}
      </p>
    </div>
  );
}

// ============================================================
// Issue Card (warnings + errors, prominent)
// ============================================================

function IssueCard({
  item,
  onNavigateSettings,
}: {
  item: DiagnosticItem;
  onNavigateSettings: () => void;
}) {
  const isDirIssue = item.id.includes("scan-dir") || item.id.includes("data-dir") || item.detail?.includes(":");

  return (
    <div
      className={`rounded-xl border p-4 transition-all hover:shadow-sm ${
        item.status === "error"
          ? "border-red-500/30 bg-red-500/5 dark:border-red-500/15"
          : "border-amber-500/30 bg-amber-500/5 dark:border-amber-500/15"
      }`}
    >
      <div className="flex items-start gap-3">
        <StatusIcon status={item.status} size="h-5 w-5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{item.name}</div>
          <p className="mt-0.5 text-sm text-muted">{item.message}</p>
          {item.detail && (
            <p className="mt-1 truncate rounded-lg bg-background/50 px-2.5 py-1.5 font-mono text-xs text-muted">
              {item.detail}
            </p>
          )}
          {item.hint && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-blue-500/5 border border-blue-500/15 px-3 py-2">
              <span className="text-xs">💡</span>
              <p className="text-xs text-blue-600 dark:text-blue-300">{item.hint}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2 pl-8">
        {isDirIssue && (
          <button
            onClick={onNavigateSettings}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            去站点设置修改
          </button>
        )}
        {item.detail && (
          <button
            onClick={() => navigator.clipboard.writeText(item.detail!)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-background/50 px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
          >
            <Copy className="h-3 w-3" />
            复制路径
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Compact Item Row (ok items, lightweight)
// ============================================================

function CompactItemRow({ item }: { item: DiagnosticItem }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        item.status !== "ok" ? statusBg(item.status) : "hover:bg-card-hover"
      }`}
    >
      <StatusIcon status={item.status} size="h-3.5 w-3.5" />
      <span className="flex-1 min-w-0 truncate text-foreground">{item.name}</span>
      <span className="truncate text-xs text-muted max-w-[50%]">{item.message}</span>
    </div>
  );
}