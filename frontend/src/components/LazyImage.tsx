"use client";

import { useState, useCallback, ImgHTMLAttributes } from "react";

interface LazyImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "onLoad" | "onError"> {
  /** 加载完成回调 */
  onLoaded?: () => void;
  /** 是否启用模糊渐清效果，默认 true */
  blurEffect?: boolean;
  /** 骨架屏的额外 class */
  skeletonClassName?: string;
  /** 容器的额外 class */
  wrapperClassName?: string;
}

/**
 * 统一的懒加载图片组件
 * - 加载前显示 shimmer 骨架屏
 * - 加载完成后模糊渐清过渡
 * - 加载失败显示占位
 */
export default function LazyImage({
  blurEffect = true,
  skeletonClassName = "",
  wrapperClassName = "",
  onLoaded,
  className = "",
  alt = "",
  ...imgProps
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    onLoaded?.();
  }, [onLoaded]);

  const handleError = useCallback(() => {
    setError(true);
    setLoaded(true);
  }, []);

  return (
    <div className={`relative overflow-hidden ${wrapperClassName}`}>
      {/* 骨架屏占位 */}
      {!loaded && (
        <div className={`absolute inset-0 skeleton-shimmer ${skeletonClassName}`} />
      )}

      {/* 加载失败占位 */}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-card">
          <svg className="h-8 w-8 text-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
        </div>
      ) : (
        <img
          {...imgProps}
          alt={alt}
          className={`${className} transition-all duration-500 ${
            blurEffect
              ? loaded
                ? "opacity-100 blur-0 scale-100"
                : "opacity-0 blur-sm scale-[1.02]"
              : loaded
                ? "opacity-100"
                : "opacity-0"
          }`}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  );
}
