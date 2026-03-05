"use client";

import Image from "next/image";
import { useEffect, useRef, useCallback } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ReaderTheme } from "@/components/reader/ReaderToolbar";

interface WebtoonViewProps {
  pages: string[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTapCenter: () => void;
  useRealData?: boolean;
  readerTheme?: ReaderTheme;
}

export default function WebtoonView({
  pages,
  currentPage,
  onPageChange,
  onTapCenter,
  useRealData,
  readerTheme = "night",
}: WebtoonViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>(undefined);
  const t = useTranslation();

  useEffect(() => {
    if (isScrollingRef.current) return;
    const el = pageRefs.current[currentPage];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [currentPage]);

  const handleScroll = useCallback(() => {
    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 150);

    const container = containerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const viewCenter = scrollTop + viewportHeight / 3;

    for (let i = 0; i < pageRefs.current.length; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (viewCenter >= top && viewCenter < bottom) {
        if (i !== currentPage) {
          onPageChange(i);
        }
        break;
      }
    }
  }, [currentPage, onPageChange]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const ratio = x / width;

    if (ratio > 0.25 && ratio < 0.75) {
      onTapCenter();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`h-screen w-full overflow-y-auto select-none transition-colors duration-300 ${
        readerTheme === "day" ? "bg-gray-100" : "bg-black"
      }`}
      onScroll={handleScroll}
      onClick={handleClick}
    >
      <div className="mx-auto max-w-3xl">
        {pages.map((pageUrl, index) => (
          <div
            key={index}
            ref={(el) => {
              pageRefs.current[index] = el;
            }}
            className="relative w-full"
          >
            {useRealData ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={pageUrl}
                alt={`Page ${index + 1}`}
                className="w-full h-auto"
                loading={Math.abs(index - currentPage) < 5 ? "eager" : "lazy"}
              />
            ) : (
              <div className="relative aspect-[2/3] w-full">
                <Image
                  src={pageUrl}
                  alt={`Page ${index + 1}`}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 768px"
                  loading={Math.abs(index - currentPage) < 5 ? "eager" : "lazy"}
                />
              </div>
            )}
          </div>
        ))}

        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <p className={`text-sm ${readerTheme === "day" ? "text-gray-400" : "text-white/40"}`}>{t.reader.reachedLastPage}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
