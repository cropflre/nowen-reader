"use client";

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Info,
  List,
  Type,
  Bookmark,
  Search,
  Volume2,
  Timer,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";

// 主题图标和标签映射
const themeOptions: { value: ReaderTheme; label: string; color: string }[] = [
  { value: "night", label: "深色", color: "#18181b" },
  { value: "day", label: "米黄", color: "#fffbeb" },
  { value: "green", label: "豆沙绿", color: "#C7EDCC" },
  { value: "gray", label: "浅灰", color: "#E0E0E0" },
  { value: "white", label: "纯白", color: "#ffffff" },
];

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
  onThemeChange: (theme: ReaderTheme) => void;
  onShowInfo?: () => void;
  onShowTOC?: () => void;
  onShowSettings?: () => void;
  onShowBookmarks?: () => void;
  onShowSearch?: () => void;
  onToggleTTS?: () => void;
  onToggleAutoScroll?: () => void;
  isTTSPlaying?: boolean;
  isAutoScrolling?: boolean;
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
  onThemeChange,
  onShowInfo,
  onShowTOC,
  onShowSettings,
  onShowBookmarks,
  onShowSearch,
  onToggleTTS,
  onToggleAutoScroll,
  isTTSPlaying,
  isAutoScrolling,
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
          {/* 功能按钮区 + 主题色卡 - 移动端自适应布局 */}
          <div className="flex items-center justify-between border-t border-white/10 py-2 sm:py-3">
            {/* 左侧功能按钮：移动端只显示核心按钮 */}
            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0 overflow-x-auto">
              {/* TOC 按钮 */}
              {onShowTOC && (
                <button
                  onClick={onShowTOC}
                  className="flex items-center gap-1 sm:gap-1.5 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs font-medium text-white/60 transition-all duration-200 hover:text-white hover:bg-white/10 shrink-0"
                >
                  <List className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.reader?.toc || "目录"}</span>
                </button>
              )}

              {/* 排版设置按钮 */}
              {onShowSettings && (
                <button
                  onClick={onShowSettings}
                  className="flex items-center gap-1 sm:gap-1.5 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs font-medium text-white/60 transition-all duration-200 hover:text-white hover:bg-white/10 shrink-0"
                >
                  <Type className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.reader?.typesetting || "排版"}</span>
                </button>
              )}

              {/* 书签按钮 */}
              {onShowBookmarks && (
                <button
                  onClick={onShowBookmarks}
                  className="flex items-center gap-1 sm:gap-1.5 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs font-medium text-white/60 transition-all duration-200 hover:text-white hover:bg-white/10 shrink-0"
                >
                  <Bookmark className="h-4 w-4" />
                  <span className="hidden sm:inline">书签</span>
                </button>
              )}

              {/* 搜索按钮 */}
              {onShowSearch && (
                <button
                  onClick={onShowSearch}
                  className="flex items-center gap-1 sm:gap-1.5 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs font-medium text-white/60 transition-all duration-200 hover:text-white hover:bg-white/10 shrink-0"
                >
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">搜索</span>
                </button>
              )}

              {/* TTS 听书按钮 - 移动端隐藏 */}
              {onToggleTTS && (
                <button
                  onClick={onToggleTTS}
                  className={`hidden sm:flex items-center gap-1 sm:gap-1.5 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 shrink-0 ${
                    isTTSPlaying
                      ? "text-accent bg-accent/10"
                      : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Volume2 className={`h-4 w-4 ${isTTSPlaying ? "animate-pulse" : ""}`} />
                  <span className="hidden sm:inline">{isTTSPlaying ? "停止" : "听书"}</span>
                </button>
              )}

              {/* 自动翻页按钮 - 移动端隐藏 */}
              {onToggleAutoScroll && (
                <button
                  onClick={onToggleAutoScroll}
                  className={`hidden sm:flex items-center gap-1 sm:gap-1.5 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs font-medium transition-all duration-200 shrink-0 ${
                    isAutoScrolling
                      ? "text-green-400 bg-green-500/10"
                      : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Timer className={`h-4 w-4 ${isAutoScrolling ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">{isAutoScrolling ? "停止" : "自动"}</span>
                </button>
              )}
            </div>

            {/* 右侧主题色卡选择 */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 ml-2">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onThemeChange(opt.value)}
                  className={`relative h-5 w-5 sm:h-6 sm:w-6 rounded-full border-2 transition-all ${
                    readerTheme === opt.value
                      ? "border-accent scale-110 shadow-md shadow-accent/30"
                      : "border-white/20 hover:border-white/40"
                  }`}
                  style={{ backgroundColor: opt.color }}
                  title={opt.label}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
