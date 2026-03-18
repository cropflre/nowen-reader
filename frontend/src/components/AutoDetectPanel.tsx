"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import {
  X,
  Wand2,
  FolderPlus,
  Check,
  CheckSquare,
  Square,
  Loader2,
  Layers,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Cpu,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { autoDetectGroups, batchCreateGroups } from "@/api/groups";
import { useAIStatus } from "@/hooks/useAIStatus";
import type { AutoDetectGroup } from "@/hooks/useComicTypes";

interface AutoDetectPanelProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function AutoDetectPanel({
  open,
  onClose,
  onCreated,
}: AutoDetectPanelProps) {
  const t = useTranslation();
  const { locale } = useLocale();
  const { aiConfigured } = useAIStatus();
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AutoDetectGroup[] | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  // 编辑分组名
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  // 弹窗打开时重置所有状态
  useEffect(() => {
    if (open) {
      setLoading(false);
      setAiLoading(false);
      setSuggestions(null);
      setSelectedIndices(new Set());
      setExpandedIndices(new Set());
      setCreating(false);
      setCreatedCount(0);
      setEditingIndex(null);
      setEditName("");
    }
  }, [open]);

  const handleDetect = useCallback(async () => {
    setLoading(true);
    setSuggestions(null);
    setSelectedIndices(new Set());
    setExpandedIndices(new Set());
    setCreatedCount(0);
    try {
      const results = await autoDetectGroups();
      setSuggestions(results);
      // 默认全选
      setSelectedIndices(new Set(results.map((_, i) => i)));
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // AI 增强检测
  const handleAIDetect = useCallback(async () => {
    setAiLoading(true);
    setSuggestions(null);
    setSelectedIndices(new Set());
    setExpandedIndices(new Set());
    setCreatedCount(0);
    try {
      const res = await fetch("/api/ai/enhance-group-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale === "en" ? "en" : "zh" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "AI detection failed");
      }
      const data = await res.json();
      const results: AutoDetectGroup[] = (data.suggestions || []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => ({
          name: s.name,
          comicIds: s.comicIds,
          titles: s.titles || [],
          reason: s.reason || "",
          source: s.source || "ai",
        })
      );
      setSuggestions(results);
      setSelectedIndices(new Set(results.map((_, i) => i)));
    } catch {
      setSuggestions([]);
    } finally {
      setAiLoading(false);
    }
  }, [locale]);

  const toggleSelect = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!suggestions) return;
    setSelectedIndices((prev) => {
      if (prev.size === suggestions.length) return new Set();
      return new Set(suggestions.map((_, i) => i));
    });
  }, [suggestions]);

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const startEditName = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!suggestions) return;
      setEditingIndex(index);
      setEditName(suggestions[index].name);
    },
    [suggestions]
  );

  const saveEditName = useCallback(
    (index: number) => {
      if (!suggestions || !editName.trim()) {
        setEditingIndex(null);
        return;
      }
      setSuggestions((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next[index] = { ...next[index], name: editName.trim() };
        return next;
      });
      setEditingIndex(null);
    },
    [suggestions, editName]
  );

  const handleCreateSelected = useCallback(async () => {
    if (!suggestions || selectedIndices.size === 0) return;
    setCreating(true);
    const selected = Array.from(selectedIndices).map((i) => suggestions[i]);
    try {
      const result = await batchCreateGroups(selected);
      if (result.success) {
        setCreatedCount(result.created);
        // 移除已创建的建议
        setSuggestions((prev) => {
          if (!prev) return prev;
          return prev.filter((_, i) => !selectedIndices.has(i));
        });
        setSelectedIndices(new Set());
        onCreated();
      }
    } finally {
      setCreating(false);
    }
  }, [suggestions, selectedIndices, onCreated]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[70] bg-black/60 animate-backdrop-in" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-2 sm:inset-4 z-[70] mx-auto my-auto flex max-h-[90vh] sm:max-h-[85vh] max-w-3xl flex-col rounded-2xl bg-background border border-border/40 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-foreground">
              {t.comicGroup?.autoDetect || "智能检测"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4">
          {/* 初始状态 */}
          {!loading && suggestions === null && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <Wand2 className="h-8 w-8 text-accent" />
              </div>
              <p className="mb-2 text-sm font-medium text-foreground">
                {t.comicGroup?.autoDetect || "智能检测"}
              </p>
              <p className="mb-6 text-xs text-muted text-center max-w-xs">
                {t.comicGroup?.autoDetectDesc || "自动识别可合并的同系列漫画"}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDetect}
                  className="flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  <Wand2 className="h-4 w-4" />
                  {t.comicGroup?.autoDetect || "开始检测"}
                </button>
                {aiConfigured && (
                  <button
                    onClick={handleAIDetect}
                    disabled={aiLoading}
                    className="flex items-center gap-2 rounded-xl bg-amber-500/20 px-6 py-2.5 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
                  >
                    {aiLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    {aiLoading
                      ? (t.comicGroup?.aiDetecting || "AI 分析中...")
                      : (t.comicGroup?.aiEnhanceDetect || "AI 增强检测")}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 加载中 */}
          {(loading || aiLoading) && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
              <p className="text-sm text-muted">
                {t.comicGroup?.autoDetecting || "正在检测..."}
              </p>
            </div>
          )}

          {/* 无结果 */}
          {!loading && !aiLoading && suggestions !== null && suggestions.length === 0 && createdCount === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
                <Check className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="text-sm text-foreground/80">
                {t.comicGroup?.noSuggestions || "未发现可合并的系列"}
              </p>
            </div>
          )}

          {/* 已创建成功提示 */}
          {createdCount > 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">
                {(t.comicGroup?.created || "已创建 {count} 个分组").replace(
                  "{count}",
                  String(createdCount)
                )}
              </span>
            </div>
          )}

          {/* 检测结果列表 */}
          {!loading && !aiLoading && suggestions !== null && suggestions.length > 0 && (
            <div className="space-y-3">
              {/* 统计 + 全选 */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">
                  {(t.comicGroup?.foundSuggestions || "发现 {count} 个可合并的系列").replace(
                    "{count}",
                    String(suggestions.length)
                  )}
                </p>
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  {selectedIndices.size === suggestions.length ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  {t.navbar?.selectAll || "全选"}
                </button>
              </div>

              {/* 分组建议列表 */}
              {suggestions.map((suggestion, index) => {
                const isSelected = selectedIndices.has(index);
                const isExpanded = expandedIndices.has(index);

                return (
                  <div
                    key={index}
                    className={`rounded-xl border transition-all ${
                      isSelected
                        ? "border-accent/40 bg-accent/5"
                        : "border-border/40 bg-card/50"
                    }`}
                  >
                    {/* 分组头部 */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* 选择框 */}
                      <button
                        onClick={() => toggleSelect(index)}
                        className="flex-shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4.5 w-4.5 text-accent" />
                        ) : (
                          <Square className="h-4.5 w-4.5 text-muted/40" />
                        )}
                      </button>

                      {/* 分组图标 */}
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10">
                        <Layers className="h-4 w-4 text-accent" />
                      </div>

                      {/* 名称 */}
                      <div className="min-w-0 flex-1">
                        {editingIndex === index ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEditName(index);
                                if (e.key === "Escape") setEditingIndex(null);
                              }}
                              onBlur={() => saveEditName(index)}
                              className="flex-1 rounded-lg bg-background px-2 py-1 text-sm font-medium text-foreground outline-none focus:ring-1 focus:ring-accent/50"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h3
                              className="truncate text-sm font-medium text-foreground cursor-pointer hover:text-accent transition-colors"
                              onClick={(e) => startEditName(index, e)}
                              title={locale === "en" ? "Click to edit group name" : "点击编辑分组名称"}
                            >
                              {suggestion.name}
                            </h3>
                            {/* 来源标签 */}
                            {suggestion.source === "ai" && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400 flex-shrink-0">
                                <Sparkles className="h-2.5 w-2.5" />
                                AI
                              </span>
                            )}
                            {suggestion.source === "local" && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent flex-shrink-0">
                                <Cpu className="h-2.5 w-2.5" />
                                {locale === "en" ? "Rule" : "规则"}
                              </span>
                            )}
                          </div>
                        )}
                        <p className="text-[10px] text-muted">
                          {suggestion.comicIds.length} {t.comicGroup?.volumes || "卷"}
                        </p>
                      </div>

                      {/* 展开/折叠 */}
                      <button
                        onClick={() => toggleExpand(index)}
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-foreground transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {/* 展开的漫画列表 */}
                    {isExpanded && (
                      <div className="border-t border-border/20 px-4 py-2">
                        {/* AI 分析理由 */}
                        {suggestion.source === "ai" && suggestion.reason && (
                          <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-500/5 px-3 py-2">
                            <Sparkles className="h-3 w-3 text-amber-400 flex-shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-300/80 leading-relaxed">
                              {suggestion.reason}
                            </p>
                          </div>
                        )}
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {suggestion.titles.map((title, ti) => (
                            <div
                              key={ti}
                              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-card/80 transition-colors"
                            >
                              {/* 缩略图 */}
                              <div className="relative h-10 w-8 flex-shrink-0 overflow-hidden rounded-md bg-muted/10">
                                <Image
                                  src={`/api/comics/${suggestion.comicIds[ti]}/thumbnail`}
                                  alt={title}
                                  fill
                                  unoptimized
                                  className="object-cover"
                                  sizes="32px"
                                />
                              </div>
                              {/* 序号 + 标题 */}
                              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-muted/10 text-[10px] font-bold text-muted">
                                {ti + 1}
                              </span>
                              <span className="truncate text-xs text-foreground/80">
                                {title}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/30 px-3 sm:px-6 py-2.5 sm:py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {suggestions !== null && suggestions.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDetect}
                    className="rounded-lg bg-card px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
                  >
                    {t.comicGroup?.autoDetect || "重新检测"}
                  </button>
                  {aiConfigured && (
                    <button
                      onClick={handleAIDetect}
                      disabled={aiLoading}
                      className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-4 py-2 text-sm text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      {t.comicGroup?.aiEnhanceDetect || "AI 增强"}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {suggestions !== null && suggestions.length > 0 && selectedIndices.size > 0 && (
                <button
                  onClick={handleCreateSelected}
                  disabled={creating}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderPlus className="h-4 w-4" />
                  )}
                  {selectedIndices.size === suggestions.length
                    ? t.comicGroup?.createAll || "全部创建"
                    : (t.comicGroup?.createSelected || "创建选中") +
                      ` (${selectedIndices.size})`}
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-card-hover"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
