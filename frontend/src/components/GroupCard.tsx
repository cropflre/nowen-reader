"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, useState } from "react";
import { Layers, BookOpen } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { ComicGroup } from "@/hooks/useComicTypes";

interface GroupCardProps {
  group: ComicGroup;
  viewMode?: "grid" | "list";
  batchMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: number) => void;
  /** 右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent, group: ComicGroup) => void;
  /** 交错入场动画索引 */
  animationIndex?: number;
  /** 删除动画 */
  isRemoving?: boolean;
}

const GroupCard = memo(function GroupCard({
  group,
  viewMode = "grid",
  batchMode,
  isSelected,
  onSelect,
  onContextMenu,
  animationIndex,
  isRemoving,
}: GroupCardProps) {
  const t = useTranslation();
  const [coverLoaded, setCoverLoaded] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (batchMode) {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.(group.id);
    }
  };

  // 通用右键处理
  const handleContextMenu = (e: React.MouseEvent) => {
    if (batchMode || !onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, group);
  };

  // 列表模式
  if (viewMode === "list") {
    return (
      <div
        className={`group relative block ${animationIndex !== undefined ? "animate-card-in" : ""} ${isRemoving ? "animate-item-remove" : ""}`}
        style={animationIndex !== undefined ? { animationDelay: `${animationIndex * 40}ms` } : undefined}
        onContextMenu={handleContextMenu}
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
            <div className="relative h-20 w-14 sm:h-16 sm:w-12 flex-shrink-0 overflow-hidden rounded-lg">
              {group.coverUrl ? (
                <Image
                  src={group.coverUrl}
                  alt={group.name}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="56px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-accent/10">
                  <Layers className="h-5 w-5 text-accent" />
                </div>
              )}
              {/* 分组角标 */}
              <div className="absolute bottom-0 right-0 rounded-tl-md bg-accent px-1 py-0.5 text-[8px] font-bold text-white">
                {group.comicCount}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-medium text-foreground/90">
                  {group.name}
                </h3>
                <span className="flex-shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {group.comicCount} {t.comicGroup?.volumes || "卷"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <Link
            href={`/group/${group.id}`}
            className="flex flex-1 items-center gap-3 sm:gap-4 rounded-xl bg-card p-2.5 sm:p-3 transition-all duration-200 group-hover:bg-card-hover group-hover:shadow-lg group-hover:shadow-accent/5"
          >
            <div className="relative h-20 w-14 sm:h-16 sm:w-12 flex-shrink-0 overflow-hidden rounded-lg">
              {group.coverUrl ? (
                <Image
                  src={group.coverUrl}
                  alt={group.name}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="56px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-accent/10">
                  <Layers className="h-5 w-5 text-accent" />
                </div>
              )}
              <div className="absolute bottom-0 right-0 rounded-tl-md bg-accent px-1 py-0.5 text-[8px] font-bold text-white">
                {group.comicCount}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
                  {group.name}
                </h3>
                <span className="flex-shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {group.comicCount} {t.comicGroup?.volumes || "卷"}
                </span>
              </div>
            </div>
            <BookOpen className="h-4 w-4 flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 hidden sm:block" />
          </Link>
        )}
      </div>
    );
  }

  // 网格模式
  return (
    <div
      className={`group relative ${animationIndex !== undefined ? "animate-card-in" : ""} ${isRemoving ? "animate-item-remove" : ""}`}
      style={animationIndex !== undefined ? { animationDelay: `${animationIndex * 40}ms` } : undefined}
      onContextMenu={handleContextMenu}
    >
      {batchMode ? (
        <div onClick={handleClick} className="cursor-pointer">
          <div
            className={`relative overflow-hidden rounded-xl bg-card transition-all duration-300 ease-out ${
              isSelected
                ? "ring-2 ring-accent scale-[0.97]"
                : "hover:scale-[1.03]"
            }`}
          >
            <div className="relative aspect-[5/7] w-full overflow-hidden">
              {group.coverUrl ? (
                <Image
                  src={group.coverUrl}
                  alt={group.name}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/20 to-accent/5">
                  <Layers className="h-12 w-12 text-accent/40" />
                </div>
              )}
              {/* 分组标识覆盖层 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-white shadow-lg">
                  📚 {group.comicCount} {t.comicGroup?.volumes || "卷"}
                </span>
              </div>
            </div>
            <div className="p-3">
              <h3 className="mb-1 truncate text-sm font-medium text-foreground/90">
                {group.name}
              </h3>
              <p className="text-[10px] text-muted">
                {t.comicGroup?.groups || "分组"}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <Link href={`/group/${group.id}`} className="block">
          <div className="relative overflow-hidden rounded-xl bg-card transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:shadow-accent/10">
            <div className="relative aspect-[5/7] w-full overflow-hidden">
              {/* 骨架屏 */}
              {!coverLoaded && group.coverUrl && (
                <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-muted/30 to-muted/10" />
              )}
              {group.coverUrl ? (
                <Image
                  src={group.coverUrl}
                  alt={group.name}
                  fill
                  unoptimized
                  className={`object-cover transition-all duration-500 group-hover:scale-110 ${
                    coverLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  onLoad={() => setCoverLoaded(true)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/20 to-accent/5">
                  <Layers className="h-12 w-12 text-accent/40" />
                </div>
              )}
              {/* 渐变 + 分组标识 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80 transition-opacity group-hover:opacity-100" />
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-white shadow-lg">
                  📚 {group.comicCount} {t.comicGroup?.volumes || "卷"}
                </span>
              </div>
              {/* Hover overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                <div className="flex h-14 w-14 scale-75 items-center justify-center rounded-full bg-accent/90 shadow-lg shadow-accent/30 backdrop-blur-sm transition-transform duration-300 group-hover:scale-100">
                  <Layers className="h-6 w-6 text-white" />
                </div>
              </div>
            </div>
            <div className="p-3">
              <h3 className="mb-1 truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
                {group.name}
              </h3>
              <p className="text-[10px] text-muted">
                {t.comicGroup?.groups || "分组"}
              </p>
            </div>
          </div>
        </Link>
      )}
    </div>
  );
});

export default GroupCard;
