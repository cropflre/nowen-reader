"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  Download,
  Loader2,
  Image as ImageIcon,
  Star,
  Tag,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
  CheckCircle2,
  Package,
  Eye,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

// ============================================================
// Types
// ============================================================

interface EHGallery {
  gid: string;
  token: string;
  title: string;
  titleJpn: string;
  category: string;
  cover: string;
  uploader: string;
  tags: string[];
  fileCount: number;
  rating: number;
  url: string;
}

interface EHGalleryDetail extends EHGallery {
  pageLinks: string[];
  totalPageSets: number;
}

interface DownloadStatus {
  status: string;
  progress: number;
  total: number;
  error?: string;
}

// ============================================================
// Category color mapping
// ============================================================

const CATEGORY_COLORS: Record<string, string> = {
  "Doujinshi": "bg-red-500/20 text-red-400 border-red-500/30",
  "Manga": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "Artist CG": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "Game CG": "bg-green-500/20 text-green-400 border-green-500/30",
  "Western": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "Non-H": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "Image Set": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "Cosplay": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "Asian Porn": "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "Misc": "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function getCategoryColor(cat: string) {
  return CATEGORY_COLORS[cat] || "bg-muted/30 text-muted border-border/50";
}

// ============================================================
// Main Page Component
// ============================================================

export default function EHentaiPage() {
  const t = useTranslation();
  const eh = t.ehentai;

  // Config status
  const [configured, setConfigured] = useState<boolean | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [galleries, setGalleries] = useState<EHGallery[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [totalResults, setTotalResults] = useState(0);

  // Gallery detail modal
  const [selectedGallery, setSelectedGallery] = useState<EHGalleryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Downloads
  const [downloads, setDownloads] = useState<Record<string, DownloadStatus>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================================
  // Check configuration
  // ============================================================
  useEffect(() => {
    fetch("/api/ehentai/status")
      .then((r) => r.json())
      .then((data) => setConfigured(data.configured))
      .catch(() => setConfigured(false));
  }, []);

  // ============================================================
  // Download status polling
  // ============================================================
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/ehentai/download");
        const data = await res.json();
        if (data.downloads) {
          setDownloads(data.downloads);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ============================================================
  // Search
  // ============================================================
  const doSearch = useCallback(async (query: string, page: number = 0) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: query, page: String(page) });
      const res = await fetch(`/api/ehentai/search?${params}`);
      const data = await res.json();
      setGalleries(data.galleries || []);
      setHasNext(data.hasNext || false);
      setTotalResults(data.total || 0);
      setSearchPage(page);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(searchQuery, 0);
  };

  // ============================================================
  // Gallery detail
  // ============================================================
  const openGalleryDetail = async (gallery: EHGallery) => {
    setLoadingDetail(true);
    setSelectedGallery(null);
    setPreviewImages([]);
    try {
      const res = await fetch(`/api/ehentai/gallery/${gallery.gid}/${gallery.token}`);
      const data = await res.json();
      setSelectedGallery(data);
    } catch (err) {
      console.error("Failed to load gallery detail:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // ============================================================
  // Preview images (first few)
  // ============================================================
  const loadPreviewImages = async (detail: EHGalleryDetail) => {
    if (previewImages.length > 0 || loadingPreview) return;
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/ehentai/gallery/${detail.gid}/${detail.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageLinks: detail.pageLinks.slice(0, 6),
          startIndex: 0,
          count: 6,
        }),
      });
      const data = await res.json();
      const images = (data.results || []).map((r: { imageUrl: string }) => r.imageUrl);
      setPreviewImages(images);
    } catch (err) {
      console.error("Failed to load preview:", err);
    } finally {
      setLoadingPreview(false);
    }
  };

  // ============================================================
  // Download
  // ============================================================
  const startDownload = async (gid: string, token: string) => {
    try {
      await fetch("/api/ehentai/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gid, token }),
      });
      setDownloads((prev) => ({
        ...prev,
        [gid]: { status: "starting", progress: 0, total: 0 },
      }));
    } catch (err) {
      console.error("Failed to start download:", err);
    }
  };

  // ============================================================
  // Render: Not configured
  // ============================================================
  if (configured === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="min-h-screen bg-background">
        <StickyHeader title={eh.title} />
        <main className="mx-auto max-w-5xl px-6 py-8 pt-24">
          <div className="flex flex-col items-center gap-4 py-20">
            <AlertCircle className="h-16 w-16 text-muted" />
            <h2 className="text-xl font-semibold text-foreground">{eh.notConfigured}</h2>
            <p className="max-w-md text-center text-sm text-muted">{eh.notConfiguredDesc}</p>
            <div className="mt-4 rounded-xl border border-border/60 bg-card p-4 text-left">
              <code className="text-xs text-muted">
                EHENTAI_MEMBER_ID=your_id<br />
                EHENTAI_PASS_HASH=your_hash<br />
                EHENTAI_IGNEOUS=your_igneous  <span className="text-muted/50"># optional, for ExHentai</span>
              </code>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ============================================================
  // Render: Main
  // ============================================================
  return (
    <div className="min-h-screen bg-background">
      <StickyHeader title={eh.title} />

      <main className="mx-auto max-w-[1800px] px-6 pt-24 pb-12">
        {/* Search Bar */}
        <form onSubmit={handleSearch} className="mb-8 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={eh.searchPlaceholder}
              className="h-11 w-full rounded-xl border border-border/60 bg-card/50 pl-10 pr-4 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-300 focus:border-accent/50 focus:bg-card focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {eh.search}
          </button>
        </form>

        {/* Active Downloads Banner */}
        {Object.keys(downloads).length > 0 && (
          <div className="mb-6 space-y-2">
            {Object.entries(downloads).map(([gid, dl]) => (
              <DownloadBanner key={gid} gid={gid} status={dl} t={eh} />
            ))}
          </div>
        )}

        {/* Results Stats */}
        {galleries.length > 0 && (
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted">
              {eh.resultsCount.replace("{count}", String(totalResults))}
            </p>
          </div>
        )}

        {/* Gallery Grid */}
        {searching ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
            <p className="text-sm text-muted">{eh.searching}</p>
          </div>
        ) : galleries.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {galleries.map((g) => (
                <GalleryCard
                  key={g.gid}
                  gallery={g}
                  downloadStatus={downloads[g.gid]}
                  onDetail={() => openGalleryDetail(g)}
                  onDownload={() => startDownload(g.gid, g.token)}
                  t={eh}
                />
              ))}
            </div>

            {/* Pagination */}
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                onClick={() => doSearch(searchQuery, searchPage - 1)}
                disabled={searchPage <= 0}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
                {eh.prevPage}
              </button>
              <span className="text-sm text-muted">
                {eh.pageNum.replace("{page}", String(searchPage + 1))}
              </span>
              <button
                onClick={() => doSearch(searchQuery, searchPage + 1)}
                disabled={!hasNext}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-30"
              >
                {eh.nextPage}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          !searching && galleries.length === 0 && searchQuery && (
            <div className="flex flex-col items-center gap-3 py-20">
              <ImageIcon className="h-16 w-16 text-muted/50" />
              <p className="text-sm text-muted">{eh.noResults}</p>
            </div>
          )
        )}

        {/* Empty state (no search yet) */}
        {!searching && galleries.length === 0 && !searchQuery && (
          <div className="flex flex-col items-center gap-3 py-20">
            <Search className="h-16 w-16 text-muted/30" />
            <p className="text-lg font-medium text-foreground">{eh.title}</p>
            <p className="text-sm text-muted">{eh.emptyHint}</p>
          </div>
        )}
      </main>

      {/* Gallery Detail Modal */}
      {(selectedGallery || loadingDetail) && (
        <GalleryDetailModal
          detail={selectedGallery}
          loading={loadingDetail}
          previewImages={previewImages}
          loadingPreview={loadingPreview}
          downloadStatus={selectedGallery ? downloads[selectedGallery.gid] : undefined}
          onLoadPreview={() => selectedGallery && loadPreviewImages(selectedGallery)}
          onDownload={() =>
            selectedGallery && startDownload(selectedGallery.gid, selectedGallery.token)
          }
          onClose={() => {
            setSelectedGallery(null);
            setPreviewImages([]);
          }}
          t={eh}
        />
      )}
    </div>
  );
}

