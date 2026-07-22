/**
 * Centralised reading-progress helpers.
 *
 * `lastReadPage` is a **0-based page/chapter index** (the reader's
 * internal `currentPage`).  `pageCount` is the total number of pages.
 *
 * These helpers convert that to human-friendly progress values without
 * mutating the underlying 0-based semantics used for restore.
 */

/**
 * Return reading progress as an integer 0-100.
 *
 * Rules:
 *  - `pageCount <= 0`  -> `0`
 *  - Uses `lastReadPage + 1` as the current readable page.
 *  - Result is clamped to `[0, 100]`.
 *  - When the user is on the last page (`lastReadPage >= pageCount - 1`)
 *    the result is always `100`.
 */
export function calculateReadingProgress(
  lastReadPage: number,
  pageCount: number,
): number {
  if (!pageCount || pageCount <= 0) return 0;

  const currentPage = Math.min(
    Math.max(lastReadPage + 1, 0),
    pageCount,
  );

  return Math.min(100, Math.round((currentPage / pageCount) * 100));
}

/** Whether persisted state contains evidence that reading has started. */
export function hasReadingStarted(
  lastReadPage: number,
  lastReadAt?: string | null,
  readingStatus?: string | null,
): boolean {
  return Boolean(lastReadAt)
    || lastReadPage > 0
    || readingStatus === "reading"
    || readingStatus === "finished";
}

/**
 * Calculate progress for state loaded from the server.
 *
 * Persisted `lastReadPage = 0` is ambiguous: it is both the database default
 * and the reader's zero-based first page. Reading timestamps/status disambiguate
 * those cases, while `lastReadPage > 0` preserves legacy records.
 */
export function calculateStoredReadingProgress(
  lastReadPage: number,
  pageCount: number,
  lastReadAt?: string | null,
  readingStatus?: string | null,
): number {
  if (!hasReadingStarted(lastReadPage, lastReadAt, readingStatus)) return 0;
  const progress = calculateReadingProgress(lastReadPage, pageCount);
  return progress > 0 ? progress : (pageCount > 0 ? 1 : 0);
}

/** Return the 1-based page number used in labels, clamped to pageCount. */
export function getReadingPageNumber(
  lastReadPage: number,
  pageCount: number,
): number {
  const currentPage = Math.max(lastReadPage + 1, 0);
  return pageCount > 0 ? Math.min(currentPage, pageCount) : currentPage;
}

/**
 * Whether the user has finished the book/comic.
 *
 * `true` when `pageCount > 0` **and** the last-read page is the final page.
 */
export function isReadingFinished(
  lastReadPage: number,
  pageCount: number,
): boolean {
  return pageCount > 0 && lastReadPage >= pageCount - 1;
}

/** Finished-state check for persisted records, including the unread page-zero case. */
export function isStoredReadingFinished(
  lastReadPage: number,
  pageCount: number,
  lastReadAt?: string | null,
  readingStatus?: string | null,
): boolean {
  if (readingStatus === "finished") return true;
  return hasReadingStarted(lastReadPage, lastReadAt, readingStatus)
    && isReadingFinished(lastReadPage, pageCount);
}
