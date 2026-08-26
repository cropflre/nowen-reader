package service

import "github.com/nowen-reader/nowen-reader/internal/store"

// ComicSeriesLibrarySize returns the current comic-item count and whether the
// library is too large for the legacy in-memory DetectComicSeries path. Callers
// that would otherwise build a full []SeriesSourceItem can fail fast or enqueue
// background maintenance instead of risking OOM on small NAS devices.
func ComicSeriesLibrarySize(libraryID string) (itemCount int, tooLarge bool, err error) {
	fingerprints, err := store.ListComicSeriesLibraryFingerprints()
	if err != nil {
		return 0, false, err
	}
	for _, fp := range fingerprints {
		if fp.LibraryID == libraryID {
			return fp.ItemCount, fp.ItemCount > seriesAutoRebuildItemLimit, nil
		}
	}
	return 0, false, nil
}
