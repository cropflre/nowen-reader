import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  listBookmarks,
  upsertBookmark,
  deleteBookmark,
  importBookmarks,
  type ServerUserBookmark,
} from "@/api/readerAssets";

export interface ComicBookmark {
  id?: string;
  comicId: string;
  pageIndex: number;
  createdAt: number;
}

const STORAGE_KEY_PREFIX = "nowen-reader:comic-bookmarks:";
const MIGRATED_KEY_PREFIX = "nowen-reader:migrated:comic-bookmarks:";

function getUserStorageKey(uid: string, comicId: string) {
  return `${STORAGE_KEY_PREFIX}${uid}:${comicId}`;
}

function getLegacyStorageKey(comicId: string) {
  return `${STORAGE_KEY_PREFIX}${comicId}`;
}

function getMigrationFlagKey(uid: string, comicId: string) {
  return `${MIGRATED_KEY_PREFIX}${uid}:${comicId}`;
}

function comicBookmarkId(pageIndex: number): string {
  return `comic-page-${pageIndex}`;
}

function readBookmarksFromKey(key: string): ComicBookmark[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ComicBookmark =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as ComicBookmark).pageIndex === "number"
      )
      .sort((a, b) => a.pageIndex - b.pageIndex);
  } catch {
    return [];
  }
}

function writeBookmarksToKey(key: string, bookmarks: ComicBookmark[]) {
  try {
    localStorage.setItem(key, JSON.stringify(bookmarks));
  } catch {
    // ignore storage quota errors
  }
}

function toComicBookmarks(items: ServerUserBookmark[]): ComicBookmark[] {
  return items
    .map((b) => ({
      id: b.id,
      comicId: b.comicId,
      pageIndex: b.pageIndex,
      createdAt: b.createdAt,
    }))
    .sort((a, b) => a.pageIndex - b.pageIndex);
}

export function useComicBookmarks(comicId: string) {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const [bookmarks, setBookmarks] = useState<ComicBookmark[]>([]);
  const bookmarksRef = useRef<ComicBookmark[]>([]);

  const applyState = useCallback((next: ComicBookmark[]) => {
    bookmarksRef.current = next;
    setBookmarks(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const userKey = getUserStorageKey(uid, comicId);
    const legacyKey = getLegacyStorageKey(comicId);
    const migratedKey = getMigrationFlagKey(uid, comicId);

    const userCached = readBookmarksFromKey(userKey);
    const isMigrated = (() => {
      try {
        return localStorage.getItem(migratedKey) === "1";
      } catch {
        return false;
      }
    })();
    const legacyCached =
      userCached.length === 0 && !isMigrated
        ? readBookmarksFromKey(legacyKey)
        : [];

    applyState(userCached.length > 0 ? userCached : legacyCached);

    if (!comicId || !user?.id) {
      return () => {
        cancelled = true;
      };
    }

    const syncFromServer = async () => {
      try {
        if (!isMigrated && legacyCached.length > 0) {
          const imported = await importBookmarks(
            comicId,
            legacyCached.map((b) => ({
              id: b.id || comicBookmarkId(b.pageIndex),
              pageIndex: b.pageIndex,
              createdAt: b.createdAt,
            }))
          );
          if (cancelled) return;
          try {
            localStorage.setItem(migratedKey, "1");
            localStorage.removeItem(legacyKey);
          } catch {
            // ignore storage errors
          }
          const mapped = toComicBookmarks(imported);
          writeBookmarksToKey(userKey, mapped);
          applyState(mapped);
          return;
        }

        const remote = await listBookmarks(comicId);
        if (cancelled) return;
        const mapped = toComicBookmarks(remote);
        writeBookmarksToKey(userKey, mapped);
        applyState(mapped);
        if (!isMigrated) {
          try {
            localStorage.setItem(migratedKey, "1");
          } catch {
            // ignore storage errors
          }
        }
      } catch {
        // Offline / server unavailable: preserve local cache silently
      }
    };

    void syncFromServer();
    return () => {
      cancelled = true;
    };
  }, [comicId, uid, user?.id, applyState]);

  const isBookmarked = useCallback(
    (pageIndex: number) => bookmarks.some((b) => b.pageIndex === pageIndex),
    [bookmarks]
  );

  const toggleBookmark = useCallback(
    (pageIndex: number) => {
      const prev = bookmarksRef.current;
      const existing = prev.find((b) => b.pageIndex === pageIndex);
      const userKey = getUserStorageKey(uid, comicId);

      if (existing) {
        const next = prev.filter((b) => b.pageIndex !== pageIndex);
        writeBookmarksToKey(userKey, next);
        applyState(next);
        if (user?.id && comicId) {
          void deleteBookmark(
            comicId,
            existing.id || comicBookmarkId(pageIndex)
          ).catch(() => {});
        }
        return;
      }

      const id = comicBookmarkId(pageIndex);
      const createdAt = Date.now();
      const next = [...prev, { id, comicId, pageIndex, createdAt }].sort(
        (a, b) => a.pageIndex - b.pageIndex
      );
      writeBookmarksToKey(userKey, next);
      applyState(next);
      if (user?.id && comicId) {
        void upsertBookmark(comicId, { id, pageIndex, createdAt }).catch(
          () => {}
        );
      }
    },
    [comicId, uid, user?.id, applyState]
  );

  const removeBookmark = useCallback(
    (pageIndex: number) => {
      const prev = bookmarksRef.current;
      const existing = prev.find((b) => b.pageIndex === pageIndex);
      const next = prev.filter((b) => b.pageIndex !== pageIndex);
      writeBookmarksToKey(getUserStorageKey(uid, comicId), next);
      applyState(next);
      if (user?.id && comicId) {
        void deleteBookmark(
          comicId,
          existing?.id || comicBookmarkId(pageIndex)
        ).catch(() => {});
      }
    },
    [comicId, uid, user?.id, applyState]
  );

  return { bookmarks, isBookmarked, toggleBookmark, removeBookmark };
}
