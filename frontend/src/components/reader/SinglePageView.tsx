"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";
import type { FitMode } from "@/types/reader";
import { useImagePreloader } from "@/hooks/useImagePreloader";

interface SinglePageViewProps {
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
  /** 漫画 ID，用于触发后端预热 */
  comicId?: string;
  /** 翻页超出边界时触发："next" 表示翻过最后一页，"prev" 表示翻到第一页之前 */
  onBoundaryReached?: (direction: "next" | "prev") => void;
}

export default function SinglePageView({
  pages,
  currentPage,
  onPageChange,
  onTapCenter,
  direction,
  useRealData,
  readerTheme = "night",
  fitMode = "container",
  containerWidth,
  preloadCount = 3,
  comicId,
  onBoundaryReached,
}: SinglePageViewProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [scale, setScale] = useState(1);
  // 拖拽平移偏移量（缩放后拖拽查看）
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  // 翻页动画方向
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);

  // 触摸手势状态
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  // 拖拽平移状态（缩放后单指拖拽）
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const isPanningRef = useRef(false);
  // 标记touch事件已处理翻页，防止后续合成click再次触发
  const touchHandledRef = useRef(false);

  // Preload next N pages
  useImagePreloader(pages, currentPage, preloadCount, comicId);

  // Reset loaded state and scale when page changes
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    // 清除翻页动画
    const timer = setTimeout(() => setSlideDirection(null), 300);
    return () => {
      clearTimeout(timer);
      // 清理延迟单击定时器，防止翻页后残留触发
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
    };
  }, [currentPage]);

  // 检查缓存图片：组件挂载时或页码变化后，如果图片已在浏览器缓存中加载完成，
  // onLoad 可能不会触发，需要手动检查 img.complete 来解除 loading 状态
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
    }
  });

  // 带动画的翻页
  const goToPage = useCallback((page: number, dir: "left" | "right") => {
    setSlideDirection(dir);
    // 短暂延迟让动画开始后再切页
    requestAnimationFrame(() => {
      onPageChange(page);
    });
  }, [onPageChange]);

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
      // 缩放状态下准备拖拽
      if (scale > 1.1) {
        panStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          tx: translate.x,
          ty: translate.y,
        };
        isPanningRef.current = false;
      }
    }
  }, [scale, translate]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      // 捏合缩放
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.min(3, Math.max(0.5, pinchStartScaleRef.current * (dist / pinchStartDistRef.current)));
      setScale(newScale);
      e.preventDefault();
    } else if (e.touches.length === 1 && panStartRef.current && scale > 1.1) {
      // 缩放后单指拖拽平移
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      // 移动超过 5px 判定为拖拽
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isPanningRef.current = true;
      }
      setTranslate({
        x: panStartRef.current.tx + dx,
        y: panStartRef.current.ty + dy,
      });
      e.preventDefault();
    }
  }, [scale]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // 捏合缩放结束
    if (pinchStartDistRef.current !== null) {
      pinchStartDistRef.current = null;
      // 双指松开时如果缩放接近1则重置
      if (Math.abs(scale - 1) < 0.15) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      }
      return;
    }

    // 如果正在拖拽平移，不触发翻页
    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartRef.current = null;
      return;
    }
    panStartRef.current = null;

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
    const maxTime = 800; // 放宽时间限制，适合单手操作

    // 水平滑动翻页
    if (absDx > absDy && absDx > minSwipe && elapsed < maxTime) {
      const swipeLeft = dx < 0;
      if (direction === "ltr") {
        if (swipeLeft) {
          if (currentPage >= pages.length - 1) onBoundaryReached?.("next");
          else goToPage(currentPage + 1, "left");
        } else {
          if (currentPage <= 0) onBoundaryReached?.("prev");
          else goToPage(currentPage - 1, "right");
        }
      } else {
        if (swipeLeft) {
          if (currentPage <= 0) onBoundaryReached?.("prev");
          else goToPage(currentPage - 1, "left");
        } else {
          if (currentPage >= pages.length - 1) onBoundaryReached?.("next");
          else goToPage(currentPage + 1, "right");
        }
      }
      return;
    }

    // 竖向滑动翻页（上滑=下一页，下滑=上一页）
    if (absDy > absDx && absDy > minSwipe && elapsed < maxTime) {
      const swipeUp = dy < 0;
      if (swipeUp) {
        if (currentPage >= pages.length - 1) onBoundaryReached?.("next");
        else goToPage(currentPage + 1, "left");
      } else {
        if (currentPage <= 0) onBoundaryReached?.("prev");
        else goToPage(currentPage - 1, "right");
      }
      return;
    }

    // 轻触（非滑动）- 区域翻页或显示工具栏
    if (absDx < 10 && absDy < 10 && elapsed < 300) {
      // 标记touch已处理，防止后续合成click事件重复翻页
      touchHandledRef.current = true;
      setTimeout(() => { touchHandledRef.current = false; }, 400);

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = (start.x - rect.left) / rect.width;
      if (ratio > 0.3 && ratio < 0.7) {
        onTapCenter();
      } else if (ratio <= 0.3) {
        if (direction === "ltr") {
          if (currentPage <= 0) onBoundaryReached?.("prev");
          else goToPage(currentPage - 1, "right");
        } else {
          if (currentPage >= pages.length - 1) onBoundaryReached?.("next");
          else goToPage(currentPage + 1, "left");
        }
      } else {
        if (direction === "ltr") {
          if (currentPage >= pages.length - 1) onBoundaryReached?.("next");
          else goToPage(currentPage + 1, "left");
        } else {
          if (currentPage <= 0) onBoundaryReached?.("prev");
          else goToPage(currentPage - 1, "right");
        }
      }
    }
  }, [direction, currentPage, pages.length, goToPage, onTapCenter, scale, onBoundaryReached]);

  // 双击缩放（改进：双击位置为缩放中心）+ 延迟单击防止双击冲突
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 如果touch事件已处理过翻页，跳过合成的click事件，防止翻两页
    if (touchHandledRef.current) {
      return;
    }

    const now = Date.now();
    const lastTap = lastTapRef.current;

    // 检测是否为双击（两次点击间隔 < 300ms）
    if (now - lastTap.time < 300) {
      // 取消前一次的延迟单击
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      // 执行双击缩放
      if (scale > 1) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      } else {
        setScale(2);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        setTranslate({
          x: (centerX - clickX) * 1,
          y: (centerY - clickY) * 1,
        });
      }
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      e.preventDefault();
      return;
    }

    // 记录本次点击时间
    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };

    // 缩放模式下不处理点击翻页
    if (scale > 1.1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const ratio = x / width;

    // 延迟执行单击操作，等待双击判定
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      if (ratio > 0.3 && ratio < 0.7) {
        onTapCenter();
        return;
      }

      const isLeftTap = ratio <= 0.3;
      const isRightTap = ratio >= 0.7;

      if (direction === "ltr") {
        if (isLeftTap) {
          if (currentPage <= 0) onBoundaryReached?.("prev");
          else goToPage(currentPage - 1, "right");
        }
        if (isRightTap) {
          if (currentPage >= pages.length - 1) onBoundaryReached?.("next");
          else goToPage(currentPage + 1, "left");
        }
      } else {
        if (isLeftTap) {
          if (currentPage >= pages.length - 1) onBoundaryReached?.("next");
          else goToPage(currentPage + 1, "left");
        }
        if (isRightTap) {
          if (currentPage <= 0) onBoundaryReached?.("prev");
          else goToPage(currentPage - 1, "right");
        }
      }
    }, 250);
  }, [scale, direction, currentPage, pages.length, goToPage, onTapCenter, onBoundaryReached]);

  // 根据 fitMode 计算图片样式
  const getImageClass = () => {
    switch (fitMode) {
      case "width":
        return "w-full h-auto object-contain";
      case "height":
        return "h-full w-auto object-contain";
      case "container":
      default:
        return "max-h-full max-w-full object-contain";
    }
  };

  // 翻页动画 class
  const getSlideAnimClass = () => {
    if (!slideDirection) return "";
    return slideDirection === "left"
      ? "animate-slide-page-left"
      : "animate-slide-page-right";
  };

  return (
    <div
      className={`relative flex h-dvh w-full cursor-pointer items-center justify-center select-none transition-colors duration-300 overflow-hidden ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={`relative h-full flex items-center justify-center ${getSlideAnimClass()}`}
        style={{
          transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
          transition: isPanningRef.current ? "none" : "transform 0.2s ease-out",
          width: containerWidth || "100%",
          maxWidth: "100%",
          margin: "0 auto",
        }}
      >
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`h-8 w-8 animate-spin rounded-full border-2 border-t-accent ${
              readerTheme === "day" ? "border-gray-300" : "border-white/20"
            }`} />
          </div>
        )}
        {imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center px-4">
              <div className={`text-4xl`}>⚠️</div>
              <p className={`text-sm font-medium ${readerTheme === "day" ? "text-gray-600" : "text-white/70"}`}>
                页面加载失败
              </p>
              <p className={`text-xs ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>
                PDF 渲染可能需要安装 mutool 等工具
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); setImageError(false); setImageLoaded(false); }}
                className="mt-1 rounded-lg bg-accent/20 px-4 py-1.5 text-xs text-accent hover:bg-accent/30 transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        )}
        {useRealData ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            ref={imgRef}
            key={currentPage}
            src={pages[currentPage]}
            alt={`Page ${currentPage + 1}`}
            className={`${getImageClass()} transition-opacity duration-200 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
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

      {/* 缩放指示器 */}
      {scale !== 1 && (
        <div className={`absolute top-4 left-4 z-10 rounded-full px-2.5 py-1 text-xs backdrop-blur-sm ${
          readerTheme === "day" ? "bg-white/70 text-gray-500 shadow" : "bg-black/50 text-white/50"
        }`}>
          {Math.round(scale * 100)}%
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 flex">
        <div className="w-[30%]" />
        <div className="w-[40%]" />
        <div className="w-[30%]" />
      </div>
    </div>
  );
}
