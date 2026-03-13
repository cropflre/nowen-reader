package handler

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
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
		generated := 0
		skipped := 0
		for _, comic := range comics {
			cachePath := filepath.Join(thumbDir, comic.ID+".webp")
			if _, err := os.Stat(cachePath); err == nil {
				skipped++
				continue
			}
			if _, err := service.GetComicThumbnail(comic.ID); err == nil {
				generated++
			} else {
				log.Printf("[thumbnails] Failed to generate for %s: %v", comic.ID, err)
			}
		}
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

		generated := 0
		failed := 0
		for _, comic := range comics {
			if _, err := service.GetComicThumbnail(comic.ID); err == nil {
				generated++
			} else {
				failed++
			}
		}
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
			cachePath := filepath.Join(thumbDir, comic.ID+".webp")
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
