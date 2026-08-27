package service

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// cleanupOrphanContentCaches removes disk caches whose owning Comic row no
// longer exists. It never touches source library files. Group/series cover
// caches are intentionally preserved because they are not keyed by Comic IDs.
func cleanupOrphanContentCaches() {
	ids, err := store.GetAllComicIDs()
	if err != nil {
		log.Printf("[cache-gc] Failed to list content IDs: %v", err)
		return
	}

	valid := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		valid[id] = struct{}{}
	}

	removedThumbnails := cleanupOrphanThumbnails(valid)
	removedPageCaches := cleanupOrphanPageCaches(valid)
	if removedThumbnails > 0 || removedPageCaches > 0 {
		InvalidateAllCaches()
		log.Printf("[cache-gc] Removed orphan caches: thumbnails=%d, pageDirs=%d", removedThumbnails, removedPageCaches)
	}
}

func cleanupOrphanThumbnails(valid map[string]struct{}) int {
	entries, err := os.ReadDir(config.GetThumbnailsDir())
	if err != nil {
		return 0
	}

	removed := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ownerID := thumbnailCacheOwnerID(entry.Name())
		if ownerID == "" || strings.HasPrefix(ownerID, "group_") || strings.HasPrefix(ownerID, "series_") {
			continue
		}
		if _, ok := valid[ownerID]; ok {
			continue
		}
		if os.Remove(filepath.Join(config.GetThumbnailsDir(), entry.Name())) == nil {
			removed++
		}
	}
	return removed
}

// Thumbnail cache files are named <contentID>_<width>x<height>.webp. Using
// LastIndex keeps this compatible even if a future content ID contains '_'.
func thumbnailCacheOwnerID(name string) string {
	idx := strings.LastIndex(name, "_")
	if idx <= 0 {
		return ""
	}
	return name[:idx]
}

func cleanupOrphanPageCaches(valid map[string]struct{}) int {
	entries, err := os.ReadDir(config.GetPagesCacheDir())
	if err != nil {
		return 0
	}

	removed := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, ok := valid[entry.Name()]; ok {
			continue
		}
		if os.RemoveAll(filepath.Join(config.GetPagesCacheDir(), entry.Name())) == nil {
			removed++
		}
	}
	return removed
}
