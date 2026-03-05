"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";

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

  // Reset loaded state when page changes
  useEffect(() => {
    setImageLoaded(false);
  }, [currentPage]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
      className={`relative flex h-screen w-full cursor-pointer items-center justify-center select-none transition-colors duration-300 ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onClick={handleClick}
    >
      <div className="relative h-full w-full flex items-center justify-center">
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
