package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ListComicsCompatible keeps the canonical list handler for every supported
// sort mode and adds the pageCount mode already exposed by the Flutter UI.
func (h *ComicHandler) ListComicsCompatible(c *gin.Context) {
	if c.Query("sortBy") != "pageCount" {
		h.ListComics(c)
		return
	}

	scope, ok := resolveComicListScope(c)
	if !ok {
		return
	}

	search := c.Query("search")
	tagsParam := c.Query("tags")
	var tags []string
	if tagsParam != "" {
		for _, tag := range strings.Split(tagsParam, ",") {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	}

	category := c.Query("category")
	contentType := c.Query("contentType")
	seriesView := c.Query("seriesView") == "true"
	if seriesView {
		if err := service.EnsureComicSeriesFresh(); err != nil {
			log.Printf("[series] refresh before shelf failed: %v", err)
		}
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "0"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "0"))

	result, err := store.GetAllComicsSortedByPageCount(store.ComicListOptions{
		Search:           search,
		Tags:             tags,
		FavoritesOnly:    c.Query("favorites") == "true",
		SortBy:           "pageCount",
		SortOrder:        c.DefaultQuery("sortOrder", "asc"),
		Page:             page,
		PageSize:         pageSize,
		Category:         category,
		ContentType:      contentType,
		ReadingStatus:    c.Query("readingStatus"),
		ExcludeGrouped:   c.Query("excludeGrouped") == "true",
		UserID:           getUserID(c),
		FilterLibraryIDs: scope.FilterLibraryIDs,
		LibraryIDs:       scope.LibraryIDs,
		DirectoryPath:    scope.DirectoryPath,
		Uncategorized:    c.Query("uncategorized") == "true",
		Untagged:         c.Query("untagged") == "true",
		SeriesView:       seriesView,
	})
	if err != nil {
		log.Printf("[API] ListComics pageCount sort error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch comics"})
		return
	}

	c.Header("Cache-Control", "private, max-age=15, stale-while-revalidate=60")
	c.JSON(http.StatusOK, result)
}
