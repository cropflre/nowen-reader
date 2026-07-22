export const SERIES_SHELF_ID_PREFIX = "series-";

export function seriesIdFromShelfId(id: string): string | null {
  return id.startsWith(SERIES_SHELF_ID_PREFIX)
    ? id.slice(SERIES_SHELF_ID_PREFIX.length)
    : null;
}
