package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ComicHandler handles all comic-related API endpoints.
type ComicHandler struct{}

// NewComicHandler creates a new ComicHandler.
func NewComicHandler() *ComicHandler {
	return &ComicHandler{}
}

// ============================================================
// GET /api/comics — List comics with filters
// ============================================================

func (h *ComicHandler) ListComics(c *gin.Context) {
	search := c.Query("search")
	tagsParam := c.Query("tags")
	var tags []string
	if tagsParam != "" {
		tags = strings.Split(tagsParam, ",")
		// Filter empty strings
		filtered := tags[:0]
		for _, t := range tags {
			t = strings.TrimSpace(t)
			if t != "" {
				filtered = append(filtered, t)
			}
		}
		tags = filtered
	}

	favoritesOnly := c.Query("favorites") == "true"
	sortBy := c.DefaultQuery("sortBy", "title")
	sortOrder := c.DefaultQuery("sortOrder", "asc")
	category := c.Query("category")
	contentType := c.Query("contentType") // "comic" | "novel" | ""

	page, _ := strconv.Atoi(c.DefaultQuery("page", "0"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "0"))

	result, err := store.GetAllComics(store.ComicListOptions{
		Search:        search,
		Tags:          tags,
		FavoritesOnly: favoritesOnly,
		SortBy:        sortBy,
		SortOrder:     sortOrder,
		Page:          page,
		PageSize:      pageSize,
		Category:      category,
		ContentType:   contentType,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch comics"})
		return
	}

	c.Header("Cache-Control", "private, max-age=15, stale-while-revalidate=60")
	c.JSON(http.StatusOK, result)
}

// ============================================================
// GET /api/comics/:id — Get single comic
// ============================================================

func (h *ComicHandler) GetComic(c *gin.Context) {
	id := c.Param("id")
	comic, err := store.GetComicByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get comic"})
		return
	}
	if comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	c.JSON(http.StatusOK, comic)
}

// ============================================================
// PUT /api/comics/:id/favorite — Toggle favorite
// ============================================================

func (h *ComicHandler) ToggleFavorite(c *gin.Context) {
	id := c.Param("id")
	newState, err := store.ToggleFavorite(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to toggle favorite"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "isFavorite": newState})
}

// ============================================================
// PUT /api/comics/:id/rating — Update rating
// ============================================================

func (h *ComicHandler) UpdateRating(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Rating *int `json:"rating"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Validate rating range
	if body.Rating != nil && (*body.Rating < 1 || *body.Rating > 5) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Rating must be 1-5 or null"})
		return
	}

	if err := store.UpdateRating(id, body.Rating); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update rating"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// PUT /api/comics/:id/progress — Update reading progress
// ============================================================

func (h *ComicHandler) UpdateProgress(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Page int `json:"page"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := store.UpdateReadingProgress(id, body.Page); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update progress"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// DELETE /api/comics/:id/delete — Delete comic
// ============================================================

func (h *ComicHandler) DeleteComic(c *gin.Context) {
	id := c.Param("id")
	if err := store.DeleteComic(id, config.GetAllComicsDirs()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete comic"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/comics/:id/tags — Add tags
// ============================================================

func (h *ComicHandler) AddTags(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Tags []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Tags) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tags array required"})
		return
	}

	if err := store.AddTagsToComic(id, body.Tags); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add tags"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// DELETE /api/comics/:id/tags — Remove tag
// ============================================================

func (h *ComicHandler) RemoveTag(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Tag string `json:"tag"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Tag == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tag required"})
		return
	}

	if err := store.RemoveTagFromComic(id, body.Tag); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove tag"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/comics/:id/categories — Add categories
// ============================================================

func (h *ComicHandler) AddCategories(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		CategorySlugs []string `json:"categorySlugs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.CategorySlugs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "categorySlugs array required"})
		return
	}

	if err := store.AddCategoriesToComic(id, body.CategorySlugs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add categories"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// PUT /api/comics/:id/categories — Set (replace) categories
// ============================================================

func (h *ComicHandler) SetCategories(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		CategorySlugs []string `json:"categorySlugs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "categorySlugs array required"})
		return
	}

	if err := store.SetComicCategories(id, body.CategorySlugs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to set categories"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// DELETE /api/comics/:id/categories — Remove category
// ============================================================

func (h *ComicHandler) RemoveCategory(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		CategorySlug string `json:"categorySlug"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.CategorySlug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "categorySlug required"})
		return
	}

	if err := store.RemoveCategoryFromComic(id, body.CategorySlug); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove category"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/comics/batch — Batch operations
// ============================================================

func (h *ComicHandler) BatchOperation(c *gin.Context) {
	var body struct {
		Action        string   `json:"action"`
		ComicIDs      []string `json:"comicIds"`
		IsFavorite    *bool    `json:"isFavorite"`
		Tags          []string `json:"tags"`
		CategorySlugs []string `json:"categorySlugs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if len(body.ComicIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicIds array required"})
		return
	}

	switch body.Action {
	case "delete":
		n, err := store.BatchDeleteComics(body.ComicIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Batch delete failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "已删除 " + strconv.FormatInt(n, 10) + " 本漫画"})

	case "favorite":
		fav := true
		if body.IsFavorite != nil {
			fav = *body.IsFavorite
		}
		_, err := store.BatchSetFavorite(body.ComicIDs, fav)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Batch favorite failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})

	case "unfavorite":
		_, err := store.BatchSetFavorite(body.ComicIDs, false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Batch unfavorite failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})

	case "addTags":
		if len(body.Tags) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tags array required"})
			return
		}
		if err := store.BatchAddTags(body.ComicIDs, body.Tags); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Batch add tags failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})

	case "setCategory":
		if len(body.CategorySlugs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "categorySlugs array required"})
			return
		}
		if err := store.BatchSetCategory(body.ComicIDs, body.CategorySlugs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Batch set category failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown action"})
	}
}

// ============================================================
// PUT /api/comics/reorder — Reorder comics
// ============================================================

func (h *ComicHandler) Reorder(c *gin.Context) {
	var body struct {
		Orders []struct {
			ID        string `json:"id"`
			SortOrder int    `json:"sortOrder"`
		} `json:"orders"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Orders) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "orders array required"})
		return
	}

	if err := store.UpdateSortOrders(body.Orders); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reorder"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// GET /api/comics/duplicates — Detect duplicates
