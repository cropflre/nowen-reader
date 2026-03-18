"use client";

import Image from "next/image";
import { useMemo, useState, useEffect } from "react";
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
}: DoublePageViewProps) {
  const [loadedLeft, setLoadedLeft] = useState(false);
  const [loadedRight, setLoadedRight] = useState(false);
  const [errorLeft, setErrorLeft] = useState(false);
  const [errorRight, setErrorRight] = useState(false);

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

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const ratio = x / width;

    if (ratio > 0.3 && ratio < 0.7) {
      onTapCenter();
      return;
    }

    const goForward = direction === "ltr" ? ratio >= 0.7 : ratio <= 0.3;
    const goBack = direction === "ltr" ? ratio <= 0.3 : ratio >= 0.7;

    if (goForward) {
      onPageChange(Math.min(pages.length - 1, spreadIndex + 2));
    }
    if (goBack) {
      onPageChange(Math.max(0, spreadIndex - 2));
    }
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
    keyPrefix: string
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
      className={`relative flex h-screen w-full cursor-pointer items-center justify-center select-none transition-colors duration-300 ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onClick={handleClick}
    >
      <div
        className="flex h-full items-center justify-center gap-1 p-4"
        style={containerWidth ? { width: containerWidth, maxWidth: "100%", margin: "0 auto" } : undefined}
      >
        {renderPage(leftPage, leftPageIndex, loadedLeft, setLoadedLeft, errorLeft, setErrorLeft, "left")}
        <div className={`h-[80%] w-px ${readerTheme === "day" ? "bg-gray-300" : "bg-white/5"}`} />
        {renderPage(rightPage, rightPageIndex, loadedRight, setLoadedRight, errorRight, setErrorRight, "right")}
      </div>
    </div>
  );
}
