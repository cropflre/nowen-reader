package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// SeriesLayoutPreview previews the impact of changing Library.seriesDepth on a comic library.
// POST /api/admin/libraries/:id/series-layout-preview
func (h *LibraryHandler) SeriesLayoutPreview(c *gin.Context) {
	libraryID := c.Param("id")
	existing, err := store.GetLibraryByID(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}

	var req struct {
		SeriesDepth optionalSeriesDepth `json:"seriesDepth"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if !req.SeriesDepth.Set || !req.SeriesDepth.Valid {
		msg := req.SeriesDepth.Err
		if msg == "" {
			msg = "seriesDepth must be an integer between 1 and 8"
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if existing.Type != "comic" {
		if req.SeriesDepth.Value != store.DefaultLibrarySeriesDepth {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Novel libraries only support seriesDepth = 1"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Series layout preview is only supported for comic libraries"})
		return
	}

	preview, err := service.PreviewLibrarySeriesLayout(libraryID, req.SeriesDepth.Value)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to preview series layout"})
		return
	}
	c.JSON(http.StatusOK, preview)
}

// ListSeriesLayoutSnapshots returns summary metadata for series layout snapshots of a library
// without exposing full user/group payloads.
// GET /api/admin/libraries/:id/series-layout-snapshots
func (h *LibraryHandler) ListSeriesLayoutSnapshots(c *gin.Context) {
	libraryID := c.Param("id")
	existing, err := store.GetLibraryByID(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}

	limit := 50
	if rawLimit := c.Query("limit"); rawLimit != "" {
		if parsed, parseErr := strconv.Atoi(rawLimit); parseErr == nil && parsed > 0 {
			limit = parsed
		}
	}
	snapshots, err := store.ListLibrarySeriesSnapshots(libraryID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list series layout snapshots"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"libraryId": libraryID,
		"snapshots": snapshots,
	})
}

// ExportSeriesLayoutSnapshot exports a single snapshot's full versioned payload for backup or manual recovery.
// GET /api/admin/libraries/:id/series-layout-snapshots/:snapshotId/export
func (h *LibraryHandler) ExportSeriesLayoutSnapshot(c *gin.Context) {
	libraryID := c.Param("id")
	snapshotID := c.Param("snapshotId")

	existing, err := store.GetLibraryByID(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}

	exported, err := store.GetLibrarySeriesSnapshotExport(libraryID, snapshotID)
	if err != nil {
		if errors.Is(err, store.ErrSeriesLayoutSnapshotNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Snapshot not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export series layout snapshot"})
		return
	}

	filename := fmt.Sprintf("series-layout-snapshot-%s-%s.json", libraryID, snapshotID)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.JSON(http.StatusOK, exported)
}

// RestoreSeriesLayoutSnapshot atomically restores a previous series layout snapshot after
// verifying library identity, payload version, source revision, and post-change state digest.
// POST /api/admin/libraries/:id/series-layout-snapshots/:snapshotId/restore
func (h *LibraryHandler) RestoreSeriesLayoutSnapshot(c *gin.Context) {
	libraryID := c.Param("id")
	snapshotID := c.Param("snapshotId")

	existing, err := store.GetLibraryByID(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}

	res, err := service.RestoreLibrarySeriesSnapshot(libraryID, snapshotID, getUserID(c))
	if err != nil {
		if errors.Is(err, store.ErrSeriesLayoutSnapshotNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Snapshot not found"})
			return
		}
		var conflictErr *store.SeriesLayoutConflictError
		if errors.As(err, &conflictErr) {
			writeSeriesLayoutConflictResponse(c, conflictErr)
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore series layout snapshot"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":            true,
		"restoredSnapshotId": snapshotID,
		"library":            res.Library,
		"backupSnapshot":     res.Snapshot,
	})
}

func writeSeriesLayoutConflictResponse(c *gin.Context, conflictErr *store.SeriesLayoutConflictError) {
	switch conflictErr.Kind {
	case "revision":
		c.JSON(http.StatusConflict, gin.H{
			"error":                 conflictErr.Message,
			"code":                  "SOURCE_REVISION_CONFLICT",
			"currentSourceRevision": conflictErr.CurrentSourceRevision,
		})
	case "lock":
		c.JSON(http.StatusConflict, gin.H{
			"error":         conflictErr.Message,
			"code":          "MANUAL_LOCK_CONFLICT",
			"lockConflicts": conflictErr.LockConflicts,
		})
	default:
		resp := gin.H{
			"error": conflictErr.Message,
			"code":  "SNAPSHOT_STATE_CONFLICT",
		}
		if conflictErr.CurrentSourceRevision != "" {
			resp["currentSourceRevision"] = conflictErr.CurrentSourceRevision
		}
		c.JSON(http.StatusConflict, resp)
	}
}
