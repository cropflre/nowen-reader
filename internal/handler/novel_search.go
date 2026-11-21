package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

// SearchNovel handles GET /api/comics/:id/search?q=<keyword>&limit=100
func (h *ComicHandler) SearchNovel(c *gin.Context) {
	id := c.Param("id")
	if err := checkComicAccess(c, id); err != nil {
		return
	}

	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Search query 'q' is required"})
		return
	}

	limit := 100
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid limit parameter"})
			return
		}
		if parsed > 500 {
			parsed = 500
		}
		limit = parsed
	}

	result, err := service.SearchNovelContent(c.Request.Context(), id, query, limit)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, service.ErrNotNovel) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Full-text chapter search is only supported for novels"})
			return
		}
		if errors.Is(err, service.ErrEmptySearchQuery) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search novel: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
