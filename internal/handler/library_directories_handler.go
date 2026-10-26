package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const (
	defaultDirectoryPageSize = 100
	maxDirectoryPageSize     = 500
)

type resolvedComicListScope struct {
	LibraryIDs       []string
	FilterLibraryIDs bool
	DirectoryPath    string
}

// ListLibraryDirectories returns immediate classification subdirectories,
// logical work counts, and representative cover URLs for an accessible comic
// library up to depth (seriesDepth - 1).
// GET /api/libraries/:id/directories
func (h *LibraryHandler) ListLibraryDirectories(c *gin.Context) {
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Login required"})
		return
	}

	libraryID := strings.TrimSpace(c.Param("id"))
	if libraryID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Library ID is required"})
		return
	}

	allowed, err := store.UserCanViewLibrary(uid, libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check library permission"})
		return
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: no access to this library"})
		return
	}

	page := 1
	if rawPage := strings.TrimSpace(c.Query("page")); rawPage != "" {
		parsed, parseErr := strconv.Atoi(rawPage)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = parsed
	}

	pageSize := defaultDirectoryPageSize
	if rawSize := strings.TrimSpace(c.Query("pageSize")); rawSize != "" {
		parsed, parseErr := strconv.Atoi(rawSize)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "pageSize must be a positive integer"})
			return
		}
		if parsed > maxDirectoryPageSize {
			parsed = maxDirectoryPageSize
		}
		pageSize = parsed
	}

	if err := service.EnsureComicSeriesFresh(); err != nil {
		log.Printf("[series] refresh before directories failed: %v", err)
	}

	queryStarted := time.Now()
	result, err := store.ListLibraryDirectories(store.LibraryDirectoryQueryOptions{
		LibraryID: libraryID,
		UserID:    uid,
		Parent:    c.Query("parent"),
		Page:      page,
		PageSize:  pageSize,
	})
	if err != nil {
		switch {
		case errors.Is(err, store.ErrInvalidDirectoryPath):
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid parent directory path"})
		case errors.Is(err, store.ErrInvalidDirectoryDepth):
			c.JSON(http.StatusBadRequest, gin.H{"error": "Directory path exceeds library category depth"})
		case errors.Is(err, store.ErrDirectoryLibraryNotFound):
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: no access to this library"})
		default:
			log.Printf("[API] ListLibraryDirectories error for %s: %v", libraryID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library directories"})
		}
		return
	}

	recordLibraryQuery(c, "directories", queryStarted, len(result.Directories), result.Total)
	c.Header("Cache-Control", "private, max-age=15, stale-while-revalidate=60")
	c.JSON(http.StatusOK, result)
}

// resolveComicListScope resolves libraryIds and directoryPath for /api/comics.
// When directoryPath is non-empty, a single accessible enabled library must be
// explicitly selected and directoryPath must be a normalized library-relative path.
func resolveComicListScope(c *gin.Context) (resolvedComicListScope, bool) {
	rawDir := c.Query("directoryPath")
	if rawDir != "" {
		cleanDir, err := store.ValidateDirectoryRelativePath(rawDir)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid directoryPath: must be a normalized library-relative path"})
			return resolvedComicListScope{}, false
		}
		requested := splitQueryIDs(c.Query("libraryIds"))
		if len(requested) != 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "A single libraryId in libraryIds is required when directoryPath is specified"})
			return resolvedComicListScope{}, false
		}
		targetLibID := requested[0]
		if uid := getUserID(c); uid != "" {
			allowed, err := store.UserCanViewLibrary(uid, targetLibID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check library permission"})
				return resolvedComicListScope{}, false
			}
			if !allowed {
				c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: no access to this library"})
				return resolvedComicListScope{}, false
			}
		} else {
			lib, err := store.GetLibraryByID(targetLibID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
				return resolvedComicListScope{}, false
			}
			if lib == nil || !lib.Enabled {
				c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: no access to this library"})
				return resolvedComicListScope{}, false
			}
		}
		return resolvedComicListScope{
			LibraryIDs:       []string{targetLibID},
			FilterLibraryIDs: true,
			DirectoryPath:    cleanDir,
		}, true
	}

	var scope resolvedComicListScope
	if uid := getUserID(c); uid != "" {
		user := middleware.GetCurrentUser(c)
		isAdmin := user != nil && user.Role == "admin"
		requestedParam := c.Query("libraryIds")

		if isAdmin {
			if requestedParam != "" {
				for _, id := range strings.Split(requestedParam, ",") {
					id = strings.TrimSpace(id)
					if id != "" {
						scope.LibraryIDs = append(scope.LibraryIDs, id)
					}
				}
				scope.FilterLibraryIDs = true
			}
		} else {
			scope.FilterLibraryIDs = true
			if accessibleIDs, err := store.GetUserAccessibleLibraryIDs(uid); err == nil {
				if requestedParam == "" {
					scope.LibraryIDs = accessibleIDs
				} else {
					allowed := make(map[string]struct{}, len(accessibleIDs))
					for _, id := range accessibleIDs {
						allowed[id] = struct{}{}
					}
					for _, id := range strings.Split(requestedParam, ",") {
						id = strings.TrimSpace(id)
						if _, ok := allowed[id]; ok {
							scope.LibraryIDs = append(scope.LibraryIDs, id)
						}
					}
				}
			}
		}
	}
	return scope, true
}
