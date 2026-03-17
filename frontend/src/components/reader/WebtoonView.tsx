"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import { useImagePreloader } from "@/hooks/useImagePreloader";

interface WebtoonViewProps {
  pages: string[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTapCenter: () => void;
  useRealData?: boolean;
  readerTheme?: ReaderTheme;
}

/** Estimated page height for skeleton placeholders */
const ESTIMATED_PAGE_HEIGHT = 1200;
/** Number of pages to render outside viewport (buffer) */
const RENDER_BUFFER = 5;

export default function WebtoonView({
  pages,
  currentPage,
  onPageChange,
  onTapCenter,
  useRealData,
  readerTheme = "night",
}: WebtoonViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const t = useTranslation();

  // Track which pages are "in range" to render
  const [renderRange, setRenderRange] = useState({ start: 0, end: Math.min(RENDER_BUFFER * 2, pages.length - 1) });

  // Track loaded image heights for accurate positioning
  const [pageHeights, setPageHeights] = useState<Map<number, number>>(new Map());

  // Track which pages failed to load
  const [errorPages, setErrorPages] = useState<Set<number>>(new Set());

  // Preload images ahead of current page
  useImagePreloader(pages, currentPage, 5);

  // Update render range based on scroll position
  const updateRenderRange = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const viewCenter = scrollTop + viewportHeight / 3;

    // Determine which page is at center
    let accumulatedHeight = 0;
    let centerPage = 0;

    for (let i = 0; i < pages.length; i++) {
      const h = pageHeights.get(i) ?? ESTIMATED_PAGE_HEIGHT;
      if (accumulatedHeight + h > viewCenter) {
        centerPage = i;
        break;
      }
      accumulatedHeight += h;
      if (i === pages.length - 1) centerPage = i;
    }

    const newStart = Math.max(0, centerPage - RENDER_BUFFER);
    const newEnd = Math.min(pages.length - 1, centerPage + RENDER_BUFFER);

    setRenderRange((prev) => {
      if (prev.start !== newStart || prev.end !== newEnd) {
        return { start: newStart, end: newEnd };
      }
      return prev;
    });

    return centerPage;
  }, [pages.length, pageHeights]);

  // Scroll to current page when externally changed
  useEffect(() => {
    if (isScrollingRef.current) return;
    const el = pageRefs.current[currentPage];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [currentPage]);

  const handleScroll = useCallback(() => {
    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 150);

    const centerPage = updateRenderRange();

    if (centerPage !== undefined && centerPage !== currentPage) {
      onPageChange(centerPage);
    }
  }, [currentPage, onPageChange, updateRenderRange]);

  // Record actual image height after load
  const handleImageLoad = useCallback((index: number, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalHeight > 0) {
      setPageHeights((prev) => {
        const next = new Map(prev);
        next.set(index, img.clientHeight);
        return next;
      });
    }
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const ratio = x / width;

    if (ratio > 0.25 && ratio < 0.75) {
      onTapCenter();
    }
  };

  // Initialize render range
  useEffect(() => {
    updateRenderRange();
  }, [updateRenderRange]);

  return (
    <div
      ref={containerRef}
      className={`h-screen w-full overflow-y-auto select-none transition-colors duration-300 ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onScroll={handleScroll}
      onClick={handleClick}
    >
      <div className="mx-auto max-w-3xl">
        {pages.map((pageUrl, index) => {
          const isInRange = index >= renderRange.start && index <= renderRange.end;
          const estimatedHeight = pageHeights.get(index) ?? ESTIMATED_PAGE_HEIGHT;

          return (
            <div
              key={index}
              ref={(el) => {
                pageRefs.current[index] = el;
              }}
              className="relative w-full"
              style={!isInRange ? { height: estimatedHeight } : undefined}
            >
              {isInRange ? (
                useRealData ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  errorPages.has(index) ? (
                    <div
                      className={`w-full flex items-center justify-center py-16 ${readerTheme === "day" ? "bg-gray-200" : "bg-white/5"}`}
                    >
                      <div className="flex flex-col items-center gap-2 text-center">
                        <span className="text-2xl">⚠️</span>
                        <p className={`text-xs ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>第 {index + 1} 页加载失败</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); setErrorPages(prev => { const next = new Set(prev); next.delete(index); return next; }); }}
                          className="text-xs text-accent hover:text-accent/80"
                        >重试</button>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={pageUrl}
                      alt={`Page ${index + 1}`}
                      className="w-full h-auto"
                      loading={Math.abs(index - currentPage) < 3 ? "eager" : "lazy"}
                      onLoad={(e) => handleImageLoad(index, e)}
                      onError={() => setErrorPages(prev => new Set(prev).add(index))}
                    />
                  )
                ) : (
                  <div className="relative aspect-2/3 w-full">
                    {/* Next/Image for mock data */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pageUrl}
                      alt={`Page ${index + 1}`}
                      className="w-full h-auto object-contain"
                      loading={Math.abs(index - currentPage) < 3 ? "eager" : "lazy"}
                    />
                  </div>
                )
              ) : (
                /* Skeleton placeholder */
                <div
                  className={`w-full animate-pulse ${
                    readerTheme === "day" ? "bg-gray-200" : "bg-white/5"
                  }`}
                  style={{ height: estimatedHeight }}
                />
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <p className={`text-sm ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>{t.reader.reachedLastPage}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
