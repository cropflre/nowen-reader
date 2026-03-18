"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, List, Minus, Plus, Type, Brain, Loader2, BookOpenCheck, Bookmark, BookmarkPlus, Trash2, Search, X, Copy, MessageSquare, Highlighter, Volume2, Pause, Play, Timer, Square } from "lucide-react";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import { useLocale, useTranslation } from "@/lib/i18n";
import { useAIStatus } from "@/hooks/useAIStatus";
import { idbSave, idbLoad } from "@/lib/idb-backup";

// ============ 主题色卡配置 ============
interface ThemeColors {
  bg: string;
  text: string;
  titleText: string;
  contentText: string;
  headerBg: string;
  headerText: string;
  hoverBg: string;
  navBtnBg: string;
  navBtnText: string;
  navBtnHoverBg: string;
  statusBarBg: string;
  statusBarText: string;
  settingsBg: string;
  settingsText: string;
  settingsLabel: string;
  settingsBtnBg: string;
  settingsBtnText: string;
  settingsBtnHoverBg: string;
  activeRing: string;
  tocBg: string;
  tocText: string;
  tocHoverBg: string;
  tocActiveText: string;
  tocActiveBg: string;
  epubCodeBg: string;
  epubBorderColor: string;
  isDark: boolean;
}

const themeColorMap: Record<string, ThemeColors> = {
  night: {
    bg: "bg-zinc-900", text: "text-zinc-200", titleText: "text-zinc-100",
    contentText: "text-zinc-300", headerBg: "bg-zinc-800/80", headerText: "text-zinc-400",
    hoverBg: "hover:bg-zinc-700", navBtnBg: "bg-zinc-800", navBtnText: "text-zinc-300",
    navBtnHoverBg: "hover:bg-zinc-700", statusBarBg: "bg-zinc-900/60",
    statusBarText: "text-zinc-500", settingsBg: "bg-zinc-800", settingsText: "text-zinc-200",
    settingsLabel: "text-zinc-400", settingsBtnBg: "bg-zinc-700", settingsBtnText: "text-zinc-300",
    settingsBtnHoverBg: "hover:bg-zinc-600", activeRing: "ring-accent/40",
    tocBg: "bg-zinc-900", tocText: "text-zinc-400", tocHoverBg: "hover:bg-zinc-800",
    tocActiveText: "text-accent", tocActiveBg: "bg-accent/20",
    epubCodeBg: "rgba(255,255,255,0.05)", epubBorderColor: "rgba(255,255,255,0.15)",
    isDark: true,
  },
  day: {
    bg: "bg-amber-50", text: "text-zinc-800", titleText: "text-zinc-800",
    contentText: "text-zinc-700", headerBg: "bg-amber-100/80", headerText: "text-zinc-500",
    hoverBg: "hover:bg-amber-200", navBtnBg: "bg-amber-100", navBtnText: "text-zinc-600",
    navBtnHoverBg: "hover:bg-amber-200", statusBarBg: "bg-amber-50/60",
    statusBarText: "text-zinc-400", settingsBg: "bg-white", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-zinc-100", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-zinc-200", activeRing: "ring-accent/30",
    tocBg: "bg-white", tocText: "text-zinc-600", tocHoverBg: "hover:bg-zinc-100",
    tocActiveText: "text-accent", tocActiveBg: "bg-accent/10",
    epubCodeBg: "rgba(0,0,0,0.05)", epubBorderColor: "rgba(0,0,0,0.15)",
    isDark: false,
  },
  green: {
    bg: "bg-[#C7EDCC]", text: "text-zinc-800", titleText: "text-zinc-800",
    contentText: "text-zinc-700", headerBg: "bg-[#b5e0ba]/80", headerText: "text-zinc-600",
    hoverBg: "hover:bg-[#a8d4ad]", navBtnBg: "bg-[#b5e0ba]", navBtnText: "text-zinc-600",
    navBtnHoverBg: "hover:bg-[#a8d4ad]", statusBarBg: "bg-[#C7EDCC]/60",
    statusBarText: "text-zinc-500", settingsBg: "bg-[#d8f0db]", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-[#b5e0ba]", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-[#a8d4ad]", activeRing: "ring-green-600/40",
    tocBg: "bg-[#d8f0db]", tocText: "text-zinc-600", tocHoverBg: "hover:bg-[#c0e4c5]",
    tocActiveText: "text-green-700", tocActiveBg: "bg-green-500/20",
    epubCodeBg: "rgba(0,0,0,0.04)", epubBorderColor: "rgba(0,0,0,0.12)",
    isDark: false,
  },
  gray: {
    bg: "bg-[#E0E0E0]", text: "text-zinc-800", titleText: "text-zinc-800",
    contentText: "text-zinc-700", headerBg: "bg-[#d0d0d0]/80", headerText: "text-zinc-600",
    hoverBg: "hover:bg-[#c8c8c8]", navBtnBg: "bg-[#d0d0d0]", navBtnText: "text-zinc-600",
    navBtnHoverBg: "hover:bg-[#c8c8c8]", statusBarBg: "bg-[#E0E0E0]/60",
    statusBarText: "text-zinc-500", settingsBg: "bg-[#eaeaea]", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-[#d0d0d0]", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-[#c8c8c8]", activeRing: "ring-zinc-600/40",
    tocBg: "bg-[#eaeaea]", tocText: "text-zinc-600", tocHoverBg: "hover:bg-[#d4d4d4]",
    tocActiveText: "text-zinc-800", tocActiveBg: "bg-zinc-500/20",
    epubCodeBg: "rgba(0,0,0,0.04)", epubBorderColor: "rgba(0,0,0,0.12)",
    isDark: false,
  },
  white: {
    bg: "bg-white", text: "text-zinc-900", titleText: "text-zinc-900",
    contentText: "text-zinc-800", headerBg: "bg-zinc-100/80", headerText: "text-zinc-500",
    hoverBg: "hover:bg-zinc-200", navBtnBg: "bg-zinc-100", navBtnText: "text-zinc-700",
    navBtnHoverBg: "hover:bg-zinc-200", statusBarBg: "bg-white/60",
    statusBarText: "text-zinc-400", settingsBg: "bg-white", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-zinc-100", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-zinc-200", activeRing: "ring-accent/30",
    tocBg: "bg-white", tocText: "text-zinc-600", tocHoverBg: "hover:bg-zinc-100",
    tocActiveText: "text-accent", tocActiveBg: "bg-accent/10",
    epubCodeBg: "rgba(0,0,0,0.04)", epubBorderColor: "rgba(0,0,0,0.12)",
    isDark: false,
  },
};

// 主题色卡预览色（用于设置面板选择器）
const themePreviewColorKeys: Record<string, { bg: string; labelKey: string }> = {
  night: { bg: "#18181b", labelKey: "themeNight" },
  day: { bg: "#fffbeb", labelKey: "themeDay" },
  green: { bg: "#C7EDCC", labelKey: "themeGreen" },
  gray: { bg: "#E0E0E0", labelKey: "themeGray" },
  white: { bg: "#ffffff", labelKey: "themeWhite" },
};

// 页边距档位
const paddingOptions = [
  { value: "compact", labelKey: "marginCompact" as const, class: "px-2 sm:px-4 md:px-8" },
  { value: "standard", labelKey: "marginStandard" as const, class: "px-4 sm:px-8 md:px-16 lg:px-32" },
  { value: "wide", labelKey: "marginWide" as const, class: "px-8 sm:px-16 md:px-24 lg:px-40" },
];

// 翻页模式
type PageMode = "scroll" | "swipe";
const pageModeOptions = [
  { value: "scroll" as PageMode, labelKey: "pageModeScroll" as const },
  { value: "swipe" as PageMode, labelKey: "pageModeSwipe" as const },
];

// 书签类型
interface NovelBookmark {
  chapterIndex: number;
  chapterTitle: string;
  timestamp: number;
}

// 划线标注类型
interface TextHighlight {
  id: string;
  chapterIndex: number;
  text: string;
  note?: string;
  color: string;
  timestamp: number;
}

// 全书搜索结果类型
interface SearchResult {
  chapterIndex: number;
  chapterTitle: string;
  matchText: string; // 匹配的上下文片段
  matchCount: number;
}

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
  const t = useTranslation();
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
  // 前情提要状态
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapData, setRecapData] = useState<{ summary: string; keyCharacters?: string; lastCliffhanger?: string } | null>(null);
  const [showRecap, setShowRecap] = useState(false);

  // 当章节切换时隐藏前情提要
  useEffect(() => {
    setShowRecap(false);
    setRecapData(null);
  }, [currentPage]);

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
  // 页边距档位
  const [paddingLevel, setPaddingLevel] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("textReaderPadding") || "standard";
    }
    return "standard";
  });
  // 书签
  const [bookmarks, setBookmarks] = useState<NovelBookmark[]>(() => {
    if (typeof window !== "undefined" && comicId) {
      try {
        const stored = localStorage.getItem(`novel-bookmarks-${comicId}`);
        if (stored) return JSON.parse(stored);
      } catch { /* fallback below */ }
    }
    return [];
  });

  // 从 IndexedDB 恢复书签（localStorage 为空时的降级方案）
  useEffect(() => {
    if (!comicId || bookmarks.length > 0) return;
    idbLoad<NovelBookmark[]>(`novel-bookmarks-${comicId}`, []).then((data) => {
      if (data.length > 0) setBookmarks(data);
    });
  }, [comicId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 目录面板的当前Tab: 'toc' | 'bookmark'
  const [tocTab, setTocTab] = useState<'toc' | 'bookmark'>('toc');
  // 当前时间（用于底部状态条）
  const [currentTime, setCurrentTime] = useState('');
  // 翻页模式
  const [pageMode, setPageMode] = useState<PageMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("textReaderPageMode") as PageMode) || "scroll";
    }
    return "scroll";
  });
  // 划线标注
  const [highlights, setHighlights] = useState<TextHighlight[]>(() => {
    if (typeof window !== "undefined" && comicId) {
      try {
        const stored = localStorage.getItem(`novel-highlights-${comicId}`);
        if (stored) return JSON.parse(stored);
      } catch { /* fallback below */ }
    }
    return [];
  });

  // 从 IndexedDB 恢复划线（localStorage 为空时的降级方案）
  useEffect(() => {
    if (!comicId || highlights.length > 0) return;
    idbLoad<TextHighlight[]>(`novel-highlights-${comicId}`, []).then((data) => {
      if (data.length > 0) setHighlights(data);
    });
  }, [comicId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 选词弹出菜单
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number; y: number; text: string;
  } | null>(null);
  const [highlightNote, setHighlightNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  // 全书搜索
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 左右滑动翻页触摸状态
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // 用于区分「点击」和「滑动后抬起」，防止滚动后误触工具栏
  const scrollTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  // TTS 听书状态
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(() => {
    if (typeof window !== "undefined") {
      return parseFloat(localStorage.getItem("textReaderTtsRate") || "1.0");
    }
    return 1.0;
  });
  const [ttsSupported, setTtsSupported] = useState(false);
  const [showTtsPanel, setShowTtsPanel] = useState(false);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // 自动翻页状态
  const [autoScrollActive, setAutoScrollActive] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(() => {
    if (typeof window !== "undefined") {
      return parseInt(localStorage.getItem("textReaderAutoScrollSpeed") || "2", 10);
    }
    return 2;
  });
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // swipe 模式章内分页
  const [swipePage, setSwipePage] = useState(0);
  const [swipeTotalPages, setSwipeTotalPages] = useState(1);
  const swipeInnerRef = useRef<HTMLDivElement>(null);
  // 搜索取消/进度
  const searchAbortRef = useRef<AbortController | null>(null);
  const [searchProgress, setSearchProgress] = useState(0);

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
        setContent(t.reader.loadError);
        setIsHTML(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [currentPage, chapters]);

  // Scroll to top on chapter change + reset swipe page
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
    setSwipePage(0);
  }, [currentPage]);

  // swipe 模式下计算章内总页数
  useEffect(() => {
    if (pageMode !== 'swipe' || loading) {
      setSwipeTotalPages(1);
      return;
    }
    // 延迟计算，等渲染完成
    const timer = setTimeout(() => {
      const container = contentRef.current;
      const inner = swipeInnerRef.current;
      if (!container || !inner) { setSwipeTotalPages(1); return; }
      const viewH = container.clientHeight;
      const contentH = inner.scrollHeight;
      if (viewH <= 0) { setSwipeTotalPages(1); return; }
      setSwipeTotalPages(Math.max(1, Math.ceil(contentH / viewH)));
    }, 100);
    return () => clearTimeout(timer);
  }, [pageMode, loading, content, fontSize, lineHeight, fontFamily, currentPage]);

  // 字体/行高等变化时重置 swipePage
  useEffect(() => {
    setSwipePage(0);
  }, [fontSize, lineHeight, fontFamily, paddingLevel]);

  // swipePage 设置为 Infinity 时 clamp 到实际最后一页
  useEffect(() => {
    if (swipePage >= swipeTotalPages && swipeTotalPages > 0) {
      setSwipePage(swipeTotalPages - 1);
    }
  }, [swipePage, swipeTotalPages]);

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

  // 保存页边距设置
  useEffect(() => {
    localStorage.setItem("textReaderPadding", paddingLevel);
  }, [paddingLevel]);

  // 保存书签（localStorage + IndexedDB 双写）
  useEffect(() => {
    if (comicId) {
      localStorage.setItem(`novel-bookmarks-${comicId}`, JSON.stringify(bookmarks));
      idbSave(`novel-bookmarks-${comicId}`, bookmarks);
    }
  }, [bookmarks, comicId]);

  // 保存翻页模式
  useEffect(() => {
    localStorage.setItem("textReaderPageMode", pageMode);
  }, [pageMode]);

  // 保存划线标注（localStorage + IndexedDB 双写）
  useEffect(() => {
    if (comicId) {
      localStorage.setItem(`novel-highlights-${comicId}`, JSON.stringify(highlights));
      idbSave(`novel-highlights-${comicId}`, highlights);
    }
  }, [highlights, comicId]);

  // 选词事件监听（使用 pointerup 兼容鼠标和触摸）
  useEffect(() => {
    const handlePointerUp = () => {
      // 延迟检测选区，等待触摸选词完成
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
          setTimeout(() => setSelectionMenu(null), 200);
          return;
        }
        const text = selection.toString().trim();
        if (text.length < 2) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelectionMenu({
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
          text,
        });
      }, 10);
    };

    document.addEventListener('pointerup', handlePointerUp);
    return () => document.removeEventListener('pointerup', handlePointerUp);
  }, []);

  // 添加划线标注
  const addHighlight = useCallback((text: string, note?: string) => {
    const newHL: TextHighlight = {
      id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      chapterIndex: currentPage,
      text,
      note,
      color: '#fbbf24', // amber-400
      timestamp: Date.now(),
    };
    setHighlights(prev => [...prev, newHL]);
    setSelectionMenu(null);
    setHighlightNote('');
    setShowNoteInput(false);
    window.getSelection()?.removeAllRanges();
  }, [currentPage]);

  // 删除划线标注
  const removeHighlight = useCallback((id: string) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
  }, []);

  // 复制文本
  const copyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // 全书搜索（带防抖、进度、取消支持）
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim() || !comicId) return;

    // 取消上次搜索
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const abortController = new AbortController();
    searchAbortRef.current = abortController;

    setSearchLoading(true);
    setSearchResults([]);
    setSearchProgress(0);

    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // 逐章获取内容并搜索
    for (let i = 0; i < chapters.length; i++) {
      // 检查是否已取消
      if (abortController.signal.aborted) {
        return;
      }

      setSearchProgress(Math.round(((i + 1) / chapters.length) * 100));

      try {
        const res = await fetch(`/api/comics/${comicId}/chapter/${i}`, {
          signal: abortController.signal,
        });
        if (!res.ok) continue;
        const data = await res.json();
        const text = (data.content || '').replace(/<[^>]*>/g, ' ');
        const lowerText = text.toLowerCase();

        let matchCount = 0;
        let idx = lowerText.indexOf(lowerQuery);
        let firstMatchText = '';

        while (idx !== -1) {
          matchCount++;
          if (matchCount === 1) {
            const start = Math.max(0, idx - 30);
            const end = Math.min(text.length, idx + query.length + 30);
            firstMatchText = (start > 0 ? '...' : '') +
              text.slice(start, end).replace(/\s+/g, ' ') +
              (end < text.length ? '...' : '');
          }
          idx = lowerText.indexOf(lowerQuery, idx + 1);
        }

        if (matchCount > 0) {
          results.push({
            chapterIndex: i,
            chapterTitle: data.title || chapters[i]?.title || chapters[i]?.name || t.reader.chapterN.replace('{n}', String(i + 1)),
            matchText: firstMatchText,
            matchCount,
          });
          // 实时更新结果，让用户边搜边看
          setSearchResults([...results]);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return; // 被取消，静默退出
        }
        // skip failed chapters
      }
    }

    if (!abortController.signal.aborted) {
      setSearchResults(results);
      setSearchLoading(false);
      setSearchProgress(0);
    }
  }, [comicId, chapters]);

  // 更新时间
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 30000);
    return () => clearInterval(timer);
  }, []);

  // 添加书签
  const addBookmark = useCallback(() => {
    const exists = bookmarks.some(b => b.chapterIndex === currentPage);
    if (exists) return;
    setBookmarks(prev => [...prev, {
      chapterIndex: currentPage,
      chapterTitle: chapterTitle || `第 ${currentPage + 1} 章`,
      timestamp: Date.now(),
    }]);
  }, [bookmarks, currentPage, chapterTitle]);

  // 删除书签
  const removeBookmark = useCallback((chapterIndex: number) => {
    setBookmarks(prev => prev.filter(b => b.chapterIndex !== chapterIndex));
  }, []);

  // 判断当前章节是否有书签
  const isCurrentBookmarked = bookmarks.some(b => b.chapterIndex === currentPage);

  // 监听来自父组件的书签显示事件
  useEffect(() => {
    const handleShowBookmarks = () => {
      setTocTab('bookmark');
    };
    window.addEventListener('novel-show-bookmarks', handleShowBookmarks);
    return () => window.removeEventListener('novel-show-bookmarks', handleShowBookmarks);
  }, []);

  // 监听来自父组件的搜索显示事件
  useEffect(() => {
    const handleShowSearch = () => {
      setShowSearch(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    };
    window.addEventListener('novel-show-search', handleShowSearch);
    return () => window.removeEventListener('novel-show-search', handleShowSearch);
  }, []);

  // ========== TTS 听书 ==========
  // 检测 TTS 是否可用
  useEffect(() => {
    setTtsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  // 保存 TTS 语速设置
  useEffect(() => {
    localStorage.setItem("textReaderTtsRate", String(ttsRate));
  }, [ttsRate]);

  // TTS 状态变化时通知父组件
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('novel-tts-state-change', { detail: ttsPlaying }));
  }, [ttsPlaying]);

  // 自动翻页状态变化时通知父组件
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('novel-auto-scroll-state-change', { detail: autoScrollActive }));
  }, [autoScrollActive]);

  // 章节切换时停止 TTS
  useEffect(() => {
    if (ttsPlaying) {
      window.speechSynthesis?.cancel();
      setTtsPlaying(false);
      setTtsPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // 组件卸载时停止 TTS
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  // 获取当前章节的纯文本（用于TTS）
  const getChapterText = useCallback(() => {
    if (isHTML) {
      // 从 HTML 中提取纯文本
      const div = document.createElement('div');
      div.innerHTML = content;
      return div.textContent || div.innerText || '';
    }
    return content;
  }, [content, isHTML]);

  // 开始 TTS 朗读
  const startTTS = useCallback(() => {
    if (!ttsSupported) return;

    window.speechSynthesis.cancel();

    const text = getChapterText();
    if (!text.trim()) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = ttsRate;
    utterance.pitch = 1.0;

    // 尝试选择中文语音
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh')) || voices.find(v => v.lang.includes('CN'));
    if (zhVoice) utterance.voice = zhVoice;

    utterance.onend = () => {
      setTtsPlaying(false);
      setTtsPaused(false);
      // 自动播放下一章
      if (currentPage < chapters.length - 1) {
        onPageChange(currentPage + 1);
        // 延迟后自动开始朗读下一章（等内容加载）
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('novel-tts-auto-next'));
        }, 1500);
      }
    };

    utterance.onerror = () => {
      setTtsPlaying(false);
      setTtsPaused(false);
    };

    ttsUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setTtsPlaying(true);
    setTtsPaused(false);
  }, [ttsSupported, getChapterText, ttsRate, currentPage, chapters.length, onPageChange]);

  // 暂停/继续 TTS
  const toggleTTSPause = useCallback(() => {
    if (!ttsPlaying) return;
    if (ttsPaused) {
      window.speechSynthesis.resume();
      setTtsPaused(false);
    } else {
      window.speechSynthesis.pause();
      setTtsPaused(true);
    }
  }, [ttsPlaying, ttsPaused]);

  // 停止 TTS
  const stopTTS = useCallback(() => {
    window.speechSynthesis?.cancel();
    setTtsPlaying(false);
    setTtsPaused(false);
  }, []);

  // 监听自动播放下一章事件
  useEffect(() => {
    const handleAutoNext = () => {
      if (ttsPlaying || ttsPaused) return; // 已在播放
      startTTS();
    };
    window.addEventListener('novel-tts-auto-next', handleAutoNext);
    return () => window.removeEventListener('novel-tts-auto-next', handleAutoNext);
  }, [startTTS, ttsPlaying, ttsPaused]);

  // ========== 自动翻页 ==========
  // 保存自动翻页速度
  useEffect(() => {
    localStorage.setItem("textReaderAutoScrollSpeed", String(autoScrollSpeed));
  }, [autoScrollSpeed]);

  // 自动翻页逻辑
  useEffect(() => {
    if (!autoScrollActive || !contentRef.current) {
      if (autoScrollTimerRef.current) {
        clearInterval(autoScrollTimerRef.current);
        autoScrollTimerRef.current = null;
      }
      return;
    }

    // 速度映射：1=慢(1px/50ms), 2=中(2px/50ms), 3=快(4px/50ms)
    const speedPx = autoScrollSpeed === 1 ? 1 : autoScrollSpeed === 2 ? 2 : 4;

    autoScrollTimerRef.current = setInterval(() => {
      const el = contentRef.current;
      if (!el) return;

      const maxScroll = el.scrollHeight - el.clientHeight;
      if (el.scrollTop >= maxScroll - 2) {
        // 到底了，自动翻到下一章
        if (currentPage < chapters.length - 1) {
          onPageChange(currentPage + 1);
        } else {
          // 最后一章，停止自动翻页
          setAutoScrollActive(false);
        }
      } else {
        el.scrollTop += speedPx;
      }
    }, 50);

    return () => {
      if (autoScrollTimerRef.current) {
        clearInterval(autoScrollTimerRef.current);
        autoScrollTimerRef.current = null;
      }
    };
  }, [autoScrollActive, autoScrollSpeed, currentPage, chapters.length, onPageChange]);

  // 章节切换时如果自动翻页开启，需要滚动到顶部（已在 Scroll to top effect 中处理）

  // 切换自动翻页
  const toggleAutoScroll = useCallback(() => {
    setAutoScrollActive(prev => !prev);
  }, []);

  // 监听来自父组件的TTS播放事件
  useEffect(() => {
    const handleTtsToggle = () => {
      if (ttsPlaying) {
        stopTTS();
      } else {
        startTTS();
        setShowTtsPanel(true);
      }
    };
    window.addEventListener('novel-tts-toggle', handleTtsToggle);
    return () => window.removeEventListener('novel-tts-toggle', handleTtsToggle);
  }, [ttsPlaying, stopTTS, startTTS]);

  // 监听来自父组件的自动翻页事件
  useEffect(() => {
    const handleAutoScrollToggle = () => {
      toggleAutoScroll();
    };
    window.addEventListener('novel-auto-scroll-toggle', handleAutoScrollToggle);
    return () => window.removeEventListener('novel-auto-scroll-toggle', handleAutoScrollToggle);
  }, [toggleAutoScroll]);

  // 字体族映射
  const fontFamilyMap: Record<string, string> = {
    system: "system-ui, -apple-system, sans-serif",
    serif: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif",
    sans: "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    kai: "'KaiTi', 'STKaiti', 'AR PL KaitiM GB', serif",
    mono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  };

  const fontFamilyLabels: Record<string, string> = {
    system: t.reader.fontSystem,
    serif: t.reader.fontSerif,
    sans: t.reader.fontSans,
    kai: t.reader.fontKai,
    mono: t.reader.fontMono,
  };

  // Keyboard shortcuts for chapter navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (showTOC || showSettings || showSearch) return;

      if (e.key === "ArrowLeft" || e.key === "a") {
        e.preventDefault();
        if (pageMode === 'swipe') {
          if (swipePage > 0) {
            setSwipePage(p => p - 1);
          } else if (currentPage > 0) {
            onPageChange(currentPage - 1);
            setTimeout(() => setSwipePage(Infinity), 200);
          }
        } else {
          if (currentPage > 0) onPageChange(currentPage - 1);
        }
      } else if (e.key === "ArrowRight" || e.key === "d") {
        e.preventDefault();
        if (pageMode === 'swipe') {
          if (swipePage < swipeTotalPages - 1) {
            setSwipePage(p => p + 1);
          } else if (currentPage < chapters.length - 1) {
            onPageChange(currentPage + 1);
          }
        } else {
          if (currentPage < chapters.length - 1) onPageChange(currentPage + 1);
        }
      } else if (e.key === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowSearch(true);
      } else if (e.key === "b" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (isCurrentBookmarked) {
          removeBookmark(currentPage);
        } else {
          addBookmark();
        }
      } else if (e.key === "t" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (ttsPlaying) {
          stopTTS();
        } else {
          startTTS();
          setShowTtsPanel(true);
        }
      } else if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleAutoScroll();
      }
    },
    [currentPage, chapters.length, onPageChange, showTOC, showSettings, showSearch, isCurrentBookmarked, removeBookmark, addBookmark, ttsPlaying, stopTTS, startTTS, toggleAutoScroll, pageMode, swipePage, swipeTotalPages]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const theme = themeColorMap[readerTheme] || themeColorMap.night;
  const isDark = theme.isDark;
  const currentPadding = paddingOptions.find(p => p.value === paddingLevel) || paddingOptions[1];

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
      background: ${theme.epubCodeBg};
      text-indent: 0;
    }
    .epub-content table {
      border-collapse: collapse; width: 100%; margin: 1em 0;
    }
    .epub-content td, .epub-content th {
      border: 1px solid ${theme.epubBorderColor};
      padding: 0.5em;
    }
    .epub-content sup { font-size: 0.75em; vertical-align: super; }
    .epub-content sub { font-size: 0.75em; vertical-align: sub; }
    .epub-content figure { margin: 1em 0; text-align: center; }
    .epub-content figcaption { font-size: 0.85em; opacity: 0.7; margin-top: 0.5em; }
  `;

  return (
    <div
      className={`relative flex h-screen w-full flex-col transition-colors duration-300 ${theme.bg} ${theme.text}`}
    >
      {/* Chapter title bar */}
      <div
        className={`flex shrink-0 items-center justify-between px-4 py-2 ${theme.headerBg} backdrop-blur-sm`}
      >
        <button
          onClick={() => setShowTOC(true)}
          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${theme.headerText} ${theme.hoverBg}`}
        >
          <List className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t.reader.tocLabel}</span>
        </button>

        <span
          className={`mx-4 truncate text-xs font-medium ${theme.headerText}`}
        >
          {chapterTitle || t.reader.chapterN.replace('{n}', String(currentPage + 1))}
        </span>

        {/* 移动端仅显示核心按钮，避免小屏溢出 */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          {/* 搜索按钮 */}
          <button
            onClick={() => {
              setShowSearch(true);
              setTimeout(() => searchInputRef.current?.focus(), 100);
            }}
            className={`flex items-center rounded-lg p-1.5 sm:px-2 sm:py-1 text-xs transition-colors ${theme.headerText} ${theme.hoverBg}`}
            title={t.reader.search + " (S)"}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          {/* 书签按钮 */}
          <button
            onClick={() => isCurrentBookmarked ? removeBookmark(currentPage) : addBookmark()}
            className={`flex items-center rounded-lg p-1.5 sm:px-2 sm:py-1 text-xs transition-colors ${
              isCurrentBookmarked
                ? "text-amber-500"
                : `${theme.headerText} ${theme.hoverBg}`
            }`}
            title={isCurrentBookmarked ? t.reader.removeBookmark : t.reader.bookmarkLabel}
          >
            <Bookmark className={`h-3.5 w-3.5 ${isCurrentBookmarked ? "fill-amber-500" : ""}`} />
          </button>
          {/* 排版设置按钮 */}
          <button
            onClick={() => setShowSettings((v) => !v)}
            className={`flex items-center rounded-lg p-1.5 sm:px-2 sm:py-1 text-xs transition-colors ${theme.headerText} ${theme.hoverBg}`}
            title={t.reader.settingsTitle}
          >
            <Type className="h-3.5 w-3.5" />
            <span className="hidden sm:inline ml-1">{t.reader.typesetting}</span>
          </button>
          {/* TTS 和自动翻页在桌面端显示 */}
          {ttsSupported && (
            <button
              onClick={() => {
                if (ttsPlaying) {
                  setShowTtsPanel(v => !v);
                } else {
                  startTTS();
                  setShowTtsPanel(true);
                }
              }}
              className={`hidden sm:flex items-center rounded-lg p-1.5 sm:px-2 sm:py-1 text-xs transition-colors ${
                ttsPlaying
                  ? "text-accent bg-accent/10"
                  : `${theme.headerText} ${theme.hoverBg}`
              }`}
              title="听书 (T)"
            >
              <Volume2 className={`h-3.5 w-3.5 ${ttsPlaying ? "animate-pulse" : ""}`} />
            </button>
          )}
          <button
            onClick={toggleAutoScroll}
            className={`hidden sm:flex items-center rounded-lg p-1.5 sm:px-2 sm:py-1 text-xs transition-colors ${
              autoScrollActive
                ? "text-green-500 bg-green-500/10"
                : `${theme.headerText} ${theme.hoverBg}`
            }`}
            title="自动翻页 (G)"
          >
            <Timer className={`h-3.5 w-3.5 ${autoScrollActive ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div
        ref={contentRef}
        className={`flex-1 pb-8 pt-6 ${currentPadding.class} ${
          pageMode === "swipe" ? "overflow-hidden" : "overflow-y-auto"
        }`}
        onClick={(e) => {
          // 如果有选中文本，不处理点击
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;

          // 检查是否是滑动后的抬起（防止滚动误触工具栏）
          if (scrollTouchStartRef.current) {
            // 已经在 onTouchEnd 中处理了，不再重复触发
            return;
          }

          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const width = rect.width;
          const height = rect.height;

          if (pageMode === "swipe") {
            // 左右翻页模式：左1/3上一页，右1/3下一页，中间1/3呼出菜单
            if (x / width < 0.33) {
              // 上一页
              if (swipePage > 0) {
                setSwipePage(p => p - 1);
              } else if (currentPage > 0) {
                onPageChange(currentPage - 1);
                // 跳到上一章最后一页 — 在 useEffect 中通过 swipeTotalPages 处理
                setTimeout(() => setSwipePage(Infinity), 200);
              }
            } else if (x / width > 0.67) {
              // 下一页
              if (swipePage < swipeTotalPages - 1) {
                setSwipePage(p => p + 1);
              } else if (currentPage < chapters.length - 1) {
                onPageChange(currentPage + 1);
              }
            } else {
              onTapCenter();
            }
          } else {
            // 上下滚动模式：中间区域呼出菜单
            if (y / height > 0.3 && y / height < 0.7) {
              onTapCenter();
            }
          }
        }}
        onTouchStart={(e) => {
          // 始终记录触摸起点，用于区分点击和滑动
          scrollTouchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          if (pageMode === "swipe") {
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }
        }}
        onTouchEnd={(e) => {
          const start = scrollTouchStartRef.current;
          if (start) {
            const dx = e.changedTouches[0].clientX - start.x;
            const dy = e.changedTouches[0].clientY - start.y;
            const moved = Math.abs(dx) > 10 || Math.abs(dy) > 10;

            if (moved) {
              // 有明显滑动，阻止后续 onClick 触发
              // scrollTouchStartRef 保持非 null，onClick 会检查并 return
              // 延迟清除，确保 onClick 能读到
              setTimeout(() => { scrollTouchStartRef.current = null; }, 50);
            } else {
              // 纯点击，清空 ref，让 onClick 正常处理
              scrollTouchStartRef.current = null;
            }
          }

          // swipe 模式的滑动翻页（章内分页）
          if (pageMode === "swipe" && touchStartRef.current) {
            const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
            const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
            touchStartRef.current = null;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
              if (dx < 0) {
                // 左滑 — 下一页
                if (swipePage < swipeTotalPages - 1) {
                  setSwipePage(p => p + 1);
                } else if (currentPage < chapters.length - 1) {
                  onPageChange(currentPage + 1);
                }
              } else {
                // 右滑 — 上一页
                if (swipePage > 0) {
                  setSwipePage(p => p - 1);
                } else if (currentPage > 0) {
                  onPageChange(currentPage - 1);
                  setTimeout(() => setSwipePage(Infinity), 200);
                }
              }
            }
          }
        }}
      >
        <div
          ref={swipeInnerRef}
          className="mx-auto max-w-2xl"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: lineHeight,
            fontFamily: fontFamilyMap[fontFamily] || fontFamilyMap.system,
            ...(pageMode === 'swipe' ? {
              transform: `translateY(-${swipePage * (contentRef.current?.clientHeight || 0)}px)`,
              transition: 'transform 0.3s ease-out',
            } : {}),
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
                  className={`mb-8 text-center text-xl font-bold ${theme.titleText}`}
                >
                  {chapterTitle}
                </h2>
              )}

              {/* AI 前情提要 */}
              {comicId && aiConfigured && currentPage > 0 && (
                <div className="mb-6">
                  {!showRecap ? (
                    <button
                      onClick={async () => {
                        if (recapLoading) return;
                        setRecapLoading(true);
                        setShowRecap(true);
                        try {
                          const res = await fetch(`/api/comics/${comicId}/ai-chapter-recap`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ chapterIndex: currentPage, targetLang: locale }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setRecapData(data.recap || null);
                          }
                        } catch {
                          setRecapData(null);
                        } finally {
                          setRecapLoading(false);
                        }
                      }}
                      disabled={recapLoading}
                      className={`mx-auto flex items-center gap-2 rounded-xl px-4 py-2 text-xs transition-all ${
                        isDark
                          ? "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20"
                          : "bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200"
                      }`}
                    >
                      <BookOpenCheck className="h-3.5 w-3.5" />
                      {locale === "zh-CN" ? "📖 查看前情提要" : "📖 Previously On..."}
                    </button>
                  ) : (
                    <div className={`rounded-xl p-4 transition-all ${
                      isDark
                        ? "bg-purple-500/5 border border-purple-500/20"
                        : "bg-purple-50/80 border border-purple-200/60"
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${
                          isDark ? "text-purple-400" : "text-purple-600"
                        }`}>
                          <BookOpenCheck className="h-3.5 w-3.5" />
                          {locale === "zh-CN" ? "前情提要" : "Previously On..."}
                        </span>
                        <button
                          onClick={() => setShowRecap(false)}
                          className={`text-xs px-2 py-0.5 rounded ${
                            isDark ? "text-zinc-500 hover:text-zinc-300" : "text-zinc-400 hover:text-zinc-600"
                          }`}
                        >
                          ✕
                        </button>
                      </div>
                      {recapLoading ? (
                        <div className="flex items-center gap-2 py-4 justify-center">
                          <Loader2 className={`h-4 w-4 animate-spin ${isDark ? "text-purple-400/50" : "text-purple-400"}`} />
                          <span className={`text-xs ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                            {locale === "zh-CN" ? "生成前情提要中..." : "Generating recap..."}
                          </span>
                        </div>
                      ) : recapData ? (
                        <div className="space-y-2">
                          <p className={`text-sm leading-relaxed ${isDark ? "text-zinc-300/80" : "text-zinc-600"}`}>
                            {recapData.summary}
                          </p>
                          {recapData.keyCharacters && (
                            <p className={`text-xs ${isDark ? "text-purple-400/60" : "text-purple-500/70"}`}>
                              👤 {recapData.keyCharacters}
                            </p>
                          )}
                          {recapData.lastCliffhanger && (
                            <p className={`text-xs ${isDark ? "text-amber-400/60" : "text-amber-600/70"}`}>
                              ⚡ {recapData.lastCliffhanger}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className={`text-xs py-2 ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                          {locale === "zh-CN" ? "暂无前情提要" : "No recap available"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Text content */}
              <div
                className={`leading-relaxed ${theme.contentText}`}
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

              {/* 当前章节的划线标注 */}
              {highlights.filter(h => h.chapterIndex === currentPage).length > 0 && (
                <div className={`mt-8 border-t pt-4 ${isDark ? "border-zinc-700" : "border-current/10"}`}>
                  <h4 className={`mb-3 flex items-center gap-1.5 text-xs font-medium ${theme.statusBarText}`}>
                    <Highlighter className="h-3 w-3" />
                    本章划线 ({highlights.filter(h => h.chapterIndex === currentPage).length})
                  </h4>
                  <div className="space-y-2">
                    {highlights
                      .filter(h => h.chapterIndex === currentPage)
                      .map((hl) => (
                        <div
                          key={hl.id}
                          className={`group rounded-lg p-2.5 text-xs transition-colors ${
                            isDark ? "bg-amber-500/5 border border-amber-500/10" : "bg-amber-50 border border-amber-200/30"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                            <div className="flex-1 min-w-0">
                              <p className={`leading-relaxed ${isDark ? "text-amber-200/80" : "text-amber-900/70"}`}>
                                "{hl.text.length > 100 ? hl.text.slice(0, 100) + '...' : hl.text}"
                              </p>
                              {hl.note && (
                                <p className={`mt-1 text-[10px] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                                  💬 {hl.note}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => removeHighlight(hl.id)}
                              className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:bg-red-500/10"
                              title="删除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Chapter navigation at bottom */}
              <div className="mt-12 flex items-center justify-between border-t border-current/10 pt-6 pb-8">
                <button
                  onClick={() => currentPage > 0 && onPageChange(currentPage - 1)}
                  disabled={currentPage === 0}
                  className={`flex items-center gap-1 rounded-lg px-4 py-2 text-sm transition-colors ${
                    currentPage === 0
                      ? "opacity-30 cursor-not-allowed"
                      : `${theme.navBtnBg} ${theme.navBtnText} ${theme.navBtnHoverBg}`
                  }`}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t.reader.prevChapter}
                </button>

                <span
                  className={`text-xs ${theme.statusBarText}`}
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
                      : `${theme.navBtnBg} ${theme.navBtnText} ${theme.navBtnHoverBg}`
                  }`}
                >
                  {t.reader.nextChapter}
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 底部阅读状态条（沉浸式微弱显示） */}
      {!showTOC && !showSettings && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-1 text-[10px] backdrop-blur-sm ${theme.statusBarBg} ${theme.statusBarText}`}
        >
          <span>{chapterTitle || t.reader.chapterN.replace('{n}', String(currentPage + 1))}</span>
          <div className="flex items-center gap-3">
            {pageMode === 'swipe' && swipeTotalPages > 1 && (
              <span>{swipePage + 1}/{swipeTotalPages}</span>
            )}
            <span>{Math.round(((currentPage + 1) / chapters.length) * 100)}%</span>
            <span>{currentTime}</span>
          </div>
        </div>
      )}

      {/* Settings panel (排版设置) */}
      {showSettings && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowSettings(false)}
          />
          <div
            className={`fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl p-4 sm:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl ${theme.settingsBg}`}
          >
            <h3
              className={`mb-4 text-sm font-semibold ${theme.settingsText}`}
            >
              {t.reader.settingsTitle}
            </h3>

            {/* 主题色卡 */}
            <div className="mb-5">
              <label
                className={`mb-2 block text-xs ${theme.settingsLabel}`}
              >
                {t.reader.bgTheme}
              </label>
              <div className="flex items-center gap-3">
                {Object.entries(themePreviewColorKeys).map(([key, { bg, labelKey }]) => (
                  <button
                    key={key}
                    onClick={() => {
                      // 通知父组件切换主题 — 通过触发一个自定义事件
                      window.dispatchEvent(new CustomEvent('novel-theme-change', { detail: key }));
                    }}
                    className={`flex flex-col items-center gap-1 transition-all ${
                      readerTheme === key ? "scale-110" : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    <div
                      className={`h-8 w-8 rounded-full border-2 transition-all ${
                        readerTheme === key
                          ? "border-accent shadow-md shadow-accent/20"
                          : key === "night"
                          ? "border-zinc-600"
                          : "border-zinc-300"
                      }`}
                      style={{ backgroundColor: bg }}
                    />
                    <span className={`text-[10px] ${
                      readerTheme === key ? "font-semibold" : ""
                    } ${theme.settingsLabel}`}>
                      {t.reader[labelKey as keyof typeof t.reader] || labelKey}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Font size */}
            <div className="mb-4">
              <label
                className={`mb-2 block text-xs ${theme.settingsLabel}`}
              >
                {t.reader.fontSize}: {fontSize}px
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                  className={`rounded-lg p-2 ${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`}
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
                  className={`rounded-lg p-2 ${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Line height */}
            <div className="mb-4">
              <label
                className={`mb-2 block text-xs ${theme.settingsLabel}`}
              >
                {t.reader.lineSpacing}: {lineHeight.toFixed(1)}
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setLineHeight((h) => Math.max(1.2, h - 0.2))}
                  className={`rounded-lg p-2 ${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`}
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
                  className={`rounded-lg p-2 ${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 页边距 */}
            <div className="mb-4">
              <label
                className={`mb-2 block text-xs ${theme.settingsLabel}`}
              >
                {t.reader.margin}
              </label>
              <div className="flex flex-wrap gap-2">
                {paddingOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPaddingLevel(opt.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                      paddingLevel === opt.value
                        ? `bg-accent/20 text-accent ring-1 ${theme.activeRing}`
                        : `${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`
                    }`}
                  >
                    {t.reader[opt.labelKey]}
                  </button>
                ))}
              </div>
            </div>

            {/* 翻页方式 */}
            <div className="mb-4">
              <label
                className={`mb-2 block text-xs ${theme.settingsLabel}`}
              >
                {t.reader.pageMode}
              </label>
              <div className="flex flex-wrap gap-2">
                {pageModeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPageMode(opt.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                      pageMode === opt.value
                        ? `bg-accent/20 text-accent ring-1 ${theme.activeRing}`
                        : `${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`
                    }`}
                  >
                    {t.reader[opt.labelKey]}
                  </button>
                ))}
              </div>
            </div>

            {/* 自动翻页速度 */}
            <div className="mb-4">
              <label
                className={`mb-2 flex items-center gap-1.5 text-xs ${theme.settingsLabel}`}
              >
                <Timer className="h-3 w-3" />
                {t.reader.autoScrollSpeed}
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 1, label: t.reader.speedSlow },
                  { value: 2, label: t.reader.speedMedium },
                  { value: 3, label: t.reader.speedFast },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setAutoScrollSpeed(opt.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                      autoScrollSpeed === opt.value
                        ? `bg-accent/20 text-accent ring-1 ${theme.activeRing}`
                        : `${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className={`mt-1.5 text-[10px] ${theme.statusBarText}`}>
                {t.reader.autoScrollHint}
              </p>
            </div>

            {/* Font family */}
            <div>
              <label
                className={`mb-2 block text-xs ${theme.settingsLabel}`}
              >
                {t.reader.font}
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(fontFamilyLabels).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFontFamily(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                      fontFamily === key
                        ? `bg-accent/20 text-accent ring-1 ${theme.activeRing}`
                        : `${theme.settingsBtnBg} ${theme.settingsBtnText} ${theme.settingsBtnHoverBg}`
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

      {/* TOC / 书签 面板 */}
      {showTOC && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowTOC(false)}
          />
          <div
            className={`fixed top-0 left-0 z-50 h-full w-[85vw] max-w-80 sm:w-72 overflow-y-auto shadow-2xl ${theme.tocBg}`}
          >
            {/* Tab 切换头部 */}
            <div className="sticky top-0 z-10">
              <div className={`flex items-center justify-between p-4 pb-2 ${theme.tocBg}`}>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setTocTab('toc')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      tocTab === 'toc'
                        ? `${theme.tocActiveBg} ${theme.tocActiveText}`
                        : `${theme.tocText} ${theme.tocHoverBg}`
                    }`}
                  >
                    {t.reader.tocLabel} ({chapters.length})
                  </button>
                  <button
                    onClick={() => setTocTab('bookmark')}
                    className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      tocTab === 'bookmark'
                        ? `${theme.tocActiveBg} ${theme.tocActiveText}`
                        : `${theme.tocText} ${theme.tocHoverBg}`
                    }`}
                  >
                    <Bookmark className="h-3 w-3" />
                    {t.reader.bookmarkLabel} ({bookmarks.length})
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {tocTab === 'toc' && comicId && aiConfigured && (
                    <button
                      onClick={() => setShowSummaries((v) => !v)}
                      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-colors ${
                        showSummaries
                          ? "bg-purple-500/20 text-purple-400"
                          : `${theme.tocText}`
                      }`}
                      title={locale === "zh-CN" ? "AI 章节摘要" : "AI Chapter Summaries"}
                    >
                      <Brain className="h-3 w-3" />
                      AI
                    </button>
                  )}
                  {tocTab === 'bookmark' && (
                    <button
                      onClick={() => isCurrentBookmarked ? removeBookmark(currentPage) : addBookmark()}
                      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-colors ${
                        isCurrentBookmarked
                          ? "text-amber-500"
                          : `${theme.tocText}`
                      }`}
                      title={isCurrentBookmarked ? t.reader.removeBookmark : t.reader.addBookmarkHint}
                    >
                      <BookmarkPlus className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowTOC(false)}
                    className={`rounded-lg p-1 text-xs ${theme.tocText}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* 目录内容 */}
            {tocTab === 'toc' && (
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
                        ? `${theme.tocActiveBg} ${theme.tocActiveText}`
                        : `${theme.tocText} ${theme.tocHoverBg}`
                    }`}
                  >
                    <span className="mr-2 inline-block w-8 text-right text-xs opacity-50">
                      {i + 1}.
                    </span>
                    <span className="flex-1">
                      {ch.title || ch.name}
                      {/* 书签标记 */}
                      {bookmarks.some(b => b.chapterIndex === i) && (
                        <Bookmark className="inline-block h-3 w-3 ml-1 text-amber-500 fill-amber-500" />
                      )}
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
            )}

            {/* 书签内容 */}
            {tocTab === 'bookmark' && (
              <div className="px-2 pb-4">
                {bookmarks.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center py-12 ${theme.tocText}`}>
                    <Bookmark className="h-8 w-8 opacity-30 mb-2" />
                    <p className="text-xs opacity-50">{t.reader.noBookmarks}</p>
                    <p className="text-[10px] opacity-30 mt-1">{t.reader.addBookmarkHint}</p>
                  </div>
                ) : (
                  bookmarks
                    .sort((a, b) => a.chapterIndex - b.chapterIndex)
                    .map((bm) => (
                      <div
                        key={bm.chapterIndex}
                        className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          bm.chapterIndex === currentPage
                            ? `${theme.tocActiveBg} ${theme.tocActiveText}`
                            : `${theme.tocText} ${theme.tocHoverBg}`
                        }`}
                      >
                        <button
                          onClick={() => {
                            onPageChange(bm.chapterIndex);
                            setShowTOC(false);
                          }}
                          className="flex-1 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <Bookmark className="h-3 w-3 shrink-0 text-amber-500 fill-amber-500" />
                            <span className="truncate">{bm.chapterTitle}</span>
                          </div>
                          <span className="mt-0.5 block text-[10px] opacity-40">
                            {t.reader.chapterN.replace('{n}', String(bm.chapterIndex + 1))} · {new Date(bm.timestamp).toLocaleDateString()}
                          </span>
                        </button>
                        <button
                          onClick={() => removeBookmark(bm.chapterIndex)}
                          className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 text-red-400"
                          title={t.reader.removeBookmark}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* 选词弹出菜单 */}
      {selectionMenu && (
        <div
          className="fixed z-[60] flex items-center gap-0.5 rounded-xl shadow-2xl py-1 px-1.5 animate-in fade-in zoom-in-95"
          style={{
            left: Math.min(selectionMenu.x, window.innerWidth - 200),
            top: Math.max(selectionMenu.y - 44, 8),
            backgroundColor: isDark ? '#27272a' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          }}
        >
          <button
            onClick={() => copyText(selectionMenu.text)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
              isDark ? "text-zinc-300 hover:bg-zinc-700" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            <Copy className="h-3 w-3" />
            {t.reader.copy}
          </button>
          <button
            onClick={() => addHighlight(selectionMenu.text)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
              isDark ? "text-amber-400 hover:bg-amber-500/10" : "text-amber-600 hover:bg-amber-50"
            }`}
          >
            <Highlighter className="h-3 w-3" />
            {t.reader.highlight}
          </button>
          <button
            onClick={() => setShowNoteInput(true)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
              isDark ? "text-blue-400 hover:bg-blue-500/10" : "text-blue-600 hover:bg-blue-50"
            }`}
          >
            <MessageSquare className="h-3 w-3" />
            {t.reader.note}
          </button>
          <button
            onClick={() => {
              setSelectionMenu(null);
              window.getSelection()?.removeAllRanges();
            }}
            className={`rounded-lg p-1.5 transition-colors ${
              isDark ? "text-zinc-500 hover:bg-zinc-700" : "text-zinc-400 hover:bg-zinc-100"
            }`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 笔记输入弹窗 */}
      {showNoteInput && selectionMenu && (
        <>
          <div
            className="fixed inset-0 z-[65] bg-black/30"
            onClick={() => { setShowNoteInput(false); setHighlightNote(''); }}
          />
          <div
            className={`fixed left-1/2 top-1/2 z-[70] w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-4 shadow-2xl ${theme.settingsBg}`}
          >
            <h4 className={`mb-2 text-sm font-medium ${theme.settingsText}`}>{t.reader.addNote}</h4>
            <p className={`mb-3 rounded-lg p-2 text-xs ${isDark ? "bg-zinc-700/50 text-zinc-300" : "bg-zinc-100 text-zinc-600"}`}>
              "{selectionMenu.text.length > 60 ? selectionMenu.text.slice(0, 60) + '...' : selectionMenu.text}"
            </p>
            <textarea
              value={highlightNote}
              onChange={(e) => setHighlightNote(e.target.value)}
              placeholder={t.reader.writeThoughts}
              className={`w-full rounded-lg p-2.5 text-xs outline-none resize-none h-20 ${
                isDark ? "bg-zinc-700 text-zinc-200 placeholder-zinc-500" : "bg-zinc-100 text-zinc-700 placeholder-zinc-400"
              }`}
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { setShowNoteInput(false); setHighlightNote(''); }}
                className={`rounded-lg px-3 py-1.5 text-xs ${theme.settingsBtnBg} ${theme.settingsBtnText}`}
              >
                {t.reader.cancel}
              </button>
              <button
                onClick={() => addHighlight(selectionMenu.text, highlightNote || undefined)}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white"
              >
                {t.reader.save}
              </button>
            </div>
          </div>
        </>
      )}

      {/* TTS 听书控制面板 */}
      {showTtsPanel && ttsPlaying && (
        <div
          className={`fixed bottom-16 left-1/2 z-[55] -translate-x-1/2 flex items-center gap-2 rounded-2xl px-4 py-2.5 shadow-2xl backdrop-blur-xl ${
            isDark ? "bg-zinc-800/95 border border-zinc-700" : "bg-white/95 border border-zinc-200"
          }`}
        >
          {/* 播放/暂停 */}
          <button
            onClick={toggleTTSPause}
            className={`rounded-full p-2 transition-colors ${
              isDark ? "hover:bg-zinc-700 text-zinc-200" : "hover:bg-zinc-100 text-zinc-700"
            }`}
            title={ttsPaused ? t.reader.ttsPause : t.reader.ttsResume}
          >
            {ttsPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>

          {/* 停止 */}
          <button
            onClick={() => { stopTTS(); setShowTtsPanel(false); }}
            className={`rounded-full p-2 transition-colors ${
              isDark ? "hover:bg-zinc-700 text-red-400" : "hover:bg-zinc-100 text-red-500"
            }`}
            title={t.reader.ttsStop}
          >
            <Square className="h-3.5 w-3.5" />
          </button>

          {/* 分隔线 */}
          <div className={`h-6 w-px mx-0.5 shrink-0 ${isDark ? "bg-zinc-700" : "bg-zinc-200"}`} />

          {/* 语速调节 - 移动端自适应 */}
          <div className="flex items-center gap-1 overflow-x-auto">
            <span className={`text-[10px] shrink-0 ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>{t.reader.ttsSpeed}</span>
            {[0.5, 0.8, 1.0, 1.5, 2.0].map((rate) => (
              <button
                key={rate}
                onClick={() => {
                  setTtsRate(rate);
                  // 如果正在播放，需要重新开始以应用新语速
                  if (ttsPlaying && !ttsPaused) {
                    window.speechSynthesis.cancel();
                    setTimeout(() => startTTS(), 100);
                  }
                }}
                className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[10px] transition-colors ${
                  ttsRate === rate
                    ? "bg-accent/20 text-accent font-bold"
                    : isDark ? "text-zinc-400 hover:bg-zinc-700" : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          {/* 关闭面板按钮 */}
          <button
            onClick={() => setShowTtsPanel(false)}
            className={`ml-1 shrink-0 rounded-full p-1 transition-colors ${
              isDark ? "text-zinc-500 hover:text-zinc-300" : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* TTS 播放中但面板隐藏时的迷你指示器 */}
      {ttsPlaying && !showTtsPanel && (
        <button
          onClick={() => setShowTtsPanel(true)}
          className="fixed bottom-16 right-4 z-[55] flex items-center gap-1.5 rounded-full bg-accent/90 px-3 py-1.5 text-[11px] text-white shadow-lg backdrop-blur-sm transition-all hover:bg-accent"
        >
          <Volume2 className="h-3 w-3 animate-pulse" />
          {ttsPaused ? t.reader.ttsPaused : t.reader.ttsReading}
        </button>
      )}

      {/* 自动翻页状态指示条 */}
      {autoScrollActive && (
        <div
          className={`fixed top-12 left-1/2 z-[55] -translate-x-1/2 flex items-center gap-2 rounded-full px-3 py-1 shadow-lg backdrop-blur-sm ${
            isDark ? "bg-green-500/10 border border-green-500/20" : "bg-green-50 border border-green-200"
          }`}
        >
          <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className={`text-[10px] ${isDark ? "text-green-400" : "text-green-600"}`}>
            {t.reader.autoScrolling} · {autoScrollSpeed === 1 ? t.reader.speedSlow : autoScrollSpeed === 2 ? t.reader.speedMedium : t.reader.speedFast}
          </span>
          <button
            onClick={() => setAutoScrollActive(false)}
            className={`rounded-full p-0.5 transition-colors ${
              isDark ? "text-green-500 hover:bg-green-500/20" : "text-green-600 hover:bg-green-100"
            }`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 全书搜索面板 */}
      {showSearch && (
        <>
          <div
            className="fixed inset-0 z-[55] bg-black/50"
            onClick={() => setShowSearch(false)}
          />
          <div
            className={`fixed top-0 right-0 z-[60] h-full w-full sm:w-96 flex flex-col shadow-2xl ${theme.tocBg}`}
          >
            {/* 搜索头部 */}
            <div className={`shrink-0 p-4 border-b ${isDark ? "border-zinc-700" : "border-zinc-200"}`}>
              <div className="flex items-center gap-2">
                <div className={`flex flex-1 items-center gap-2 rounded-xl px-3 py-2 ${
                  isDark ? "bg-zinc-800" : "bg-zinc-100"
                }`}>
                  <Search className={`h-4 w-4 shrink-0 ${theme.statusBarText}`} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearch(searchQuery);
                      if (e.key === 'Escape') setShowSearch(false);
                    }}
                    placeholder={t.reader.searchPlaceholder}
                    className={`flex-1 bg-transparent text-sm outline-none ${theme.settingsText} placeholder:${theme.statusBarText}`}
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                      className={`shrink-0 ${theme.statusBarText}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (searchLoading) {
                      // 取消搜索
                      if (searchAbortRef.current) {
                        searchAbortRef.current.abort();
                        searchAbortRef.current = null;
                      }
                      setSearchLoading(false);
                      setSearchProgress(0);
                    } else {
                      handleSearch(searchQuery);
                    }
                  }}
                  disabled={!searchQuery.trim() && !searchLoading}
                  className={`shrink-0 rounded-xl px-3 py-2 text-xs text-white disabled:opacity-40 ${
                    searchLoading ? "bg-red-500 hover:bg-red-600" : "bg-accent"
                  }`}
                >
                  {searchLoading ? t.reader.searchCancel : t.reader.search}
                </button>
                <button
                  onClick={() => setShowSearch(false)}
                  className={`shrink-0 rounded-lg p-1.5 ${theme.tocText}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 搜索结果 */}
            <div className="flex-1 overflow-y-auto p-2">
              {searchLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className={`h-6 w-6 animate-spin ${isDark ? "text-accent" : "text-accent"}`} />
                  <p className={`text-xs ${theme.statusBarText}`}>{t.reader.searchingAll} {searchProgress}%</p>
                  <div className="w-48 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${searchProgress}%` }}
                    />
                  </div>
                  <p className={`text-[10px] ${theme.statusBarText}`}>{t.reader.searchChapterCount.replace('{n}', String(chapters.length))}</p>
                </div>
              )}

              {!searchLoading && searchResults.length === 0 && searchQuery && (
                <div className={`flex flex-col items-center justify-center py-12 ${theme.tocText}`}>
                  <Search className="h-8 w-8 opacity-30 mb-2" />
                  <p className="text-xs opacity-50">{t.reader.noSearchResults}</p>
                </div>
              )}

              {!searchLoading && searchResults.length > 0 && (
                <>
                  <div className={`px-2 py-1.5 text-[10px] ${theme.statusBarText}`}>
                    {t.reader.searchFoundMatches.replace('{count}', String(searchResults.reduce((sum, r) => sum + r.matchCount, 0))).replace('{chapters}', String(searchResults.length))}
                  </div>
                  {searchResults.map((result) => (
                    <button
                      key={result.chapterIndex}
                      onClick={() => {
                        onPageChange(result.chapterIndex);
                        setShowSearch(false);
                      }}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                        result.chapterIndex === currentPage
                          ? `${theme.tocActiveBg} ${theme.tocActiveText}`
                          : `${theme.tocText} ${theme.tocHoverBg}`
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium truncate">
                          {result.chapterTitle}
                        </span>
                        <span className={`shrink-0 ml-2 text-[10px] rounded-full px-1.5 py-0.5 ${
                          isDark ? "bg-accent/20 text-accent" : "bg-accent/10 text-accent"
                        }>`}>
                          {t.reader.searchMatches.replace('{n}', String(result.matchCount))}
                        </span>                      </div>
                      <p className={`text-[11px] leading-relaxed opacity-60 line-clamp-2`}>
                        {result.matchText}
                      </p>
                    </button>
                  ))}
                </>
              )}

              {!searchLoading && !searchQuery && (
                <div className={`flex flex-col items-center justify-center py-12 ${theme.tocText}`}>
                  <Search className="h-8 w-8 opacity-20 mb-2" />
                  <p className="text-xs opacity-40">{t.reader.searchHint}</p>
                  <p className="text-[10px] opacity-30 mt-1">{t.reader.searchShortcut}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