// ============================================================
// Sticky Header
// ============================================================

function StickyHeader({ title }: { title: string }) {
  return (
    <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-[1800px] items-center gap-4 px-6">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
      </div>
    </div>
  );
}

// ============================================================
// Gallery Card
// ============================================================

interface GalleryCardProps {
  gallery: EHGallery;
  downloadStatus?: DownloadStatus;
  onDetail: () => void;
  onDownload: () => void;
  t: Record<string, string>;
}

function GalleryCard({ gallery, downloadStatus, onDetail, onDownload, t }: GalleryCardProps) {
  const isDownloading = downloadStatus && ["starting", "fetching_info", "downloading", "packaging"].includes(downloadStatus.status);
  const isCompleted = downloadStatus?.status === "completed";

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/40 bg-card transition-all duration-300 hover:border-border/80 hover:shadow-lg">
      {/* Cover */}
      <div className="relative aspect-[5/7] cursor-pointer overflow-hidden" onClick={onDetail}>
        {gallery.cover ? (
          <img
            src={`/api/ehentai/proxy?url=${encodeURIComponent(gallery.cover)}`}
            alt={gallery.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/10">
            <ImageIcon className="h-12 w-12 text-muted/30" />
          </div>
        )}

        {/* Category badge */}
        {gallery.category && (
          <div className={`absolute top-2 left-2 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${getCategoryColor(gallery.category)}`}>
            {gallery.category}
          </div>
        )}

        {/* Rating badge */}
        {gallery.rating > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-yellow-400 backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-current" />
            {gallery.rating.toFixed(1)}
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/40 group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); onDetail(); }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-transform hover:scale-110"
          >
            <Eye className="h-5 w-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(); }}
            disabled={!!isDownloading}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/80 text-white backdrop-blur-sm transition-transform hover:scale-110 disabled:opacity-50"
          >
            {isDownloading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isCompleted ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-2.5">
        <h3 className="line-clamp-2 text-xs font-medium text-foreground leading-tight">
          {gallery.title}
        </h3>
        {gallery.fileCount > 0 && (
          <p className="mt-1 text-[10px] text-muted">{gallery.fileCount} {t.pages}</p>
        )}
      </div>

      {/* Download progress bar */}
      {isDownloading && downloadStatus && downloadStatus.total > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted/20">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${(downloadStatus.progress / downloadStatus.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Download Banner
// ============================================================

function DownloadBanner({
  gid,
  status,
  t,
}: {
  gid: string;
  status: DownloadStatus;
  t: Record<string, string>;
}) {
  const icon = (() => {
    switch (status.status) {
      case "completed": return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case "error": return <AlertCircle className="h-4 w-4 text-red-400" />;
      case "packaging": return <Package className="h-4 w-4 text-yellow-400 animate-pulse" />;
      default: return <Loader2 className="h-4 w-4 animate-spin text-accent" />;
    }
  })();

  const statusText = (() => {
    switch (status.status) {
      case "starting": return t.downloadStarting;
      case "fetching_info": return t.downloadFetchingInfo;
      case "downloading": return `${t.downloading} ${status.progress}/${status.total}`;
      case "packaging": return t.downloadPackaging;
      case "completed": return t.downloadCompleted;
      case "error": return `${t.downloadError}: ${status.error || ""}`;
      default: return status.status;
    }
  })();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-2.5">
      {icon}
      <span className="text-sm text-foreground">
        {t.galleryId}: {gid}
      </span>
      <span className="text-sm text-muted">— {statusText}</span>
      {status.status === "downloading" && status.total > 0 && (
        <div className="ml-auto flex items-center gap-2">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted/20">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${(status.progress / status.total) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted">
            {Math.round((status.progress / status.total) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Gallery Detail Modal
// ============================================================

interface GalleryDetailModalProps {
  detail: EHGalleryDetail | null;
  loading: boolean;
  previewImages: string[];
  loadingPreview: boolean;
  downloadStatus?: DownloadStatus;
  onLoadPreview: () => void;
  onDownload: () => void;
  onClose: () => void;
  t: Record<string, string>;
}

function GalleryDetailModal({
  detail,
  loading,
  previewImages,
  loadingPreview,
  downloadStatus,
  onLoadPreview,
  onDownload,
  onClose,
  t,
}: GalleryDetailModalProps) {
  const isDownloading = downloadStatus && ["starting", "fetching_info", "downloading", "packaging"].includes(downloadStatus.status);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border/60 bg-background p-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-muted transition-colors hover:text-foreground backdrop-blur-sm"
        >
          <X className="h-4 w-4" />
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
          </div>
        ) : detail ? (
          <>
            {/* Header with cover */}
            <div className="grid gap-6 p-6 md:grid-cols-[200px_1fr]">
              {/* Cover */}
              <div className="aspect-[5/7] overflow-hidden rounded-xl bg-muted/10">
                {detail.cover ? (
                  <img
                    src={`/api/ehentai/proxy?url=${encodeURIComponent(detail.cover)}`}
                    alt={detail.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-12 w-12 text-muted/30" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-bold text-foreground leading-tight">{detail.title}</h2>
                {detail.titleJpn && (
                  <p className="text-sm text-muted">{detail.titleJpn}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {detail.category && (
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${getCategoryColor(detail.category)}`}>
                      {detail.category}
                    </span>
                  )}
                  {detail.rating > 0 && (
                    <span className="flex items-center gap-1 rounded-md bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                      <Star className="h-3 w-3 fill-current" />
                      {detail.rating.toFixed(1)}
                    </span>
                  )}
                </div>

                {/* Metadata grid */}
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {detail.uploader && (
                    <div className="rounded-lg bg-card p-2">
                      <span className="text-muted">{t.uploader}</span>
                      <p className="font-medium text-foreground">{detail.uploader}</p>
                    </div>
                  )}
                  <div className="rounded-lg bg-card p-2">
                    <span className="text-muted">{t.fileCount}</span>
                    <p className="font-medium text-foreground">{detail.fileCount} {t.pages}</p>
                  </div>
                </div>

                {/* Tags */}
                {detail.tags.length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted mb-1.5">
                      <Tag className="h-3 w-3" />
                      {t.tags}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {detail.tags.slice(0, 30).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-muted/20 hover:text-foreground cursor-pointer"
                          onClick={() => {
                            onClose();
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                      {detail.tags.length > 30 && (
                        <span className="text-[10px] text-muted/50">+{detail.tags.length - 30}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={onDownload}
                    disabled={!!isDownloading}
                    className="flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {downloadStatus?.status === "downloading"
                          ? `${downloadStatus.progress}/${downloadStatus.total}`
                          : t.downloading}
                      </>
                    ) : downloadStatus?.status === "completed" ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        {t.downloadCompleted}
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        {t.downloadToLibrary}
                      </>
                    )}
                  </button>

                  <button
                    onClick={onLoadPreview}
                    disabled={loadingPreview || previewImages.length > 0}
                    className="flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card px-4 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {loadingPreview ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                    {t.preview}
                  </button>
                </div>
              </div>
            </div>

            {/* Download progress */}
            {isDownloading && downloadStatus && downloadStatus.total > 0 && (
              <div className="mx-6 mb-4">
                <div className="flex items-center justify-between text-xs text-muted mb-1">
                  <span>{t.downloading} {downloadStatus.progress}/{downloadStatus.total}</span>
                  <span>{Math.round((downloadStatus.progress / downloadStatus.total) * 100)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted/20">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${(downloadStatus.progress / downloadStatus.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Preview images */}
            {previewImages.length > 0 && (
              <div className="border-t border-border/40 p-6">
                <h3 className="mb-3 text-sm font-medium text-foreground">{t.preview}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {previewImages.map((url, i) => (
                    <div key={i} className="aspect-[5/7] overflow-hidden rounded-lg bg-muted/10">
                      {url ? (
                        <img
                          src={`/api/ehentai/proxy?url=${encodeURIComponent(url)}`}
                          alt={`Page ${i + 1}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <RefreshCw className="h-4 w-4 text-muted/30" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
