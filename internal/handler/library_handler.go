package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// LibraryHandler handles library management API endpoints.
type LibraryHandler struct{}

// NewLibraryHandler creates a new LibraryHandler.
func NewLibraryHandler() *LibraryHandler {
	return &LibraryHandler{}
}

// ============================================================
// GET /api/admin/libraries — List all libraries
// ============================================================

func (h *LibraryHandler) ListLibraries(c *gin.Context) {
	libraries, err := store.GetAllLibraries()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch libraries"})
		return
	}

	// Add comic count for each library
	type libraryWithCount struct {
		model.Library
		ComicCount int `json:"comicCount"`
	}

	result := make([]libraryWithCount, len(libraries))
	for i, lib := range libraries {
		count, _ := store.GetLibraryComicCount(lib.ID)
		result[i] = libraryWithCount{
			Library:    lib,
			ComicCount: count,
		}
	}

	c.JSON(http.StatusOK, gin.H{"libraries": result})
}

// ============================================================
// POST /api/admin/libraries — Create library
// ============================================================

func (h *LibraryHandler) CreateLibrary(c *gin.Context) {
	var req struct {
		Name          string  `json:"name" binding:"required"`
		Type          string  `json:"type" binding:"required"`
		RootPath      string  `json:"rootPath" binding:"required"`
		Enabled       *bool   `json:"enabled"`
		SortOrder     *int    `json:"sortOrder"`
		DefaultAccess *string `json:"defaultAccess"`
		ScanEnabled   *bool   `json:"scanEnabled"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Validate type
	if req.Type != "comic" && req.Type != "novel" && req.Type != "mixed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Type must be comic, novel, or mixed"})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}

	defaultAccess := "private"
	if req.DefaultAccess != nil && (*req.DefaultAccess == "public" || *req.DefaultAccess == "private") {
		defaultAccess = *req.DefaultAccess
	}

	scanEnabled := true
	if req.ScanEnabled != nil {
		scanEnabled = *req.ScanEnabled
	}

	lib := &model.Library{
		Name:          req.Name,
		Type:          req.Type,
		RootPath:      req.RootPath,
		Enabled:       enabled,
		SortOrder:     sortOrder,
		DefaultAccess: defaultAccess,
		ScanEnabled:   scanEnabled,
	}

	if err := store.CreateLibrary(lib); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create library"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"library": lib})
}

// ============================================================
// PUT /api/admin/libraries/:id — Update library
// ============================================================

func (h *LibraryHandler) UpdateLibrary(c *gin.Context) {
	id := c.Param("id")

	existing, err := store.GetLibraryByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}

	var req struct {
		Name          *string `json:"name"`
		Type          *string `json:"type"`
		RootPath      *string `json:"rootPath"`
		Enabled       *bool   `json:"enabled"`
		SortOrder     *int    `json:"sortOrder"`
		DefaultAccess *string `json:"defaultAccess"`
		ScanEnabled   *bool   `json:"scanEnabled"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.Type != nil {
		if *req.Type != "comic" && *req.Type != "novel" && *req.Type != "mixed" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Type must be comic, novel, or mixed"})
			return
		}
		existing.Type = *req.Type
	}
	if req.RootPath != nil {
		existing.RootPath = *req.RootPath
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	if req.SortOrder != nil {
		existing.SortOrder = *req.SortOrder
	}
	if req.DefaultAccess != nil && (*req.DefaultAccess == "public" || *req.DefaultAccess == "private") {
		existing.DefaultAccess = *req.DefaultAccess
	}
	if req.ScanEnabled != nil {
		existing.ScanEnabled = *req.ScanEnabled
	}

	if err := store.UpdateLibrary(existing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update library"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"library": existing})
}

// ============================================================
// DELETE /api/admin/libraries/:id — Delete library
// ============================================================

func (h *LibraryHandler) DeleteLibrary(c *gin.Context) {
	id := c.Param("id")

	existing, err := store.GetLibraryByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}

	if err := store.DeleteLibrary(id); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/admin/libraries/:id/scan — Scan library
// ============================================================

func (h *LibraryHandler) ScanLibrary(c *gin.Context) {
	id := c.Param("id")

	existing, err := store.GetLibraryByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Library not found"})
		return
	}

	added, err := service.SyncLibraryByID(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	lib, _ := store.GetLibraryByID(id)
	c.JSON(http.StatusOK, gin.H{"added": added, "library": lib})
}

// ============================================================
// GET /api/admin/users/:id/library-access — Get user library access
// ============================================================

func (h *LibraryHandler) GetUserLibraryAccess(c *gin.Context) {
	userID := c.Param("id")

	// Verify user exists
	user, err := store.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}
	if user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	accesses, err := store.GetUserLibraryAccess(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library access"})
		return
	}

	// Get all libraries for context
	libraries, err := store.GetAllLibraries()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch libraries"})
		return
	}

	// Build access map
	accessMap := make(map[string]bool)
	for _, access := range accesses {
		accessMap[access.LibraryID] = access.CanView
	}

	// Build result with all libraries
	type libraryAccess struct {
		model.Library
		CanView bool `json:"canView"`
	}

	result := make([]libraryAccess, len(libraries))
	for i, lib := range libraries {
		result[i] = libraryAccess{
			Library: lib,
			CanView: accessMap[lib.ID],
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"userId":    userID,
		"libraries": result,
	})
}

// ============================================================
// PUT /api/admin/users/:id/library-access — Set user library access
// ============================================================

func (h *LibraryHandler) SetUserLibraryAccess(c *gin.Context) {
	userID := c.Param("id")

	// Verify user exists
	user, err := store.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}
	if user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Prevent modifying admin's access
	if user.Role == "admin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot modify admin library access"})
		return
	}

	var req struct {
		LibraryIDs []string `json:"libraryIds"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := store.SetUserLibraryAccess(userID, req.LibraryIDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update library access"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
