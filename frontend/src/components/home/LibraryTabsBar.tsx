"use client";

import { useState, useRef, useEffect, useCallback, type PointerEvent } from "react";
import { Library, Book, BookOpen, Layers, Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { Library as LibraryType } from "@/api/libraries";

interface LibraryTabsBarProps {
  libraries: LibraryType[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const typeIcons: Record<string, typeof Library> = {
  comic: Book,
  novel: BookOpen,
  mixed: Layers,
};

function LibraryChip({
  label,
  count,
  icon: Icon,
  active,
  multiSelected,
  tabId,
  focusable,
  onClick,
}: {
  label: string;
  count: number;
  icon: typeof Library;
  active: boolean;
  multiSelected?: boolean;
  tabId: string;
  focusable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={tabId}
      type="button"
      role="tab"
      aria-selected={active || !!multiSelected}
      aria-controls="library-content-panel"
      tabIndex={focusable ? 0 : -1}
      title={label}
      onClick={onClick}
      className={`inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
        active
          ? "border-accent text-accent"
          : multiSelected
            ? "border-accent/40 text-accent"
            : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {multiSelected && !active && (
        <Check className="h-3.5 w-3.5 shrink-0" />
      )}
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate max-w-[120px]">{label}</span>
      <span className={`text-xs tabular-nums ${active || multiSelected ? "text-accent/80" : "text-muted/70"}`}>
        {count}
      </span>
    </button>
  );
}

export function LibraryTabsBar({
  libraries,
  selectedIds,
  onChange,
}: LibraryTabsBarProps) {
  const [multiMode, setMultiMode] = useState(selectedIds.length > 1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const totalCount = libraries.reduce((sum, l) => sum + (l.comicCount ?? 0), 0);
  const isAll = selectedIds.length === 0;

  const handleAllClick = () => {
    onChange([]);
    if (!multiMode) setMultiMode(false);
  };

  const handleChipClick = (id: string) => {
    if (multiMode) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      onChange(next);
    } else {
      onChange([id]);
    }
  };

  const checkScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setCanScrollLeft(element.scrollLeft > 1);
    setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    checkScroll();
    element.addEventListener("scroll", checkScroll, { passive: true });
    const resizeObserver = new ResizeObserver(checkScroll);
    resizeObserver.observe(element);
    Array.from(element.children).forEach((child) => resizeObserver.observe(child));

    return () => {
      element.removeEventListener("scroll", checkScroll);
      resizeObserver.disconnect();
    };
  }, [checkScroll, libraries]);

  const scrollLibraries = (direction: "left" | "right") => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = Math.max(element.clientWidth * 0.65, 200);
    element.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: "smooth",
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    // 触屏保留浏览器原生滑动；鼠标只在标签溢出时启用拖动。
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
      moved: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.buttons !== 1) {
      handlePointerEnd(event);
      return;
    }
    const distance = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(distance) < 6) return;
      drag.moved = true;
      suppressClickRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (libraries.length === 0) return null;

  return (
    <div className="flex h-11 min-w-0 w-full items-center gap-2">
      <div className="relative min-w-0 flex-1">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollLibraries("left")}
            className="absolute left-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
            aria-label="向左查看更多书库"
            title="向左查看更多书库"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        <div
          ref={scrollRef}
          role="tablist"
          aria-label="我的书库"
          aria-multiselectable={multiMode}
          className={`flex min-w-0 select-none items-center gap-1 overflow-x-auto overscroll-x-contain scrollbar-hide ${
            dragging
              ? "cursor-grabbing [&_button]:cursor-grabbing"
              : canScrollLeft || canScrollRight
                ? "cursor-grab [&_button]:cursor-grab"
                : ""
          }`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            const index = tabs.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next]?.focus();
            tabs[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onPointerLeave={() => {
            if (!dragRef.current?.moved) dragRef.current = null;
          }}
          onClickCapture={(event) => {
            if (suppressClickRef.current && event.detail !== 0) {
              suppressClickRef.current = false;
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <LibraryChip
            label="全部"
            count={totalCount}
            icon={Layers}
            active={isAll}
            tabId="library-tab-all"
            focusable={isAll}
            onClick={handleAllClick}
          />
          {libraries.map((lib) => {
            const Icon = typeIcons[lib.type] ?? Library;
            const selected = selectedIds.includes(lib.id);
            const active = !multiMode && selectedIds.length === 1 && selected;
            return (
              <LibraryChip
                key={lib.id}
                label={lib.name}
                count={lib.comicCount ?? 0}
                icon={Icon}
                active={active}
                multiSelected={multiMode && selected}
                tabId={`library-tab-library-${lib.id}`}
                focusable={selectedIds[0] === lib.id}
                onClick={() => handleChipClick(lib.id)}
              />
            );
          })}
        </div>

        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollLibraries("right")}
            className="absolute right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
            aria-label="向右查看更多书库"
            title="向右查看更多书库"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
      {libraries.length > 1 && (
        <button
          type="button"
          aria-pressed={multiMode}
          onClick={() => {
            setMultiMode(!multiMode);
            if (multiMode && selectedIds.length > 1) onChange([selectedIds[0]]);
          }}
          className={`shrink-0 text-xs px-2 py-1 rounded-md transition-colors ${
            multiMode ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground hover:bg-card-hover"
          }`}
        >
          {multiMode ? "完成" : "多选"}
        </button>
      )}
    </div>
  );
}
