"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import { useImagePreloader } from "@/hooks/useImagePreloader";

interface SinglePageViewProps {
  pages: string[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTapCenter: () => void;
  direction: "ltr" | "rtl";
  useRealData?: boolean;
  readerTheme?: ReaderTheme;
}

export default function SinglePageView({
  pages,
  currentPage,
  onPageChange,
  onTapCenter,
  direction,
  useRealData,
  readerTheme = "night",
}: SinglePageViewProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [scale, setScale] = useState(1);

  // 触摸手势状态
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);

  // Preload next 3 pages
  useImagePreloader(pages, currentPage, 3);

  // Reset loaded state and scale when page changes
  useEffect(() => {
    setImageLoaded(false);
    setScale(1);
  }, [currentPage]);

  // 触摸事件处理
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // 捏合缩放开始
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartScaleRef.current = scale;
    } else if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  }, [scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      // 捏合缩放
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.min(3, Math.max(0.5, pinchStartScaleRef.current * (dist / pinchStartDistRef.current)));
      setScale(newScale);
      e.preventDefault();
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // 捏合缩放结束
    if (pinchStartDistRef.current !== null) {
      pinchStartDistRef.current = null;
      // 双指松开时如果缩放接近1则重置
      if (Math.abs(scale - 1) < 0.15) setScale(1);
      return;
    }

    // 滑动翻页检测
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const start = touchStartRef.current;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - start.x;
    const dy = endY - start.y;
    const elapsed = Date.now() - start.time;
    touchStartRef.current = null;

    // 缩放状态下不翻页
    if (scale > 1.1) return;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const minSwipe = 50;
    const maxTime = 500;

    // 水平滑动距离 > 垂直距离，且超过最小阈值
    if (absDx > absDy && absDx > minSwipe && elapsed < maxTime) {
      const swipeLeft = dx < 0;
      if (direction === "ltr") {
        if (swipeLeft) onPageChange(Math.min(pages.length - 1, currentPage + 1));
        else onPageChange(Math.max(0, currentPage - 1));
      } else {
        if (swipeLeft) onPageChange(Math.max(0, currentPage - 1));
        else onPageChange(Math.min(pages.length - 1, currentPage + 1));
      }
    } else if (absDx < 10 && absDy < 10 && elapsed < 300) {
      // 轻触（非滑动）- 区域翻页或显示工具栏
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = (start.x - rect.left) / rect.width;
      if (ratio > 0.35 && ratio < 0.65) {
        onTapCenter();
      } else if (ratio <= 0.35) {
        if (direction === "ltr") onPageChange(Math.max(0, currentPage - 1));
        else onPageChange(Math.min(pages.length - 1, currentPage + 1));
      } else {
        if (direction === "ltr") onPageChange(Math.min(pages.length - 1, currentPage + 1));
        else onPageChange(Math.max(0, currentPage - 1));
      }
    }
  }, [direction, currentPage, pages.length, onPageChange, onTapCenter, scale]);

  // 双击缩放
  const lastTapRef = useRef<number>(0);
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // 双击切换缩放
      setScale(prev => prev > 1 ? 1 : 2);
      e.preventDefault();
    }
    lastTapRef.current = now;
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 缩放模式下不处理点击翻页
    if (scale > 1.1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const ratio = x / width;

    if (ratio > 0.35 && ratio < 0.65) {
      onTapCenter();
      return;
    }

    const isLeftTap = ratio <= 0.35;
    const isRightTap = ratio >= 0.65;

    if (direction === "ltr") {
      if (isLeftTap) onPageChange(Math.max(0, currentPage - 1));
      if (isRightTap) onPageChange(Math.min(pages.length - 1, currentPage + 1));
    } else {
      if (isLeftTap) onPageChange(Math.min(pages.length - 1, currentPage + 1));
      if (isRightTap) onPageChange(Math.max(0, currentPage - 1));
    }
  };

  return (
    <div
      className={`relative flex h-screen w-full cursor-pointer items-center justify-center select-none transition-colors duration-300 overflow-hidden ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="relative h-full w-full flex items-center justify-center transition-transform duration-200"
        style={{ transform: `scale(${scale})` }}
      >
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`h-8 w-8 animate-spin rounded-full border-2 border-t-accent ${
              readerTheme === "day" ? "border-gray-300" : "border-white/20"
            }`} />
          </div>
        )}
        {useRealData ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={currentPage}
            src={pages[currentPage]}
            alt={`Page ${currentPage + 1}`}
            className={`max-h-full max-w-full object-contain transition-opacity duration-200 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setImageLoaded(true)}
            draggable={false}
          />
        ) : (
          <Image
            key={currentPage}
            src={pages[currentPage]}
            alt={`Page ${currentPage + 1}`}
            fill
            className={`object-contain transition-opacity duration-200 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
            priority
            onLoad={() => setImageLoaded(true)}
            sizes="100vw"
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 flex">
        <div className="w-[35%]" />
        <div className="w-[30%]" />
        <div className="w-[35%]" />
      </div>
    </div>
  );
}
