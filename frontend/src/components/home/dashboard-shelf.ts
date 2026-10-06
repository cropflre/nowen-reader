import type { ApiComic } from "@/hooks/useComicTypes";
import { isNSFW } from "@/lib/nsfw";
import { hasReadingStarted, isStoredReadingFinished } from "@/lib/progress";

export interface ShelfFocus {
  comics: ApiComic[];
  activeId: string;
}

export function readingBackdropSrc(comic: ApiComic, hideNSFW: boolean): string | null {
  if (hideNSFW && isNSFW(comic)) return null;
  const src = typeof comic.coverUrl === "string" ? comic.coverUrl.trim() : "";
  return src || null;
}

export function selectContinueReading(comics: ApiComic[]): ApiComic[] {
  return comics.filter((comic) =>
    hasReadingStarted(comic.lastReadPage, comic.lastReadAt, comic.readingStatus)
    && !isStoredReadingFinished(comic.lastReadPage, comic.pageCount, comic.lastReadAt, comic.readingStatus)
  ).slice(0, 8);
}

/** Unique slots keep small libraries from repeating books on both sides. */
export function shelfPositions(count: number, activeIndex: number): number[] {
  const slots = [
    [4], [3, 4], [3, 4, 5], [2, 3, 4, 5],
    [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6],
    [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6, 7],
  ][count - 1];
  if (!slots) return [];
  const active = ((activeIndex % count) + count) % count;
  return slots.map((_, index) => slots[(index - active + slots.indexOf(4) + count) % count]);
}

export function comicFileFormat(filename: string): string {
  return filename.split(".").pop()?.toUpperCase() || "";
}
