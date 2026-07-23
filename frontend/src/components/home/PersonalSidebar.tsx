"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { Shuffle, ChevronRight, BookOpen, Clock, Library, Settings, Database, Play, BarChart3, TrendingUp } from "lucide-react";
import type { ApiComic } from "@/hooks/useComics";
import { calculateStoredReadingProgress } from "@/lib/progress";
import ServerActivityPanel from "@/components/ServerActivityPanel";
import { apiPath } from "@/lib/base-path";

interface PersonalSidebarProps {
  comics: ApiComic[];
  contentType?: string;
  totalItems?: number;
}

function storedProgress(comic: ApiComic): number {
  return calculateStoredReadingProgress(comic.lastReadPage, comic.pageCount, comic.lastReadAt, comic.readingStatus);
}

export default function PersonalSidebar({ comics, contentType, totalItems }: PersonalSidebarProps) {
  const [randomKey, setRandomKey] = useState(0);

  const readable = useMemo(() => comics.filter(c => c.type !== "dir"), [comics]);

  const unreadCount = useMemo(
    () => readable.filter(c => storedProgress(c) === 0).length,
    [readable]
  );

  const readingCount = useMemo(
    () => readable.filter(c => {
      const pct = storedProgress(c);
      return pct > 0 && pct < 100;
    }).length,
    [readable]
  );

  const finishedCount = useMemo(
    () => readable.filter(c => storedProgress(c) === 100).length,
    [readable]
  );

  const continueReading = useMemo(() => {
    return readable
      .filter(c => {
        const pct = storedProgress(c);
        return pct > 0 && pct < 100;
      })
      .slice(0, 3);
  }, [readable]);

  const randomComic = useMemo(() => {
    if (readable.length === 0) return null;
    return readable[Math.floor(Math.random() * readable.length)];
  }, [readable, randomKey]);

  const latestComics = useMemo(() => {
    return [...readable]
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
      .slice(0, 4);
  }, [readable]);

  const handleShuffleRandom = useCallback(() => {
    setRandomKey(k => k + 1);
  }, []);

  if (readable.length === 0) return null;

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-3 pr-1 scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>

        {/* 服务器状态面板 */}
        <ServerActivityPanel />

        {/* 书库统计卡片 */}
        <div className="dashboard-glass p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <BarChart3 className="h-3.5 w-3.5 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">书库概览</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-background/30 p-2.5 text-center border border-white/[0.04]">
              <p className="text-lg font-bold text-foreground tabular-nums">{totalItems || readable.length}</p>
              <p className="text-[10px] text-muted">总内容</p>
            </div>
            <div className="rounded-lg bg-background/30 p-2.5 text-center border border-white/[0.04]">
              <p className="text-lg font-bold text-accent tabular-nums">{readingCount}</p>
              <p className="text-[10px] text-muted">在读</p>
            </div>
            <div className="rounded-lg bg-background/30 p-2.5 text-center border border-white/[0.04]">
              <p className="text-lg font-bold text-emerald-500 tabular-nums">{unreadCount}</p>
              <p className="text-[10px] text-muted">未读</p>
            </div>
            <div className="rounded-lg bg-background/30 p-2.5 text-center border border-white/[0.04]">
              <p className="text-lg font-bold text-purple-400 tabular-nums">{finishedCount}</p>
              <p className="text-[10px] text-muted">已读完</p>
            </div>
          </div>
          {/* 阅读进度条 */}
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted">
              <span>阅读进度</span>
              <span>{readable.length > 0 ? Math.round((finishedCount / readable.length) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-background/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-purple transition-all duration-700"
                style={{ width: `${readable.length > 0 ? (finishedCount / readable.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* 随机盲盒 */}
        <div className="dashboard-glass p-4">
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
            <Link href={`/comic/${randomComic.id}`} className="group flex items-center gap-3 rounded-xl bg-background/30 p-2 transition-all hover:bg-background/50 border border-white/[0.04]">
              <div className="relative w-14 h-20 rounded-lg overflow-hidden shadow-md flex-shrink-0 bg-gradient-to-br from-muted/20 to-card">
                <Image src={randomComic.coverUrl || apiPath("/api/placeholder/112/160")} alt="" fill className="object-contain" sizes="56px" />
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

        {/* 继续阅读 */}
        {continueReading.length > 0 && (
          <div className="dashboard-glass p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Play className="h-3.5 w-3.5 text-accent" />
              <h3 className="text-sm font-semibold text-foreground">继续阅读</h3>
            </div>
            <div className="space-y-2">
              {continueReading.map((comic) => {
                const pct = storedProgress(comic);
                return (
                  <Link key={comic.id} href={`/comic/${comic.id}`} className="group flex items-center gap-2.5 rounded-lg bg-background/30 p-1.5 transition-all hover:bg-background/50 border border-white/[0.04]">
                    <div className="relative w-9 h-[50px] rounded-md overflow-hidden flex-shrink-0 bg-gradient-to-br from-muted/20 to-card shadow-sm">
                      <Image src={comic.coverUrl || apiPath("/api/placeholder/72/100")} alt="" fill className="object-contain" sizes="36px" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground line-clamp-1">{comic.title}</p>
                      <div className="mt-1 h-1 w-full rounded-full bg-background/60 overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <p className="text-[10px] text-muted mt-0.5 tabular-nums">{pct}%</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* 最近入库 */}
        {latestComics.length > 0 && (
          <div className="dashboard-glass p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-sm">🆕</span>
              <h3 className="text-sm font-semibold text-foreground">最近入库</h3>
            </div>
            <div className="space-y-2">
              {latestComics.map((comic) => (
                <Link key={comic.id} href={`/comic/${comic.id}`} className="group flex items-center gap-2.5 rounded-lg bg-background/30 p-1.5 transition-all hover:bg-background/50 border border-white/[0.04]">
                  <div className="relative w-9 h-[50px] rounded-md overflow-hidden flex-shrink-0 bg-gradient-to-br from-muted/20 to-card shadow-sm">
                    <Image src={comic.coverUrl || apiPath("/api/placeholder/72/100")} alt="" fill className="object-contain" sizes="36px" />
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

        {/* 快速操作 */}
        <div className="dashboard-glass p-3">
          <div className="flex items-center gap-2">
            <Link href="/data-qa" className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-background/40 px-3 py-2 text-xs font-medium text-muted hover:text-accent hover:bg-background/60 transition-all border border-white/[0.04]">
              <Database className="h-3.5 w-3.5" />
              巡检
            </Link>
            <Link href="/settings" className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-background/40 px-3 py-2 text-xs font-medium text-muted hover:text-accent hover:bg-background/60 transition-all border border-white/[0.04]">
              <Settings className="h-3.5 w-3.5" />
              设置
            </Link>
          </div>
        </div>

      </div>
    </aside>
  );
}
