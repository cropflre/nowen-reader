"use client";

import Image from "next/image";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import type { FitMode } from "@/types/reader";
import { useImagePreloader } from "@/hooks/useImagePreloader";

interface DoublePageViewProps {
  pages: string[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTapCenter: () => void;
  direction: "ltr" | "rtl";
  useRealData?: boolean;
  readerTheme?: ReaderTheme;
  fitMode?: FitMode;
  containerWidth?: string;
  preloadCount?: number;
  /** 翻页超出边界时触发 */
  onBoundaryReached?: (direction: "next" | "prev") => void;
}

export default function DoublePageView({
  pages,
  currentPage,
  onPageChange,
  onTapCenter,
  direction,
  useRealData,
  readerTheme = "night",
  fitMode = "container",
  containerWidth,
  preloadCount = 4,
  onBoundaryReached,
}: DoublePageViewProps) {
  const [loadedLeft, setLoadedLeft] = useState(false);
  const [loadedRight, setLoadedRight] = useState(false);
  const [errorLeft, setErrorLeft] = useState(false);
  const [errorRight, setErrorRight] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileHint, setShowMobileHint] = useState(false);

  // 触摸手势状态
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  // 标记touch事件已处理翻页，防止后续合成click再次触发
  const touchHandledRef = useRef(false);

  // 检测移动端
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setShowMobileHint(true);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 移动端提示 3 秒后消失
  useEffect(() => {
    if (!showMobileHint) return;
    const timer = setTimeout(() => setShowMobileHint(false), 3000);
    return () => clearTimeout(timer);
  }, [showMobileHint]);

  // Preload next pages
  useImagePreloader(pages, currentPage, preloadCount);

  const spreadIndex = useMemo(() => {
    return currentPage % 2 === 0 ? currentPage : currentPage - 1;
  }, [currentPage]);

  const leftPageIndex = direction === "ltr" ? spreadIndex : spreadIndex + 1;
  const rightPageIndex = direction === "ltr" ? spreadIndex + 1 : spreadIndex;
  const leftPage = pages[leftPageIndex] ?? null;
  const rightPage = pages[rightPageIndex] ?? null;

  useEffect(() => {
    setLoadedLeft(false);
    setLoadedRight(false);
    setErrorLeft(false);
    setErrorRight(false);
  }, [spreadIndex]);

