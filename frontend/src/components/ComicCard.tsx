"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, useState } from "react";
import { Comic } from "@/types/comic";
import { BookOpen, Heart, Star, Info, GripVertical } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { ApiComicTag } from "@/hooks/useComicTypes";

// Check if file is a novel type based on filename extension
function isNovelFile(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.toLowerCase();
  return ext.endsWith(".txt") || ext.endsWith(".epub") || ext.endsWith(".mobi") || ext.endsWith(".azw3") || ext.endsWith(".html") || ext.endsWith(".htm");
}

function getReaderUrl(comic: Comic): string {
  return isNovelFile(comic.filename)
    ? `/novel/${comic.id}`
    : `/reader/${comic.id}`;
}

const tagStyleMap: Record<string, string> = {
  Action: "tag-action",
  Romance: "tag-romance",
  Comedy: "tag-comedy",
  Fantasy: "tag-fantasy",
  Horror: "tag-horror",
  "Sci-Fi": "tag-sci-fi",
  Drama: "tag-drama",
  "Slice of Life": "tag-slice-of-life",
  Adventure: "tag-adventure",
  Mystery: "tag-mystery",
};

/** 从DB color字段生成内联样式，fallback到预设CSS类 */
function getTagStyle(tag: string | ApiComicTag): { className?: string; style?: React.CSSProperties } {
  const name = typeof tag === "string" ? tag : tag.name;
  const color = typeof tag === "string" ? "" : (tag.color || "");

  // 如果DB中设置了自定义颜色（hex格式），使用内联样式
  if (color && color.startsWith("#")) {
    return {
      style: {
        background: `${color}26`, // 15% opacity
        color: color,
      },
    };
  }

  // fallback: 预设映射 → 默认灰色
  const cls = tagStyleMap[name] || "tag-default";
  return { className: cls };
}

interface ComicCardProps {
  comic: Comic;
  onClick?: (comic: Comic) => void;
  isReal?: boolean;
  viewMode?: "grid" | "list";
  batchMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string) => void;
  onDragEnd?: () => void;
  isDragOver?: boolean;
  /** 标记此卡片是否正在被拖拽 */
  isDragging?: boolean;
  /** 带颜色的原始标签数据 */
  tagData?: ApiComicTag[];
  /** 右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent, comic: Comic) => void;
  /** 交错入场动画索引，不传则不启用 */
  animationIndex?: number;
  /** 删除动画：设为 true 时播放收缩消失动画 */
  isRemoving?: boolean;
}

