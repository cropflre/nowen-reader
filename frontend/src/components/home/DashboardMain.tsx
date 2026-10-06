"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Heart, Loader2, RotateCcw, Upload } from "lucide-react";
import NSFWCoverGuard from "@/components/NSFWCoverGuard";
import { useToast } from "@/components/Toast";
import { useComics, toggleComicFavorite, invalidateComicsCache, type ApiComic } from "@/hooks/useComics";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { useTranslation } from "@/lib/i18n";
import { getReaderUrl, isNovelComic } from "@/lib/comic-utils";
import { isNSFW } from "@/lib/nsfw";
import { calculateStoredReadingProgress, getReadingPageNumber, hasReadingStarted, isStoredReadingFinished } from "@/lib/progress";
import { comicFileFormat, selectContinueReading, shelfPositions, type ShelfFocus } from "./dashboard-shelf";
import "../book-card-size.css";
import "./dashboard-main.css";

type FocusChange = (focus: ShelfFocus) => void;

function ProgressRing({ comic, large = false }: { comic: ApiComic; large?: boolean }) {
  const t = useTranslation();
  const finished = isStoredReadingFinished(comic.lastReadPage, comic.pageCount, comic.lastReadAt, comic.readingStatus);
  const started = hasReadingStarted(comic.lastReadPage, comic.lastReadAt, comic.readingStatus);
  const progress = finished ? 100 : calculateStoredReadingProgress(comic.lastReadPage, comic.pageCount, comic.lastReadAt, comic.readingStatus);
  const label = finished ? t.home.statusFinished : !started ? t.dashboard.unread : `${progress}%`;
  if (!finished && started && comic.pageCount <= 0) return null;
  return <span className={`ds-progress-ring${large ? " ds-progress-large" : ""}${finished ? " ds-finished" : !started ? " ds-unread" : ""}`} style={{ "--ds-progress": `${progress}%`, "--ds-progress-color": finished ? "#d6b56d" : isNovelComic(comic) ? "#b98fe1" : "#8cc6ad" } as CSSProperties} aria-label={label} title={label}>
    <span>{finished ? <Check size={16} /> : label}</span>
  </span>;
}

