"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { Shuffle, ChevronRight, BookOpen, Clock, Sparkles, Library } from "lucide-react";
import type { ApiComic } from "@/hooks/useComics";
import { calculateReadingProgress } from "@/lib/progress";

interface PersonalSidebarProps {
  comics: ApiComic[];
  contentType: string;
  totalItems?: number;
}

export default function PersonalSidebar({ comics, contentType, totalItems }: PersonalSidebarProps) {
  const [randomKey, setRandomKey] = useState(0);

  const readable = useMemo(() => comics.filter(c => c.type !== "dir"), [comics]);

  const unreadCount = useMemo(
    () => readable.filter(c => calculateReadingProgress(c.lastReadPage, c.pageCount) === 0).length,
    [readable]
  );

  const readingCount = useMemo(
    () => readable.filter(c => {
      const pct = calculateReadingProgress(c.lastReadPage, c.pageCount);
      return pct > 0 && pct < 100;
    }).length,
    [readable]
  );

  const randomComic = useMemo(() => {
    if (readable.length === 0) return null;
    return readable[Math.floor(Math.random() * readable.length)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readable, randomKey]);

  const latestComics = useMemo(() => {
    return [...readable]
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
      .slice(0, 4);
  }, [readable]);

  const unreadCovers = useMemo(() => {
    return readable
      .filter(c => calculateReadingProgress(c.lastReadPage, c.pageCount) === 0)
      .slice(0, 4);
  }, [readable]);

  const handleShuffleRandom = useCallback(() => {
    setRandomKey(k => k + 1);
  }, []);

  if (readable.length === 0) return null;

  return (
    <aside className="hidden xl:block space-y-3 sticky top-20 self-start">
      {/* Random pick */}
      <div className="rounded-2xl border border-border/30 bg-card/70 backdrop-blur-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🎲</span>
            <h3 className="text-sm font-semibold text-foreground">随机盲盒</h3>
          </div>
          <button
            onClick={handleShuffleRandom}
            className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors"
          >
            <Shuffle className="h-3 w-3" /> 换一个
          </button>
        </div>
        {randomComic && (
          <Link href={`/comic/${randomComic.id}`} className="group flex items-center gap-3 rounded-xl bg-background/40 p-2 transition-all hover:bg-background/60">
            <div className="relative w-14 h-20 rounded-lg overflow-hidden shadow-md flex-shrink-0 bg-gradient-to-br from-muted/20 to-card">
              <Image src={randomComic.coverUrl || "/api/placeholder/112/160"} alt="" fill className="object-contain" sizes="56px" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground line-clamp-2">{randomComic.title}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {randomComic.pageCount ? `${randomComic.pageCount} 页` : ""}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
        )}
      </div>

      {/* Unread treasures */}
      {unreadCovers.length > 0 && (
        <div className="rounded-2xl border border-border/30 bg-card/70 backdrop-blur-xl p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm">📚</span>
            <h3 className="text-sm font-semibold text-foreground">未读宝藏</h3>
            <span className="ml-auto text-[11px] text-muted">{unreadCount} 本</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {unreadCovers.map((comic) => (
              <Link key={comic.id} href={`/comic/${comic.id}`} className="group">
                <div className="relative aspect-[5/7] rounded-lg overflow-hidden bg-gradient-to-br from-muted/20 to-card shadow-sm transition-transform group-hover:scale-105">
                  <Image src={comic.coverUrl || "/api/placeholder/80/112"} alt="" fill className="object-contain" sizes="60px" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Latest arrivals */}
      {latestComics.length > 0 && (
        <div className="rounded-2xl border border-border/30 bg-card/70 backdrop-blur-xl p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm">🆕</span>
            <h3 className="text-sm font-semibold text-foreground">最近入库</h3>
          </div>
          <div className="space-y-2">
            {latestComics.map((comic) => (
              <Link key={comic.id} href={`/comic/${comic.id}`} className="group flex items-center gap-2.5 rounded-lg bg-background/30 p-1.5 transition-all hover:bg-background/50">
                <div className="relative w-9 h-[50px] rounded-md overflow-hidden flex-shrink-0 bg-gradient-to-br from-muted/20 to-card shadow-sm">
                  <Image src={comic.coverUrl || "/api/placeholder/72/100"} alt="" fill className="object-contain" sizes="36px" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground line-clamp-1">{comic.title}</p>
                  <p className="text-[10px] text-muted">{comic.pageCount ? `${comic.pageCount} 页` : ""}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Library stats */}
      <div className="rounded-2xl border border-border/30 bg-card/70 backdrop-blur-xl p-4 shadow-sm">
        <div className="flex items-center gap-1.5 mb-3">
          <Library className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-foreground">书库状态</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-lg font-bold text-foreground">{totalItems || readable.length}</p>
            <p className="text-[10px] text-muted">总内容</p>
          </div>
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-lg font-bold text-accent">{readingCount}</p>
            <p className="text-[10px] text-muted">在读</p>
          </div>
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-lg font-bold text-emerald-500">{unreadCount}</p>
            <p className="text-[10px] text-muted">未读</p>
          </div>
          <div className="rounded-lg bg-background/40 p-2 text-center">
            <p className="text-lg font-bold text-foreground">{contentType === "novel" ? "小说" : "漫画"}</p>
            <p className="text-[10px] text-muted">当前类型</p>
          </div>
        </div>
      </div>
    </aside>
  );
}