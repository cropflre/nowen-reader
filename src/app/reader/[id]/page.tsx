"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { mockComics } from "@/data/mock-comics";
import { getMockPages, comicPageCounts } from "@/data/mock-pages";
import {
  useComicPages,
  useComicDetail,
  saveReadingProgress,
  toggleComicFavorite,
  updateComicRating,
  addComicTags,
  removeComicTag,
  startSession,
  endSession,
} from "@/hooks/useComics";
import { ReadingMode, ReadingDirection } from "@/types/reader";
import ReaderToolbar from "@/components/reader/ReaderToolbar";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import { useTheme } from "@/lib/theme-context";
import SinglePageView from "@/components/reader/SinglePageView";
import DoublePageView from "@/components/reader/DoublePageView";
import WebtoonView from "@/components/reader/WebtoonView";
import { Heart, Star, Tag, X, Plus } from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";

export default function ReaderPage() {
  const params = useParams();
  const router = useRouter();
  const comicId = params.id as string;
  const t = useTranslation();
  const { locale } = useLocale();

  // Try API first
  const {
    pages: apiPages,
    title: apiTitle,
    loading: apiLoading,
    error: apiError,
  } = useComicPages(comicId);

  // Comic detail from DB
  const { comic: comicDetail, refetch: refetchDetail } =
    useComicDetail(comicId);

  // Fallback to mock data
  const mockComic = mockComics.find((c) => c.id === comicId);
  const mockPageCount = comicPageCounts[comicId] || 20;
  const mockPages = mockComic ? getMockPages(comicId, mockPageCount) : [];

  // Determine data source
  const useRealData = !apiError && apiPages.length > 0;
  const pages = useRealData ? apiPages : mockPages;
  const title = useRealData ? apiTitle : mockComic?.title || t.reader.unknownComic;
  const isLoading = apiLoading && !mockComic;

  // State
  const [currentPage, setCurrentPage] = useState(0);
  const [mode, setMode] = useState<ReadingMode>("single");
  const [direction, setDirection] = useState<ReadingDirection>("ltr");
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("night");
  const { theme: globalTheme, toggleTheme: globalToggleTheme } = useTheme();

  // Sync readerTheme with global theme
  useEffect(() => {
    setReaderTheme(globalTheme === "light" ? "day" : "night");
  }, [globalTheme]);

  // Debounced progress save ref
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Reading session tracking
  const sessionIdRef = useRef<number | null>(null);
  const sessionStartTimeRef = useRef<number>(Date.now());
  const sessionStartPageRef = useRef<number>(0);

  // Restore reading progress when comic detail loads
  useEffect(() => {
    if (comicDetail && useRealData) {
      if (comicDetail.lastReadPage > 0 && comicDetail.lastReadPage < pages.length) {
        setCurrentPage(comicDetail.lastReadPage);
        sessionStartPageRef.current = comicDetail.lastReadPage;
      }
      setIsFavorite(comicDetail.isFavorite);
      setRating(comicDetail.rating || 0);
    }
  }, [comicDetail, useRealData, pages.length]);

  // Start reading session
  useEffect(() => {
    if (!useRealData || pages.length === 0) return;

    sessionStartTimeRef.current = Date.now();
    startSession(comicId, currentPage).then((id) => {
      if (id) sessionIdRef.current = id;
    });

    return () => {
      // End session on unmount
      if (sessionIdRef.current) {
        const duration = Math.round((Date.now() - sessionStartTimeRef.current) / 1000);
        if (duration > 2) {
          endSession(sessionIdRef.current, currentPage, duration);
        }
        sessionIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useRealData, comicId]);

  // Save progress on page change (debounced)
  useEffect(() => {
    if (!useRealData) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveReadingProgress(comicId, currentPage);
    }, 1000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [currentPage, comicId, useRealData]);

  // Save progress on unmount
  useEffect(() => {
    return () => {
      if (useRealData) {
        saveReadingProgress(comicId, currentPage);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hide toolbar
  useEffect(() => {
    if (!toolbarVisible) return;
    const timer = setTimeout(() => setToolbarVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [toolbarVisible, currentPage]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if info panel is open (for tag input)
      if (showInfoPanel) return;

      if (mode === "webtoon") return;

      const isForward =
        direction === "ltr"
          ? e.key === "ArrowRight" || e.key === "d"
          : e.key === "ArrowLeft" || e.key === "a";

      const isBack =
        direction === "ltr"
          ? e.key === "ArrowLeft" || e.key === "a"
          : e.key === "ArrowRight" || e.key === "d";

      const step = mode === "double" ? 2 : 1;

      if (isForward || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setCurrentPage((p) => Math.min(pages.length - 1, p + step));
      } else if (isBack || e.key === "ArrowUp") {
        e.preventDefault();
        setCurrentPage((p) => Math.max(0, p - step));
      } else if (e.key === "Escape") {
        if (showInfoPanel) {
          setShowInfoPanel(false);
        } else if (isFullscreen) {
          document.exitFullscreen?.();
        } else {
          router.back();
        }
      } else if (e.key === "f") {
        toggleFullscreen();
      } else if (e.key === "i") {
        setShowInfoPanel((v) => !v);
      }
    },
    [direction, mode, pages.length, isFullscreen, router, showInfoPanel]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleTapCenter = useCallback(() => {
    setToolbarVisible((v) => !v);
  }, []);

  const handlePageChange = useCallback(
    (page: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, page));
      setCurrentPage(clamped);
    },
    [pages.length]
  );

  // Theme toggle
  const handleToggleTheme = useCallback(() => {
    globalToggleTheme();
  }, [globalToggleTheme]);

  // Favorite toggle
  const handleToggleFavorite = async () => {
    const result = await toggleComicFavorite(comicId);
    if (result !== null) {
      setIsFavorite(result);
    }
  };

  // Rating update
  const handleRating = async (newRating: number) => {
    const r = newRating === rating ? 0 : newRating;
    setRating(r);
    await updateComicRating(comicId, r || null);
  };

  // Tag management
  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    await addComicTags(comicId, [newTag.trim()]);
    setNewTag("");
    refetchDetail();
  };

  const handleRemoveTag = async (tagName: string) => {
    await removeComicTag(comicId, tagName);
    refetchDetail();
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
      </div>
    );
  }

  // 404
  if (pages.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <p className="text-lg font-medium">{ t.reader.comicNotFound}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm"
          >
            {t.reader.backToShelf}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative h-screen w-full overflow-hidden transition-colors duration-300 ${
      readerTheme === "day" ? "bg-gray-100" : "bg-black"
    }`}>
      {/* Reading View */}
      {mode === "single" && (
        <SinglePageView
          pages={pages}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTapCenter={handleTapCenter}
          direction={direction}
          useRealData={useRealData}
          readerTheme={readerTheme}
        />
      )}

      {mode === "double" && (
        <DoublePageView
          pages={pages}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTapCenter={handleTapCenter}
          direction={direction}
          useRealData={useRealData}
          readerTheme={readerTheme}
        />
      )}

      {mode === "webtoon" && (
        <WebtoonView
          pages={pages}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTapCenter={handleTapCenter}
          useRealData={useRealData}
          readerTheme={readerTheme}
        />
      )}

      {/* Toolbar */}
      <ReaderToolbar
        visible={toolbarVisible}
        title={title}
        currentPage={currentPage}
        totalPages={pages.length}
        mode={mode}
        direction={direction}
        isFullscreen={isFullscreen}
        readerTheme={readerTheme}
        onBack={() => router.push("/")}
        onPageChange={handlePageChange}
        onModeChange={setMode}
        onDirectionChange={setDirection}
        onToggleFullscreen={toggleFullscreen}
        onToggleTheme={handleToggleTheme}
        onShowInfo={useRealData ? () => setShowInfoPanel(true) : undefined}
      />

      {/* Page number indicator */}
      {mode !== "webtoon" && !toolbarVisible && (
        <div className={`pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 backdrop-blur-sm ${
          readerTheme === "day" ? "bg-white/70 shadow" : "bg-black/50"
        }`}>
          <span className={`text-xs font-mono ${
            readerTheme === "day" ? "text-gray-500" : "text-white/50"
          }`}>
            {currentPage + 1} / {pages.length}
          </span>
        </div>
      )}

      {/* Info Panel (slide-in from right) */}
      {showInfoPanel && useRealData && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowInfoPanel(false)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 z-50 h-full w-80 overflow-y-auto bg-zinc-900/95 p-6 shadow-2xl backdrop-blur-xl">
            {/* Close */}
            <button
              onClick={() => setShowInfoPanel(false)}
              className="absolute top-4 right-4 rounded-lg p-1 text-white/50 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="mb-6 pr-8 text-lg font-semibold text-white">
              {title}
            </h2>

            {/* Favorite */}
            <div className="mb-6">
              <button
                onClick={handleToggleFavorite}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  isFavorite
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-white/5 text-white/60 hover:text-white"
                }`}
              >
                <Heart
                  className={`h-4 w-4 ${isFavorite ? "fill-rose-500" : ""}`}
                />
                {isFavorite ? t.reader.favorited : t.reader.addFavorite}
              </button>
            </div>

            {/* Rating */}
            <div className="mb-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                {t.reader.rating}
              </h3>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleRating(star)}
                    className="p-0.5 transition-transform hover:scale-110"
                  >
                    <Star
                      className={`h-6 w-6 ${
                        star <= rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-white/20"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div className="mb-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                {t.reader.tagsLabel}
              </h3>

              {/* Existing tags */}
              <div className="mb-3 flex flex-wrap gap-2">
                {comicDetail?.tags.map((tag) => (
                  <span
                    key={tag.name}
                    className="flex items-center gap-1 rounded-md bg-accent/20 px-2 py-1 text-xs text-accent"
                  >
                    <Tag className="h-3 w-3" />
                    {tag.name}
                    <button
                      onClick={() => handleRemoveTag(tag.name)}
                      className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}

                {(!comicDetail?.tags || comicDetail.tags.length === 0) && (
                  <span className="text-xs text-white/30">{t.reader.noTags}</span>
                )}
              </div>

              {/* Add tag */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder={t.reader.addTagPlaceholder}
                  className="flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:ring-1 focus:ring-accent/50"
                />
                <button
                  onClick={handleAddTag}
                  disabled={!newTag.trim()}
                  className="rounded-lg bg-accent/20 px-2 py-1.5 text-accent transition-colors hover:bg-accent/30 disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Reading Info */}
            <div className="mb-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                {t.reader.readingInfo}
              </h3>
              <div className="space-y-2 text-xs text-white/60">
                <div className="flex justify-between">
                  <span>{t.reader.currentPage}</span>
                  <span className="text-white/80">
                    {currentPage + 1} / {pages.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.reader.readProgress}</span>
                  <span className="text-white/80">
                    {Math.round(((currentPage + 1) / pages.length) * 100)}%
                  </span>
                </div>
                {comicDetail?.lastReadAt && (
                  <div className="flex justify-between">
                    <span>{t.reader.lastRead}</span>
                    <span className="text-white/80">
                      {new Date(comicDetail.lastReadAt).toLocaleDateString(locale)}
                    </span>
                  </div>
                )}
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{
                    width: `${((currentPage + 1) / pages.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Keyboard Shortcuts */}
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                {t.reader.shortcuts}
              </h3>
              <div className="space-y-1.5 text-xs text-white/40">
                <div className="flex justify-between">
                  <span>{t.reader.turnPage}</span>
                  <span>← → / A D</span>
                </div>
                <div className="flex justify-between">
                  <span>{t.reader.fullscreen}</span>
                  <span>F</span>
                </div>
                <div className="flex justify-between">
                  <span>{t.reader.infoPanel}</span>
                  <span>I</span>
                </div>
                <div className="flex justify-between">
                  <span>{t.reader.goBack}</span>
                  <span>Esc</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
