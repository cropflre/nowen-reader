import type { NovelBookmark } from "./text-reader-types";

const clampPositionRatio = (value: unknown): number => {
  const ratio = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, ratio));
};

const createBookmarkID = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `bookmark-${crypto.randomUUID()}`;
  }
  return `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export function normalizeNovelBookmarks(value: unknown): NovelBookmark[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const chapterIndex = Number(raw.chapterIndex);
    if (!Number.isInteger(chapterIndex) || chapterIndex < 0) return [];

    const timestamp = Number(raw.timestamp);
    const normalizedTimestamp = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
    const updatedAt = Number(raw.updatedAt);
    return [{
      id: typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : `legacy-${chapterIndex}-${normalizedTimestamp}-${index}`,
      chapterIndex,
      chapterTitle: typeof raw.chapterTitle === "string" && raw.chapterTitle.trim()
        ? raw.chapterTitle.trim()
        : `Chapter ${chapterIndex + 1}`,
      name: typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "",
      note: typeof raw.note === "string" ? raw.note.trim().slice(0, 500) : "",
      positionRatio: clampPositionRatio(raw.positionRatio),
      timestamp: normalizedTimestamp,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : normalizedTimestamp,
    }];
  });
}

export function createNovelBookmark(
  chapterIndex: number,
  chapterTitle: string,
  positionRatio: number,
): NovelBookmark {
  const now = Date.now();
  return {
    id: createBookmarkID(),
    chapterIndex,
    chapterTitle: chapterTitle.trim() || `Chapter ${chapterIndex + 1}`,
    name: "",
    note: "",
    positionRatio: clampPositionRatio(positionRatio),
    timestamp: now,
    updatedAt: now,
  };
}

export function sortNovelBookmarks(bookmarks: NovelBookmark[]): NovelBookmark[] {
  return [...bookmarks].sort((a, b) =>
    a.chapterIndex - b.chapterIndex ||
    a.positionRatio - b.positionRatio ||
    a.timestamp - b.timestamp,
  );
}
