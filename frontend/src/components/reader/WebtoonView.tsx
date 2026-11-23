"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import { useImagePreloader } from "@/hooks/useImagePreloader";
import {
  DEFAULT_ASPECT_RATIO,
  DOM_BUFFER,
  RENDER_BUFFER,
  SCROLL_REPORT_THROTTLE,
  calibrateDefaultAspectRatio,
  computeAnchoredScrollTop,
  computeRenderRange,
  findWebtoonCenterPage,
  getWebtoonPageHeight,
  getWebtoonPageTop,
  shouldIgnoreScrollEcho,
  type RenderRange,
  type WebtoonDimension,
  type WebtoonLayoutConfig,
} from "./webtoon-layout";

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

interface LayoutMetricsState {
  dimensions: Map<number, WebtoonDimension>;
  defaultRatio: number;
}

interface WebtoonPageImageProps {
  index: number;
  src: string;
  dimension?: WebtoonDimension;
  readerTheme: ReaderTheme;
  imageFilter: string;
  onLoaded: (index: number, img: HTMLImageElement) => void;
  onError: (index: number) => void;
}

function WebtoonPageImage({
  index,
  src,
  dimension,
  readerTheme,
  imageFilter,
  onLoaded,
  onError,
}: WebtoonPageImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [decoded, setDecoded] = useState(false);

  // Reset local decode flag when page image URL changes.
  useEffect(() => {
    setDecoded(false);
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setDecoded(true);
      onLoaded(index, img);
    }
  }, [index, src, onLoaded]);

  return (
    <>
      {!decoded && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 animate-pulse ${
            readerTheme === "day" ? "bg-gray-200" : "bg-white/5"
          }`}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={`Page ${index + 1}`}
        width={dimension?.width}
        height={dimension?.height}
        className={
          dimension
            ? "relative w-full h-full block"
            : "relative w-full h-full object-contain block"
        }
        style={imageFilter ? { filter: imageFilter } : undefined}
        loading="eager"
        decoding="async"
        onLoad={(e) => {
          setDecoded(true);
          onLoaded(index, e.currentTarget);
        }}
        onError={() => onError(index)}
      />
    </>
  );
}

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
  const contentRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trailingReportTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 记录上一次由滚动事件报告的页码，用于区分“外部跳转”和“滚动同步”
  // 若初始挂载时 currentPage > 0（例如从单页模式切入或恢复进度），初始化为 -1 以确保立即定位。
  const lastScrollReportedPage = useRef<number>(currentPage > 0 ? -1 : 0);
  const recentScrollReportsRef = useRef<Map<number, number>>(new Map());
  const pendingJumpPageRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef<{ expectedTop: number; until: number } | null>(null);
  // 滚动报告节流时间戳
  const lastScrollReportTime = useRef(0);
  const hasCalibratedRatioRef = useRef(false);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  const t = useTranslation();

  // Track which pages are "in range" to render
  const [renderRange, setRenderRange] = useState<RenderRange>(() =>
    computeRenderRange(currentPage, pages.length)
  );

  // Track natural image dimensions & calibrated fallback ratio for responsive height stability
  const [layoutMetrics, setLayoutMetrics] = useState<LayoutMetricsState>(() => ({
    dimensions: new Map<number, WebtoonDimension>(),
    defaultRatio: DEFAULT_ASPECT_RATIO,
  }));
  const [contentWidth, setContentWidth] = useState(0);

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

  const pagesSignature = `${pages.length}:${pages[0] ?? ""}:${pages[pages.length - 1] ?? ""}`;
  const prevPagesSignatureRef = useRef(pagesSignature);

  const currentLayoutConfig: WebtoonLayoutConfig = {
    pageCount: pages.length,
    dimensions: layoutMetrics.dimensions,
    contentWidth,
    defaultRatio: layoutMetrics.defaultRatio,
  };
  const currentLayoutConfigRef = useRef<WebtoonLayoutConfig>(currentLayoutConfig);
  currentLayoutConfigRef.current = currentLayoutConfig;
  const committedLayoutConfigRef = useRef<WebtoonLayoutConfig | null>(null);

  // Preload images ahead of current page
  useImagePreloader(pages, currentPage, preloadCount, comicId);

  // Reset cached dimensions if the underlying page list actually changes
  useEffect(() => {
    if (prevPagesSignatureRef.current === pagesSignature) return;
    prevPagesSignatureRef.current = pagesSignature;
    hasCalibratedRatioRef.current = false;
    committedLayoutConfigRef.current = null;
    recentScrollReportsRef.current.clear();
    lastScrollReportedPage.current = currentPageRef.current > 0 ? -1 : 0;
    setLayoutMetrics({
      dimensions: new Map<number, WebtoonDimension>(),
      defaultRatio: DEFAULT_ASPECT_RATIO,
    });
    setErrorPages(new Set());
    setRenderRange(computeRenderRange(currentPageRef.current, pages.length));
  }, [pagesSignature, pages.length]);

  // Measure unscaled column width via ResizeObserver so aspect-ratio heights adapt on resize/rotation
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) {
        setContentWidth((prev) => (Math.abs(prev - width) >= 0.5 ? width : prev));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerWidth]);

  // Cleanup pending timers on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (trailingReportTimerRef.current) clearTimeout(trailingReportTimerRef.current);
    };
  }, []);

  const updateRenderRangeForScroll = useCallback(
    (scrollTop: number, viewportHeight: number) => {
      const config = currentLayoutConfigRef.current;
      const centerPage = findWebtoonCenterPage(scrollTop, viewportHeight, config);
      const nextRange = computeRenderRange(centerPage, config.pageCount);
      setRenderRange((prev) =>
        prev.start !== nextRange.start || prev.end !== nextRange.end ? nextRange : prev
      );
      return centerPage;
    },
    []
  );

  // Handle external jumps & scroll-anchor compensation synchronously before paint
  useLayoutEffect(() => {
    const container = containerRef.current;
    const prevCommitted = committedLayoutConfigRef.current;
    const nextConfig = currentLayoutConfig;

    if (!container || pages.length === 0) {
      committedLayoutConfigRef.current = nextConfig;
      return;
    }

    const now = performance.now();
    if (currentPage === lastScrollReportedPage.current) {
      recentScrollReportsRef.current.clear();
    }
    const isEcho = shouldIgnoreScrollEcho(
      currentPage,
      lastScrollReportedPage.current,
      recentScrollReportsRef.current,
      now
    );

    if (!isEcho && pendingJumpPageRef.current !== currentPage) {
      pendingJumpPageRef.current = currentPage;
      lastScrollReportedPage.current = currentPage;
      recentScrollReportsRef.current.clear();
      if (trailingReportTimerRef.current) {
        clearTimeout(trailingReportTimerRef.current);
        trailingReportTimerRef.current = undefined;
      }
      if (scaleRef.current !== 1) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      }
    }

    if (pendingJumpPageRef.current !== null) {
      const targetPage = Math.max(0, Math.min(pages.length - 1, pendingJumpPageRef.current));
      const desiredRange = computeRenderRange(targetPage, pages.length);

      if (
        desiredRange.start !== renderRange.start ||
        desiredRange.end !== renderRange.end
      ) {
        committedLayoutConfigRef.current = nextConfig;
        setRenderRange(desiredRange);
        return;
      }

      const targetEl = pageRefs.current[targetPage];
      const targetTop =
        targetEl && targetEl.offsetParent === contentRef.current
          ? targetEl.offsetTop
          : getWebtoonPageTop(targetPage, nextConfig);

      const beforeScrollTop = container.scrollTop;
      container.scrollTop = targetTop;
      if (Math.abs(container.scrollTop - beforeScrollTop) >= 0.5) {
        programmaticScrollRef.current = {
          expectedTop: container.scrollTop,
          until: performance.now() + 150,
        };
      }
      pendingJumpPageRef.current = null;
      committedLayoutConfigRef.current = nextConfig;
      return;
    }

    if (
      prevCommitted &&
      (prevCommitted.dimensions !== nextConfig.dimensions ||
        prevCommitted.defaultRatio !== nextConfig.defaultRatio ||
        prevCommitted.contentWidth !== nextConfig.contentWidth)
    ) {
      const { nextScrollTop, delta } = computeAnchoredScrollTop(
        prevCommitted,
        nextConfig,
        container.scrollTop
      );
      if (Math.abs(delta) >= 0.5) {
        const beforeScrollTop = container.scrollTop;
        container.scrollTop = nextScrollTop;
        if (Math.abs(container.scrollTop - beforeScrollTop) >= 0.5) {
          programmaticScrollRef.current = {
            expectedTop: container.scrollTop,
            until: performance.now() + 150,
          };
        }
      }
    }

    committedLayoutConfigRef.current = nextConfig;
  }, [currentPage, pages.length, renderRange, layoutMetrics, contentWidth]);

  const emitScrollPage = useCallback((centerPage: number) => {
    const now = performance.now();
    lastScrollReportTime.current = now;
    lastScrollReportedPage.current = centerPage;
    recentScrollReportsRef.current.set(centerPage, now);
    for (const [page, ts] of recentScrollReportsRef.current) {
      if (now - ts >= 500) {
        recentScrollReportsRef.current.delete(page);
      }
    }
    if (centerPage !== currentPageRef.current) {
      onPageChangeRef.current(centerPage);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || pages.length === 0) return;

    const now = performance.now();
    const prog = programmaticScrollRef.current;
    const isProgrammatic =
      prog !== null &&
      now <= prog.until &&
      Math.abs(container.scrollTop - prog.expectedTop) <= 8;

    if (isProgrammatic) {
      programmaticScrollRef.current = null;
      if (!isPinchingRef.current) {
        updateRenderRangeForScroll(container.scrollTop, container.clientHeight);
      }
      return;
    }

    programmaticScrollRef.current = null;
    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      // Calibrate typical aspect ratio once user scroll settles if not done yet
      if (!hasCalibratedRatioRef.current) {
        setLayoutMetrics((prev) => {
          if (hasCalibratedRatioRef.current) return prev;
          const calibrated = calibrateDefaultAspectRatio(prev.dimensions, pages.length);
          if (calibrated === null) return prev;
          hasCalibratedRatioRef.current = true;
          if (Math.abs(calibrated - prev.defaultRatio) < 0.01) return prev;
          return { ...prev, defaultRatio: calibrated };
        });
      }
    }, 150);

    // Skip virtualization range update during an active pinch gesture
    if (isPinchingRef.current) return;

    const centerPage = updateRenderRangeForScroll(container.scrollTop, container.clientHeight);

    // When zoomed in, suppress page-change reporting to avoid
    // panning-triggered scroll events resetting the zoom state.
    if (scaleRef.current > 1) return;

    const elapsed = now - lastScrollReportTime.current;
    if (elapsed >= SCROLL_REPORT_THROTTLE) {
      if (trailingReportTimerRef.current) {
        clearTimeout(trailingReportTimerRef.current);
        trailingReportTimerRef.current = undefined;
      }
      if (centerPage !== currentPageRef.current) {
        emitScrollPage(centerPage);
      }
    } else if (!trailingReportTimerRef.current) {
      trailingReportTimerRef.current = setTimeout(() => {
        trailingReportTimerRef.current = undefined;
        const el = containerRef.current;
        if (!el || pendingJumpPageRef.current !== null || scaleRef.current > 1) return;
        const latestCenter = findWebtoonCenterPage(
          el.scrollTop,
          el.clientHeight,
          currentLayoutConfigRef.current
        );
        if (latestCenter !== currentPageRef.current) {
          emitScrollPage(latestCenter);
        }
      }, Math.max(16, SCROLL_REPORT_THROTTLE - elapsed));
    }
  }, [pages.length, updateRenderRangeForScroll, emitScrollPage]);

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

  // Record intrinsic natural dimensions after load (never clientHeight, which can be 0 pre-layout)
  const handleImageLoad = useCallback(
    (index: number, img: HTMLImageElement) => {
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;

      setLayoutMetrics((prev) => {
        const existing = prev.dimensions.get(index);
        const sameDim =
          existing?.width === img.naturalWidth && existing?.height === img.naturalHeight;
        if (sameDim && hasCalibratedRatioRef.current) {
          return prev;
        }

        const nextDims = sameDim ? prev.dimensions : new Map(prev.dimensions);
        if (!sameDim) {
          nextDims.set(index, { width: img.naturalWidth, height: img.naturalHeight });
        }

        let nextDefaultRatio = prev.defaultRatio;
        if (!hasCalibratedRatioRef.current && !isUserScrollingRef.current) {
          const calibrated = calibrateDefaultAspectRatio(nextDims, pages.length);
          if (calibrated !== null) {
            hasCalibratedRatioRef.current = true;
            if (Math.abs(calibrated - prev.defaultRatio) >= 0.01) {
              nextDefaultRatio = calibrated;
            }
          }
        }

        if (nextDims === prev.dimensions && nextDefaultRatio === prev.defaultRatio) {
          return prev;
        }
        return { dimensions: nextDims, defaultRatio: nextDefaultRatio };
      });
    },
    [pages.length]
  );

  const handleImageError = useCallback((index: number) => {
    setErrorPages((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  // Touch gesture handlers for double-tap zoom, pinch-to-zoom, and pan
  const getTouchDistance = (touches: React.TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Cancel pending programmatic expectation when user explicitly touches to scroll
      programmaticScrollRef.current = null;
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
    },
    [scale, translate]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      // Pinch-to-zoom
      if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
        const currentDist = getTouchDistance(e.touches);
        const nextScale = Math.min(
          3,
          Math.max(1, pinchStartScaleRef.current * (currentDist / pinchStartDistRef.current))
        );
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
    },
    [scale]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
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
        setTimeout(() => {
          touchHandledRef.current = false;
        }, 400);
        panStartRef.current = null;
        return;
      }

      panStartRef.current = null;

      // Double-tap detection (only when not pinching)
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300 && e.changedTouches.length === 1) {
        lastTapTimeRef.current = 0;
        touchHandledRef.current = true;
        setTimeout(() => {
          touchHandledRef.current = false;
        }, 400);

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
      setTimeout(() => {
        isPanningRef.current = false;
      }, 50);
    },
    [scale]
  );

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

  const domStart = pages.length > 0 ? Math.max(0, renderRange.start - DOM_BUFFER) : 0;
  const domEnd =
    pages.length > 0 ? Math.min(pages.length - 1, renderRange.end + DOM_BUFFER) : -1;

  return (
    <div
      ref={containerRef}
      className={`h-dvh w-full overflow-x-hidden overflow-y-auto select-none transition-colors duration-300 ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onScroll={handleScroll}
      onWheel={() => {
        programmaticScrollRef.current = null;
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={scale > 1 ? { touchAction: "none" } : undefined}
    >
      <div
        ref={contentRef}
        className="mx-auto relative"
        style={{
          ...(containerWidth ? { width: containerWidth, maxWidth: "100%" } : { maxWidth: "48rem" }),
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: "center top",
          transition: isPanningRef.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* 顶部不在 DOM 范围内的页面用一个合并占位元素 */}
        {domStart > 0 && (
          <div style={{ height: getWebtoonPageTop(domStart, currentLayoutConfig) }} />
        )}

        {pages.map((pageUrl, index) => {
          // 超出 DOM 缓冲区的页面不创建节点
          if (index < domStart || index > domEnd) return null;

          const isInRange = index >= renderRange.start && index <= renderRange.end;
          const dim = layoutMetrics.dimensions.get(index);
          const estimatedHeight = getWebtoonPageHeight(index, currentLayoutConfig);
          const hasError = errorPages.has(index);

          let wrapperStyle: React.CSSProperties;
          if (!isInRange) {
            wrapperStyle = { height: estimatedHeight };
          } else if (hasError) {
            wrapperStyle = { minHeight: estimatedHeight };
          } else if (dim && useRealData) {
            // Known intrinsic ratio keeps exact layout box height even across remounts before decode
            wrapperStyle = { aspectRatio: `${dim.width} / ${dim.height}` };
          } else if (useRealData) {
            // Hold estimated height while image has never loaded yet so height never collapses to 0
            wrapperStyle = { height: estimatedHeight };
          } else {
            wrapperStyle = { height: estimatedHeight };
          }

          return (
            <div
              key={index}
              ref={(el) => {
                pageRefs.current[index] = el;
              }}
              className="relative w-full overflow-hidden"
              style={wrapperStyle}
            >
              {isInRange ? (
                useRealData ? (
                  hasError ? (
                    <div
                      className={`w-full h-full flex items-center justify-center py-16 ${
                        readerTheme === "day" ? "bg-gray-200" : "bg-white/5"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-2 text-center">
                        <span className="text-2xl">⚠️</span>
                        <p
                          className={`text-xs ${
                            readerTheme === "day" ? "text-gray-400" : "text-white/40"
                          }`}
                        >
                          第 {index + 1} 页加载失败，请重试
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setErrorPages((prev) => {
                              const next = new Set(prev);
                              next.delete(index);
                              return next;
                            });
                          }}
                          className="min-h-[44px] rounded-lg bg-accent/20 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/30 active:bg-accent/40 transition-colors"
                        >
                          重试
                        </button>
                      </div>
                    </div>
                  ) : (
                    <WebtoonPageImage
                      index={index}
                      src={pageUrl}
                      dimension={dim}
                      readerTheme={readerTheme}
                      imageFilter={imageFilter}
                      onLoaded={handleImageLoad}
                      onError={handleImageError}
                    />
                  )
                ) : (
                  <div className="relative h-full w-full">
                    {/* Next/Image for mock data */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pageUrl}
                      alt={`Page ${index + 1}`}
                      className="w-full h-full object-contain block"
                      style={imageFilter ? { filter: imageFilter } : undefined}
                      loading="eager"
                    />
                  </div>
                )
              ) : (
                /* Skeleton placeholder */
                <div
                  className={`w-full h-full animate-pulse ${
                    readerTheme === "day" ? "bg-gray-200" : "bg-white/5"
                  }`}
                />
              )}
            </div>
          );
        })}

        {/* 底部不在 DOM 范围内的页面用一个合并占位元素 */}
        {domEnd >= 0 && domEnd < pages.length - 1 && (
          <div
            style={{
              height:
                getWebtoonPageTop(pages.length, currentLayoutConfig) -
                getWebtoonPageTop(domEnd + 1, currentLayoutConfig),
            }}
          />
        )}

        <div className="flex items-center justify-center py-16 pb-[calc(env(safe-area-inset-bottom)+4rem)]">
          <div className="text-center">
            <p className={`text-sm ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>
              {t.reader.reachedLastPage}
            </p>
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