function Shelf({ comics, onFocusChange }: { comics: ApiComic[]; onFocusChange: FocusChange }) {
  const t = useTranslation();
  const { enabled, blurNSFW } = usePrivacyMode();
  const [selected, setSelected] = useState("");
  const [dragOffset, setDragOffset] = useState(0);
  const pointer = useRef<{ x: number; id: number } | null>(null);
  const suppressClick = useRef(0);
  const active = Math.max(0, comics.findIndex((comic) => comic.id === selected));
  const activeId = comics[active].id;
  const positions = shelfPositions(comics.length, active);
  useEffect(() => { onFocusChange({ comics, activeId }); }, [comics, activeId, onFocusChange]);
  useEffect(() => () => { onFocusChange({ comics: [], activeId: "" }); }, [onFocusChange]);
  const move = (direction: number) => {
    if (comics.length) setSelected(comics[(active + direction + comics.length) % comics.length].id);
  };
  const select = (id: string) => { if (Date.now() >= suppressClick.current) setSelected(id); };
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    const distance = event.clientX - pointer.current.x;
    if (Math.abs(distance) > 40) { move(distance < 0 ? 1 : -1); suppressClick.current = Date.now() + 250; }
    pointer.current = null;
    setDragOffset(0);
  };

  return <>
    <div className="ds-section-heading">
      <h2 className="ds-reading-title">{t.dashboard.continueReading}</h2>
      <div className="ds-carousel-controls">
        <Link href="/books" className="ds-text-link ds-library-link">{t.dashboard.allLibrary}<ArrowRight size={15} /></Link>
        <button className="ds-icon-button" disabled={comics.length < 2} onClick={() => move(-1)} aria-label={t.dashboard.previousBook} title={t.dashboard.previousBook}><ChevronLeft size={18} /></button>
        <button className="ds-icon-button" disabled={comics.length < 2} onClick={() => move(1)} aria-label={t.dashboard.nextBook} title={t.dashboard.nextBook}><ChevronRight size={18} /></button>
      </div>
    </div>
    <div className={`ds-shelf ds-count-${comics.length}${dragOffset ? " ds-dragging" : ""}`} role="region" aria-label={t.dashboard.continueReading} tabIndex={0} style={{ "--ds-drag": `${dragOffset}px` } as CSSProperties}
      onKeyDown={(event) => { if ((event.target as HTMLElement).closest("button, a")) return; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); } }}
      onPointerDown={(event) => { if (event.button === 0 && !(event.target as Element).closest("a, .ds-cover > .group button")) pointer.current = { x: event.clientX, id: event.pointerId }; }}
      onPointerMove={(event) => { if (pointer.current?.id === event.pointerId) { const distance = event.clientX - pointer.current.x; if (Math.abs(distance) > 12) { event.currentTarget.setPointerCapture(event.pointerId); setDragOffset(Math.max(-30, Math.min(30, distance * 0.2))); } } }}
      onPointerUp={finishDrag} onPointerCancel={() => { pointer.current = null; setDragOffset(0); }}>
      {comics.map((comic, index) => {
        const isActive = index === active;
        const progress = calculateStoredReadingProgress(comic.lastReadPage, comic.pageCount, comic.lastReadAt, comic.readingStatus);
        const unit = isNovelComic(comic) ? (t.continueReading.chapterUnit || t.continueReading.chapter) : t.continueReading.pageUnit;
        return <article key={comic.id} className={`ds-feature ds-position-${positions[index]}${isActive ? " ds-active" : ""}`}>
          <div className="ds-cover">
            <NSFWCoverGuard src={comic.coverUrl} alt={comic.title} isNSFW={isNSFW(comic)} blurEnabled={enabled && blurNSFW} fill unoptimized className="object-cover" sizes="(max-width: 640px) 44vw, 240px" />
            <button className="ds-cover-select" aria-label={`${t.dashboard.selectBook} ${comic.title}`} aria-pressed={isActive} onClick={() => select(comic.id)} />
            {isActive && <ProgressRing comic={comic} large />}
          </div>
          <div className="ds-feature-footer">
            <div className="ds-feature-meta"><button onClick={() => select(comic.id)} title={comic.title}>{comic.title}</button>{!isActive && comic.pageCount > 0 && <small>{getReadingPageNumber(comic.lastReadPage, comic.pageCount)}/{comic.pageCount}{unit}</small>}</div>
            <div className="ds-linear-progress"><span style={{ width: `${progress}%` }} /></div>
            <Link href={getReaderUrl(comic)} className="ds-continue" aria-label={`${t.dashboard.continueAction} ${comic.title}`}>{t.dashboard.continueAction}</Link>
          </div>
        </article>;
      })}
    </div>
  </>;
}

function RecentCard({ comic, onFavorite, saving }: { comic: ApiComic; onFavorite: () => void; saving: boolean }) {
  const t = useTranslation();
  const { enabled, blurNSFW } = usePrivacyMode();
  const unit = isNovelComic(comic) ? (t.continueReading.chapterUnit || t.continueReading.chapter) : t.continueReading.pageUnit;
  const favoriteLabel = comic.isFavorite ? (t.contextMenu?.unfavorite || t.batch.unfavorite) : (t.contextMenu?.favorite || t.batch.favorite);
  return <article className="ds-recent-card">
    <Link href={getReaderUrl(comic)} className="ds-book-link" aria-label={`${t.contextMenu?.read || t.dashboard.continueAction} ${comic.title}`}>
      <div className="ds-recent-cover">
        <NSFWCoverGuard src={comic.coverUrl} alt={comic.title} isNSFW={isNSFW(comic)} blurEnabled={enabled && blurNSFW} fill unoptimized className="object-cover" sizes="(max-width: 640px) 45vw, (max-width: 1024px) 25vw, 160px" />
        <ProgressRing comic={comic} />
        <span className="ds-format">{comicFileFormat(comic.filename)}</span>
      </div>
      <h3 title={comic.title}>{comic.title}</h3>
      <p title={comic.author}>{comic.author}{comic.author && comic.pageCount > 0 && <span> · </span>}{comic.pageCount > 0 && <>{comic.pageCount} {unit}</>}</p>
    </Link>
    <button className={`ds-favorite${comic.isFavorite ? " ds-saved" : ""}`} onClick={onFavorite} disabled={saving} aria-label={`${favoriteLabel} ${comic.title}`} aria-pressed={comic.isFavorite} title={favoriteLabel}>
      {saving ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} fill={comic.isFavorite ? "currentColor" : "none"} />}
    </button>
  </article>;
}

