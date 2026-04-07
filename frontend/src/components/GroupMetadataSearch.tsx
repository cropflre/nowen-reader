"use client";

import React, { useState, useCallback } from "react";
import { useTranslation, useLocale } from "@/lib/i18n";
import {
  Search,
  Download,
  Check,
  Loader2,
  BookOpen,
  Filter,
  Sparkles,
  Tag,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface MetadataResult {
  title?: string;
  author?: string;
  publisher?: string;
  year?: number;
  description?: string;
  language?: string;
  genre?: string;
  coverUrl?: string;
  source: string;
}

// 漫画数据源
const COMIC_SOURCES = [
  { id: "anilist", name: "AniList", icon: "🅰" },
  { id: "bangumi", name: "Bangumi", icon: "🅱" },
  { id: "mangadex", name: "MangaDex", icon: "📖" },
  { id: "mangaupdates", name: "MangaUpdates", icon: "📋" },
  { id: "kitsu", name: "Kitsu", icon: "🦊" },
] as const;

const DEFAULT_COMIC_SOURCES = COMIC_SOURCES.map((s) => s.id);

const SOURCE_COLORS: Record<string, string> = {
  anilist: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  bangumi: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  mangadex: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  mangaupdates: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  kitsu: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

// 可选择应用的字段
const APPLICABLE_FIELDS = [
  { id: "title", label: "标题", defaultOff: true },
  { id: "author", label: "作者" },
  { id: "description", label: "简介" },
  { id: "genre", label: "类型" },
  { id: "publisher", label: "出版商" },
  { id: "language", label: "语言" },
  { id: "year", label: "年份" },
  { id: "cover", label: "封面" },
  { id: "tags", label: "标签" },
] as const;

interface Props {
  groupId: number;
  groupName: string;
  onApplied?: (success: boolean, message?: string) => void;
}

export function GroupMetadataSearch({ groupId, groupName, onApplied }: Props) {
  const t = useTranslation();
  const { locale } = useLocale();

  const getSourceName = (id: string) => {
    return (t.metadata?.sources as Record<string, string>)?.[id] || id;
  };

  const [query, setQuery] = useState(groupName);
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [enabledSources, setEnabledSources] = useState<string[]>(DEFAULT_COMIC_SOURCES as unknown as string[]);
  const [showSourceFilter, setShowSourceFilter] = useState(false);
  const [overwrite, setOverwrite] = useState(true);
  const [syncTags, setSyncTags] = useState(true);

  // 选择性字段应用（标题字段默认不选中，避免意外覆盖系列名称）
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    new Set(APPLICABLE_FIELDS.filter((f) => !("defaultOff" in f && f.defaultOff)).map((f) => f.id))
  );
  const [showFieldSelector, setShowFieldSelector] = useState(false);

  // AI 识别
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{
    recognized?: { title?: string; author?: string; language?: string; genre?: string; year?: number; tags?: string };
    metadata?: { title?: string; author?: string; genre?: string; description?: string; language?: string; year?: number; tags?: string };
  } | null>(null);

  const toggleSource = (id: string) => {
    setEnabledSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleField = (id: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 在线搜索
  const handleSearch = useCallback(async () => {
    if (!query.trim() || enabledSources.length === 0) return;
    setSearching(true);
    setError("");
    setResults([]);
    setApplied(null);
    setAiResult(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/scrape-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          sources: enabledSources,
          lang: locale,
          contentType: "comic",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results || []);
      if (data.results?.length === 0) {
        setError(t.metadata?.noResults || "未找到结果");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  }, [query, enabledSources, groupId, locale, t]);

  // 应用刮削结果到系列
  const handleApply = useCallback(async (index: number) => {
    setApplying(index);
    try {
      const res = await fetch(`/api/groups/${groupId}/apply-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: results[index],
          fields: Array.from(selectedFields),
          overwrite,
          syncTags,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApplied(index);
      onApplied?.(true, `已成功应用来自 ${results[index].source} 的元数据`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用失败");
      onApplied?.(false, err instanceof Error ? err.message : "应用失败");
    } finally {
      setApplying(null);
    }
  }, [groupId, results, selectedFields, overwrite, syncTags, onApplied]);

  // AI 智能识别
  const handleAiRecognize = useCallback(async () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiResult(null);
    setError("");
    try {
      const res = await fetch(`/api/groups/${groupId}/ai-recognize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: locale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAiResult(data);

      // 如果 AI 识别出了标题，自动填入搜索框
      if (data.recognized?.title) {
        setQuery(data.recognized.title);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 识别失败");
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, groupId, locale]);

  // 将 AI 识别结果作为元数据应用
  const handleApplyAiResult = useCallback(async () => {
    if (!aiResult?.metadata && !aiResult?.recognized) return;
    setApplying(-1);
    try {
      const meta = aiResult.metadata || aiResult.recognized;
      const metadata: MetadataResult = {
        title: meta?.title,
        author: meta?.author,
        description: (aiResult.metadata as any)?.description,
        genre: meta?.genre,
        language: meta?.language,
        year: meta?.year ?? undefined,
        source: "ai_recognize",
      };

      const res = await fetch(`/api/groups/${groupId}/apply-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata,
          fields: Array.from(selectedFields),
          overwrite,
          syncTags,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApplied(-2); // 特殊标记表示 AI 结果已应用
      onApplied?.(true, "AI 识别结果已成功应用到系列");
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用 AI 结果失败");
      onApplied?.(false, err instanceof Error ? err.message : "应用 AI 结果失败");
    } finally {
      setApplying(null);
    }
  }, [aiResult, groupId, selectedFields, overwrite, syncTags, onApplied]);

  return (
    <div className="space-y-3">
      {/* 搜索栏 */}
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-0 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={t.metadata?.searchPlaceholder || "搜索元数据..."}
            className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim() || enabledSources.length === 0}
            className="px-2.5 sm:px-3 py-2 bg-accent text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="hidden sm:inline">{t.metadata?.search || "搜索"}</span>
          </button>
          <button
            onClick={() => setShowSourceFilter(!showSourceFilter)}
            className={`px-2 py-2 rounded-lg text-sm flex items-center transition-colors ${
              showSourceFilter ? "bg-accent text-white" : "bg-card-hover text-foreground/70 hover:bg-surface"
            }`}
            title={t.metadata?.selectSources || "选择数据源"}
          >
            <Filter className="w-4 h-4" />
          </button>
          <button
            onClick={handleAiRecognize}
            disabled={aiLoading}
            className="px-2.5 sm:px-3 py-2 bg-purple-500/20 text-purple-400 rounded-lg text-sm hover:bg-purple-500/30 disabled:opacity-50 flex items-center gap-1.5"
            title="AI 智能识别"
          >
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span className="hidden sm:inline">AI 识别</span>
          </button>
        </div>
      </div>

      {/* 数据源筛选 */}
      {showSourceFilter && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-card border border-border rounded-lg">
          {COMIC_SOURCES.map((src) => (
            <button
              key={src.id}
              onClick={() => toggleSource(src.id)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                enabledSources.includes(src.id)
                  ? SOURCE_COLORS[src.id] || "bg-accent/20 text-accent"
                  : "bg-card-hover text-muted opacity-50"
              }`}
            >
              <span>{src.icon}</span>
              <span>{getSourceName(src.id)}</span>
            </button>
          ))}
        </div>
      )}

      {/* 应用选项 */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-accent"
          />
          <span className="text-xs text-muted">覆盖现有数据</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={syncTags}
            onChange={(e) => setSyncTags(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-accent"
          />
          <span className="text-xs text-muted">同步标签到所有卷</span>
        </label>
        <button
          onClick={() => setShowFieldSelector(!showFieldSelector)}
          className="flex items-center gap-1 text-xs text-accent/80 hover:text-accent"
        >
          <Tag className="w-3 h-3" />
          选择应用字段 ({selectedFields.size}/{APPLICABLE_FIELDS.length})
          {showFieldSelector ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* 字段选择器 */}
      {showFieldSelector && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-card border border-border rounded-lg">
          {APPLICABLE_FIELDS.map((field) => (
            <button
              key={field.id}
              onClick={() => toggleField(field.id)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                selectedFields.has(field.id)
                  ? field.id === "title"
                    ? "bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/30"
                    : "bg-accent/20 text-accent"
                  : "bg-card-hover text-muted opacity-50"
              }`}
              title={field.id === "title" ? "⚠️ 启用后将覆盖系列名称，请谨慎操作" : undefined}
            >
              {field.id === "title" && selectedFields.has(field.id) ? `⚠ ${field.label}` : field.label}
            </button>
          ))}
          <button
            onClick={() => {
              if (selectedFields.size === APPLICABLE_FIELDS.length) {
                setSelectedFields(new Set());
              } else {
                setSelectedFields(new Set(APPLICABLE_FIELDS.map((f) => f.id)));
              }
            }}
            className="px-2 py-1 rounded text-xs bg-card-hover text-muted hover:text-foreground"
          >
            {selectedFields.size === APPLICABLE_FIELDS.length ? "取消全选" : "全选"}
          </button>
        </div>
      )}
      {/* 标题应用预览提示 */}
      {selectedFields.has("title") && (results.length > 0 || aiResult) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-500">
          <span>⚠</span>
          <span>已启用标题应用：当前系列名「{groupName}」将被刮削结果中的标题替换</span>
        </div>
      )}

      {error && <div className="text-sm text-red-400">{error}</div>}

      {/* AI 识别结果 */}
      {aiResult && (
        <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium text-purple-400">AI 识别结果</span>
          </div>
          <div className="space-y-1 text-xs">
            {aiResult.recognized?.title && (
              <div><span className="text-muted">标题：</span><span className="text-foreground">{aiResult.recognized.title}</span></div>
            )}
            {(aiResult.metadata?.author || aiResult.recognized?.author) && (
              <div><span className="text-muted">作者：</span><span className="text-foreground">{aiResult.metadata?.author || aiResult.recognized?.author}</span></div>
            )}
            {aiResult.metadata?.description && (
              <div><span className="text-muted">简介：</span><span className="text-foreground line-clamp-2">{aiResult.metadata.description}</span></div>
            )}
            {(aiResult.metadata?.genre || aiResult.recognized?.genre) && (
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="text-muted">类型：</span>
                {(aiResult.metadata?.genre || aiResult.recognized?.genre || "").split(",").map((g) => (
                  <span key={g} className="px-1.5 py-0.5 bg-purple-500/10 rounded text-purple-400">{g.trim()}</span>
                ))}
              </div>
            )}
            {(aiResult.metadata?.tags || aiResult.recognized?.tags) && (
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="text-muted">标签：</span>
                {(aiResult.metadata?.tags || aiResult.recognized?.tags || "").split(",").slice(0, 8).map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 bg-accent/10 rounded text-accent">{tag.trim()}</span>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleApplyAiResult}
              disabled={applying !== null}
              className={`px-3 py-1.5 rounded text-xs flex items-center gap-1 ${
                applied === -2
                  ? "bg-green-500/20 text-green-400"
                  : "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
              } disabled:opacity-50`}
            >
              {applying === -1 ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : applied === -2 ? (
                <Check className="w-3 h-3" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              {applied === -2 ? "已应用" : "应用到系列"}
            </button>
            {aiResult.recognized?.title && (
              <button
                onClick={() => {
                  setQuery(aiResult.recognized!.title!);
                  handleSearch();
                }}
                className="px-3 py-1.5 rounded text-xs bg-card-hover text-foreground/70 hover:bg-surface flex items-center gap-1"
              >
                <Search className="w-3 h-3" />
                用此标题搜索
              </button>
            )}
          </div>
        </div>
      )}

      {/* 搜索结果列表 */}
      {results.length > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((result, i) => (
            <div key={i} className="p-3 bg-card border border-border rounded-lg">
              <div className="flex items-start justify-between gap-2">
                {result.coverUrl && (
                  <img
                    src={result.coverUrl}
                    alt={result.title || "cover"}
                    className="w-12 h-16 object-cover rounded flex-shrink-0 bg-card-hover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="w-4 h-4 text-accent flex-shrink-0" />
                    <span className="font-medium text-sm text-foreground truncate">
                      {result.title || "Unknown"}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${SOURCE_COLORS[result.source] || "bg-card-hover text-muted"}`}>
                      {getSourceName(result.source)}
                    </span>
                  </div>
                  {result.author && (
                    <div className="text-xs text-foreground/70">
                      {t.metadata?.author || "作者"}: {result.author}
                    </div>
                  )}
                  {result.year && (
                    <div className="text-xs text-muted">
                      {result.year}
                      {result.publisher && ` · ${result.publisher}`}
                      {result.language && ` · ${result.language}`}
                    </div>
                  )}
                  {result.description && (
                    <div className="text-xs text-muted mt-1 line-clamp-2">
                      {result.description}
                    </div>
                  )}
                  {result.genre && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.genre.split(",").slice(0, 5).map((g) => (
                        <span key={g} className="text-xs px-1.5 py-0.5 bg-card-hover rounded text-muted">
                          {g.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleApply(i)}
                  disabled={applying !== null}
                  className={`flex-shrink-0 px-2 py-1.5 rounded text-xs flex items-center gap-1 ${
                    applied === i
                      ? "bg-green-500/20 text-green-400"
                      : "bg-accent text-white hover:opacity-90"
                  } disabled:opacity-50`}
                >
                  {applying === i ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : applied === i ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                  {applied === i
                    ? (t.metadata?.applied || "已应用")
                    : (t.metadata?.apply || "应用")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
