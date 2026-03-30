package handler

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ThumbnailHandler handles thumbnail management API endpoints.
type ThumbnailHandler struct{}

// NewThumbnailHandler creates a new ThumbnailHandler.
func NewThumbnailHandler() *ThumbnailHandler {
	return &ThumbnailHandler{}
}

// thumbnailWorkers 是缩略图生成的并发 worker 数量。
const thumbnailWorkers = 4

// POST /api/thumbnails/manage — Manage thumbnails
func (h *ThumbnailHandler) ManageThumbnails(c *gin.Context) {
	var body struct {
		Action string `json:"action"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Get all comics from DB
	comics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get comics"})
		return
	}

	thumbDir := config.GetThumbnailsDir()
	os.MkdirAll(thumbDir, 0755)

	switch body.Action {
	case "generate-missing":
		// 筛选出缺失缩略图的漫画
		var missing []store.ComicIDFilename
		for _, comic := range comics {
			cachePath := filepath.Join(thumbDir, archive.ThumbnailCacheName(comic.ID))
			if _, err := os.Stat(cachePath); err != nil {
				missing = append(missing, comic)
			}
		}
		skipped := len(comics) - len(missing)

		// Worker pool 并发生成
		var generated int64
		jobs := make(chan store.ComicIDFilename, len(missing))
		var wg sync.WaitGroup
		for w := 0; w < thumbnailWorkers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for comic := range jobs {
					if _, _, err := service.GetComicThumbnail(comic.ID); err == nil {
						atomic.AddInt64(&generated, 1)
					} else {
						log.Printf("[thumbnails] Failed to generate for %s: %v", comic.ID, err)
					}
				}
			}()
		}
		for _, comic := range missing {
			jobs <- comic
		}
		close(jobs)
		wg.Wait()

		c.JSON(http.StatusOK, gin.H{
			"success":   true,
			"generated": generated,
			"skipped":   skipped,
			"total":     len(comics),
		})

	case "regenerate-all":
		// Delete all existing thumbnails
		if entries, err := os.ReadDir(thumbDir); err == nil {
			for _, e := range entries {
				os.Remove(filepath.Join(thumbDir, e.Name()))
			}
		}

		// Worker pool 并发生成
		var generated, failed int64
		jobs := make(chan store.ComicIDFilename, len(comics))
		var wg sync.WaitGroup
		for w := 0; w < thumbnailWorkers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for comic := range jobs {
					if _, _, err := service.GetComicThumbnail(comic.ID); err == nil {
						atomic.AddInt64(&generated, 1)
					} else {
						atomic.AddInt64(&failed, 1)
					}
				}
			}()
		}
		for _, comic := range comics {
			jobs <- comic
		}
		close(jobs)
		wg.Wait()

		c.JSON(http.StatusOK, gin.H{
			"success":   true,
			"generated": generated,
			"failed":    failed,
			"total":     len(comics),
		})

	case "stats":
		existing := 0
		missing := 0
		for _, comic := range comics {
			cachePath := filepath.Join(thumbDir, archive.ThumbnailCacheName(comic.ID))
			if _, err := os.Stat(cachePath); err == nil {
				existing++
			} else {
				missing++
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"total":    len(comics),
			"existing": existing,
			"missing":  missing,
		})

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid action"})
	}
}
