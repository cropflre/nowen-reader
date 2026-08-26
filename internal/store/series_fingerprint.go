package store

import "fmt"

type ComicSeriesLibraryFingerprint struct {
	LibraryID  string
	Fingerprint string
	ItemCount  int
	SeriesCount int
}

// ListComicSeriesLibraryFingerprints returns compact per-library change tokens.
// It never materialises Comic rows and is safe to poll from the background
// maintenance loop even on very large installations.
func ListComicSeriesLibraryFingerprints() ([]ComicSeriesLibraryFingerprint, error) {
	rows, err := db.Query(`
		SELECT l."id",
		       COUNT(c."id") AS itemCount,
		       COALESCE(SUM(LENGTH(COALESCE(NULLIF(c."relativePath", ''), c."filename")) + LENGTH(c."title")), 0) AS pathBytes,
		       COALESCE(MAX(CAST(c."updatedAt" AS TEXT)), '') AS comicUpdatedAt,
		       COALESCE(CAST(l."updatedAt" AS TEXT), '') AS libraryUpdatedAt,
		       (SELECT COUNT(*) FROM "ComicSeries" s WHERE s."libraryId" = l."id") AS seriesCount
		FROM "Library" l
		LEFT JOIN "Comic" c ON c."libraryId" = l."id" AND c."type" = 'comic'
		WHERE l."enabled" = 1 AND l."type" = 'comic'
		GROUP BY l."id", l."updatedAt"
		ORDER BY l."id"
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ComicSeriesLibraryFingerprint, 0)
	for rows.Next() {
		var item ComicSeriesLibraryFingerprint
		var pathBytes int64
		var comicUpdatedAt, libraryUpdatedAt string
		if err := rows.Scan(&item.LibraryID, &item.ItemCount, &pathBytes, &comicUpdatedAt, &libraryUpdatedAt, &item.SeriesCount); err != nil {
			return nil, err
		}
		item.Fingerprint = fmt.Sprintf("%d:%d:%s:%s", item.ItemCount, pathBytes, comicUpdatedAt, libraryUpdatedAt)
		result = append(result, item)
	}
	return result, rows.Err()
}
