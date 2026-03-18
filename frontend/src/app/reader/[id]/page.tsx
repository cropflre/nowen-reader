"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
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
  endSessionBeacon,
} from "@/hooks/useComics";
import { ComicReadingMode, ReadingDirection } from "@/types/reader";
import ReaderToolbar from "@/components/reader/ReaderToolbar";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import { useTheme } from "@/lib/theme-context";
import SinglePageView from "@/components/reader/SinglePageView";
import DoublePageView from "@/components/reader/DoublePageView";
import WebtoonView from "@/components/reader/WebtoonView";
import PdfView from "@/components/reader/PdfView";
import ReaderOptionsPanel from "@/components/reader/ReaderOptionsPanel";
import { Heart, Star, Tag, X, Plus } from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import AIChatPanel from "@/components/reader/AIChatPanel";
import PageTranslateOverlay from "@/components/reader/PageTranslateOverlay";
import { useAIStatus } from "@/hooks/useAIStatus";
import { useReaderOptions } from "@/hooks/useReaderOptions";
import { fetchSeriesDetail, type SeriesVolumeInfo } from "@/api/series";

export default function ReaderPage() {
  const params = useParams();
  const router = useRouter();
  const comicId = params.id as string;
  const t = useTranslation();
  const { locale } = useLocale();
  const { aiConfigured } = useAIStatus();
  const { options: readerOpts, updateOptions: updateReaderOpts, loaded: optsLoaded } = useReaderOptions();

  // Try API first
  const {
    pages: apiPages,
    title: apiTitle,
    isNovel,
    isPdf,
    loading: apiLoading,
    error: apiError,
  } = useComicPages(comicId);

  // Comic detail from DB
  const { comic: comicDetail, refetch: refetchDetail } =
    useComicDetail(comicId);

  // Determine data source
  const [pdfTotalPages, setPdfTotalPages] = useState<number | null>(null);
  const pages = pdfTotalPages && isPdf
    ? Array.from({ length: pdfTotalPages }, (_, i) => `/api/comics/${comicId}/page/${i}`)
    : apiPages;
  const title = apiTitle || t.reader.unknownComic;
  const isLoading = apiLoading;
  const useRealData = pages.length > 0 || (comicDetail !== null);

  // Redirect novel files to the dedicated novel reader
  useEffect(() => {
    if (isNovel && !apiLoading) {
      router.replace(`/novel/${comicId}`);
    }
  }, [isNovel, apiLoading, comicId, router]);

  // State
  const [currentPage, setCurrentPage] = useState(0);
  const [mode, setMode] = useState<ComicReadingMode>("single");
  const [direction, setDirection] = useState<ReadingDirection>("ltr");
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showOptionsPanel, setShowOptionsPanel] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [autoPageActive, setAutoPageActive] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("night");
  const { theme: globalTheme, toggleTheme: globalToggleTheme } = useTheme();

  // 系列跨卷连续阅读
  const [seriesVolumes, setSeriesVolumes] = useState<SeriesVolumeInfo[]>([]);
  const [showNextVolume, setShowNextVolume] = useState(false);
  const [seriesName, setSeriesName] = useState<string>("");

  // 从选项同步模式、方向
  useEffect(() => {
    if (!optsLoaded) return;
    setMode(readerOpts.infiniteScroll ? "webtoon" : readerOpts.mode);
    setDirection(readerOpts.direction);
    // 默认显示档案覆盖层
    if (readerOpts.defaultOverlay) {
      setShowOverlay(true);
    }
  }, [optsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync readerTheme with global theme
  useEffect(() => {
    setReaderTheme(globalTheme === "light" ? "day" : "night");
  }, [globalTheme]);

  // Debounced progress save ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reading session tracking
  const sessionIdRef = useRef<number | null>(null);
  const sessionStartTimeRef = useRef<number>(Date.now());
  const sessionStartPageRef = useRef<number>(0);

  // Restore reading progress when comic detail loads
  useEffect(() => {
    if (comicDetail && useRealData) {
      // 进度跟踪：禁用时不恢复进度
      if (readerOpts.progressTracking && comicDetail.lastReadPage > 0 && comicDetail.lastReadPage < pages.length) {
        setCurrentPage(comicDetail.lastReadPage);
        sessionStartPageRef.current = comicDetail.lastReadPage;
      }
      setIsFavorite(comicDetail.isFavorite);
      setRating(comicDetail.rating || 0);

      // 加载系列卷信息
      if (comicDetail.seriesName) {
        setSeriesName(comicDetail.seriesName);
        fetchSeriesDetail(comicDetail.seriesName)
          .then((detail) => {
            if (detail?.volumes) {
              setSeriesVolumes(detail.volumes);
            }
          })
          .catch(() => {});
      }
    }
  }, [comicDetail, useRealData, pages.length, readerOpts.progressTracking]);

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

  // beforeunload 兜底：浏览器崩溃/强制关闭时用 sendBeacon 保存会话
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (sessionIdRef.current) {
        const duration = Math.round((Date.now() - sessionStartTimeRef.current) / 1000);
        if (duration > 2) {
          endSessionBeacon(sessionIdRef.current, currentPage, duration);
        }
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  });

  // Save progress on page change (debounced) — 仅在进度跟踪启用时
  useEffect(() => {
    if (!useRealData || !readerOpts.progressTracking) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveReadingProgress(comicId, currentPage);
    }, 1000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [currentPage, comicId, useRealData, readerOpts.progressTracking]);

  // Save progress on unmount
  useEffect(() => {
    return () => {
      if (useRealData && readerOpts.progressTracking) {
        saveReadingProgress(comicId, currentPage);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hide toolbar (不在选项面板打开时隐藏)
  useEffect(() => {
    if (!toolbarVisible || showOptionsPanel) return;
    const timer = setTimeout(() => setToolbarVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [toolbarVisible, currentPage, showOptionsPanel]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if info/options panel is open
      if (showInfoPanel || showOptionsPanel) return;

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
    [direction, mode, pages.length, isFullscreen, router, showInfoPanel, showOptionsPanel]
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

      // 翻到最后一页时，如果有下一卷则显示提示
      if (clamped >= pages.length - 1 && seriesVolumes.length > 0) {
        const currentIdx = seriesVolumes.findIndex(v => v.comicId === comicId);
        if (currentIdx >= 0 && currentIdx < seriesVolumes.length - 1) {
          setShowNextVolume(true);
        }
      } else {
        setShowNextVolume(false);
      }
    },
    [pages.length, seriesVolumes, comicId]
  );

  // 自动翻页
  useEffect(() => {
    if (!autoPageActive || readerOpts.autoPageInterval <= 0) return;
    if (mode === "webtoon") return; // 无限滚动不需要自动翻页

    const step = mode === "double" ? 2 : 1;
    const timer = setInterval(() => {
      setCurrentPage((p) => {
        const next = p + step;
        if (next >= pages.length) {
          setAutoPageActive(false);
          return p;
        }
        return next;
      });
    }, readerOpts.autoPageInterval * 1000);

    return () => clearInterval(timer);
  }, [autoPageActive, readerOpts.autoPageInterval, mode, pages.length]);

  // 系列导航辅助函数
  const currentVolumeIdx = seriesVolumes.findIndex(v => v.comicId === comicId);
  const prevVolume = currentVolumeIdx > 0 ? seriesVolumes[currentVolumeIdx - 1] : null;
  const nextVolume = currentVolumeIdx >= 0 && currentVolumeIdx < seriesVolumes.length - 1 ? seriesVolumes[currentVolumeIdx + 1] : null;

  // 选项面板 onChange 处理
  const handleOptionsChange = useCallback((partial: Partial<typeof readerOpts>) => {
    updateReaderOpts(partial);
    // 同步到当前阅读器状态
    if (partial.mode !== undefined) setMode(partial.mode);
    if (partial.direction !== undefined) setDirection(partial.direction);
    if (partial.infiniteScroll !== undefined) {
      setMode(partial.infiniteScroll ? "webtoon" : (readerOpts.mode === "webtoon" ? "single" : readerOpts.mode));
    }
  }, [updateReaderOpts, readerOpts.mode]);

  // 工具栏 mode/direction 变更也同步到选项
  const handleModeChange = useCallback((m: ComicReadingMode) => {
    setMode(m);
    updateReaderOpts({ mode: m, infiniteScroll: m === "webtoon" });
  }, [updateReaderOpts]);

  const handleDirectionChange = useCallback((d: ReadingDirection) => {
    setDirection(d);
    updateReaderOpts({ direction: d });
  }, [updateReaderOpts]);

  // 计算容器宽度样式
  const containerWidthStyle = readerOpts.containerWidth
    ? (readerOpts.containerWidth.includes("%") || readerOpts.containerWidth.includes("px")
      ? readerOpts.containerWidth
      : `${readerOpts.containerWidth}px`)
    : undefined;

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
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
          <p className="text-sm text-white/40">{t.reader.loading || "正在加载..."}</p>
        </div>
      </div>
    );
  }

  // Error state (e.g. timeout for large files)
  if (apiError && pages.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <p className="text-lg font-medium">{t.reader.loadError || "加载失败"}</p>
          <p className="mt-2 text-sm text-white/50">{apiError}</p>
          <div className="mt-4 flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent px-4 py-2 text-sm"
            >
              {t.reader.retry || "重试"}
            </button>
            <button
              onClick={() => router.push("/")}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm"
            >
              {t.reader.backToShelf}
            </button>
          </div>
        </div>
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
      {isPdf ? (
        <PdfView
          comicId={comicId}
          totalPages={pages.length}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTotalPagesChange={setPdfTotalPages}
          onTapCenter={handleTapCenter}
          readerTheme={readerTheme}
        />
      ) : mode === "single" ? (
        <SinglePageView
          pages={pages}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTapCenter={handleTapCenter}
          direction={direction}
          useRealData={useRealData}
          readerTheme={readerTheme}
          fitMode={readerOpts.fitMode}
          containerWidth={containerWidthStyle}
          preloadCount={readerOpts.preloadCount}
        />
      ) : mode === "double" ? (
        <DoublePageView
          pages={pages}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTapCenter={handleTapCenter}
          direction={direction}
          useRealData={useRealData}
          readerTheme={readerTheme}
          fitMode={readerOpts.fitMode}
          containerWidth={containerWidthStyle}
          preloadCount={readerOpts.preloadCount}
        />
      ) : (
        <WebtoonView
          pages={pages}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTapCenter={handleTapCenter}
          useRealData={useRealData}
          readerTheme={readerTheme}
          containerWidth={containerWidthStyle}
          preloadCount={readerOpts.preloadCount}
        />
      )}

      {/* 跨卷连续阅读：下一卷提示浮层 */}
      {showNextVolume && nextVolume && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-2xl">
            <div className="mb-3 text-4xl">🎉</div>
            <h3 className="mb-1 text-lg font-bold text-foreground">
              {t.series.volumeFinished}
            </h3>
            <p className="mb-4 text-sm text-muted">
              {t.series.nextVolume}: {nextVolume.title}
              {nextVolume.seriesIndex != null && ` (Vol.${nextVolume.seriesIndex})`}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowNextVolume(false)}
                className="flex-1 rounded-lg border border-border/60 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
              >
                {t.common.close}
              </button>
              <button
                onClick={() => router.push(`/reader/${nextVolume.comicId}`)}
                className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-accent/25 transition-colors hover:bg-accent/90"
              >
                {t.series.nextVolume} →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 系列卷导航指示器（工具栏可见时在底部显示） */}
      {seriesVolumes.length > 1 && toolbarVisible && (
        <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 backdrop-blur-sm">
          {prevVolume && (
            <button
              onClick={() => router.push(`/reader/${prevVolume.comicId}`)}
              className="text-xs text-white/70 hover:text-white transition-colors"
              title={t.series.prevVolume}
            >
              ← Vol.{prevVolume.seriesIndex ?? "?"}
            </button>
          )}
          <span className="text-xs font-medium text-accent">
            {seriesName}
            {currentVolumeIdx >= 0 && ` (${currentVolumeIdx + 1}/${seriesVolumes.length})`}
          </span>
          {nextVolume && (
            <button
              onClick={() => router.push(`/reader/${nextVolume.comicId}`)}
              className="text-xs text-white/70 hover:text-white transition-colors"
              title={t.series.nextVolume}
            >
              Vol.{nextVolume.seriesIndex ?? "?"} →
            </button>
          )}
        </div>
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
        onModeChange={handleModeChange}
        onDirectionChange={handleDirectionChange}
        onToggleFullscreen={toggleFullscreen}
        onToggleTheme={handleToggleTheme}
        onShowInfo={useRealData ? () => setShowInfoPanel(true) : undefined}
        onShowSettings={() => setShowOptionsPanel(true)}
      />

      {/* Page number indicator (头部可见性控制) */}
      {readerOpts.headerVisible && mode !== "webtoon" && !toolbarVisible && (
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

      {/* AI Chat Panel */}
      {aiConfigured && (
        <AIChatPanel
          comicId={comicId}
          locale={locale}
          contextImageUrl={pages[currentPage] || undefined}
          contextLabel={`${t.reader.currentPage}: ${currentPage + 1} / ${pages.length}`}
          readerTheme={readerTheme}
        />
      )}

      {/* Page Translation Overlay (Phase 4) */}
      {aiConfigured && !isNovel && !isPdf && (
        <PageTranslateOverlay
          comicId={comicId}
          pageIndex={currentPage}
          locale={locale}
          readerTheme={readerTheme}
        />
      )}

      {/* Reader Options Panel */}
      {showOptionsPanel && (
        <ReaderOptionsPanel
          options={readerOpts}
          onChange={handleOptionsChange}
          onClose={() => setShowOptionsPanel(false)}
        />
      )}

      {/* Archive Overlay (档案覆盖层) */}
      {showOverlay && (
        <>
          <div className="fixed inset-0 z-[55] bg-black/70" onClick={() => setShowOverlay(false)} />
          <div className="fixed inset-4 z-[56] overflow-y-auto rounded-xl bg-zinc-900/95 backdrop-blur-xl p-6">
            <button
              onClick={() => setShowOverlay(false)}
              className="absolute top-4 right-4 rounded-lg p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors z-10"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-bold text-white mb-4">{title}</h2>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
              {pages.map((pageUrl, idx) => (
                <button
                  key={idx}
                  onClick={() => { handlePageChange(idx); setShowOverlay(false); }}
                  className={`relative aspect-[2/3] rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                    idx === currentPage ? "border-accent" : "border-transparent hover:border-white/30"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pageUrl} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-center py-0.5">
                    <span className="text-[10px] text-white/70">{idx + 1}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
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
                {(comicDetail?.tags || []).map((tag) => (
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
