"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Filter,
  Download,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface ErrorLogEntry {
  time: string;
  status: number;
  method: string;
  path: string;
  clientIP: string;
  latency: string;
  latencyMs: number;
  bodySize: number;
  error?: string;
}

interface LogsResponse {
  logs: ErrorLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

interface LogStats {
  total: number;
  statusCounts: Record<string, number>;
  methodCounts: Record<string, number>;
  topPaths: { path: string; count: number }[];
}

// 状态码颜色样式
function statusColor(status: number): string {
  if (status >= 500) return "text-red-400";
  if (status >= 400) return "text-yellow-400";
  return "text-muted";
}

// HTTP方法颜色样式
function methodColor(method: string): string {
  switch (method) {
    case "GET":
      return "text-blue-400";
    case "POST":
      return "text-green-400";
    case "PUT":
      return "text-yellow-400";
    case "DELETE":
      return "text-red-400";
    default:
      return "text-muted";
  }
}

export default function LogsPage() {
  const router = useRouter();
  const t = useTranslation();
  const logT = (t as Record<string, Record<string, string>>).errorLogs || {};

  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showStats, setShowStats] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [methodFilter, setMethodFilter] = useState<string>("");
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const pageSize = 20;

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (statusFilter) params.set("status", statusFilter);
      if (methodFilter) params.set("method", methodFilter);

