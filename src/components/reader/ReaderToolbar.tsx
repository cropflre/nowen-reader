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
} from "lucide-react";
import { ReadingMode, ReadingDirection } from "@/types/reader";
import { useTranslation } from "@/lib/i18n";

export type ReaderTheme = "day" | "night";

interface ReaderToolbarProps {
  visible: boolean;
  title: string;
  currentPage: number;
  totalPages: number;
  mode: ReadingMode;
  direction: ReadingDirection;
  isFullscreen: boolean;
  readerTheme: ReaderTheme;
  onBack: () => void;
  onPageChange: (page: number) => void;
  onModeChange: (mode: ReadingMode) => void;
  onDirectionChange: (dir: ReadingDirection) => void;
  onToggleFullscreen: () => void;
  onToggleTheme: () => void;
  onShowInfo?: () => void;
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
}: ReaderToolbarProps) {
  const t = useTranslation();

  const modeOptions: { value: ReadingMode; icon: React.ReactNode; label: string }[] = [
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
                value={currentPage}
                onChange={(e) => onPageChange(Number(e.target.value))}
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

            <span className="shrink-0 min-w-[60px] text-center text-xs font-mono text-white/70">
              {currentPage + 1} / {totalPages}
            </span>
          </div>

          {/* Mode & Settings */}
          <div className="flex items-center justify-between border-t border-white/10 py-3">
            {/* Reading Mode */}
            <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
              {modeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onModeChange(opt.value)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    mode === opt.value
                      ? "bg-accent text-white shadow-sm"
                      : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>

            {/* Direction Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  onDirectionChange(direction === "ltr" ? "rtl" : "ltr")
                }
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  direction === "rtl"
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
              >
                <ArrowLeftRight className="h-4 w-4" />
                <span>{direction === "rtl" ? t.readerToolbar.rtl : t.readerToolbar.ltr}</span>
              </button>

              <button
                onClick={onToggleTheme}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
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
                <span>{readerTheme === "day" ? t.readerToolbar.dayMode : t.readerToolbar.nightMode}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
