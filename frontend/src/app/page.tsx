"use client";

import { apiPath } from "@/lib/base-path";
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Layers,
  ArrowRight,
  Shuffle,
} from "lucide-react";
import DashboardTopBar from "@/components/DashboardTopBar";
import DashboardMain from "@/components/home/DashboardMain";
import { useAmbientFocus } from "@/lib/ambient-context";
import ServerActivityPanel from "@/components/ServerActivityPanel";
import UploadDialog from "@/components/UploadDialog";
import NSFWCoverGuard from "@/components/NSFWCoverGuard";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { isNSFW } from "@/lib/nsfw";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { invalidateComicsCache, ApiComic } from "@/hooks/useComics";

/**
 * Dashboard 首页 — 私人漫画库 NAS 媒体库仪表盘
 * 左侧 Sidebar + 顶部 TopBar + 主内容（Continue Reading Hero + Recently Added 精选）+ 右侧状态面板
 */
export default function Home() {
  const t = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { enabled: privacyEnabled, blurNSFW } = usePrivacyMode();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanningLibrary, setScanningLibrary] = useState(false);
  const publishFocus = useAmbientFocus();

  const [dashboardRevision, setDashboardRevision] = useState(0);
  const refreshDashboard = useCallback(() => {
    invalidateComicsCache();
    setDashboardRevision((revision) => revision + 1);
  }, []);

  const handleScanLibrary = useCallback(async () => {
    setScanningLibrary(true);
    try {
      await fetch(apiPath("/api/sync"), { method: "POST" });
      await new Promise((r) => setTimeout(r, 2000));
      refreshDashboard();
    } catch { /* */ } finally {
      setScanningLibrary(false);
    }
  }, [refreshDashboard]);

  return (
    <>
      <div className="relative z-10">
        <DashboardTopBar
          onUpload={() => setUploadDialogOpen(true)}
          uploading={uploading}
          onScanLibrary={handleScanLibrary}
          scanning={scanningLibrary}
        />

        <div className="flex min-h-[calc(100vh-4rem)]">
          {/* ═══ 主内容区 ═══ */}
          <DashboardMain refreshKey={dashboardRevision} onUpload={() => setUploadDialogOpen(true)} isAdmin={isAdmin} onFocusChange={publishFocus} />

          {/* ═══ 右侧面板 — 桌面端 ═══ */}
          <aside className="home-ambient-sidebar hidden xl:block w-[300px] 2xl:w-[340px] shrink-0 border-l border-border/30">
            <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-6 px-4 space-y-4 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
              <ServerActivityPanel />
              <LibraryOverviewCard t={t} />
              <RandomPickCard privacyEnabled={privacyEnabled} blurNSFW={blurNSFW} t={t} />
            </div>
          </aside>
        </div>
      </div>

      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onUploaded={async () => { refreshDashboard(); }}
      />
    </>
  );
}

/** 书库概览卡片 */
function LibraryOverviewCard({ t }: { t: any }) {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    fetch(apiPath("/api/comics?pageSize=1&page=1"), { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setTotal(d.total || 0))
      .catch(() => {});
  }, []);

  return (
    <div className="dashboard-glass p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Layers className="h-3.5 w-3.5 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">{t.dashboard.libraryOverview}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-background/30 p-3 text-center border border-border/30">
          <p className="text-2xl font-bold text-foreground tabular-nums">{total || "—"}</p>
          <p className="text-[10px] text-muted mt-0.5">{t.dashboard.totalItems}</p>
        </div>
        <div className="rounded-lg bg-background/30 p-3 text-center border border-border/30">
          <p className="text-2xl font-bold text-emerald-500 tabular-nums">—</p>
          <p className="text-[10px] text-muted mt-0.5">{t.dashboard.unread}</p>
        </div>
      </div>
      <Link
        href="/books"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
      >
        {t.dashboard.browseLibrary}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

/** 随机盲盒卡片 */
function RandomPickCard({ privacyEnabled, blurNSFW, t }: { privacyEnabled: boolean; blurNSFW: boolean; t: any }) {
  const [comic, setComic] = useState<ApiComic | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    fetch(apiPath("/api/comics?pageSize=50&page=1&sortBy=random"), { credentials: "include" })
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
          <h3 className="text-sm font-semibold text-foreground">{t.dashboard.randomPick}</h3>
        </div>
        <button
          onClick={() => setKey((k) => k + 1)}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors"
        >
          <Shuffle className="h-3 w-3" /> {t.dashboard.shuffle}
        </button>
      </div>
      <Link href={href} className="group flex items-center gap-3 rounded-xl bg-background/30 p-2.5 transition-all hover:bg-background/50 border border-border/30">
        <div className="relative w-14 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-card">
          <NSFWCoverGuard
            src={comic.coverUrl || ""}
            alt=""
            isNSFW={isNSFW(comic)}
            blurEnabled={privacyEnabled && blurNSFW}
            fill
            unoptimized
            className="object-cover"
            sizes="56px"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground line-clamp-2">{comic.title}</p>
          {comic.pageCount > 0 && (
            <p className="text-[11px] text-muted mt-0.5">{comic.pageCount} {t.dashboard?.pages || "页"}</p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    </div>
  );
}
