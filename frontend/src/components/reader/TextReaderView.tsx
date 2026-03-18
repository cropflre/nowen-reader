"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, List, Minus, Plus, Type, Brain, Loader2 } from "lucide-react";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import { useLocale } from "@/lib/i18n";
import { useAIStatus } from "@/hooks/useAIStatus";

interface ChapterInfo {
  index: number;
  name: string;
  url: string;
  title?: string;
}

interface TextReaderViewProps {
  chapters: ChapterInfo[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTapCenter: () => void;
  readerTheme?: ReaderTheme;
  onShowTOCChange?: (show: boolean) => void;
  onShowSettingsChange?: (show: boolean) => void;
  externalShowTOC?: boolean;
  externalShowSettings?: boolean;
  comicId?: string;
}

export default function TextReaderView({
  chapters,
  currentPage,
  onPageChange,
  onTapCenter,
  readerTheme = "night",
  onShowTOCChange,
  onShowSettingsChange,
  externalShowTOC,
  externalShowSettings,
  comicId,
}: TextReaderViewProps) {
  const { locale } = useLocale();
  const { aiConfigured } = useAIStatus();
  const [content, setContent] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [isHTML, setIsHTML] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== "undefined") {
      return parseInt(localStorage.getItem("textReaderFontSize") || "18", 10);
    }
    return 18;
  });
  const [lineHeight, setLineHeight] = useState(() => {
    if (typeof window !== "undefined") {
      return parseFloat(localStorage.getItem("textReaderLineHeight") || "1.8");
    }
    return 1.8;
  });
  const [showTOC, setShowTOC] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // 章节摘要状态
  const [chapterSummaries, setChapterSummaries] = useState<Record<number, string>>({});
  const [summaryLoadingIdx, setSummaryLoadingIdx] = useState<number | null>(null);
  const [showSummaries, setShowSummaries] = useState(false);

  // 外部控制TOC和Settings的显示
  useEffect(() => {
    if (externalShowTOC !== undefined) setShowTOC(externalShowTOC);
  }, [externalShowTOC]);

  useEffect(() => {
    if (externalShowSettings !== undefined) setShowSettings(externalShowSettings);
  }, [externalShowSettings]);

  // 向父组件通知状态变化
  useEffect(() => {
    onShowTOCChange?.(showTOC);
  }, [showTOC, onShowTOCChange]);

  useEffect(() => {
    onShowSettingsChange?.(showSettings);
  }, [showSettings, onShowSettingsChange]);
  const [fontFamily, setFontFamily] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("textReaderFontFamily") || "system";
    }
    return "system";
  });
  const contentRef = useRef<HTMLDivElement>(null);

  // Load chapter content
  useEffect(() => {
    if (!chapters[currentPage]) return;

    const url = chapters[currentPage].url;
    setLoading(true);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load chapter");
        return res.json();
      })
      .then((data) => {
        setContent(data.content || "");
        setChapterTitle(data.title || chapters[currentPage].title || "");
        // Detect if content is HTML (from EPUB)
        const mime = data.mimeType || "";
        setIsHTML(mime.includes("html"));
      })
      .catch(() => {
        setContent("加载失败，请重试");
        setIsHTML(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [currentPage, chapters]);

  // Scroll to top on chapter change
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [currentPage]);

  // Persist font settings
  useEffect(() => {
    localStorage.setItem("textReaderFontSize", String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem("textReaderLineHeight", String(lineHeight));
  }, [lineHeight]);

  useEffect(() => {
    localStorage.setItem("textReaderFontFamily", fontFamily);
  }, [fontFamily]);

  // 字体族映射
  const fontFamilyMap: Record<string, string> = {
    system: "system-ui, -apple-system, sans-serif",
    serif: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif",
    sans: "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    kai: "'KaiTi', 'STKaiti', 'AR PL KaitiM GB', serif",
    mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  };

  const fontFamilyLabels: Record<string, string> = {
    system: "系统默认",
    serif: "宋体/衬线",
    sans: "黑体/无衬线",
    kai: "楷体",
    mono: "等宽字体",
  };

  // Keyboard shortcuts for chapter navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (showTOC || showSettings) return;

      if (e.key === "ArrowLeft" || e.key === "a") {
        e.preventDefault();
        if (currentPage > 0) onPageChange(currentPage - 1);
      } else if (e.key === "ArrowRight" || e.key === "d") {
        e.preventDefault();
        if (currentPage < chapters.length - 1) onPageChange(currentPage + 1);
      }
    },
    [currentPage, chapters.length, onPageChange, showTOC, showSettings]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const isDark = readerTheme === "night";

  // Format text content: convert newlines to paragraphs (for plain text only)
  const formattedContent = !isHTML
    ? content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line, i) => (
          <p key={i} className="mb-4 indent-8">
            {line.trim()}
          </p>
        ))
    : null;

  // EPUB HTML styles injected for rich rendering
  const epubStyles = `
    .epub-content p { margin-bottom: 1em; text-indent: 2em; }
    .epub-content h1, .epub-content h2, .epub-content h3,
    .epub-content h4, .epub-content h5, .epub-content h6 {
      font-weight: bold; margin: 1.5em 0 0.5em; text-indent: 0;
    }
    .epub-content h1 { font-size: 1.5em; }
    .epub-content h2 { font-size: 1.3em; }
    .epub-content h3 { font-size: 1.15em; }
    .epub-content em, .epub-content i { font-style: italic; }
    .epub-content strong, .epub-content b { font-weight: bold; }
    .epub-content u { text-decoration: underline; }
    .epub-content blockquote {
      border-left: 3px solid currentColor;
      opacity: 0.7;
      padding-left: 1em;
      margin: 1em 0;
      text-indent: 0;
    }
    .epub-content ul, .epub-content ol {
      padding-left: 2em; margin: 0.5em 0; text-indent: 0;
    }
    .epub-content li { margin-bottom: 0.3em; }
    .epub-content img {
      max-width: 100%; height: auto; display: block;
      margin: 1em auto; border-radius: 4px;
    }
    .epub-content a { color: inherit; text-decoration: underline; opacity: 0.8; }
    .epub-content hr {
      border: none; border-top: 1px solid currentColor;
      opacity: 0.2; margin: 2em 0;
    }
    .epub-content pre, .epub-content code {
      font-family: monospace; font-size: 0.9em;
    }
    .epub-content pre {
      padding: 1em; border-radius: 6px; overflow-x: auto;
      background: ${isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"};
      text-indent: 0;
    }
    .epub-content table {
      border-collapse: collapse; width: 100%; margin: 1em 0;
    }
    .epub-content td, .epub-content th {
      border: 1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"};
      padding: 0.5em;
    }
    .epub-content sup { font-size: 0.75em; vertical-align: super; }
    .epub-content sub { font-size: 0.75em; vertical-align: sub; }
    .epub-content figure { margin: 1em 0; text-align: center; }
    .epub-content figcaption { font-size: 0.85em; opacity: 0.7; margin-top: 0.5em; }
  `;

  return (
    <div
      className={`relative flex h-screen w-full flex-col transition-colors duration-300 ${
        isDark ? "bg-zinc-900 text-zinc-200" : "bg-amber-50 text-zinc-800"
      }`}
    >
      {/* Chapter title bar */}
      <div
        className={`flex shrink-0 items-center justify-between px-4 py-2 ${
          isDark ? "bg-zinc-800/80" : "bg-amber-100/80"
        } backdrop-blur-sm`}
      >
        <button
          onClick={() => setShowTOC(true)}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${
            isDark
              ? "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              : "text-zinc-500 hover:bg-amber-200 hover:text-zinc-700"
          }`}
        >
          <List className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">目录</span>
        </button>

        <span
          className={`mx-4 truncate text-xs font-medium ${
            isDark ? "text-zinc-400" : "text-zinc-500"
          }`}
        >
          {chapterTitle || `第 ${currentPage + 1} 章`}
        </span>

        <button
          onClick={() => setShowSettings((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${
            isDark
              ? "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              : "text-zinc-500 hover:bg-amber-200 hover:text-zinc-700"
          }`}
        >
          <Type className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">排版</span>
        </button>
      </div>

      {/* Main content area */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 md:px-16 lg:px-32"
        onClick={(e) => {
          // Tap center to toggle toolbar
          const rect = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const height = rect.height;
          if (y / height > 0.3 && y / height < 0.7) {
            onTapCenter();
          }
        }}
      >
        <div
          className="mx-auto max-w-2xl"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: lineHeight,
            fontFamily: fontFamilyMap[fontFamily] || fontFamilyMap.system,
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div
                className={`h-8 w-8 animate-spin rounded-full border-2 border-t-accent ${
                  isDark ? "border-zinc-700" : "border-zinc-300"
                }`}
              />
            </div>
          ) : (
            <>
              {/* Chapter title */}
              {chapterTitle && (
                <h2
                  className={`mb-8 text-center text-xl font-bold ${
                    isDark ? "text-zinc-100" : "text-zinc-800"
                  }`}
                >
                  {chapterTitle}
                </h2>
              )}

              {/* Text content */}
              <div
                className={`leading-relaxed ${
                  isDark ? "text-zinc-300" : "text-zinc-700"
                }`}
              >
                {isHTML ? (
                  <>
                    <style>{epubStyles}</style>
                    <div
                      className="epub-content"
                      dangerouslySetInnerHTML={{ __html: content }}
                    />
                  </>
                ) : (
                  formattedContent
                )}
              </div>

              {/* Chapter navigation at bottom */}
              <div className="mt-12 flex items-center justify-between border-t border-current/10 pt-6 pb-8">
                <button
                  onClick={() => currentPage > 0 && onPageChange(currentPage - 1)}
                  disabled={currentPage === 0}
                  className={`flex items-center gap-1 rounded-lg px-4 py-2 text-sm transition-colors ${
                    currentPage === 0
                      ? "opacity-30 cursor-not-allowed"
                      : isDark
                      ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      : "bg-amber-100 text-zinc-600 hover:bg-amber-200"
                  }`}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一章
                </button>

                <span
                  className={`text-xs ${isDark ? "text-zinc-500" : "text-zinc-400"}`}
                >
                  {currentPage + 1} / {chapters.length}
                </span>

                <button
                  onClick={() =>
                    currentPage < chapters.length - 1 &&
                    onPageChange(currentPage + 1)
                  }
                  disabled={currentPage >= chapters.length - 1}
                  className={`flex items-center gap-1 rounded-lg px-4 py-2 text-sm transition-colors ${
                    currentPage >= chapters.length - 1
                      ? "opacity-30 cursor-not-allowed"
                      : isDark
                      ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      : "bg-amber-100 text-zinc-600 hover:bg-amber-200"
                  }`}
                >
                  下一章
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Settings panel (font size, line height) */}
      {showSettings && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowSettings(false)}
          />
          <div
            className={`fixed bottom-0 left-0 right-0 z-50 max-h-[60vh] overflow-y-auto rounded-t-2xl p-4 sm:p-6 shadow-2xl ${
              isDark ? "bg-zinc-800" : "bg-white"
            }`}
          >
            <h3
              className={`mb-4 text-sm font-semibold ${
                isDark ? "text-zinc-200" : "text-zinc-700"
              }`}
            >
              排版设置
            </h3>

            {/* Font size */}
            <div className="mb-4">
              <label
                className={`mb-2 block text-xs ${
                  isDark ? "text-zinc-400" : "text-zinc-500"
                }`}
              >
                字体大小: {fontSize}px
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                  className={`rounded-lg p-2 ${
                    isDark
                      ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="range"
                  min={12}
                  max={32}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="flex-1"
                />
                <button
                  onClick={() => setFontSize((s) => Math.min(32, s + 2))}
                  className={`rounded-lg p-2 ${
                    isDark
                      ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Line height */}
            <div className="mb-4">
              <label
                className={`mb-2 block text-xs ${
                  isDark ? "text-zinc-400" : "text-zinc-500"
                }`}
              >
                行间距: {lineHeight.toFixed(1)}
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setLineHeight((h) => Math.max(1.2, h - 0.2))}
                  className={`rounded-lg p-2 ${
                    isDark
                      ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="range"
                  min={1.2}
                  max={3.0}
                  step={0.2}
                  value={lineHeight}
                  onChange={(e) => setLineHeight(Number(e.target.value))}
                  className="flex-1"
                />
                <button
                  onClick={() => setLineHeight((h) => Math.min(3.0, h + 0.2))}
                  className={`rounded-lg p-2 ${
                    isDark
                      ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Font family */}
            <div>
              <label
                className={`mb-2 block text-xs ${
                  isDark ? "text-zinc-400" : "text-zinc-500"
                }`}
              >
                字体
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(fontFamilyLabels).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFontFamily(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                      fontFamily === key
                        ? isDark
                          ? "bg-accent/20 text-accent ring-1 ring-accent/40"
                          : "bg-accent/10 text-accent ring-1 ring-accent/30"
                        : isDark
                        ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                    style={{ fontFamily: fontFamilyMap[key] }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* TOC (Table of Contents) panel */}
      {showTOC && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowTOC(false)}
          />
          <div
            className={`fixed top-0 left-0 z-50 h-full w-64 sm:w-72 overflow-y-auto shadow-2xl ${
              isDark ? "bg-zinc-900" : "bg-white"
            }`}
          >
            <div className="sticky top-0 flex items-center justify-between p-4">
              <h3
                className={`text-sm font-semibold ${
                  isDark ? "text-zinc-200" : "text-zinc-700"
                }`}
              >
                目录 ({chapters.length} 章)
              </h3>
              <div className="flex items-center gap-2">
                {comicId && aiConfigured && (
                  <button
                    onClick={() => setShowSummaries((v) => !v)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-colors ${
                      showSummaries
                        ? "bg-purple-500/20 text-purple-400"
                        : isDark
                        ? "text-zinc-400 hover:text-zinc-200"
                        : "text-zinc-500 hover:text-zinc-700"
                    }`}
                    title={locale === "zh-CN" ? "AI 章节摘要" : "AI Chapter Summaries"}
                  >
                    <Brain className="h-3 w-3" />
                    AI
                  </button>
                )}
                <button
                  onClick={() => setShowTOC(false)}
                  className={`rounded-lg p-1 text-xs ${
                    isDark
                      ? "text-zinc-400 hover:text-zinc-200"
                      : "text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="px-2 pb-4">
              {chapters.map((ch, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onPageChange(i);
                    setShowTOC(false);
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    i === currentPage
                      ? isDark
                        ? "bg-accent/20 text-accent"
                        : "bg-accent/10 text-accent"
                      : isDark
                      ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800"
                  }`}
                >
                  <span className="mr-2 inline-block w-8 text-right text-xs opacity-50">
                    {i + 1}.
                  </span>
                  <span className="flex-1">
                    {ch.title || ch.name}
                    {/* 章节摘要显示 */}
                    {showSummaries && chapterSummaries[i] && (
                      <span className={`mt-0.5 block text-[10px] leading-tight ${
                        isDark ? "text-purple-400/60" : "text-purple-500/60"
                      }`}>
                        {chapterSummaries[i]}
                      </span>
                    )}
                    {showSummaries && !chapterSummaries[i] && summaryLoadingIdx === i && (
                      <span className={`mt-0.5 flex items-center gap-1 text-[10px] ${
                        isDark ? "text-zinc-500" : "text-zinc-400"
                      }`}>
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        {locale === "zh-CN" ? "生成中..." : "Generating..."}
                      </span>
                    )}
                  </span>
                  {/* AI 摘要按钮 */}
                  {showSummaries && comicId && aiConfigured && !chapterSummaries[i] && summaryLoadingIdx !== i && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSummaryLoadingIdx(i);
                        fetch(`/api/comics/${comicId}/ai-chapter-summary`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ chapterIndex: i, targetLang: locale }),
                        })
                          .then((res) => res.ok ? res.json() : null)
                          .then((data) => {
                            if (data?.summary?.summary) {
                              setChapterSummaries((prev) => ({ ...prev, [i]: data.summary.summary }));
                            }
                          })
                          .finally(() => setSummaryLoadingIdx(null));
                      }}
                      className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] transition-colors ${
                        isDark
                          ? "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                          : "bg-purple-500/10 text-purple-500 hover:bg-purple-500/20"
                      }`}
                    >
                      <Brain className="h-2.5 w-2.5" />
                    </button>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
