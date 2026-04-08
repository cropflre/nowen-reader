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

// POST /api/categories/create — 创建自定义分类
func (h *CategoryHandler) CreateCategory(c *gin.Context) {
	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
		Icon string `json:"icon"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if body.Icon == "" {
		body.Icon = "📚"
	}
	// 自动生成 slug
	if body.Slug == "" {
		body.Slug = store.GenerateCategorySlug(body.Name)
	}

	cat, err := store.CreateCategory(body.Name, body.Slug, body.Icon)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create category: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "category": cat})
}

// PUT /api/categories/reorder — 批量更新分类排序
func (h *CategoryHandler) ReorderCategories(c *gin.Context) {
	var body struct {
		Orders []struct {
			Slug      string `json:"slug"`
			SortOrder int    `json:"sortOrder"`
		} `json:"orders"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Orders) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "orders array is required"})
		return
	}

	for _, o := range body.Orders {
		if err := store.UpdateCategorySortOrder(o.Slug, o.SortOrder); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reorder categories"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
