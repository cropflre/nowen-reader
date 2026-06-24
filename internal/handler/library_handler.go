package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
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
		Name          string   `json:"name" binding:"required"`
		Type          string   `json:"type" binding:"required"`
		RootPath      string   `json:"rootPath"`
		RootPaths     []string `json:"rootPaths"`
		Enabled       *bool    `json:"enabled"`
		SortOrder     *int     `json:"sortOrder"`
		DefaultAccess *string  `json:"defaultAccess"`
		ScanEnabled   *bool    `json:"scanEnabled"`
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

	// 处理 rootPaths：优先使用 rootPaths，如果都没有则报错
	rootPath := strings.TrimSpace(req.RootPath)
	allPaths := req.RootPaths
	if rootPath == "" && len(allPaths) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rootPath or rootPaths is required"})
		return
	}
	if rootPath == "" && len(allPaths) > 0 {
		rootPath = strings.TrimSpace(allPaths[0])
	}
	// 确保主路径在 rootPaths 列表中
	if len(allPaths) == 0 {
		allPaths = []string{rootPath}
	} else {
		found := false
		for _, p := range allPaths {
			if strings.TrimSpace(p) == rootPath {
				found = true
				break
			}
		}
		if !found {
			allPaths = append([]string{rootPath}, allPaths...)
		}
	}

	// 验证路径：去空、去重、检查重叠
	allPaths = validateAndCleanRootPaths(allPaths)
	if len(allPaths) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "All root paths are empty"})
		return
	}
	rootPath = allPaths[0]

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
		RootPath:      rootPath,
		RootPaths:     allPaths,
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
		Name          *string  `json:"name"`
		Type          *string  `json:"type"`
		RootPath      *string  `json:"rootPath"`
		RootPaths     []string `json:"rootPaths"`
		Enabled       *bool    `json:"enabled"`
		SortOrder     *int     `json:"sortOrder"`
		DefaultAccess *string  `json:"defaultAccess"`
		ScanEnabled   *bool    `json:"scanEnabled"`
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
	if req.RootPaths != nil {
		// 验证路径：去空、去重、检查重叠
		cleanedPaths := validateAndCleanRootPaths(req.RootPaths)
		existing.RootPaths = cleanedPaths
		if len(cleanedPaths) > 0 {
			existing.RootPath = cleanedPaths[0]
		}
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
// DELETE /api/admin/libraries/:id — Delete library and its indexed contents/cache
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

	comicIDs, err := store.GetComicIDsByLibraryID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library contents"})
		return
	}

	ids := make([]string, 0, len(comicIDs))
	for comicID := range comicIDs {
		ids = append(ids, comicID)
	}

	thumbnailCacheDeleted, pageCacheDeleted := cleanupLibraryContentCaches(comicIDs)

	deletedContents := int64(0)
	if len(ids) > 0 {
		deletedContents, err = store.BatchDeleteComicsWithFiles(ids, nil, false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete library contents"})
			return
		}
	}

	if err := store.DeleteLibrary(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete library"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":               true,
		"libraryId":             existing.ID,
		"libraryName":           existing.Name,
		"deletedContents":       deletedContents,
		"thumbnailCacheDeleted": thumbnailCacheDeleted,
		"pageCacheDeleted":      pageCacheDeleted,
		"deleteSourceFiles":     false,
	})
}

// ============================================================
// GET /api/libraries/accessible — List libraries the current user can access
// ============================================================

func (h *LibraryHandler) ListAccessibleLibraries(c *gin.Context) {
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Login required"})
		return
	}

	libraries, err := store.GetAccessibleLibrariesWithCount(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch accessible libraries"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"libraries": libraries})
}

func cleanupLibraryContentCaches(comicIDs map[string]struct{}) (thumbnailDeleted int, pageDeleted int) {
	if len(comicIDs) == 0 {
		return 0, 0
	}

	tw := config.GetThumbnailWidth()
	th := config.GetThumbnailHeight()
	thumbsDir := config.GetThumbnailsDir()
	pagesDir := config.GetPagesCacheDir()

	for comicID := range comicIDs {
		thumbName := filepath.Base(filepath.Clean(comicID)) + "_" + fmt.Sprintf("%d", tw) + "x" + fmt.Sprintf("%d", th) + ".webp"
		if err := os.Remove(filepath.Join(thumbsDir, thumbName)); err == nil {
			thumbnailDeleted++
		}

		if pageCachePath, ok := safeCachePath(pagesDir, comicID); ok {
			if _, err := os.Stat(pageCachePath); err == nil {
				if err := os.RemoveAll(pageCachePath); err == nil {
					pageDeleted++
				}
			}
		}
	}

	return thumbnailDeleted, pageDeleted
}

