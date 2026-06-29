"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { BookOpen, Eye, EyeOff } from "lucide-react";

interface NSFWCoverGuardProps {
  src?: string | null;
  alt: string;
  isNSFW: boolean;
  blurEnabled: boolean;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  unoptimized?: boolean;
  onClick?: () => void;
  onLoad?: () => void;
  onError?: () => void;
}

function DefaultCover({ title, className = "" }: { title: string; className?: string }) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 via-slate-200 to-slate-300 text-slate-500 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950 dark:text-slate-300 ${className}`}
      aria-label={title || "默认封面"}
    >
      <div className="absolute inset-x-4 top-4 h-px bg-white/40 dark:bg-white/10" />
      <div className="absolute inset-y-4 left-4 w-px bg-white/40 dark:bg-white/10" />
      <div className="absolute -right-8 -top-10 h-24 w-24 rounded-full bg-white/40 blur-2xl dark:bg-white/10" />
      <div className="absolute -bottom-12 -left-10 h-28 w-28 rounded-full bg-accent/20 blur-3xl" />

      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/50 bg-white/45 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
        <BookOpen className="h-7 w-7 text-accent/80" strokeWidth={1.8} />
      </div>
      <div className="relative mt-4 px-4 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
          No Cover
        </p>
        {title && (
          <p className="mt-2 line-clamp-2 text-xs font-semibold leading-snug text-slate-600 dark:text-slate-200">
            {title}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * NSFW 封面保护组件
 * 当隐私模式开启且内容为 NSFW 时模糊封面，支持临时显示
 * 图片为空或加载失败时显示默认封面，避免小说/ZIP 无封面时出现破图
 */
export default function NSFWCoverGuard({
  src,
  alt,
  isNSFW,
  blurEnabled,
  fill = false,
  width,
  height,
  sizes,
  className = "",
  unoptimized = false,
  onClick,
  onLoad,
  onError,
}: NSFWCoverGuardProps) {
  const [revealed, setRevealed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reportedFallbackLoad, setReportedFallbackLoad] = useState(false);
  const safeSrc = typeof src === "string" ? src.trim() : "";
  const hasValidSrc = safeSrc.length > 0;
  const showFallback = !hasValidSrc || loadFailed;
  const shouldBlur = isNSFW && blurEnabled && !revealed;

  useEffect(() => {
    setLoadFailed(false);
    setRevealed(false);
    setReportedFallbackLoad(false);
  }, [safeSrc]);

  useEffect(() => {
    if (!hasValidSrc && !reportedFallbackLoad) {
      onLoad?.();
      setReportedFallbackLoad(true);
    }
  }, [hasValidSrc, onLoad, reportedFallbackLoad]);

  const imgProps = fill
    ? { fill: true, sizes: sizes || "200px" }
    : { width: width || 200, height: height || 280 };

  return (
    <div className="relative w-full h-full group" onClick={shouldBlur ? (e) => { e.preventDefault(); e.stopPropagation(); } : onClick}>
      {showFallback ? (
        <DefaultCover
          title={alt}
          className={`${shouldBlur ? "blur-xl scale-110" : ""} transition-all duration-300`}
        />
      ) : (
        <Image
          src={safeSrc}
          alt={shouldBlur ? "" : alt}
          unoptimized={unoptimized}
          className={`${className} ${shouldBlur ? "blur-xl scale-110" : ""} transition-all duration-300`}
          onLoad={onLoad}
          onError={() => {
            setLoadFailed(true);
            onError?.();
          }}
          {...imgProps}
        />
      )}

      {/* 模糊遮罩 */}
      {shouldBlur && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-10">
          <EyeOff className="h-6 w-6 text-white/60 mb-1.5" />
          <p className="text-[10px] text-white/70 font-medium">已隐藏成人内容</p>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setRevealed(true);
            }}
            className="mt-2 flex items-center gap-1 rounded-lg bg-white/15 backdrop-blur-sm px-3 py-1.5 text-[10px] font-medium text-white/80 hover:bg-white/25 transition-colors border border-white/10"
          >
            <Eye className="h-3 w-3" />
            显示封面
          </button>
        </div>
      )}
    </div>
  );
}