      const res = await fetch(`/api/logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data: LogsResponse = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, methodFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/logs/stats");
      if (!res.ok) return;
      const data: LogStats = await res.json();
      setStats(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
    fetchStats();
  }, [fetchLogs, fetchStats]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchLogs();
      fetchStats();
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs, fetchStats]);

  const handleClear = async () => {
    if (!confirm(logT.confirmClear || "确定要清空所有错误日志吗？")) return;
    setClearing(true);
    try {
      await fetch("/api/logs", { method: "DELETE" });
      setLogs([]);
      setTotal(0);
      setStats(null);
      setPage(1);
      fetchStats();
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  // 导出日志
  const handleExport = async (format: "json" | "csv") => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const params = new URLSearchParams({ format });
      if (statusFilter) params.set("status", statusFilter);
      if (methodFilter) params.set("method", methodFilter);

      const res = await fetch(`/api/logs/export?${params}`);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const ext = format === "csv" ? "csv" : "json";
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `error_logs_${timestamp}.${ext}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <AlertTriangle className="h-5 w-5 text-accent" />
            <h1 className="text-lg font-bold text-foreground">
              {logT.title || "错误日志"}
            </h1>
            {total > 0 && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                {total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* 自动刷新 */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`rounded-lg p-2 text-xs transition-colors ${
                autoRefresh
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
              title={logT.autoRefresh || "自动刷新"}
            >
              <RefreshCw
                className={`h-4 w-4 ${autoRefresh ? "animate-spin" : ""}`}
              />
            </button>
            {/* 手动刷新 */}
            <button
              onClick={() => {
                fetchLogs();
                fetchStats();
              }}
              className="rounded-lg p-2 text-muted transition-colors hover:text-foreground"
              title={logT.refresh || "刷新"}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {/* 导出 */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={exporting || total === 0}
                className="rounded-lg p-2 text-muted transition-colors hover:text-foreground disabled:opacity-50"
                title={logT.export || "导出日志"}
              >
                {exporting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-border/60 bg-card shadow-xl">
                  <button
                    onClick={() => handleExport("json")}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-background rounded-t-lg transition-colors"
                  >
                    <span className="font-mono text-accent">JSON</span>
                    <span className="text-muted">{logT.exportJSON || "导出 JSON"}</span>
                  </button>
                  <button
                    onClick={() => handleExport("csv")}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-background rounded-b-lg transition-colors"
                  >
                    <span className="font-mono text-green-400">CSV</span>
                    <span className="text-muted">{logT.exportCSV || "导出 CSV"}</span>
                  </button>
                </div>
              )}
            </div>
            {/* 清空 */}
            <button
              onClick={handleClear}
              disabled={clearing || total === 0}
              className="rounded-lg p-2 text-muted transition-colors hover:text-red-400 disabled:opacity-50"
              title={logT.clear || "清空日志"}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* 统计信息折叠 */}
        {stats && stats.total > 0 && (
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <button
              onClick={() => setShowStats(!showStats)}
              className="flex w-full items-center justify-between text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                {logT.statistics || "统计概览"}
              </span>
              {showStats ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {showStats && (
              <div className="mt-4 space-y-4">
                {/* 状态码分布 */}
                <div>
                  <div className="text-xs text-muted mb-2">
                    {logT.statusDistribution || "状态码分布"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.statusCounts)
                      .sort(([a], [b]) => Number(b) - Number(a))
                      .map(([code, count]) => (
                        <button
                          key={code}
                          onClick={() =>
                            setStatusFilter(statusFilter === code ? "" : code)
                          }
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-mono transition-colors ${
                            statusFilter === code
                              ? "bg-accent/20 text-accent ring-1 ring-accent/30"
                              : "bg-background text-muted hover:text-foreground"
                          }`}
                        >
                          <span className={statusColor(Number(code))}>
                            {code}
                          </span>
                          <span className="text-muted">×{count}</span>
                        </button>
                      ))}
                  </div>
                </div>

                {/* 高频路径 */}
                {stats.topPaths.length > 0 && (
                  <div>
                    <div className="text-xs text-muted mb-2">
                      {logT.topPaths || "高频错误路径"}
                    </div>
                    <div className="space-y-1.5">
                      {stats.topPaths.slice(0, 8).map((p) => (
                        <div
                          key={p.path}
                          className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-xs"
                        >
                          <span className="truncate text-foreground font-mono max-w-[85%]">
                            {p.path}
                          </span>
                          <span className="text-red-400 ml-2 shrink-0">
                            ×{p.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 过滤器 */}
        {(statusFilter || methodFilter) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">{logT.filtering || "过滤中"}:</span>
            {statusFilter && (
              <button
                onClick={() => setStatusFilter("")}
                className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-accent"
              >
                Status: {statusFilter} <span className="ml-0.5">×</span>
              </button>
            )}
            {methodFilter && (
              <button
                onClick={() => setMethodFilter("")}
                className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-accent"
              >
                Method: {methodFilter} <span className="ml-0.5">×</span>
              </button>
            )}
          </div>
        )}

        {/* 日志列表 */}
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-muted/20 mb-4" />
            <p className="text-sm text-muted">
              {logT.noLogs || "暂无错误日志"}
            </p>
            <p className="text-xs text-muted/60 mt-2">
              {logT.noLogsHint ||
                "当接口返回 4xx/5xx 错误时会自动记录"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((entry, idx) => (
              <div
                key={`${entry.time}-${idx}`}
                className="group rounded-xl bg-card p-3 sm:p-4 hover:bg-card-hover transition-colors"
              >
                {/* 第一行：时间 + 状态码 + 方法 */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="text-muted/70">{entry.time}</span>
                    <span
                      className={`font-mono font-bold ${statusColor(entry.status)}`}
                    >
                      {entry.status}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-medium ${methodColor(entry.method)}`}
                    >
                      {entry.method}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted/50">
                    {entry.latency}
                  </span>
                </div>
                {/* 第二行：路径 */}
                <div
                  className="text-sm font-mono text-foreground truncate"
                  title={entry.path}
                >
                  {entry.path}
                </div>
                {/* 第三行：错误信息 (如果有) */}
                {entry.error && (
                  <div
                    className="mt-1.5 text-xs text-red-400/80 truncate"
                    title={entry.error}
                  >
                    {entry.error}
                  </div>
                )}
                {/* 附加信息 */}
                <div className="flex items-center gap-4 mt-1.5 text-[11px] text-muted/50">
                  <span>IP: {entry.clientIP}</span>
                  <span>{entry.bodySize} bytes</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted">
              {logT.pageInfo
                ? logT.pageInfo
                    .replace("{page}", String(page))
                    .replace("{total}", String(totalPages))
                : `第 ${page} / ${totalPages} 页`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-30 transition-colors border border-border/60"
              >
                {logT.prevPage || "上一页"}
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-30 transition-colors border border-border/60"
              >
                {logT.nextPage || "下一页"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
