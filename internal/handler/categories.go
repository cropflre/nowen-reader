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
// 支持查询参数:
//   - scope=groups: 返回基于系列(GroupCategory)的分类统计，而非基于漫画(ComicCategory)的统计
//   - contentType=comic|novel: 配合 scope=groups 使用，按内容类型过滤
func (h *CategoryHandler) ListCategories(c *gin.Context) {
	scope := c.Query("scope")

	if scope == "groups" {
		contentType := c.Query("contentType")
		cats, err := store.GetGroupCategoryStats(contentType)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch group categories"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"categories": cats})
		return
	}

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
