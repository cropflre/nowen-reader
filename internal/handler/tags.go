package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// TagHandler handles tag-related API endpoints.
type TagHandler struct{}

// NewTagHandler creates a new TagHandler.
func NewTagHandler() *TagHandler {
	return &TagHandler{}
}

// GET /api/tags — List all tags
func (h *TagHandler) ListTags(c *gin.Context) {
	tags, err := store.GetAllTags()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tags"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tags": tags})
}

// PUT /api/tags/color — Update tag color
func (h *TagHandler) UpdateTagColor(c *gin.Context) {
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Name == "" || body.Color == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and color required"})
		return
	}

	if err := store.UpdateTagColor(body.Name, body.Color); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update tag color"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
