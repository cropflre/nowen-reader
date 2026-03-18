"use client";

import React, { useState } from "react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { Search, Download, Check, Loader2, BookOpen, FileSearch, Filter } from "lucide-react";

interface MetadataResult {
  title?: string;
  author?: string;
  publisher?: string;
  year?: number;
  description?: string;
  genre?: string;
  seriesName?: string;
  coverUrl?: string;
  source: string;
}

function isNovelFile(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.toLowerCase();
  return ext.endsWith(".txt") || ext.endsWith(".epub") || ext.endsWith(".mobi") || ext.endsWith(".azw3") || ext.endsWith(".html") || ext.endsWith(".htm");
}

// 漫画数据源
const COMIC_SOURCES = [
  { id: "anilist", name: "AniList", icon: "🅰" },
  { id: "bangumi", name: "Bangumi", icon: "🅱" },
  { id: "mangadex", name: "MangaDex", icon: "📖" },
  { id: "mangaupdates", name: "MangaUpdates", icon: "📋" },
  { id: "kitsu", name: "Kitsu", icon: "🦊" },
] as const;

// 小说数据源
const NOVEL_SOURCES = [
  { id: "googlebooks", name: "Google Books", icon: "📚" },
  { id: "bangumi_novel", name: "Bangumi", icon: "🅱" },
  { id: "anilist_novel", name: "AniList", icon: "🅰" },
] as const;

const DEFAULT_COMIC_SOURCES = COMIC_SOURCES.map((s) => s.id);
const DEFAULT_NOVEL_SOURCES = NOVEL_SOURCES.map((s) => s.id);

const SOURCE_COLORS: Record<string, string> = {
  anilist: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  anilist_novel: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  bangumi: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  bangumi_novel: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  mangadex: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  mangaupdates: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  kitsu: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  googlebooks: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  comicinfo: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
};

interface Props {
  comicId: string;
  comicTitle: string;
  filename?: string;
  onApplied?: () => void;
}

export function MetadataSearch({ comicId, comicTitle, filename, onApplied }: Props) {
  const t = useTranslation();
  const { locale } = useLocale();

  const isNovel = isNovelFile(filename);
  const availableSources = isNovel ? NOVEL_SOURCES : COMIC_SOURCES;
  const defaultSources = isNovel ? DEFAULT_NOVEL_SOURCES : DEFAULT_COMIC_SOURCES;

  const getSourceName = (id: string) => {
    return (t.metadata?.sources as Record<string, string>)?.[id] || id;
  };
  const [query, setQuery] = useState(comicTitle);
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [enabledSources, setEnabledSources] = useState<string[]>(defaultSources as unknown as string[]);
  const [showSourceFilter, setShowSourceFilter] = useState(false);

  const toggleSource = (id: string) => {
    setEnabledSources((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : [...prev, id]
    );
  };

  const handleSearch = async () => {
    if (!query.trim() || enabledSources.length === 0) return;
    setSearching(true);
    setError("");
    setResults([]);
    setApplied(null);
    try {
      const params = new URLSearchParams({
        q: query,
        sources: enabledSources.join(","),
        lang: locale,
        contentType: isNovel ? "novel" : "comic",
      });
      const res = await fetch(`/api/metadata/search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results || []);
      if (data.results?.length === 0) {
        setError(t.metadata?.noResults || "No results found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleScanArchive = async () => {
    setScanning(true);
    setError("");
    try {
      // 小说使用专用刮削接口，漫画使用通用刮削接口
      const scanUrl = isNovel ? "/api/metadata/novel-scan" : "/api/metadata/scan";
      const res = await fetch(scanUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comicId, lang: locale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.source && data.source !== "none") {
        setApplied(-1);
        onApplied?.();
      } else {
        setError(data.message || (isNovel
          ? (t.metadata?.noEpubMetadata || "No EPUB metadata or online results found")
          : (t.metadata?.noComicInfo || "No ComicInfo.xml found")));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async (index: number) => {
    setApplying(index);
    try {
      const res = await fetch("/api/metadata/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comicId, metadata: results[index], lang: locale, overwrite: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApplied(index);
      onApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-0 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={t.metadata?.searchPlaceholder || "Search metadata..."}
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
            <span className="hidden sm:inline">{t.metadata?.search || "Search"}</span>
          </button>
          <button
            onClick={() => setShowSourceFilter(!showSourceFilter)}
            className={`px-2 py-2 rounded-lg text-sm flex items-center transition-colors ${
              showSourceFilter
                ? "bg-accent text-white"
                : "bg-card-hover text-foreground/70 hover:bg-surface"
            }`}
            title={t.metadata?.selectSources || "Select sources"}
          >
            <Filter className="w-4 h-4" />
          </button>
          <button
            onClick={handleScanArchive}
            disabled={scanning}
            className="px-2.5 sm:px-3 py-2 bg-card-hover text-foreground/70 rounded-lg text-sm hover:bg-surface disabled:opacity-50 flex items-center gap-1.5"
            title={isNovel
              ? (t.metadata?.scanNovel || "Scan novel metadata (EPUB OPF + online)")
              : (t.metadata?.scanArchive || "Scan archive for ComicInfo.xml")}
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Source filter panel */}
      {showSourceFilter && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-card border border-border rounded-lg">
          {availableSources.map((src) => (
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

      {error && <div className="text-sm text-red-400">{error}</div>}

      {applied === -1 && (
        <div className="text-sm text-green-400 flex items-center gap-1.5">
          <Check className="w-4 h-4" />
          {isNovel
            ? (t.metadata?.appliedFromNovelScan || "Novel metadata applied successfully")
            : (t.metadata?.appliedFromArchive || "Metadata applied from ComicInfo.xml")}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((result, i) => (
            <div
              key={i}
              className="p-3 bg-card border border-border rounded-lg"
            >
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
                      {t.metadata?.author || "Author"}: {result.author}
                    </div>
                  )}
                  {result.year && (
                    <div className="text-xs text-muted">
                      {result.year}
                      {result.publisher && ` · ${result.publisher}`}
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
                    ? (t.metadata?.applied || "Applied")
                    : (t.metadata?.apply || "Apply")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