/** 渲染标签chip */
function TagChip({ tag, tagObj }: { tag: string; tagObj?: ApiComicTag }) {
  const source = tagObj || tag;
  const { className, style } = getTagStyle(source);
  const name = typeof source === "string" ? source : source.name;
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-medium ${className || ""}`}
      style={style}
    >
      {name}
    </span>
  );
}

const ComicCard = memo(function ComicCard({
  comic,
  onClick,
  isReal,
  viewMode = "grid",
  batchMode,
  isSelected,
  onSelect,
  draggable,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragOver,
  isDragging,
  tagData,
  onContextMenu,
  animationIndex,
  isRemoving,
}: ComicCardProps) {

  // 构建 tag name → ApiComicTag 的映射
  const tagMap = new Map<string, ApiComicTag>();
  if (tagData) {
    for (const t of tagData) {
      tagMap.set(t.name, t);
    }
  }
  const t = useTranslation();
  const [coverLoaded, setCoverLoaded] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (batchMode) {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.(comic.id);
    }
    onClick?.(comic);
  };

  // 通用右键处理
  const handleContextMenu = (e: React.MouseEvent) => {
    if (batchMode || !onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, comic);
  };

  if (viewMode === "list") {
    return (
      <div
        className={`group relative block overflow-hidden ${isDragOver ? "drag-over-target" : ""} ${isDragging ? "drag-active" : ""} ${animationIndex !== undefined ? "animate-card-in" : ""} ${isRemoving ? "animate-item-remove" : ""}`}
        style={animationIndex !== undefined ? { animationDelay: `${animationIndex * 40}ms` } : undefined}
        draggable={draggable}
        onContextMenu={handleContextMenu}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart?.(comic.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver?.(comic.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDragEnd?.();
        }}
      >
        {batchMode ? (
          <div
            onClick={handleClick}
            className={`flex cursor-pointer items-center gap-3 sm:gap-4 rounded-xl p-2.5 sm:p-3 transition-all duration-200 ${
              isSelected
                ? "bg-accent/15 ring-1 ring-accent/50"
                : "bg-card hover:bg-card-hover"
            }`}
          >
            {/* Checkbox */}
            <div
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all ${
                isSelected
                  ? "border-accent bg-accent"
                  : "border-muted/40"
              }`}
            >
              {isSelected && (
                <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>

            {/* Thumbnail */}
            <div className="relative h-20 w-14 sm:h-16 sm:w-12 flex-shrink-0 overflow-hidden rounded-lg">
              <Image src={comic.coverUrl} alt={comic.title} fill unoptimized={isReal} className="object-cover" sizes="56px" />
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-medium text-foreground/90">{comic.title}</h3>
              <div className="mt-1 flex items-center gap-2">
                {comic.rating && comic.rating > 0 && (
                  <div className="flex items-center gap-0.5">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span className="text-[10px] text-amber-400">{comic.rating}</span>
                  </div>
                )}
              </div>
            </div>

            {comic.progress !== undefined && comic.progress > 0 && (
              <div className="flex-shrink-0 text-xs text-muted">{Math.round(comic.progress)}%</div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {draggable && (
              <div className="flex-shrink-0 cursor-grab text-muted/40 hover:text-muted active:cursor-grabbing">
                <GripVertical className="h-4 w-4" />
              </div>
            )}
            <Link
              href={getReaderUrl(comic)}
              className="flex flex-1 items-center gap-3 sm:gap-4 rounded-xl bg-card p-2.5 sm:p-3 transition-all duration-200 group-hover:bg-card-hover group-hover:shadow-lg group-hover:shadow-accent/5"
            >
              {/* Thumbnail */}
              <div className="relative h-20 w-14 sm:h-16 sm:w-12 flex-shrink-0 overflow-hidden rounded-lg">
                <Image src={comic.coverUrl} alt={comic.title} fill unoptimized={isReal} className="object-cover" sizes="56px" />
                {comic.isFavorite && (
                  <div className="absolute top-0.5 right-0.5 z-10">
                    <Heart className="h-3 w-3 fill-rose-500 text-rose-500" />
                  </div>
                )}
                {/* 阅读进度条（移动端） */}
                {comic.progress !== undefined && comic.progress > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40 sm:hidden">
                    <div className="h-full bg-accent" style={{ width: `${comic.progress}%` }} />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">{comic.title}</h3>
                {/* 作者（如果有） */}
                {comic.author && (
                  <p className="mt-0.5 truncate text-[11px] text-muted/60 sm:hidden">{comic.author}</p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  {comic.rating && comic.rating > 0 && (
                    <div className="flex items-center gap-0.5">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <span className="text-[10px] text-amber-400">{comic.rating}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {(comic.tags || []).slice(0, 2).map((tag) => (
                      <TagChip key={tag} tag={tag} tagObj={tagMap.get(tag)} />
                    ))}
                    {(comic.tags || []).length > 2 && (
                      <span className="inline-block rounded-md bg-muted/10 px-1.5 py-0.5 text-[10px] text-muted sm:hidden">
                        +{(comic.tags || []).length - 2}
                      </span>
                    )}
                    {/* 桌面端多显示一个标签 */}
                    {(comic.tags || []).length > 2 && (
                      <span className="hidden sm:inline-block">
                        <TagChip tag={(comic.tags || [])[2]} tagObj={tagMap.get((comic.tags || [])[2])} />
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress (桌面端数字显示) */}
              {comic.progress !== undefined && comic.progress > 0 && (
                <div className="hidden sm:block flex-shrink-0 text-xs text-muted">{Math.round(comic.progress)}%</div>
              )}

              <BookOpen className="h-4 w-4 flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 hidden sm:block" />
            </Link>

            {/* Detail link — 移动端始终显示 */}
            {isReal && (
              <Link
                href={`/comic/${comic.id}`}
                className="flex-shrink-0 rounded-lg p-2 text-muted/60 sm:text-muted/40 transition-colors hover:bg-card hover:text-muted"
                title={t.comicCard.detail}
                onClick={(e) => e.stopPropagation()}
              >
                <Info className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  // Grid view
  return (
    <div
      className={`group relative ${isDragOver ? "drag-over-target" : ""} ${isDragging ? "drag-active" : ""} ${animationIndex !== undefined ? "animate-card-in" : ""} ${isRemoving ? "animate-item-remove" : ""}`}
      style={animationIndex !== undefined ? { animationDelay: `${animationIndex * 40}ms` } : undefined}
      draggable={draggable}
      onContextMenu={handleContextMenu}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(comic.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver?.(comic.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDragEnd?.();
      }}
    >
      {batchMode ? (
        <div onClick={handleClick} className="cursor-pointer">
          {/* Batch Selection Overlay */}
          <div
            className={`relative overflow-hidden rounded-xl bg-card transition-all duration-300 ease-out ${
              isSelected ? "ring-2 ring-accent scale-[0.97]" : "hover:scale-[1.03]"
            }`}
          >
            {/* Checkbox */}
            <div className="absolute top-2 left-2 z-20">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-all ${
                  isSelected
                    ? "border-accent bg-accent shadow-lg shadow-accent/30"
                    : "border-white/40 bg-black/30 backdrop-blur-sm"
                }`}
              >
                {isSelected && (
                  <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>

            <div className="relative aspect-[5/7] w-full overflow-hidden">
              <Image src={comic.coverUrl} alt={comic.title} fill unoptimized={isReal} className="object-cover" sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw" />
              {comic.progress !== undefined && comic.progress > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                  <div className="h-full bg-accent transition-all duration-300" style={{ width: `${comic.progress}%` }} />
                </div>
              )}
            </div>
            <div className="p-3">
              <h3 className="mb-2 truncate text-sm font-medium text-foreground/90">{comic.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                {(comic.tags || []).slice(0, 3).map((tag) => (
                  <TagChip key={tag} tag={tag} tagObj={tagMap.get(tag)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Drag handle overlay */}
          {draggable && (
            <div className="absolute top-2 left-2 z-20 cursor-grab rounded-md bg-black/40 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 active:cursor-grabbing">
              <GripVertical className="h-4 w-4 text-white/70" />
            </div>
          )}

          <Link
            href={getReaderUrl(comic)}
            className="block"
            onClick={() => onClick?.(comic)}
          >
            <div className="relative overflow-hidden rounded-xl bg-card transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:shadow-accent/10">
              {/* Cover Image */}
              <div className="relative aspect-[5/7] w-full overflow-hidden">
                {/* 骨架屏加载占位 */}
                {!coverLoaded && (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-muted/30 to-muted/10" />
                )}
                <Image
                  src={comic.coverUrl}
                  alt={comic.title}
                  fill
                  unoptimized={isReal}
                  className={`object-cover transition-all duration-500 group-hover:scale-110 ${
                    coverLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  onLoad={() => setCoverLoaded(true)}
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {comic.isFavorite && (
                  <div className="absolute top-2 right-2 z-10">
                    <Heart className="h-4 w-4 fill-rose-500 text-rose-500 drop-shadow-lg" />
                  </div>
                )}

                {comic.rating && comic.rating > 0 && (
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span className="text-[10px] font-medium text-amber-400">{comic.rating}</span>
                  </div>
                )}


                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/90 shadow-lg shadow-accent/30 backdrop-blur-sm transition-transform duration-300 group-hover:scale-100 scale-75">
                    <BookOpen className="h-6 w-6 text-white" />
                  </div>
                </div>

                {comic.progress !== undefined && comic.progress > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                    <div className="h-full bg-accent transition-all duration-300" style={{ width: `${comic.progress}%` }} />
                  </div>
                )}
              </div>

              <div className="p-3">
                <h3 className="mb-2 truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">{comic.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {(comic.tags || []).slice(0, 3).map((tag) => (
                    <TagChip key={tag} tag={tag} tagObj={tagMap.get(tag)} />
                  ))}
                </div>
              </div>
            </div>
          </Link>

          {/* Detail button (grid) */}
          {isReal && (
            <Link
              href={`/comic/${comic.id}`}
              className="absolute top-2 right-2 z-20 rounded-lg bg-black/40 p-1.5 text-white/60 opacity-0 backdrop-blur-sm transition-all hover:text-white group-hover:opacity-100"
              title={t.comicCard.detail}
              onClick={(e) => e.stopPropagation()}
            >
              <Info className="h-3.5 w-3.5" />
            </Link>
          )}
        </>
      )}
    </div>
  );
});

export default ComicCard;