function Shelves({ refreshKey, onUpload, isAdmin, onFocusChange }: { refreshKey: number; onUpload: () => void; isAdmin: boolean; onFocusChange: FocusChange }) {
  const t = useTranslation();
  const toast = useToast();
  const recent = useComics({ page: 1, pageSize: 6, sortBy: "addedAt", sortOrder: "desc" });
  const reading = useComics({ page: 1, pageSize: 20, sortBy: "lastReadAt", sortOrder: "desc" });
  const readingComics = useMemo(() => selectContinueReading(reading.comics), [reading.comics]);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const pending = useRef(new Set<string>());
  const refresh = useCallback(() => { void recent.refetch(); void reading.refetch(); }, [recent.refetch, reading.refetch]);

  useEffect(() => { if (refreshKey) refresh(); }, [refreshKey, refresh]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  const favorite = async (id: string) => {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setSavingIds([...pending.current]);
    try {
      const value = await toggleComicFavorite(id);
      if (value === null) throw new Error();
      const update = (comics: ApiComic[]) => comics.map((comic) => comic.id === id ? { ...comic, isFavorite: value } : comic);
      recent.setComics(update);
      reading.setComics(update);
      invalidateComicsCache();
    } catch {
      toast.error(t.contextMenu?.favoriteFailed || t.reader.loadError);
    } finally {
      pending.current.delete(id);
      setSavingIds([...pending.current]);
    }
  };

  const retry = (onClick: () => void) => <button className="ds-text-link" onClick={onClick}><RotateCcw size={15} />{t.reader.retry}</button>;
  return <>
    <section className="ds-reading-section" aria-busy={reading.loading}>
      {reading.loading ? <><h2 className="ds-reading-title">{t.dashboard.continueReading}</h2><div className="ds-shelf-loading" role="status" aria-label={t.common.loading}>{Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton-shimmer" />)}</div></>
        : reading.error ? <div className="ds-empty" role="alert"><h2 className="ds-reading-title">{t.dashboard.continueReading}</h2><p>{reading.error}</p>{retry(reading.refetch)}</div>
        : readingComics.length ? <Shelf comics={readingComics} onFocusChange={onFocusChange} />
        : <div className="ds-empty"><BookOpen size={28} /><h2 className="ds-reading-title">{t.dashboard.continueReading}</h2><p>{t.common.noData}</p><Link href="/books" className="ds-text-link">{t.dashboard.browseLibrary}<ArrowRight size={15} /></Link></div>}
    </section>
    <section className="ds-recent-section" aria-busy={recent.loading}>
      <div className="ds-section-heading"><h2>{t.dashboard.recentlyAdded}</h2><Link href="/books?sortBy=addedAt&sortOrder=desc" className="ds-text-link">{t.dashboard.viewAll}<ArrowRight size={14} /></Link></div>
      {recent.loading ? <div className="ds-recent-grid" role="status" aria-label={t.common.loading}>{Array.from({ length: 6 }, (_, index) => <div className="ds-recent-skeleton skeleton-shimmer" key={index} />)}</div>
        : recent.error ? <div className="ds-empty" role="alert"><p>{recent.error}</p>{retry(recent.refetch)}</div>
        : recent.comics.length ? <div className="ds-recent-grid">{recent.comics.map((comic) => <RecentCard key={comic.id} comic={comic} onFavorite={() => { void favorite(comic.id); }} saving={savingIds.includes(comic.id)} />)}</div>
        : <div className="ds-empty"><p>{t.dashboard.emptyRecentlyAdded}</p>{isAdmin && <button className="ds-upload" onClick={onUpload}><Upload size={16} />{t.dashboard.uploadFile}</button>}</div>}
    </section>
  </>;
}

export default function DashboardMain({ refreshKey, onUpload, isAdmin, onFocusChange }: { refreshKey: number; onUpload: () => void; isAdmin: boolean; onFocusChange: FocusChange }) {
  return <main className="dashboard-shelves flex-1 min-w-0">
    <Shelves refreshKey={refreshKey} onUpload={onUpload} isAdmin={isAdmin} onFocusChange={onFocusChange} />
  </main>;
}
