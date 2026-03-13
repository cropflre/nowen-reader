"use client";

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Info,
  Sun,
  Moon,
  List,
  Type,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";

interface NovelToolbarProps {
  visible: boolean;
  title: string;
  currentChapter: number;
  totalChapters: number;
  isFullscreen: boolean;
  readerTheme: ReaderTheme;
  onBack: () => void;
  onChapterChange: (chapter: number) => void;
  onToggleFullscreen: () => void;
  onToggleTheme: () => void;
  onShowInfo?: () => void;
  onShowTOC?: () => void;
  onShowSettings?: () => void;
}

export default function NovelToolbar({
  visible,
  title,
  currentChapter,
  totalChapters,
  isFullscreen,
  readerTheme,
  onBack,
  onChapterChange,
  onToggleFullscreen,
  onToggleTheme,
  onShowInfo,
  onShowTOC,
  onShowSettings,
}: NovelToolbarProps) {
  const t = useTranslation();

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
          {/* Chapter Slider */}
          <div className="flex items-center gap-4 py-3">
            <button
              onClick={() => onChapterChange(Math.max(0, currentChapter - 1))}
              disabled={currentChapter === 0}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="relative flex-1">
              <input
                type="range"
                min={0}
                max={totalChapters - 1}
                value={currentChapter}
                onChange={(e) => onChapterChange(Number(e.target.value))}
                className="reader-slider w-full"
              />
            </div>

            <button
              onClick={() => onChapterChange(Math.min(totalChapters - 1, currentChapter + 1))}
              disabled={currentChapter >= totalChapters - 1}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <span className="shrink-0 min-w-[60px] text-center text-xs font-mono text-white/70">
              {currentChapter + 1} / {totalChapters}
            </span>
          </div>

          {/* Theme toggle */}
          <div className="flex items-center justify-between border-t border-white/10 py-2 sm:py-3">
            <div className="flex items-center gap-1">
              {/* TOC 按钮 */}
              {onShowTOC && (
                <button
                  onClick={onShowTOC}
                  className="flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium text-white/60 transition-all duration-200 hover:text-white hover:bg-white/10"
                >
                  <List className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.reader?.toc || "目录"}</span>
                </button>
              )}

              {/* 排版设置按钮 */}
              {onShowSettings && (
                <button
                  onClick={onShowSettings}
                  className="flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-medium text-white/60 transition-all duration-200 hover:text-white hover:bg-white/10"
                >
                  <Type className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.reader?.typesetting || "排版"}</span>
                </button>
              )}
            </div>
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
    </>
  );
}
