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
