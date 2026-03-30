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

// PUT /api/categories/:slug — Update category name/icon
func (h *CategoryHandler) UpdateCategory(c *gin.Context) {
	slug := c.Param("slug")
	var body struct {
		Name string `json:"name"`
		Icon string `json:"icon"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := store.UpdateCategory(slug, body.Name, body.Icon); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update category"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DELETE /api/categories/:slug — Delete category (remove from all comics)
func (h *CategoryHandler) DeleteCategory(c *gin.Context) {
	slug := c.Param("slug")

	if err := store.DeleteCategory(slug); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete category"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
