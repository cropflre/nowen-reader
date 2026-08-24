"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { List, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { apiPath } from "@/lib/base-path";
import { useLocale } from "@/lib/i18n";

type ChapterRule = {
  id: string;
  name: string;
  pattern: string;
  system: boolean;
};

type BookRuleInfo = {
  comicId: string;
  ruleId: string;
  rule: ChapterRule | null;
  isTxt: boolean;
  canManage: boolean;
};

type PreviewResult = {
  matchCount: number;
  chapters: string[];
  warning?: string;
};

async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const res = await fetch(apiPath(path), { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body as T;
}

export default function NovelChapterRuleSettings() {
  const params = useParams();
  const comicId = String(params?.id || "");
  const { locale } = useLocale();
  const zh = locale === "zh-CN";

  const [info, setInfo] = useState<BookRuleInfo | null>(null);
  const [rules, setRules] = useState<ChapterRule[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState("auto");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [rulePattern, setRulePattern] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const customRules = useMemo(() => rules.filter((r) => !r.system), [rules]);
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) || null,
    [rules, selectedRuleId]
  );

  const refresh = async () => {
    if (!comicId) return;
    const [book, list] = await Promise.all([
      requestJSON<BookRuleInfo>(`/api/comics/${comicId}/chapter-rule`),
      requestJSON<{ rules: ChapterRule[] }>("/api/novel/chapter-rules"),
    ]);
    setInfo(book);
    setRules(list.rules || []);
    setSelectedRuleId(book.ruleId || "auto");
  };

  useEffect(() => {
    let cancelled = false;
    if (!comicId) return;
    setLoading(true);
    Promise.all([
      requestJSON<BookRuleInfo>(`/api/comics/${comicId}/chapter-rule`),
      requestJSON<{ rules: ChapterRule[] }>("/api/novel/chapter-rules"),
    ])
      .then(([book, list]) => {
        if (cancelled) return;
        setInfo(book);
        setRules(list.rules || []);
        setSelectedRuleId(book.ruleId || "auto");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [comicId]);

  const notifyApplied = () => {
    window.dispatchEvent(
      new CustomEvent("novel-chapter-rule-applied", { detail: { comicId } })
    );
  };

  const previewPattern = async (pattern: string) => {
    if (!pattern.trim()) {
      setError(zh ? "请先填写正则表达式" : "Enter a regular expression first");
      return;
    }
    setPreviewLoading(true);
    setPreview(null);
    setError("");
    try {
      const result = await requestJSON<PreviewResult>("/api/novel/chapter-rules/preview", {
        method: "POST",
        body: JSON.stringify({ comicId, regex: pattern }),
      });
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewSelected = async () => {
    if (!selectedRule || selectedRule.id === "auto") return;
    await previewPattern(selectedRule.pattern);
  };

  const applyRule = async () => {
    if (!info?.canManage) return;
    setSaving(true);
    setError("");
    try {
      await requestJSON(`/api/comics/${comicId}/chapter-rule`, {
        method: "PUT",
        body: JSON.stringify({ ruleId: selectedRuleId }),
      });
      await refresh();
      notifyApplied();
      setPreview(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetEditor = () => {
    setEditingRuleId(null);
    setRuleName("");
    setRulePattern("");
    setPreview(null);
  };

  const startEdit = (rule: ChapterRule) => {
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    setRulePattern(rule.pattern);
    setPreview(null);
    setError("");
  };

  const saveCustomRule = async () => {
    setSaving(true);
    setError("");
    try {
      const path = editingRuleId
        ? `/api/novel/chapter-rules/${editingRuleId}`
        : "/api/novel/chapter-rules";
      const method = editingRuleId ? "PUT" : "POST";
      const result = await requestJSON<{ rule: ChapterRule }>(path, {
        method,
        body: JSON.stringify({ name: ruleName, pattern: rulePattern }),
      });
      const changedCurrentRule = !!editingRuleId && info?.ruleId === editingRuleId;
      await refresh();
      if (!editingRuleId && result.rule?.id) {
        setSelectedRuleId(result.rule.id);
      }
      resetEditor();
      if (changedCurrentRule) notifyApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (rule: ChapterRule) => {
    if (!window.confirm(zh ? `删除规则“${rule.name}”？使用它的书籍会恢复自动识别。` : `Delete “${rule.name}”? Books using it will return to automatic detection.`)) {
      return;
    }
    setSaving(true);
    setError("");
    const changedCurrentRule = info?.ruleId === rule.id;
    try {
      await requestJSON(`/api/novel/chapter-rules/${rule.id}`, { method: "DELETE" });
      await refresh();
      resetEditor();
      if (changedCurrentRule) notifyApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !info?.isTxt || !info.canManage) return null;

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setError("");
          setPreview(null);
        }}
        className="flex items-center gap-1 sm:gap-1.5 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs font-medium text-white/60 transition-all duration-200 hover:text-white hover:bg-white/10 shrink-0"
        title={zh ? "TXT 分章规则" : "TXT chapter rules"}
      >
        <List className="h-4 w-4" />
        <span className="hidden sm:inline">{zh ? "分章" : "Chapters"}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[88vh] w-full sm:max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-zinc-900 p-4 sm:p-6 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold">{zh ? "TXT 章节识别规则" : "TXT chapter detection"}</h3>
                <p className="mt-1 text-xs text-white/45">
                  {zh ? "只影响当前 TXT 小说，不修改原始文件。EPUB/MOBI 仍使用电子书目录。" : "Only affects this TXT book. EPUB/MOBI continue using their embedded table of contents."}
                </p>
              </div>
              <button className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <label className="mb-2 block text-xs font-medium text-white/60">
                {zh ? "当前书籍分章规则" : "Chapter rule for this book"}
              </label>
              <select
                value={selectedRuleId}
                onChange={(e) => {
                  setSelectedRuleId(e.target.value);
                  setPreview(null);
                }}
                className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-accent/60"
              >
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}{rule.system && rule.id !== "auto" ? (zh ? " · 内置" : " · built-in") : ""}
                  </option>
                ))}
              </select>

              {selectedRule?.pattern && (
                <code className="mt-3 block break-all rounded-lg bg-black/30 p-2 text-[11px] leading-relaxed text-white/55">
                  {selectedRule.pattern}
                </code>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {selectedRuleId !== "auto" && (
                  <button
                    onClick={previewSelected}
                    disabled={previewLoading}
                    className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/15 disabled:opacity-50"
                  >
                    {previewLoading ? (zh ? "检测中..." : "Checking...") : (zh ? "预览匹配结果" : "Preview matches")}
                  </button>
                )}
                <button
                  onClick={applyRule}
                  disabled={saving}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (zh ? "应用到本书" : "Apply to this book")}
                </button>
              </div>

              {preview && (
                <PreviewBlock preview={preview} zh={zh} />
              )}
            </section>

            <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium">{zh ? "自定义规则" : "Custom rules"}</h4>
                  <p className="mt-0.5 text-[11px] text-white/40">{zh ? "使用 Go/RE2 正则语法，保存前建议先预览。" : "Uses Go/RE2 regex syntax. Preview before saving."}</p>
                </div>
                {!editingRuleId && (
                  <button
                    onClick={() => {
                      setEditingRuleId("");
                      setRuleName("");
                      setRulePattern("");
                      setPreview(null);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/15"
                  >
                    <Plus className="h-3.5 w-3.5" /> {zh ? "新增" : "Add"}
                  </button>
                )}
              </div>

              {customRules.length > 0 && editingRuleId === null && (
                <div className="space-y-2">
                  {customRules.map((rule) => (
                    <div key={rule.id} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-white/80">{rule.name}</div>
                        <code className="mt-1 block truncate text-[10px] text-white/40">{rule.pattern}</code>
                      </div>
                      <button onClick={() => startEdit(rule)} className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white" title={zh ? "编辑" : "Edit"}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteRule(rule)} className="rounded-md p-1.5 text-white/45 hover:bg-red-500/10 hover:text-red-400" title={zh ? "删除" : "Delete"}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {customRules.length === 0 && editingRuleId === null && (
                <p className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-white/35">
                  {zh ? "还没有自定义规则" : "No custom rules yet"}
                </p>
              )}

              {editingRuleId !== null && (
                <div className="space-y-3">
                  <input
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder={zh ? "规则名称，例如：方括号章节" : "Rule name"}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent/60"
                  />
                  <textarea
                    value={rulePattern}
                    onChange={(e) => {
                      setRulePattern(e.target.value);
                      setPreview(null);
                    }}
                    rows={4}
                    placeholder="^【\\d+】.+$"
                    className="w-full resize-y rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent/60"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => previewPattern(rulePattern)}
                      disabled={previewLoading}
                      className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/15 disabled:opacity-50"
                    >
                      {previewLoading ? (zh ? "检测中..." : "Checking...") : (zh ? "测试正则" : "Test regex")}
                    </button>
                    <button
                      onClick={saveCustomRule}
                      disabled={saving || !ruleName.trim() || !rulePattern.trim()}
                      className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {editingRuleId ? (zh ? "保存修改" : "Save changes") : (zh ? "保存规则" : "Save rule")}
                    </button>
                    <button onClick={resetEditor} className="rounded-lg px-3 py-2 text-xs text-white/50 hover:bg-white/10">
                      {zh ? "取消" : "Cancel"}
                    </button>
                  </div>
                  {preview && <PreviewBlock preview={preview} zh={zh} />}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

function PreviewBlock({ preview, zh }: { preview: PreviewResult; zh: boolean }) {
  return (
    <div className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] p-3">
      <div className="text-xs font-medium text-emerald-300">
        {zh ? `匹配到 ${preview.matchCount} 个章节标题` : `${preview.matchCount} chapter headings matched`}
      </div>
      {preview.warning && (
        <p className="mt-1 text-[11px] text-amber-300/80">{zh ? "匹配少于 2 个章节，实际阅读时会回退为固定字数分页。" : preview.warning}</p>
      )}
      {preview.chapters?.length > 0 && (
        <ol className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-white/55">
          {preview.chapters.map((chapter, index) => (
            <li key={`${chapter}-${index}`} className="truncate">{index + 1}. {chapter}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
