"use client";

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";

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

const statusIcons: Record<string, React.ReactNode> = {
  ok: <CheckCircle className="h-4 w-4 text-green-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-yellow-400" />,
  error: <XCircle className="h-4 w-4 text-red-400" />,
};

const statusColors: Record<string, string> = {
  ok: "border-green-500/20 bg-green-500/5",
  warning: "border-yellow-500/20 bg-yellow-500/5",
  error: "border-red-500/20 bg-red-500/5",
};

const categoryIcons: Record<string, React.ReactNode> = {
  "scan-dir": <FolderOpen className="h-4 w-4 text-blue-400" />,
  "data-dir": <Database className="h-4 w-4 text-purple-400" />,
  "cache-dir": <HardDrive className="h-4 w-4 text-cyan-400" />,
  "pdf": <FileText className="h-4 w-4 text-orange-400" />,
  "thumbnail": <FileText className="h-4 w-4 text-pink-400" />,
  "database": <Database className="h-4 w-4 text-blue-400" />,
  "docker": <Monitor className="h-4 w-4 text-sky-400" />,
  "disk": <HardDrive className="h-4 w-4 text-emerald-400" />,
};

function getCategoryIcon(id: string): React.ReactNode {
  for (const [prefix, icon] of Object.entries(categoryIcons)) {
    if (id.startsWith(prefix) || id.includes(prefix)) return icon;
  }
  return <Activity className="h-4 w-4 text-gray-400" />;
}

export default function NASDiagnosticsPanel() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system/diagnostics");
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-400" />
          <h3 className="text-lg font-medium text-white">系统诊断</h3>
        </div>
        <button
          onClick={loadReport}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          重新检测
        </button>
      </div>

      <p className="text-sm text-gray-400">
        检查系统环境、目录权限、工具可用性等，帮助排查部署和使用问题。
      </p>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          检测失败: {error}
        </div>
      )}

      {/* Summary bar */}
      {report && !loading && (
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2">
            <span className="text-xs text-gray-400">总计</span>
            <span className="text-sm font-medium text-white">{report.summary.total}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-green-500/10 px-3 py-2">
            <CheckCircle className="h-3.5 w-3.5 text-green-400" />
            <span className="text-sm font-medium text-green-400">{report.summary.ok}</span>
          </div>
          {report.summary.warnings > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-yellow-500/10 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
              <span className="text-sm font-medium text-yellow-400">{report.summary.warnings}</span>
            </div>
          )}
          {report.summary.errors > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2">
              <XCircle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-sm font-medium text-red-400">{report.summary.errors}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 ml-auto">
            <span className="text-xs text-gray-400">{report.os}/{report.arch}</span>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-gray-800/50"
            />
          ))}
        </div>
      )}

      {/* Diagnostic items */}
      {report && !loading && (
        <div className="space-y-2">
          {report.items.map((item) => (
            <div
              key={item.id}
              className={`rounded-lg border p-3 ${statusColors[item.status]}`}
            >
              <div className="flex items-center gap-2">
                {getCategoryIcon(item.id)}
                <span className="text-sm font-medium text-white flex-1 min-w-0 truncate">
                  {item.name}
                </span>
                {statusIcons[item.status]}
              </div>
              <p className="mt-1 text-sm text-gray-300">{item.message}</p>
              {item.detail && (
                <p className="mt-0.5 text-xs text-gray-500 font-mono truncate">
                  {item.detail}
                </p>
              )}
              {item.hint && (
                <div className="mt-2 rounded bg-blue-500/10 border border-blue-500/20 px-2.5 py-1.5">
                  <p className="text-xs text-blue-300">
                    💡 {item.hint}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Timestamp */}
      {report && !loading && (
        <p className="text-xs text-gray-600 text-right">
          检测时间: {new Date(report.generatedAt).toLocaleString("zh-CN")}
        </p>
      )}
    </div>
  );
}
