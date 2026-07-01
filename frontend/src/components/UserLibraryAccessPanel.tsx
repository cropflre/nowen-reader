"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Library,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  Shield,
  BookOpen
} from "lucide-react";
import {
  fetchUserLibraryAccess,
  setUserLibraryAccess,
  type Library as LibraryType,
  type LibraryAccess
} from "@/api/libraries";
import { notifyLibraryAccessChanged } from "@/hooks/useComics";

interface UserLibraryAccessPanelProps {
  userId: string;
  username: string;
  isAdmin: boolean;
  onClose: () => void;
}

type LibraryPermissionField = 'canView' | 'canDownload' | 'canManage';
type LibraryAccessRow = LibraryType & LibraryAccess;

function applyLibraryPermissionToggle(lib: LibraryAccessRow, field: LibraryPermissionField): LibraryAccessRow {
  const next = { ...lib, [field]: !lib[field] };
  if ((field === 'canDownload' || field === 'canManage') && next[field]) {
    next.canView = true;
  }
  if (field === 'canView' && !next.canView) {
    next.canDownload = false;
    next.canManage = false;
  }
  return next;
}

export function UserLibraryAccessPanel({
  userId,
  username,
  isAdmin,
  onClose,
}: UserLibraryAccessPanelProps) {
  const [libraries, setLibraries] = useState<
    LibraryAccessRow[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const showMessage = useCallback((msg: string, isError = false) => {
    if (isError) {
      setError(msg);
      setSuccess("");
    } else {
      setSuccess(msg);
      setError("");
    }
    setTimeout(() => {
      setError("");
      setSuccess("");
    }, 3000);
  }, []);

  const fetchAccess = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchUserLibraryAccess(userId);
      setLibraries(data.libraries || []);
    } catch {
      showMessage("获取书库权限失败", true);
    } finally {
      setLoading(false);
    }
  }, [userId, showMessage]);

  useEffect(() => {
    fetchAccess();
  }, [fetchAccess]);

  const handleToggle = (libraryId: string, field: LibraryPermissionField) => {
    setLibraries((prev) =>
      prev.map((lib) =>
        lib.id === libraryId ? applyLibraryPermissionToggle(lib, field) : lib
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const accessList = libraries
        .filter((lib) => lib.canView || lib.canDownload || lib.canManage)
        .map((lib) => ({
          libraryId: lib.id,
          canView: !!lib.canView,
          canDownload: !!lib.canDownload,
          canManage: !!lib.canManage
        }));
      await setUserLibraryAccess(userId, accessList);
      notifyLibraryAccessChanged();
      showMessage("书库权限更新成功");
      setTimeout(() => onClose(), 1000);
    } catch (err) {
      showMessage(
        err instanceof Error ? err.message : "更新失败",
        true
      );
    } finally {
      setSaving(false);
    }
  };

  if (isAdmin) {
    return (
      <div className="p-6 rounded-2xl bg-card border border-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-accent/10">
            <Shield className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">管理员权限</h3>
            <p className="text-sm text-muted">
              管理员默认拥有所有书库的访问权限
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-card hover:bg-card-hover transition-colors text-foreground"
        >
          关闭
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-2xl bg-card border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/10">
            <Library className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">书库访问权限</h3>
            <p className="text-sm text-muted">
              配置用户 <span className="font-medium text-foreground">{username}</span> 可以访问的书库
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 消息提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-4">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-4">
          <Check className="h-4 w-4" />
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : libraries.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-muted">
          <Library className="h-8 w-8 mb-2" />
          <p>暂无可用书库</p>
        </div>
      ) : (
        <>
          <div className="space-y-2 mb-4">
            {libraries.map((lib) => {
              const isPublic = lib.defaultAccess === "public";
              return (
              <div
                key={lib.id}
                className="flex flex-col gap-2 rounded-lg border px-3 py-2 border-border/30"
              >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{lib.name}</div>
                    <div className="text-sm text-muted">
                      {(lib.rootPaths && lib.rootPaths.length > 0 ? lib.rootPaths : [lib.rootPath]).map((path, index) => (
                        <div key={index} className="truncate">{path}</div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 ml-6 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={lib.canView || isPublic} disabled={isPublic} onChange={() => handleToggle(lib.id, 'canView')} className="rounded border-border text-accent focus:ring-accent" /> 查看
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={!!lib.canDownload} onChange={() => handleToggle(lib.id, 'canDownload')} className="rounded border-border text-accent focus:ring-accent" /> 下载
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={!!lib.canManage} onChange={() => handleToggle(lib.id, 'canManage')} className="rounded border-border text-accent focus:ring-accent" /> 管理
                  </label>
                </div>
              </div>
            )})}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-card hover:bg-card-hover transition-colors text-foreground"
            >
              取消
            </button>
          </div>
        </>
      )}
    </div>
  );
}
