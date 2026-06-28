"use client";

import { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";

interface NSFWCoverGuardProps {
  src: string;
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

/**
 * NSFW 封面保护组件
 * 当隐私模式开启且内容为 NSFW 时模糊封面，支持临时显示
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
  const shouldBlur = isNSFW && blurEnabled && !revealed;

  const imgProps = fill
    ? { fill: true, sizes: sizes || "200px" }
    : { width: width || 200, height: height || 280 };

  return (
    <div className="relative w-full h-full group" onClick={shouldBlur ? (e) => { e.preventDefault(); e.stopPropagation(); } : onClick}>
      <Image
        src={src}
        alt={shouldBlur ? "" : alt}
        unoptimized={unoptimized}
        className={`${className} ${shouldBlur ? "blur-xl scale-110" : ""} transition-all duration-300`}
        onLoad={onLoad}
        onError={onError}
        {...imgProps}
      />

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
