"use client";

import { useState, useRef, useCallback } from "react";
import { X, Pencil, Undo2, Save, Wand2, Copy, Loader2, CheckCircle, XCircle, AlertCircle, Brain, ChevronUp, ChevronDown, FileText } from "lucide-react";
import { setBatchEditName, applyNameToAll, undoBatchEditNames, saveBatchRename, aiRename, exitBatchEditMode } from "@/lib/scraper-store";
import type { BatchEditNameEntry, BatchRenameResult } from "@/lib/scraper-store";

export function BatchEditPanel({
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

