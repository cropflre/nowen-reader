package handler

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

// CacheHandler handles cache management API endpoints.
type CacheHandler struct{}

// NewCacheHandler creates a new CacheHandler.
func NewCacheHandler() *CacheHandler {
	return &CacheHandler{}
}

// POST /api/cache — Clear cache by action
func (h *CacheHandler) ClearCache(c *gin.Context) {
	var body struct {
		Action string `json:"action"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	switch body.Action {
	case "clear-thumbnails":
		service.InvalidateAllCaches()
		count := clearFilesInDir(config.GetThumbnailsDir())
		c.JSON(http.StatusOK, gin.H{"success": true, "deleted": count})

	case "clear-pages":
		service.InvalidateAllCaches()
		count := clearDirRecursive(config.GetPagesCacheDir())
		c.JSON(http.StatusOK, gin.H{"success": true, "deleted": count})

	case "clear-search":
		count := 0
		cacheFiles := []string{"phash-cache.json"}
		for _, f := range cacheFiles {
			fp := filepath.Join(config.DataDir(), f)
			if err := os.Remove(fp); err == nil {
				count++
			}
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "deleted": count})

	case "clear-all":
		service.InvalidateAllCaches()
		count := 0
		// Clear thumbnails
		count += clearFilesInDir(config.GetThumbnailsDir())
		// Clear pages
		count += clearDirRecursive(config.GetPagesCacheDir())
		// Clear other caches (preserve site-config and ai-config)
		preserve := map[string]bool{
			"site-config.json": true,
			"ai-config.json":   true,
			"thumbnails":       true,
			"pages":            true,
		}
		dataDir := config.DataDir()
		if entries, err := os.ReadDir(dataDir); err == nil {
			for _, e := range entries {
				if preserve[e.Name()] {
					continue
				}
				fp := filepath.Join(dataDir, e.Name())
				if e.IsDir() {
					count += clearDirRecursive(fp)
					os.Remove(fp)
				} else {
					if os.Remove(fp) == nil {
						count++
					}
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "deleted": count})

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid action"})
	}
}

// clearFilesInDir deletes all files in a directory (not subdirectories).
func clearFilesInDir(dirPath string) int {
	count := 0
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		if !e.IsDir() {
			if os.Remove(filepath.Join(dirPath, e.Name())) == nil {
				count++
			}
		}
	}
	return count
}

// clearDirRecursive recursively deletes all files and subdirectories.
func clearDirRecursive(dirPath string) int {
	count := 0
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		fp := filepath.Join(dirPath, e.Name())
		if e.IsDir() {
			count += clearDirRecursive(fp)
			os.Remove(fp)
		} else {
			if os.Remove(fp) == nil {
				count++
			}
		}
	}
	return count
}
