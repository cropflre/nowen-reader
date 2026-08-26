package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type CatalogHandler struct{}

func NewCatalogHandler() *CatalogHandler { return &CatalogHandler{} }

// ListItems returns logical publications for collection pickers. Directory
// series and standalone comics are paginated together without synthetic IDs.
// Series projection maintenance is asynchronous; this read never rebuilds it.
func (h *CatalogHandler) ListItems(c *gin.Context) {
	contentType := strings.TrimSpace(c.DefaultQuery("contentType", "comic"))
	if contentType != "comic" && contentType != "novel" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "contentType must be comic or novel"})
		return
	}
	if sortBy := strings.TrimSpace(c.DefaultQuery("sortBy", "title")); sortBy != "title" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sortBy must be title"})
		return
	}
	sortOrder := strings.ToLower(strings.TrimSpace(c.DefaultQuery("sortOrder", "asc")))
	if sortOrder != "asc" && sortOrder != "desc" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sortOrder must be asc or desc"})
		return
	}

	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
		return
	}
	pageSize, err := strconv.Atoi(c.DefaultQuery("pageSize", "24"))
	if err != nil || pageSize < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pageSize must be a positive integer"})
		return
	}

	user := middleware.GetCurrentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	libraryIDs, err := requestedAccessibleLibraries(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve library access"})
		return
	}
	filterLibraryIDs := user.Role != "admin" || strings.TrimSpace(c.Query("libraryIds")) != ""

	result, err := store.GetCatalogItems(store.CatalogItemQueryOptions{
		Search:           c.Query("search"),
		ContentType:      contentType,
		SortOrder:        sortOrder,
		Page:             page,
		PageSize:         pageSize,
		FilterLibraryIDs: filterLibraryIDs,
		LibraryIDs:       libraryIDs,
	})
	if err != nil {
		log.Printf("[catalog] list items failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list catalog items"})
		return
	}
	c.JSON(http.StatusOK, result)
}