// ============================================================

func (h *ComicHandler) DetectDuplicates(c *gin.Context) {
	groups, err := store.DetectDuplicates(config.GetComicsDir())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to detect duplicates"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"groups": groups,
		"total":  len(groups),
	})
}

// ============================================================
// POST /api/sync — Trigger manual sync
// ============================================================

func (h *ComicHandler) TriggerSync(c *gin.Context) {
	go service.SyncComicsToDatabase()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Sync triggered"})
}

// ============================================================
// PUT /api/comics/:id/metadata — 手动编辑元数据
// ============================================================

func (h *ComicHandler) UpdateMetadata(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Title       *string `json:"title"`
		Author      *string `json:"author"`
		Publisher   *string `json:"publisher"`
		Year        *int    `json:"year"`
		Description *string `json:"description"`
		Language    *string `json:"language"`
		Genre       *string `json:"genre"`
		SeriesName  *string `json:"seriesName"`
		SeriesIndex *int    `json:"seriesIndex"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// 检查漫画是否存在
	existing, err := store.GetComicByID(id)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	updates := map[string]interface{}{}

	if body.Title != nil {
		updates["title"] = *body.Title
	}
	if body.Author != nil {
		updates["author"] = *body.Author
	}
	if body.Publisher != nil {
		updates["publisher"] = *body.Publisher
	}
	if body.Year != nil {
		updates["year"] = *body.Year
	}
	if body.Description != nil {
		updates["description"] = *body.Description
	}
	if body.Language != nil {
		updates["language"] = *body.Language
	}
	if body.Genre != nil {
		updates["genre"] = *body.Genre
	}
	if body.SeriesName != nil {
		updates["seriesName"] = *body.SeriesName
	}
	if body.SeriesIndex != nil {
		updates["seriesIndex"] = *body.SeriesIndex
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No fields to update"})
		return
	}

	// 标记为手动编辑来源
	updates["metadataSource"] = "manual"

	if err := store.UpdateComicFields(id, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update metadata"})
		return
	}

	// 如果 genre 被修改，同步更新 tags
	if body.Genre != nil && *body.Genre != "" {
		genres := strings.Split(*body.Genre, ",")
		var tagNames []string
		for _, g := range genres {
			g = strings.TrimSpace(g)
			if g != "" {
				tagNames = append(tagNames, g)
			}
		}
		if len(tagNames) > 0 {
			_ = store.AddTagsToComic(id, tagNames)
		}
	}

	updated, _ := store.GetComicByID(id)
	c.JSON(http.StatusOK, gin.H{"success": true, "comic": updated})
}
