package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ListComicsShelfSafe handles the logical series shelf through a large-library
// safe store path. Non-series requests keep using the existing compatibility
// handler so Android/pageCount behavior is unchanged.
func (h *ComicHandler) ListComicsShelfSafe(c *gin.Context) {
	if c.Query("seriesView") != "true" || c.Query("sortBy") == "pageCount" {
		h.ListComicsCompatible(c)
		return
	}

	scope, ok := resolveComicListScope(c)
	if !ok {
		return
	}

	search := c.Query("search")
	var tags []string
	if tagsParam := c.Query("tags"); tagsParam != "" {
		for _, tag := range strings.Split(tagsParam, ",") {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				tags = append(tags, tag)
			}
		}
	}

	if err := service.EnsureComicSeriesFresh(); err != nil {
		log.Printf("[series] refresh before shelf failed: %v", err)
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "0"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "0"))

	queryStarted := time.Now()
	result, err := store.GetAllComicsShelfSafe(store.ComicListOptions{
		Search:           search,
		Tags:             tags,
		FavoritesOnly:    c.Query("favorites") == "true",
		SortBy:           c.DefaultQuery("sortBy", "title"),
		SortOrder:        c.DefaultQuery("sortOrder", "asc"),
		Page:             page,
		PageSize:         pageSize,
		Category:         c.Query("category"),
		ContentType:      c.Query("contentType"),
		ReadingStatus:    c.Query("readingStatus"),
		ExcludeGrouped:   c.Query("excludeGrouped") == "true",
		UserID:           getUserID(c),
		FilterLibraryIDs: scope.FilterLibraryIDs,
		LibraryIDs:       scope.LibraryIDs,
		DirectoryPath:    scope.DirectoryPath,
		Uncategorized:    c.Query("uncategorized") == "true",
		Untagged:         c.Query("untagged") == "true",
		SeriesView:       true,
	})
	if err != nil {
		log.Printf("[API] ListComics shelf error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library contents"})
		return
	}

	recordLibraryQuery(c, "shelf", queryStarted, len(result.Comics), result.Total)
	c.Header("Cache-Control", "private, max-age=15, stale-while-revalidate=60")
	c.JSON(http.StatusOK, result)
}
