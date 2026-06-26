"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronRight,
  Upload,
  Layers,
  ArrowRight,
  Shuffle,
  BookOpen,
} from "lucide-react";
import DesktopSidebar from "@/components/DesktopSidebar";
import DashboardTopBar from "@/components/DashboardTopBar";
import { ContinueReading } from "@/components/ContinueReading";
import ServerActivityPanel from "@/components/ServerActivityPanel";
import UploadDialog from "@/components/UploadDialog";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { useComics, ApiComic } from "@/hooks/useComics";
import { calculateReadingProgress } from "@/lib/progress";

/**
 * Dashboard 首页 — 私人漫画库 NAS 媒体库仪表盘
 * 左侧 Sidebar + 顶部 TopBar + 主内容（Continue Reading Hero + Recently Added 精选）+ 右侧状态面板
 */
export default function Home() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanningLibrary, setScanningLibrary] = useState(false);

  // 获取最近添加（精选 6 本）
  const { comics: recentComics, refetch } = useComics({
    page: 1,
    pageSize: 6,
    sortBy: "addedAt",
    sortOrder: "desc",
  });

  const handleScanLibrary = useCallback(async () => {
    setScanningLibrary(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      await new Promise((r) => setTimeout(r, 2000));
      await refetch();
    } catch { /* */ } finally {
      setScanningLibrary(false);
    }
  }, [refetch]);

  return (
    <div className="min-h-screen bg-[#070A0F] overflow-x-hidden">
      {/* 背景氛围渐变 — 蓝紫光晕 */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at 25% 5%, rgba(59,130,246,0.14) 0%, transparent 100%),
            radial-gradient(ellipse 50% 40% at 80% 12%, rgba(139,92,246,0.10) 0%, transparent 100%),
            radial-gradient(ellipse 80% 60% at 50% 50%, rgba(59,130,246,0.04) 0%, transparent 100%)
          `,
        }}
      />

      <DesktopSidebar />

      <div className="lg:ml-[220px] xl:ml-[240px] relative z-10">
        <DashboardTopBar
          onUpload={() => setUploadDialogOpen(true)}
          uploading={uploading}
          onScanLibrary={handleScanLibrary}
          scanning={scanningLibrary}
        />

        <div className="flex min-h-[calc(100vh-4rem)]">
          {/* ═══ 主内容区 ═══ */}
          <main className="flex-1 min-w-0">

            {/* ── Continue Reading Hero ── */}
            <section className="px-5 sm:px-8 lg:px-10 pt-6 sm:pt-8 pb-2">
              <div className="flex items-end justify-between mb-4">
                <div>
                  <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold text-foreground tracking-tight leading-tight">
                    Continue Reading
                  </h2>
                  <p className="text-sm text-muted mt-1.5">
                    继续上次的阅读
                  </p>
                </div>
                <Link
                  href="/books"
                  className="hidden sm:flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover transition-colors group"
                >
                  全部书库
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
              <ContinueReading showTitle={false} />
            </section>

            {/* ── Recently Added 精选 ── */}
            <section className="px-5 sm:px-8 lg:px-10 py-6">
              <div className="flex items-end justify-between mb-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">
                    Recently Added
                  </h2>
                </div>
                <Link
                  href="/books?sortBy=addedAt&sortOrder=desc"
                  className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors group"
                >
                  查看全部
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>

              {recentComics.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {recentComics.map((comic) => {
                    const href = comic.type === "novel" ? `/novel/${comic.id}` : `/reader/${comic.id}`;
                    const progress = comic.pageCount > 0
                      ? calculateReadingProgress(comic.lastReadPage, comic.pageCount)
                      : 0;

                    return (
                      <Link key={comic.id} href={href} className="group block">
                        <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl bg-card/50 backdrop-blur-sm border border-white/[0.05] cover-glow">
                          <Image
                            src={comic.coverUrl}
                            alt={comic.title}
                            fill
                            unoptimized
                            className="object-cover transition-transform duration-500 group-hover:scale-110"
                            sizes="(max-width: 640px) 33vw, 16vw"
                          />
                          {progress > 0 && (
                            <div className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
                              <span className="text-[8px] font-bold text-white tabular-nums">{progress}%</span>
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-2 pt-8">
                            <p className="text-[11px] font-medium text-white/90 line-clamp-1 drop-shadow">
                              {comic.title}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="dashboard-glass rounded-2xl p-8 text-center">
                  <p className="text-muted text-sm">暂无最近添加的内容</p>
                  {isAdmin && (
                    <button
                      onClick={() => setUploadDialogOpen(true)}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      上传文件
                    </button>
                  )}
                </div>
              )}
            </section>

            {/* 移动端：进入全部书库 */}
            <div className="px-5 pb-8 sm:hidden">
              <Link
                href="/books"
                className="flex items-center justify-center gap-2 rounded-xl bg-accent/10 border border-accent/20 px-4 py-3 text-sm font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                <Layers className="h-4 w-4" />
                进入全部书库
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </main>

          {/* ═══ 右侧面板 — 桌面端 ═══ */}
          <aside className="hidden xl:block w-[300px] 2xl:w-[340px] shrink-0 border-l border-white/[0.04] bg-[#0B0F17]/40">
            <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-6 px-4 space-y-4 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
              <ServerActivityPanel />
              <LibraryOverviewCard />
              <RandomPickCard />
            </div>
          </aside>
        </div>
      </div>

      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onUploaded={async () => { await refetch(); }}
      />
    </div>
  );
}

/** 书库概览卡片 */
function LibraryOverviewCard() {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    fetch("/api/comics?pageSize=1&page=1", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setTotal(d.total || 0))
      .catch(() => {});
  }, []);

  return (
    <div className="dashboard-glass p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Layers className="h-3.5 w-3.5 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">书库概览</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-background/30 p-3 text-center border border-white/[0.04]">
          <p className="text-2xl font-bold text-foreground tabular-nums">{total || "—"}</p>
          <p className="text-[10px] text-muted mt-0.5">总内容</p>
        </div>
        <div className="rounded-lg bg-background/30 p-3 text-center border border-white/[0.04]">
          <p className="text-2xl font-bold text-emerald-500 tabular-nums">—</p>
          <p className="text-[10px] text-muted mt-0.5">未读</p>
        </div>
      </div>
      <Link
        href="/books"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
      >
        浏览全部书库
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

/** 随机盲盒卡片 */
function RandomPickCard() {
  const [comic, setComic] = useState<ApiComic | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    fetch("/api/comics?pageSize=50&page=1&sortBy=random", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const comics = d.comics || [];
        if (comics.length > 0) {
          setComic(comics[Math.floor(Math.random() * comics.length)]);
        }
      })
      .catch(() => {});
  }, [key]);

  if (!comic) return null;

  const href = comic.type === "novel" ? `/novel/${comic.id}` : `/reader/${comic.id}`;

  return (
    <div className="dashboard-glass p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🎲</span>
          <h3 className="text-sm font-semibold text-foreground">随机盲盒</h3>
        </div>
        <button
          onClick={() => setKey((k) => k + 1)}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors"
        >
          <Shuffle className="h-3 w-3" /> 换一个
        </button>
      </div>
      <Link href={href} className="group flex items-center gap-3 rounded-xl bg-background/30 p-2.5 transition-all hover:bg-background/50 border border-white/[0.04]">
        <div className="relative w-14 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-card">
          <Image src={comic.coverUrl || ""} alt="" fill unoptimized className="object-cover" sizes="56px" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground line-clamp-2">{comic.title}</p>
          {comic.pageCount > 0 && (
            <p className="text-[11px] text-muted mt-0.5">{comic.pageCount} 页</p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    </div>
  );
}
