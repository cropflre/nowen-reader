"use client";

import {
  ArrowLeft,
  BookOpen,
  Columns2,
  GalleryVertical,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  Maximize,
  Minimize,
  Info,
  Sun,
  Moon,
  Settings,
  Play,
  Square,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { ComicReadingMode, ReadingDirection } from "@/types/reader";
import { useTranslation } from "@/lib/i18n";

export type ReaderTheme = "day" | "night" | "green" | "gray" | "white";

interface ReaderToolbarProps {
  visible: boolean;
  title: string;
  currentPage: number;
  totalPages: number;
  mode: ComicReadingMode;
  direction: ReadingDirection;
  isFullscreen: boolean;
  readerTheme: ReaderTheme;
  onBack: () => void;
  onPageChange: (page: number) => void;
  onModeChange: (mode: ComicReadingMode) => void;
  onDirectionChange: (dir: ReadingDirection) => void;
  onToggleFullscreen: () => void;
  onToggleTheme: () => void;
  onShowInfo?: () => void;
  onShowSettings?: () => void;
  /** 自动翻页是否激活 */
  autoPageActive?: boolean;
  /** 自动翻页间隔（秒），为 0 或未设置时不显示按钮 */
  autoPageInterval?: number;
  /** 切换自动翻页 */
  onToggleAutoPage?: () => void;
  /** 通知父组件工具栏正在被交互，不要自动隐藏 */
  onInteracting?: (interacting: boolean) => void;
}

export default function ReaderToolbar({
  visible,
  title,
  currentPage,
  totalPages,
  mode,
  direction,
  isFullscreen,
  readerTheme,
  onBack,
  onPageChange,
  onModeChange,
  onDirectionChange,
  onToggleFullscreen,
  onToggleTheme,
  onShowInfo,
  onShowSettings,
  autoPageActive,
  autoPageInterval,
  onToggleAutoPage,
  onInteracting,
}: ReaderToolbarProps) {
  const t = useTranslation();
  const [showPageInput, setShowPageInput] = useState(false);
  const [pageInputValue, setPageInputValue] = useState("");
  // 进度条拖动状态：拖动中只更新预览值，松手后才真正跳转
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(currentPage);
  const rafRef = useRef<number>(0);

  // 拖动中的页码显示值
  const displayPage = isDragging ? dragValue : currentPage;

  // 开始拖动
  const handleSliderStart = useCallback(() => {
    setIsDragging(true);
    setDragValue(currentPage);
    onInteracting?.(true);
  }, [currentPage, onInteracting]);

  // 拖动中：只更新预览值，节流触发页面跳转
  const handleSliderInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    const val = Number((e.target as HTMLInputElement).value);
    setDragValue(val);
    // 使用 rAF 节流，拖动中也实时跳转但不会堆积
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      onPageChange(val);
    });
  }, [onPageChange]);

  // 松手：确保最终值准确
  const handleSliderEnd = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    onPageChange(dragValue);
    setIsDragging(false);
    onInteracting?.(false);
  }, [dragValue, onPageChange, onInteracting]);

  // 页码跳转
  const handlePageInputSubmit = () => {
    const num = parseInt(pageInputValue, 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      onPageChange(num - 1);
    }
    setShowPageInput(false);
    setPageInputValue("");
  };

  const modeOptions: { value: ComicReadingMode; icon: React.ReactNode; label: string }[] = [
    { value: "single", icon: <BookOpen className="h-4 w-4" />, label: t.readerToolbar.single },
    { value: "double", icon: <Columns2 className="h-4 w-4" />, label: t.readerToolbar.double },
    { value: "webtoon", icon: <GalleryVertical className="h-4 w-4" />, label: t.readerToolbar.webtoon },
  ];

  return (
    <>
      {/* Top Bar */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-out ${
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex h-14 items-center justify-between bg-black/70 px-4 backdrop-blur-xl">
          {/* Left: Back + Title */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="truncate text-sm font-medium text-white/90">
              {title}
            </h1>
          </div>

          {/* Right: Info + Fullscreen */}
          <div className="flex items-center gap-1">
            {onShowInfo && (
              <button
                onClick={onShowInfo}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Info className="h-4 w-4" />
              </button>
            )}
            {onShowSettings && (
              <button
                onClick={onShowSettings}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                title={t.readerToolbar.settings}
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onToggleFullscreen}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              {isFullscreen ? (
                <Minimize className="h-4 w-4" />
              ) : (
                <Maximize className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 ease-out ${
          visible
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <div className="bg-black/70 px-4 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          {/* Page Slider */}
          <div className="flex items-center gap-4 py-3">
            <button
              onClick={() => onPageChange(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="relative flex-1">
              <input
                type="range"
                min={0}
                max={totalPages - 1}
                value={displayPage}
                onInput={handleSliderInput}
                onChange={handleSliderInput}
                onTouchStart={handleSliderStart}
                onTouchEnd={handleSliderEnd}
                onMouseDown={handleSliderStart}
                onMouseUp={handleSliderEnd}
                className="reader-slider w-full"
              />
            </div>

            <button
              onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <span
              className="shrink-0 min-w-[60px] text-center text-xs font-mono text-white/70 cursor-pointer hover:text-white active:text-accent transition-colors"
              onClick={() => {
                setPageInputValue(String(displayPage + 1));
                setShowPageInput(true);
              }}
            >
              {displayPage + 1} / {totalPages}
            </span>
          </div>

          {/* 页码跳转弹窗 */}
          {showPageInput && (
            <div className="flex items-center gap-2 px-4 pb-2">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInputValue}
                onChange={(e) => setPageInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePageInputSubmit()}
                placeholder={`1-${totalPages}`}
                autoFocus
                className="w-20 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white text-center font-mono placeholder:text-white/30 outline-none focus:ring-1 focus:ring-accent/50"
                onFocus={() => onInteracting?.(true)}
                onBlur={() => { onInteracting?.(false); setTimeout(() => setShowPageInput(false), 200); }}
              />
              <button
                onClick={handlePageInputSubmit}
                className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs text-accent hover:bg-accent/30 transition-colors"
              >
                跳转
              </button>
            </div>
          )}

          {/* Mode & Settings */}
          <div className="flex items-center justify-between border-t border-white/10 py-2 sm:py-3">
            {/* Reading Mode */}
            <div className="flex items-center gap-0.5 sm:gap-1 rounded-xl bg-white/5 p-1">
              {modeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onModeChange(opt.value)}
                  className={`flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    mode === opt.value
                      ? "bg-accent text-white shadow-sm"
                      : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {opt.icon}
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              ))}
            </div>

            {/* Direction Toggle */}
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => {
                  const next = direction === "ltr" ? "rtl" : direction === "rtl" ? "ttb" : "ltr";
                  onDirectionChange(next);
                }}
                className={`flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  direction === "rtl"
                    ? "bg-amber-500/20 text-amber-400"
                    : direction === "ttb"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
              >
                <ArrowLeftRight className="h-4 w-4" />
                <span className="hidden sm:inline">{direction === "rtl" ? t.readerToolbar.rtl : direction === "ttb" ? t.readerToolbar.ttb : t.readerToolbar.ltr}</span>
              </button>

              {/* 自动翻页按钮 */}
              {onToggleAutoPage && autoPageInterval != null && autoPageInterval > 0 && mode !== "webtoon" && (
                <button
                  onClick={onToggleAutoPage}
                  className={`flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    autoPageActive
                      ? "bg-green-500/20 text-green-400 animate-pulse"
                      : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                  title={autoPageActive ? t.readerToolbar.autoPageStop : t.readerToolbar.autoPage}
                >
                  {autoPageActive ? (
                    <Square className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current" />
                  )}
                  <span className="hidden sm:inline">{autoPageActive ? t.readerToolbar.autoPageStop : t.readerToolbar.autoPage}</span>
                </button>
              )}

              <button
                onClick={onToggleTheme}
                className={`flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  readerTheme === "day"
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
              >
                {readerTheme === "day" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{readerTheme === "day" ? t.readerToolbar.dayMode : t.readerToolbar.nightMode}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
