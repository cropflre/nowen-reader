import type { Comic } from "@/types/comic";
import { getReaderUrl, isNovelComic } from "@/lib/comic-utils";
import { calculateStoredReadingProgress, hasReadingStarted, isStoredReadingFinished } from "@/lib/progress";
import { seriesIdFromShelfId } from "@/lib/series-id";

export function libraryCardState(comic: Comic) {
  const seriesId = seriesIdFromShelfId(comic.id);
  const total = Math.max(0, comic.pageCount ?? 0);
  const lastRead = comic.lastReadPage ?? 0;
  const started = hasReadingStarted(lastRead, comic.lastReadAt ?? comic.lastRead, comic.readingStatus);
  // Series records store a completed-item count, not a zero-based page index.
  const finished = seriesId
    ? comic.readingStatus === "finished" || (total > 0 && lastRead >= total)
    : isStoredReadingFinished(lastRead, total, comic.lastReadAt ?? comic.lastRead, comic.readingStatus);
  const progress = finished ? 100 : seriesId
    ? (total > 0 ? Math.min(100, Math.max(0, Math.round(lastRead / total * 100))) : 0)
    : calculateStoredReadingProgress(lastRead, total, comic.lastReadAt ?? comic.lastRead, comic.readingStatus);
  return {
    seriesId,
    total,
    started,
    finished,
    progress,
    showProgress: finished || !started || total > 0,
    unit: seriesId ? "item" : isNovelComic(comic) ? "chapter" : "page",
    progressColor: finished ? "#d6b56d" : isNovelComic(comic) ? "#b98fe1" : "#8cc6ad",
    readerUrl: seriesId ? `/series/${seriesId}` : getReaderUrl(comic),
    detailUrl: seriesId ? `/series/${seriesId}` : `/comic/${comic.id}`,
    format: seriesId ? "" : (comic.filename?.split(".").pop()?.toUpperCase() || "BOOK"),
  };
}
