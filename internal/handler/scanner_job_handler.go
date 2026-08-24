package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ScanLibraryQueued queues a per-library scan instead of failing when another
// scanner task is already running. Duplicate queued/running requests for the
// same library resolve to the existing job.
func (h *LibraryHandler) ScanLibraryQueued(c *gin.Context) {
	libraryID := c.Param("id")
	user := middleware.GetCurrentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	library, err := store.GetLibraryByID(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if library == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}
	canManage, err := store.UserCanManageLibrary(user.ID, libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check library permission"})
		return
	}
	if !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: no manage permission for this library"})
		return
	}
	if !library.Enabled {
		c.JSON(http.StatusConflict, gin.H{"error": "Library is disabled"})
		return
	}

	job, created := service.QueueLibraryScan(libraryID)
	c.JSON(http.StatusAccepted, gin.H{
		"success":      true,
		"queued":       true,
		"deduplicated": !created,
		"job":          job,
	})
}

func (h *LibraryHandler) GetScannerJob(c *gin.Context) {
	job, ok := service.GetScannerJob(c.Param("jobId"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Scanner job not found"})
		return
	}
	if !canViewScannerJob(c, job) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"job": job})
}

func (h *LibraryHandler) ListScannerJobs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	c.JSON(http.StatusOK, gin.H{"jobs": service.RecentScannerJobs(limit)})
}

func canViewScannerJob(c *gin.Context, job service.ScannerJobSnapshot) bool {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return false
	}
	if user.Role == "admin" {
		return true
	}
	if job.LibraryID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return false
	}
	canManage, err := store.UserCanManageLibrary(user.ID, job.LibraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check library permission"})
		return false
	}
	if !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return false
	}
	return true
}

// TriggerSyncQueued preserves POST /api/sync while changing its semantics from
// "silently skip if busy" to an observable queued scanner job.
func (h *ComicHandler) TriggerSyncQueued(c *gin.Context) {
	job, created := service.QueueForceSync("manual-api")
	c.JSON(http.StatusAccepted, gin.H{
		"success":      true,
		"queued":       true,
		"deduplicated": !created,
		"job":          job,
	})
}

func (h *ComicHandler) RedetectTypesQueued(c *gin.Context) {
	job, created := service.QueueRedetect("manual-api")
	c.JSON(http.StatusAccepted, gin.H{
		"success":      true,
		"queued":       true,
		"deduplicated": !created,
		"job":          job,
	})
}
