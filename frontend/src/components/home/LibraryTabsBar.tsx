"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Library, Book, BookOpen, Layers, Check, Settings2, Eye, EyeOff } from "lucide-react";
import type { Library as LibraryType } from "@/api/libraries";

interface LibraryTabsBarProps {
  libraries: LibraryType[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  hiddenIds?: string[];
  onToggleVisible?: (id: string) => void;
  onShowAll?: () => void;
  allLibraries?: LibraryType[];
}

const typeIcons: Record<string, typeof Library> = {
  comic: Book,
  novel: BookOpen,
  mixed: Layers,
};

function LibraryChip({
  label,
  count,
  icon: Icon,
  active,
  multiSelected,
  onClick,
}: {
  label: string;
  count: number;
  icon: typeof Library;
  active: boolean;
  multiSelected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-200 ${
        active
          ? "bg-accent text-white shadow-sm shadow-accent/25"
          : multiSelected
            ? "bg-accent/15 text-accent border border-accent/30"
            : "bg-card text-muted border border-border/60 hover:text-foreground hover:bg-card-hover"
      }`}
      style={{ minHeight: 36 }}
    >
      {multiSelected && !active && (
        <Check className="h-3.5 w-3.5 shrink-0" />
      )}
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate max-w-[120px]">{label}</span>
      <span className={`text-xs tabular-nums ${active ? "text-white/80" : "text-muted/70"}`}>
        {count}
      </span>
    </button>
  );
}

/** 书库显示管理弹窗 */
function VisibilityDialog({
  allLibraries,
  hiddenIds,
  onToggle,
  onShowAll,
  onClose,
}: {
  allLibraries: LibraryType[];
  hiddenIds: string[];
  onToggle: (id: string) => void;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭 + Esc 关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const allVisible = hiddenIds.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        ref={dialogRef}
        className="w-full max-w-sm mx-4 rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden"
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <h3 className="text-sm font-semibold text-foreground">管理首页显示的书库</h3>
          <button onClick={onClose} className="p-1 rounded-md text-muted hover:text-foreground hover:bg-card-hover transition-colors">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 书库列表 */}
        <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
          {allLibraries.map((lib) => {
            const isHidden = hiddenIds.includes(lib.id);
            const Icon = typeIcons[lib.type] ?? Library;
            return (
              <button
                key={lib.id}
                onClick={() => onToggle(lib.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-card-hover"
              >
                <div className={`flex items-center justify-center w-5 h-5 rounded-md border transition-colors ${
                  isHidden
                    ? "border-border/60 bg-transparent"
                    : "border-accent bg-accent"
                }`}>
                  {!isHidden && (
                    <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <Icon className="h-4 w-4 shrink-0 text-muted" />
                <span className={`text-sm flex-1 text-left ${isHidden ? "text-muted" : "text-foreground"}`}>
                  {lib.name}
                </span>
                <span className="text-xs text-muted/70 tabular-nums">{lib.comicCount ?? 0}</span>
                {isHidden ? (
                  <EyeOff className="h-3.5 w-3.5 text-muted/50 shrink-0" />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-muted/50 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border/40">
          <button
            onClick={onShowAll}
            disabled={allVisible}
            className="text-xs px-3 py-1.5 rounded-lg border border-border/60 text-muted hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            全选
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

export function LibraryTabsBar({
  libraries,
  selectedIds,
  onChange,
  hiddenIds = [],
  onToggleVisible,
  onShowAll,
  allLibraries,
}: LibraryTabsBarProps) {
  const [multiMode, setMultiMode] = useState(false);
  const [showVisibility, setShowVisibility] = useState(false);
  const totalCount = allLibraries
    ? allLibraries.reduce((sum, l) => sum + (l.comicCount ?? 0), 0)
    : libraries.reduce((sum, l) => sum + (l.comicCount ?? 0), 0);
  const isAll = selectedIds.length === 0;
  const hasHidden = hiddenIds.length > 0;
  const canManage = !!onToggleVisible && !!allLibraries && allLibraries.length > 1;

  const handleAllClick = () => {
    onChange([]);
    if (!multiMode) setMultiMode(false);
  };

  const handleChipClick = (id: string) => {
    if (multiMode) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      onChange(next);
    } else {
      onChange([id]);
    }
  };

  const handleToggle = useCallback((id: string) => {
    onToggleVisible?.(id);
  }, [onToggleVisible]);

  const handleShowAll = useCallback(() => {
    onShowAll?.();
  }, [onShowAll]);

  if (allLibraries && allLibraries.length <= 1) return null;
  if (libraries.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted/70">
          <Library className="h-3.5 w-3.5" />
          我的书库
        </div>
        <div className="flex items-center gap-1">
          {canManage && (
            <button
              onClick={() => setShowVisibility(true)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors ${
                hasHidden
                  ? "text-accent hover:bg-accent/10"
                  : "text-muted hover:text-foreground hover:bg-card-hover"
              }`}
              title="管理首页显示的书库"
            >
              <Settings2 className="h-3 w-3" />
              管理显示
            </button>
          )}
          {libraries.length > 1 && (
            <button
              onClick={() => {
                setMultiMode(!multiMode);
                if (multiMode && selectedIds.length > 1) {
                  onChange([selectedIds[0]]);
                }
              }}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                multiMode
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-foreground hover:bg-card-hover"
              }`}
            >
              {multiMode ? "完成" : "多选"}
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
        <LibraryChip
          label="全部"
          count={totalCount}
          icon={Layers}
          active={isAll}
          onClick={handleAllClick}
        />
        {libraries.map((lib) => {
          const Icon = typeIcons[lib.type] ?? Library;
          const selected = selectedIds.includes(lib.id);
          const active = !multiMode && selectedIds.length === 1 && selected;
          return (
            <LibraryChip
              key={lib.id}
              label={lib.name}
              count={lib.comicCount ?? 0}
              icon={Icon}
              active={active}
              multiSelected={multiMode && selected}
              onClick={() => handleChipClick(lib.id)}
            />
          );
        })}
      </div>

      {/* 管理显示弹窗 */}
      {showVisibility && canManage && allLibraries && (
        <VisibilityDialog
          allLibraries={allLibraries}
          hiddenIds={hiddenIds}
          onToggle={handleToggle}
          onShowAll={handleShowAll}
          onClose={() => setShowVisibility(false)}
        />
      )}
    </div>
  );
}