  // 检查缓存图片：切换模式后，如果图片已在浏览器缓存中加载完成，onLoad 可能不触发
  const leftImgRef = useRef<HTMLImageElement>(null);
  const rightImgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const left = leftImgRef.current;
    if (left && left.complete && left.naturalWidth > 0) setLoadedLeft(true);
    const right = rightImgRef.current;
    if (right && right.complete && right.naturalWidth > 0) setLoadedRight(true);
  });

  // 翻页逻辑
  const goForward = useCallback(() => {
    if (spreadIndex + 2 >= pages.length) onBoundaryReached?.("next");
    else onPageChange(Math.min(pages.length - 1, spreadIndex + 2));
  }, [spreadIndex, pages.length, onPageChange, onBoundaryReached]);

  const goBack = useCallback(() => {
    if (spreadIndex <= 0) onBoundaryReached?.("prev");
    else onPageChange(Math.max(0, spreadIndex - 2));
  }, [spreadIndex, onPageChange, onBoundaryReached]);

  // 触摸事件处理
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const start = touchStartRef.current;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - start.x;
    const dy = endY - start.y;
    const elapsed = Date.now() - start.time;
    touchStartRef.current = null;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const minSwipe = 50;
    const maxTime = 800;

    // 水平滑动翻页
    if (absDx > absDy && absDx > minSwipe && elapsed < maxTime) {
      const swipeLeft = dx < 0;
      if (direction === "ltr") {
        swipeLeft ? goForward() : goBack();
      } else {
        swipeLeft ? goBack() : goForward();
      }
      return;
    }

    // 竖向滑动翻页
    if (absDy > absDx && absDy > minSwipe && elapsed < maxTime) {
      dy < 0 ? goForward() : goBack();
      return;
    }

    // 轻触
    if (absDx < 10 && absDy < 10 && elapsed < 300) {
      // 标记touch已处理，防止后续合成click事件重复翻页
      touchHandledRef.current = true;
      setTimeout(() => { touchHandledRef.current = false; }, 400);

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = (start.x - rect.left) / rect.width;
      if (ratio > 0.3 && ratio < 0.7) {
        onTapCenter();
      } else if (ratio <= 0.3) {
        direction === "ltr" ? goBack() : goForward();
      } else {
        direction === "ltr" ? goForward() : goBack();
      }
    }
  }, [direction, goForward, goBack, onTapCenter]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 如果touch事件已处理过翻页，跳过合成的click事件，防止翻两页
    if (touchHandledRef.current) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const ratio = x / width;

    if (ratio > 0.3 && ratio < 0.7) {
      onTapCenter();
      return;
    }

    const isForward = direction === "ltr" ? ratio >= 0.7 : ratio <= 0.3;
    const isBack = direction === "ltr" ? ratio <= 0.3 : ratio >= 0.7;

    if (isForward) goForward();
    if (isBack) goBack();
  };

  // 根据 fitMode 计算图片类名
  const getImageClass = (loaded: boolean) => {
    const base = `object-contain transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`;
    switch (fitMode) {
      case "width":
        return `w-full h-auto ${base}`;
      case "height":
        return `h-full w-auto ${base}`;
      case "container":
      default:
        return `max-h-full max-w-full ${base}`;
    }
  };

  const renderPage = (
    pageUrl: string | null,
    pageIndex: number,
    loaded: boolean,
    setLoaded: (v: boolean) => void,
    error: boolean,
    setError: (v: boolean) => void,
    keyPrefix: string,
    imgRef?: React.RefObject<HTMLImageElement | null>
  ) => {
    if (!pageUrl) return <div className="flex-1" />;

    return (
      <div className="relative h-full flex-1 max-w-[50vw] flex items-center justify-center">
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`h-6 w-6 animate-spin rounded-full border-2 border-t-accent ${
              readerTheme === "day" ? "border-gray-300" : "border-white/20"
            }`} />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-2xl">⚠️</span>
              <p className={`text-xs ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>加载失败</p>
              <button
                onClick={(e) => { e.stopPropagation(); setError(false); setLoaded(false); }}
                className="text-xs text-accent hover:text-accent/80"
              >重试</button>
            </div>
          </div>
        )}
        {useRealData ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            ref={imgRef}
            key={`${keyPrefix}-${pageIndex}`}
            src={pageUrl}
            alt={`Page ${pageIndex + 1}`}
            className={`${getImageClass(loaded)}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        ) : (
          <Image
            key={`${keyPrefix}-${pageIndex}`}
            src={pageUrl}
            alt={`Page ${pageIndex + 1}`}
            fill
            className={`${getImageClass(loaded)}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            sizes="50vw"
          />
        )}
      </div>
    );
  };

  return (
    <div
      className={`relative flex h-dvh w-full cursor-pointer items-center justify-center select-none transition-colors duration-300 ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="flex h-full items-center justify-center gap-1 p-4"
        style={containerWidth ? { width: containerWidth, maxWidth: "100%", margin: "0 auto" } : undefined}
      >
        {renderPage(leftPage, leftPageIndex, loadedLeft, setLoadedLeft, errorLeft, setErrorLeft, "left", leftImgRef)}
        <div className={`h-[80%] w-px ${readerTheme === "day" ? "bg-gray-300" : "bg-white/5"}`} />
        {renderPage(rightPage, rightPageIndex, loadedRight, setLoadedRight, errorRight, setErrorRight, "right", rightImgRef)}
      </div>

      {/* 移动端双页模式提示 */}
      {isMobile && showMobileHint && (
        <div className="fixed top-16 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className={`rounded-xl px-4 py-2.5 text-xs font-medium shadow-lg backdrop-blur-sm ${
            readerTheme === "day"
              ? "bg-amber-50 text-amber-700 border border-amber-200"
              : "bg-amber-500/15 text-amber-300 border border-amber-500/20"
          }`}>
            ⚠️ 双页模式在小屏幕上体验不佳，建议切换为单页模式
          </div>
        </div>
      )}
    </div>
  );
}
