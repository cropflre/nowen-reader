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

// ListComicsCompatible keeps the canonical list handler for every supported
// sort mode and adds the pageCount mode already exposed by the Flutter UI.
func (h *ComicHandler) ListComicsCompatible(c *gin.Context) {
	if c.Query("sortBy") != "pageCount" {
		h.ListComics(c)
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
		FilterLibraryIDs: filterLibraryIDs,
		LibraryIDs:       libraryIDs,
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
