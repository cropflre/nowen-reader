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

const ALL_SOURCES = [
  { id: "anilist", name: "AniList", icon: "🅰" },
  { id: "bangumi", name: "Bangumi", icon: "🅱" },
  { id: "mangadex", name: "MangaDex", icon: "📖" },
  { id: "mangaupdates", name: "MangaUpdates", icon: "📋" },
  { id: "kitsu", name: "Kitsu", icon: "🦊" },
  { id: "mal", name: "MAL", icon: "Ⓜ" },
  { id: "comicvine", name: "ComicVine", icon: "💬" },
] as const;

const DEFAULT_SOURCES = ALL_SOURCES.map((s) => s.id);

const SOURCE_COLORS: Record<string, string> = {
  anilist: "bg-blue-500/15 text-blue-400",
  bangumi: "bg-pink-500/15 text-pink-400",
  mangadex: "bg-orange-500/15 text-orange-400",
  mangaupdates: "bg-purple-500/15 text-purple-400",
  kitsu: "bg-amber-500/15 text-amber-400",
  mal: "bg-sky-500/15 text-sky-400",
  comicvine: "bg-green-500/15 text-green-400",
  comicinfo: "bg-gray-500/15 text-gray-400",
};

interface Props {
  comicId: string;
  comicTitle: string;
  onApplied?: () => void;
}

export function MetadataSearch({ comicId, comicTitle, onApplied }: Props) {
  const t = useTranslation();
  const { locale } = useLocale();

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
  const [enabledSources, setEnabledSources] = useState<string[]>(DEFAULT_SOURCES);
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
      const res = await fetch("/api/metadata/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comicId, lang: locale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.found) {
        setApplied(-1);
        onApplied?.();
      } else {
        setError(data.message || "No ComicInfo.xml found");
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
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={t.metadata?.searchPlaceholder || "Search metadata..."}
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || !query.trim() || enabledSources.length === 0}
          className="px-3 py-2 bg-[var(--accent-primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {t.metadata?.search || "Search"}
        </button>
        <button
          onClick={() => setShowSourceFilter(!showSourceFilter)}
          className={`px-2 py-2 rounded-lg text-sm flex items-center transition-colors ${
            showSourceFilter
              ? "bg-[var(--accent-primary)] text-white"
              : "bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          }`}
          title={t.metadata?.selectSources || "Select sources"}
        >
          <Filter className="w-4 h-4" />
        </button>
        <button
          onClick={handleScanArchive}
          disabled={scanning}
          className="px-3 py-2 bg-[var(--bg-hover)] text-[var(--text-secondary)] rounded-lg text-sm hover:bg-[var(--bg-tertiary)] disabled:opacity-50 flex items-center gap-1.5"
          title={t.metadata?.scanArchive || "Scan archive for ComicInfo.xml"}
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
        </button>
      </div>

      {/* Source filter panel */}
      {showSourceFilter && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg">
          {ALL_SOURCES.map((src) => (
            <button
              key={src.id}
              onClick={() => toggleSource(src.id)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                enabledSources.includes(src.id)
                  ? SOURCE_COLORS[src.id] || "bg-accent/20 text-accent"
                  : "bg-[var(--bg-hover)] text-[var(--text-muted)] opacity-50"
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
          {t.metadata?.appliedFromArchive || "Metadata applied from ComicInfo.xml"}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((result, i) => (
            <div
              key={i}
              className="p-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg"
            >
              <div className="flex items-start justify-between gap-2">
                {result.coverUrl && (
                  <img
                    src={result.coverUrl}
                    alt={result.title || "cover"}
                    className="w-12 h-16 object-cover rounded flex-shrink-0 bg-[var(--bg-hover)]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="w-4 h-4 text-[var(--accent-primary)] flex-shrink-0" />
                    <span className="font-medium text-sm text-[var(--text-primary)] truncate">
                      {result.title || "Unknown"}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${SOURCE_COLORS[result.source] || "bg-[var(--bg-hover)] text-[var(--text-muted)]"}`}>
                      {getSourceName(result.source)}
                    </span>
                  </div>
                  {result.author && (
                    <div className="text-xs text-[var(--text-secondary)]">
                      {t.metadata?.author || "Author"}: {result.author}
                    </div>
                  )}
                  {result.year && (
                    <div className="text-xs text-[var(--text-muted)]">
                      {result.year}
                      {result.publisher && ` · ${result.publisher}`}
                    </div>
                  )}
                  {result.description && (
                    <div className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                      {result.description}
                    </div>
                  )}
                  {result.genre && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.genre.split(",").slice(0, 5).map((g) => (
                        <span key={g} className="text-xs px-1.5 py-0.5 bg-[var(--bg-hover)] rounded text-[var(--text-muted)]">
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
                      : "bg-[var(--accent-primary)] text-white hover:opacity-90"
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
