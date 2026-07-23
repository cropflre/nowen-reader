"use client";

import { useState, useEffect, useCallback } from "react";
import { Folder, ChevronRight, CornerLeftUp, Check, AlertCircle, Loader2, HardDrive, FolderOpen, Home, X } from "lucide-react";
import { apiPath } from "@/lib/base-path";

interface FolderEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface BrowseResult {
  current: string;
  parent: string;
  dirs: FolderEntry[];
  error?: string;
  hint?: string;
}

/**
 * 公共文件夹浏览器弹窗组件
 * 从 SiteSettingsPanel 抽取，供站点设置和书库管理共用
 */
export function FolderBrowser({
  open,
  onClose,
  onSelect,
  siteT,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  siteT?: Record<string, string>;
}) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [parentPath, setParentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch(apiPath(`/api/browse-dirs?path=${encodeURIComponent(path)}`));
      const data: BrowseResult = await res.json();
      if (!res.ok) {
        setError(data.error || `请求失败 (${res.status})`);
        setHint(data.hint || null);
        setEntries([]);
        return;
      }
      setCurrentPath(data.current);
      setParentPath(data.parent);
      setEntries(data.dirs || []);
    } catch {
      setError("网络错误，请检查连接");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) browse("/");
  }, [open, browse]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">
            {siteT?.browseDir || "选择目录"}
          </h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1 border-b border-border px-4 py-2 text-xs text-muted">
          <button
            onClick={() => browse("/")}
            className="rounded p-1 hover:bg-card"
          >
            <Home className="h-3 w-3" />
          </button>
          {currentPath.split("/").filter(Boolean).map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button
                onClick={() => browse("/" + arr.slice(0, i + 1).join("/"))}
                className="hover:text-foreground"
              >
                {part}
              </button>
            </span>
          ))}
        </div>
        <div className="max-h-64 overflow-y-auto px-2 py-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted text-sm">加载中...</div>
          ) : error ? (
            <div className="px-3 py-4">
              <div className="text-sm text-red-500">{error}</div>
              {hint && (
                <pre className="mt-2 whitespace-pre-wrap text-xs text-muted bg-background rounded-lg p-2 max-h-32 overflow-y-auto">
                  {hint}
                </pre>
              )}
            </div>
          ) : (
            <>
              {parentPath && parentPath !== currentPath && (
                <button
                  onClick={() => browse(parentPath)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-card"
                >
                  <FolderOpen className="h-4 w-4" />
                  ..
                </button>
              )}
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => browse(entry.path)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-card"
                >
                  <FolderOpen className="h-4 w-4 text-accent" />
                  {entry.name}
                </button>
              ))}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <div className="flex-1 rounded-lg bg-background px-3 py-1.5 text-sm font-mono text-foreground">
            {currentPath}
          </div>
          <button
            onClick={() => { onSelect(currentPath); onClose(); }}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {siteT?.selectDir || "选择此目录"}
          </button>
        </div>
      </div>
    </div>
  );
}