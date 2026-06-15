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
  containerWidth?: string;
  preloadCount?: number;
  /** 漫画 ID，用于触发后端预热 */
  comicId?: string;
  /** 滚动超出边界时触发 */
  onBoundaryReached?: (direction: "next" | "prev") => void;
  /** 下一卷信息（用于底部提示） */
  nextVolumeTitle?: string;
  imageFilter?: string;
}

/** Estimated page height for skeleton placeholders */
const ESTIMATED_PAGE_HEIGHT = 1200;
/** Number of pages to render outside viewport (buffer) */
const RENDER_BUFFER = 5;
/** 超出此范围的页面不创建 DOM 节点（用累加高度占位） */
const DOM_BUFFER = 15;
/** 滚动事件报告页码变化的节流间隔 (ms) */
const SCROLL_REPORT_THROTTLE = 100;

export default function WebtoonView({
  pages,
  currentPage,
  onPageChange,
  onTapCenter,
  useRealData,
  readerTheme = "night",
  containerWidth,
  preloadCount = 5,
  comicId,
  onBoundaryReached,
  nextVolumeTitle,
  imageFilter = "",
}: WebtoonViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 记录上一次由滚动事件报告的页码，用于区分“外部跳转”和“滚动同步”
  const lastScrollReportedPage = useRef(currentPage);
  // 外部跳转的防抖 RAF id
  const jumpRafRef = useRef<number>(0);
  // 滚动报告节流时间戳
  const lastScrollReportTime = useRef(0);
  const t = useTranslation();
  // Track which pages are "in range" to render
  const [renderRange, setRenderRange] = useState({ start: 0, end: Math.min(RENDER_BUFFER * 2, pages.length - 1) });

  // Track loaded image heights for accurate positioning
  const [pageHeights, setPageHeights] = useState<Map<number, number>>(new Map());

  // Track which pages failed to load
  const [errorPages, setErrorPages] = useState<Set<number>>(new Set());

  // Zoom state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const isPanningRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const touchHandledRef = useRef(false);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef(1);
  const isPinchingRef = useRef(false);
  const scaleRef = useRef(1);

  // Preload images ahead of current page
  useImagePreloader(pages, currentPage, preloadCount, comicId);

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

  // Reset zoom when page changes externally (e.g. bookmark jump, progress bar drag)
  useEffect(() => {
    if (isScrollingRef.current) return;
    if (currentPage === lastScrollReportedPage.current) return;

    // External jump detected — reset zoom state
    setScale(1);
    setTranslate({ x: 0, y: 0 });

    // 取消上一次未执行的跳转，避免堆积
    if (jumpRafRef.current) cancelAnimationFrame(jumpRafRef.current);

    // 先确保目标页面在渲染范围内
    const newStart = Math.max(0, currentPage - RENDER_BUFFER);
    const newEnd = Math.min(pages.length - 1, currentPage + RENDER_BUFFER);
    setRenderRange({ start: newStart, end: newEnd });

    // 使用 rAF 等待渲染完成后再滚动，并通过取消机制避免堆积
    jumpRafRef.current = requestAnimationFrame(() => {
      jumpRafRef.current = 0;
      const container = containerRef.current;
      if (!container) return;

      // 计算目标位置（始终用累加高度计算，避免 scrollIntoView 对未渲染元素的依赖）
      let targetTop = 0;
      for (let i = 0; i < currentPage; i++) {
        targetTop += pageHeights.get(i) ?? ESTIMATED_PAGE_HEIGHT;
      }
      container.scrollTop = targetTop;

      // 更新滚动报告页码，防止滚动事件再次触发 onPageChange
      lastScrollReportedPage.current = currentPage;
    });
  }, [currentPage, pages.length, pageHeights]);
  const handleScroll = useCallback(() => {
    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 150);

    // Skip virtualization range update during an active pinch gesture
    if (isPinchingRef.current) return;

    const centerPage = updateRenderRange();

    // When zoomed in, suppress page-change reporting to avoid
    // panning-triggered scroll events resetting the zoom state.
    if (scale > 1) return;

    // 节流页码报告：避免高频触发父组件状态更新
    const now = Date.now();
    if (centerPage !== undefined && centerPage !== currentPage && now - lastScrollReportTime.current >= SCROLL_REPORT_THROTTLE) {
      lastScrollReportTime.current = now;
      lastScrollReportedPage.current = centerPage;
      onPageChange(centerPage);
    }
  }, [currentPage, onPageChange, updateRenderRange, scale]);

  // Sync scale to ref for use in non-React event listeners
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Native touchmove with passive:false to reliably call preventDefault on iOS Safari.
  // React synthetic touch events are passive by default and cannot prevent browser gestures.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchMove = (e: globalThis.TouchEvent) => {
      // Prevent Safari rubber-band / zoom during pinch or when zoomed in
      if (e.touches.length >= 2 || isPinchingRef.current || scaleRef.current > 1) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

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

  // Touch gesture handlers for double-tap zoom, pinch-to-zoom, and pan
  const getTouchDistance = (touches: React.TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      pinchStartDistRef.current = getTouchDistance(e.touches);
      pinchStartScaleRef.current = scale;
      isPinchingRef.current = true;
      panStartRef.current = null;
      return;
    }
    if (e.touches.length === 1 && scale > 1) {
      panStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        tx: translate.x,
        ty: translate.y,
      };
    }
  }, [scale, translate]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Pinch-to-zoom
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      const currentDist = getTouchDistance(e.touches);
      const nextScale = Math.min(3, Math.max(1, pinchStartScaleRef.current * (currentDist / pinchStartDistRef.current)));
      setScale(nextScale);
      if (nextScale <= 1) {
        setTranslate({ x: 0, y: 0 });
      }
      return;
    }
    // Single-finger pan (only when zoomed in and not pinching)
    if (e.touches.length === 1 && panStartRef.current && scale > 1 && !isPinchingRef.current) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      isPanningRef.current = true;
      setTranslate({
        x: panStartRef.current.tx + dx,
        y: panStartRef.current.ty + dy,
      });
    }
  }, [scale]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // End pinch gesture
    if (isPinchingRef.current && e.touches.length < 2) {
      pinchStartDistRef.current = null;
      isPinchingRef.current = false;
      // Snap to 1x if close enough
      if (scale <= 1.05) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      }
      touchHandledRef.current = true;
      setTimeout(() => { touchHandledRef.current = false; }, 400);
      panStartRef.current = null;
      return;
    }

    panStartRef.current = null;

    // Double-tap detection (only when not pinching)
    const now = Date.now();
    if (now - lastTapTimeRef.current < 300 && e.changedTouches.length === 1) {
      lastTapTimeRef.current = 0;
      touchHandledRef.current = true;
      setTimeout(() => { touchHandledRef.current = false; }, 400);

      if (scale > 1) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      } else {
        setScale(2);
        setTranslate({ x: 0, y: 0 });
      }
    } else {
      lastTapTimeRef.current = now;
    }

    // Reset panning state after a short delay
    setTimeout(() => { isPanningRef.current = false; }, 50);
  }, [scale]);

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (scale > 1) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(2);
      setTranslate({ x: 0, y: 0 });
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore clicks that follow a pan or double-tap gesture
    if (isPanningRef.current || touchHandledRef.current) return;
    if (scale > 1) return;
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
      className={`h-dvh w-full overflow-x-hidden overflow-y-auto select-none transition-colors duration-300 ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onScroll={handleScroll}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={scale > 1 ? { touchAction: "none" } : undefined}
    >
      <div
        className="mx-auto"
        style={{
          ...(containerWidth ? { width: containerWidth, maxWidth: "100%" } : { maxWidth: "48rem" }),
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: "center top",
          transition: isPanningRef.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* 顶部不在 DOM 范围内的页面用一个合并占位元素 */}
        {(() => {
          const domStart = Math.max(0, renderRange.start - DOM_BUFFER);
          if (domStart > 0) {
            let h = 0;
            for (let i = 0; i < domStart; i++) h += pageHeights.get(i) ?? ESTIMATED_PAGE_HEIGHT;
            return <div style={{ height: h }} />;
          }
          return null;
        })()}

        {pages.map((pageUrl, index) => {
          const domStart = Math.max(0, renderRange.start - DOM_BUFFER);
          const domEnd = Math.min(pages.length - 1, renderRange.end + DOM_BUFFER);
          // 超出 DOM 缓冲区的页面不创建节点
          if (index < domStart || index > domEnd) return null;

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
                        <p className={`text-xs ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>第 {index + 1} 页加载失败，请重试</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); setErrorPages(prev => { const next = new Set(prev); next.delete(index); return next; }); }}
                        className="min-h-[44px] rounded-lg bg-accent/20 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/30 active:bg-accent/40 transition-colors"
                        >重试</button>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={pageUrl}
                      alt={`Page ${index + 1}`}
                      className="w-full h-auto block"
                      style={imageFilter ? { filter: imageFilter } : undefined}
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
                      style={imageFilter ? { filter: imageFilter } : undefined}
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

        {/* 底部不在 DOM 范围内的页面用一个合并占位元素 */}
        {(() => {
          const domEnd = Math.min(pages.length - 1, renderRange.end + DOM_BUFFER);
          if (domEnd < pages.length - 1) {
            let h = 0;
            for (let i = domEnd + 1; i < pages.length; i++) h += pageHeights.get(i) ?? ESTIMATED_PAGE_HEIGHT;
            return <div style={{ height: h }} />;
          }
          return null;
        })()}

        <div className="flex items-center justify-center py-16 pb-[calc(env(safe-area-inset-bottom)+4rem)]">
          <div className="text-center">
            <p className={`text-sm ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>{t.reader.reachedLastPage}</p>
            {nextVolumeTitle && onBoundaryReached && (
              <button
                onClick={() => onBoundaryReached("next")}
                className="mt-4 rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-sm shadow-accent/25 transition-all hover:bg-accent/90 hover:shadow-md"
              >
                {nextVolumeTitle} →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Zoom level indicator */}
      {scale > 1 && (
        <div className="fixed bottom-20 right-4 z-50 pointer-events-none">
          <div className="rounded-full bg-zinc-900/80 backdrop-blur-xl border border-white/[0.08] px-3.5 py-1.5 text-sm font-medium text-white shadow-lg shadow-black/40">
            {Math.round(scale * 100)}%
          </div>
        </div>
      )}
    </div>
  );
}
