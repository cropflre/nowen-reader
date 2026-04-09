"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import {
  X, Plus, Trash2, Loader2, Search, ChevronRight, Layers, FolderPlus,
  Sparkles, CheckCircle, AlertCircle, Pencil, Check, ArrowUpDown,
  ArrowLeft, Play, ChevronUp, ChevronDown, Minus, Zap, FolderOpen,
} from "lucide-react";
import {
  loadCollectionGroups,
  loadCollectionDetail,
  clearCollectionDetail,
  createCollection,
  updateCollection,
  deleteCollection,
  removeComicFromCollection,
  reorderCollectionComics,
  autoDetectCollections,
  batchCreateCollections,
  setCollectionEditingId,
  setCollectionEditingName,
  setCollectionCreateDialog,
  toggleSelectItem,
  closeCollectionPanel,
  startBatchSelected,
} from "@/lib/scraper-store";
import type { CollectionGroup, CollectionGroupDetail, CollectionGroupComic, AutoDetectSuggestion } from "@/lib/scraper-store";

export function CollectionPanel({
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
              startBatchSelected();
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

