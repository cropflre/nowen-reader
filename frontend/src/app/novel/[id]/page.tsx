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
  clearAllComicTags,
  startSession,
  endSession,
  endSessionBeacon,
} from "@/hooks/useComics";
import TextReaderView from "@/components/reader/TextReaderView";
import NovelToolbar from "@/components/reader/NovelToolbar";
import { Heart, Star, Tag, X, Plus, Trash2 } from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import AIChatPanel from "@/components/reader/AIChatPanel";
import { useAIStatus } from "@/hooks/useAIStatus";

export default function NovelReaderPage() {
  const params = useParams();
  const router = useRouter();
  const comicId = params.id as string;
  const t = useTranslation();
  const { locale } = useLocale();
  const { aiConfigured } = useAIStatus();

  // Fetch chapters from API
  const {
    chapters: apiChapters,
    title: apiTitle,
    isNovel,
    loading: apiLoading,
    error: apiError,
  } = useComicPages(comicId);

  // Comic detail from DB
  const { comic: comicDetail, refetch: refetchDetail } =
    useComicDetail(comicId);

  const title = apiTitle || comicDetail?.title || t.reader.unknownComic;
  const isLoading = apiLoading;
  const totalChapters = apiChapters.length;

  // 如果后端检测到不是小说（如图片为主的 MOBI/AZW3），自动重定向到漫画阅读器
  useEffect(() => {
    if (!apiLoading && !isNovel && apiChapters.length === 0) {
      router.replace(`/reader/${comicId}`);
    }
  }, [apiLoading, isNovel, apiChapters.length, comicId, router]);

  // State
  const [currentPage, setCurrentPage] = useState(0);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("novelReaderTheme") as ReaderTheme) || "night";
    }
    return "night";
  });
  const { theme: globalTheme } = useTheme();
  // 章节文本缓存（用于 AI Chat 上下文）
  const [currentChapterText, setCurrentChapterText] = useState("");

  // TOC 和 Settings 的外部控制状态
  const [showTOC, setShowTOC] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  // TTS 和 自动翻页状态（仅用于工具栏按钮状态同步）
  const [isTTSPlaying, setIsTTSPlaying] = useState(false);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);

  // Sync readerTheme with global theme（仅初始化时同步，之后用户可独立选择）
  useEffect(() => {
    const saved = localStorage.getItem("novelReaderTheme");
    if (!saved) {
      setReaderTheme(globalTheme === "light" ? "day" : "night");
    }
  }, [globalTheme]);

  // 保存主题到 localStorage
  useEffect(() => {
    localStorage.setItem("novelReaderTheme", readerTheme);
  }, [readerTheme]);

  // 监听来自 TextReaderView 设置面板的主题切换事件
  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as ReaderTheme;
      if (detail) setReaderTheme(detail);
    };
    window.addEventListener('novel-theme-change', handleThemeChange);
    return () => window.removeEventListener('novel-theme-change', handleThemeChange);
  }, []);

  // Debounced progress save ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reading session tracking
  const sessionIdRef = useRef<number | null>(null);
  const sessionStartTimeRef = useRef<number>(Date.now());

  // Restore reading progress when comic detail loads
  useEffect(() => {
    if (comicDetail && totalChapters > 0) {
      if (comicDetail.lastReadPage > 0 && comicDetail.lastReadPage < totalChapters) {
        setCurrentPage(comicDetail.lastReadPage);
      }
      setIsFavorite(comicDetail.isFavorite);
      setRating(comicDetail.rating || 0);
    }
  }, [comicDetail, totalChapters]);

  // Start reading session
  useEffect(() => {
    if (totalChapters === 0) return;

    sessionStartTimeRef.current = Date.now();
    startSession(comicId, currentPage).then((id) => {
      if (id) sessionIdRef.current = id;
    });

    return () => {
      if (sessionIdRef.current) {
        const duration = Math.round((Date.now() - sessionStartTimeRef.current) / 1000);
        if (duration > 2) {
          endSession(sessionIdRef.current, currentPage, duration);
        }
        sessionIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comicId, totalChapters > 0]);

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

  // Save progress on chapter change (debounced)
  useEffect(() => {
    if (totalChapters === 0) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveReadingProgress(comicId, currentPage);
    }, 1000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [currentPage, comicId, totalChapters]);

  // Save progress on unmount
  useEffect(() => {
    return () => {
      if (totalChapters > 0) {
        saveReadingProgress(comicId, currentPage);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 获取当前章节文本（用于 AI Chat 上下文）
  useEffect(() => {
    if (totalChapters === 0) return;
    const chapter = apiChapters[currentPage];
    if (!chapter) return;

    fetch(`/api/comics/${comicId}/chapter/${currentPage}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.content) {
          // 简单 strip HTML tags
          const text = data.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          setCurrentChapterText(text.length > 3000 ? text.slice(0, 3000) : text);
        }
      })
      .catch(() => {});
  }, [currentPage, totalChapters, comicId, apiChapters]);

  // 监听 TTS 和自动翻页状态变化（从 TextReaderView 同步到工具栏）
  useEffect(() => {
    const handleTtsStateChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as boolean;
      setIsTTSPlaying(detail);
    };
    const handleAutoScrollStateChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as boolean;
      setIsAutoScrolling(detail);
    };
    window.addEventListener('novel-tts-state-change', handleTtsStateChange);
    window.addEventListener('novel-auto-scroll-state-change', handleAutoScrollStateChange);
    return () => {
      window.removeEventListener('novel-tts-state-change', handleTtsStateChange);
      window.removeEventListener('novel-auto-scroll-state-change', handleAutoScrollStateChange);
    };
  }, []);

  // Auto-hide toolbar（面板打开时不隐藏，避免操作中途工具栏消失）
  useEffect(() => {
    if (!toolbarVisible) return;
    // 如果有面板处于打开状态，不自动隐藏工具栏
    if (showTOC || showSettingsPanel || showInfoPanel) return;
    const timer = setTimeout(() => setToolbarVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [toolbarVisible, currentPage, showTOC, showSettingsPanel, showInfoPanel]);

  // Keyboard navigation (Escape, F, I)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (showInfoPanel) return;

      if (e.key === "Escape") {
        if (isFullscreen) {
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
    [isFullscreen, router, showInfoPanel]
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

  // 移动端手势返回支持：push 一个虚拟 history state，popstate 时导航回书库
  useEffect(() => {
    // 仅在没有自定义 state 时 push
    if (!window.history.state?.novelReader) {
      window.history.pushState({ novelReader: true }, "");
    }
    const handlePopState = (e: PopStateEvent) => {
      // 如果有面板打开，先关闭面板而不是返回
      if (showTOC || showSettingsPanel || showInfoPanel) {
        // 重新 push state 以保持历史栈
        window.history.pushState({ novelReader: true }, "");
        setShowTOC(false);
        setShowSettingsPanel(false);
        setShowInfoPanel(false);
        return;
      }
      // 否则返回上一页
      router.back();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [router, showTOC, showSettingsPanel, showInfoPanel]);

  const handleTapCenter = useCallback(() => {
    setToolbarVisible((v) => !v);
  }, []);

  const handlePageChange = useCallback(
    (page: number) => {
      const clamped = Math.max(0, Math.min(totalChapters - 1, page));
      setCurrentPage(clamped);
    },
    [totalChapters]
  );

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

  // 一键清除所有标签
  const handleClearAllTags = async () => {
    if (!comicDetail?.tags || comicDetail.tags.length === 0) return;
    if (!window.confirm(t.reader.clearAllTagsConfirm)) return;
    await clearAllComicTags(comicId);
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

  // Error state
  if (apiError) {
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

  // No chapters found
  if (totalChapters === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <p className="text-lg font-medium">{t.reader.comicNotFound}</p>
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
    <div className="relative h-screen w-full overflow-hidden">
      {/* Text Reader View */}
      <TextReaderView
        chapters={apiChapters}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        onTapCenter={handleTapCenter}
        readerTheme={readerTheme}
        externalShowTOC={showTOC}
        externalShowSettings={showSettingsPanel}
        onShowTOCChange={setShowTOC}
        onShowSettingsChange={setShowSettingsPanel}
        comicId={comicId}
      />

      {/* Novel Toolbar */}
      <NovelToolbar
        visible={toolbarVisible}
        title={title}
        currentChapter={currentPage}
        totalChapters={totalChapters}
        isFullscreen={isFullscreen}
        readerTheme={readerTheme}
        onBack={() => router.back()}
        onChapterChange={handlePageChange}
        onToggleFullscreen={toggleFullscreen}
        onThemeChange={setReaderTheme}
        onShowInfo={() => setShowInfoPanel(true)}
        onShowTOC={() => setShowTOC(true)}
        onShowSettings={() => setShowSettingsPanel(true)}
        onShowBookmarks={() => {
          setShowTOC(true);
          // 利用自定义事件通知 TextReaderView 切换到书签Tab
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('novel-show-bookmarks'));
          }, 50);
        }}
        onShowSearch={() => {
          window.dispatchEvent(new CustomEvent('novel-show-search'));
        }}
        onToggleTTS={() => {
          window.dispatchEvent(new CustomEvent('novel-tts-toggle'));
        }}
        onToggleAutoScroll={() => {
          window.dispatchEvent(new CustomEvent('novel-auto-scroll-toggle'));
        }}
        isTTSPlaying={isTTSPlaying}
        isAutoScrolling={isAutoScrolling}
      />

      {/* AI Chat Panel */}
      {aiConfigured && (
        <AIChatPanel
          comicId={comicId}
          locale={locale}
          contextText={currentChapterText}
          contextLabel={`${apiChapters[currentPage]?.title || `Chapter ${currentPage + 1}`} (${currentPage + 1}/${totalChapters})`}
          readerTheme={readerTheme}
        />
      )}

      {/* Info Panel (slide-in from right) */}
      {showInfoPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 animate-backdrop-in"
            onClick={() => setShowInfoPanel(false)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 z-50 h-full w-full sm:w-80 overflow-y-auto bg-zinc-900/95 p-4 sm:p-6 shadow-2xl backdrop-blur-xl animate-modal-in">
            {/* Close */}
            <button
              onClick={() => setShowInfoPanel(false)}
              className="absolute top-4 right-4 rounded-lg p-1 text-white/50 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="mb-4 sm:mb-6 pr-8 text-lg font-semibold text-white">
              {title}
            </h2>

            {/* Favorite */}
            <div className="mb-4 sm:mb-6">
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
            <div className="mb-4 sm:mb-6">
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
            <div className="mb-4 sm:mb-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-white/40">
                  {t.reader.tagsLabel}
                </h3>
                {(comicDetail?.tags || []).length > 0 && (
                  <button
                    onClick={handleClearAllTags}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    title={t.reader.clearAllTags}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t.reader.clearAllTags}</span>
                  </button>
                )}
              </div>

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
            <div className="mb-4 sm:mb-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                {t.reader.readingInfo}
              </h3>
              <div className="space-y-2 text-xs text-white/60">
                <div className="flex justify-between">
                  <span>{t.reader.currentPage}</span>
                  <span className="text-white/80">
                    {currentPage + 1} / {totalChapters}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.reader.readProgress}</span>
                  <span className="text-white/80">
                    {Math.round(((currentPage + 1) / totalChapters) * 100)}%
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
                    width: `${((currentPage + 1) / totalChapters) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Keyboard Shortcuts - 仅桌面端显示 */}
            <div className="hidden sm:block">
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