func safeCachePath(root string, name string) (string, bool) {
	if strings.TrimSpace(root) == "" || strings.TrimSpace(name) == "" {
		return "", false
	}
	candidate := filepath.Join(root, filepath.Clean(name))
	rel, err := filepath.Rel(root, candidate)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", false
	}
	return candidate, true
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
// POST /api/admin/libraries/:id/delete-preview — Dry-run delete preview
// ============================================================

func (h *LibraryHandler) DeletePreview(c *gin.Context) {
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

	comicCount, novelCount, contentCount, err := store.GetLibraryContentCounts(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to compute library content counts"})
		return
	}

	thumbnailCacheCount := 0
	pageCacheCount := 0

	if comicCount > 0 {
		ids, err := store.GetComicIDsByLibraryID(id)
		if err == nil {
			tw := config.GetThumbnailWidth()
			th := config.GetThumbnailHeight()
			thumbsDir := config.GetThumbnailsDir()
			pagesDir := config.GetPagesCacheDir()

			for comicID := range ids {
				thumbName := filepath.Base(filepath.Clean(comicID)) + "_" + fmt.Sprintf("%d", tw) + "x" + fmt.Sprintf("%d", th) + ".webp"
				if _, err := os.Stat(filepath.Join(thumbsDir, thumbName)); err == nil {
					thumbnailCacheCount++
				}
				if pageCachePath, ok := safeCachePath(pagesDir, comicID); ok {
					if _, err := os.Stat(pageCachePath); err == nil {
						pageCacheCount++
					}
				}
			}
		}
	}

	warnings := []string{}
	if comicCount > 0 {
		warnings = append(warnings, "删除将同时清理该书库下的所有内容索引与阅读记录")
	}

	resp := gin.H{
		"libraryId":               existing.ID,
		"libraryName":             existing.Name,
		"isDefaultLibrary":        strings.EqualFold(existing.ID, "default"),
		"comicCount":              comicCount,
		"novelCount":              novelCount,
		"contentCount":            contentCount,
		"thumbnailCacheCount":     thumbnailCacheCount,
		"pageCacheCount":          pageCacheCount,
		"estimatedCacheSizeBytes": 0,
		"deleteSourceFiles":       false,
		"willDelete": []string{
			"library record",
			"comic records",
			"comic tag relations",
			"comic category relations",
			"reading states",
			"reading sessions",
			"group items",
			"thumbnail cache",
			"page cache",
		},
		"willKeep": []string{
			"source files",
			"source folders",
			"user accounts",
			"site config",
			"AI config",
		},
		"warnings": warnings,
	}

	c.JSON(http.StatusOK, resp)
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

// validateAndCleanRootPaths 验证并清理根目录路径列表：
// 1. 去除空白路径
// 2. 去除重复路径
// 3. 检查路径重叠（一个路径是另一个的子目录）
func validateAndCleanRootPaths(paths []string) []string {
	// 清理并去空
	cleaned := make([]string, 0, len(paths))
	seen := make(map[string]bool)
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		p = filepath.Clean(p)
		if seen[p] {
			continue
		}
		seen[p] = true
		cleaned = append(cleaned, p)
	}

	// 检查路径重叠
	for i := 0; i < len(cleaned); i++ {
		for j := i + 1; j < len(cleaned); j++ {
			a, b := cleaned[i], cleaned[j]
			// 确保 a 是较短的路径
			if len(a) > len(b) {
				a, b = b, a
			}
			// 检查 b 是否以 a + "/" 开头（即 b 是 a 的子目录）
			if strings.HasPrefix(b, a+"/") {
				// 移除较长的路径（子目录）
				cleaned = append(cleaned[:j], cleaned[j+1:]...)
				j--
			}
		}
	}

	return cleaned
}
