package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
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

	var libraryIDs []string
	filterLibraryIDs := false
	if uid := getUserID(c); uid != "" {
		user := middleware.GetCurrentUser(c)
		isAdmin := user != nil && user.Role == "admin"
		requestedParam := c.Query("libraryIds")

		if isAdmin {
			if requestedParam != "" {
				for _, id := range strings.Split(requestedParam, ",") {
					id = strings.TrimSpace(id)
					if id != "" {
						libraryIDs = append(libraryIDs, id)
					}
				}
				filterLibraryIDs = true
			}
		} else {
			filterLibraryIDs = true
			if accessibleIDs, err := store.GetUserAccessibleLibraryIDs(uid); err == nil {
				if requestedParam == "" {
					libraryIDs = accessibleIDs
				} else {
					allowed := make(map[string]struct{}, len(accessibleIDs))
					for _, id := range accessibleIDs {
						allowed[id] = struct{}{}
					}
					for _, id := range strings.Split(requestedParam, ",") {
						id = strings.TrimSpace(id)
						if _, ok := allowed[id]; ok {
							libraryIDs = append(libraryIDs, id)
						}
					}
				}
			}
		}
	}

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
		FilterLibraryIDs: filterLibraryIDs,
		LibraryIDs:       libraryIDs,
		Uncategorized:    c.Query("uncategorized") == "true",
		Untagged:         c.Query("untagged") == "true",
		SeriesView:       true,
	})
	if err != nil {
		log.Printf("[API] ListComics shelf error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library contents"})
		return
	}

	c.Header("Cache-Control", "private, max-age=15, stale-while-revalidate=60")
	c.JSON(http.StatusOK, result)
}
