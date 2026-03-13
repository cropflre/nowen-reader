package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// CategoryHandler handles category-related API endpoints.
type CategoryHandler struct{}

// NewCategoryHandler creates a new CategoryHandler.
func NewCategoryHandler() *CategoryHandler {
	return &CategoryHandler{}
}

// GET /api/categories — List all categories
func (h *CategoryHandler) ListCategories(c *gin.Context) {
	cats, err := store.GetAllCategories()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": cats})
}

// POST /api/categories — Initialize predefined categories
func (h *CategoryHandler) InitCategories(c *gin.Context) {
	var body struct {
		Lang string `json:"lang"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Lang == "" {
		body.Lang = "zh"
	}

	if err := store.InitCategories(body.Lang); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init categories"})
		return
	}

	cats, err := store.GetAllCategories()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": cats})
}
