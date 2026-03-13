package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ShelfHandler 处理书架相关的API请求。
type ShelfHandler struct{}

// NewShelfHandler 创建新的书架处理器。
func NewShelfHandler() *ShelfHandler {
	return &ShelfHandler{}
}

// ListShelves 返回所有书架（含漫画计数）。
func (h *ShelfHandler) ListShelves(c *gin.Context) {
	shelves, err := store.GetAllShelves()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"shelves": shelves})
}

// CreateShelf 创建新书架。
func (h *ShelfHandler) CreateShelf(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
		Icon string `json:"icon"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	shelf, err := store.CreateShelf(req.Name, req.Icon)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shelf)
}

// UpdateShelf 更新书架。
func (h *ShelfHandler) UpdateShelf(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid shelf id"})
		return
	}

	var req struct {
		Name string `json:"name" binding:"required"`
		Icon string `json:"icon"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	if err := store.UpdateShelf(id, req.Name, req.Icon); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DeleteShelf 删除书架。
func (h *ShelfHandler) DeleteShelf(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid shelf id"})
		return
	}

	if err := store.DeleteShelf(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AddComic 将漫画添加到书架。
func (h *ShelfHandler) AddComic(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid shelf id"})
		return
	}

	var req struct {
		ComicID  string   `json:"comicId"`
		ComicIDs []string `json:"comicIds"`
		Move     bool     `json:"move"` // 如果为 true，则从其他书架移除
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicId or comicIds required"})
		return
	}

	// 支持单个或批量
	var comicIDs []string
	if req.ComicID != "" {
		comicIDs = []string{req.ComicID}
	}
	if len(req.ComicIDs) > 0 {
		comicIDs = req.ComicIDs
	}

	if len(comicIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no comic ids provided"})
		return
	}

	if req.Move {
		if err := store.BatchMoveToShelf(comicIDs, id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	} else {
		if err := store.BatchAddToShelf(comicIDs, id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RemoveComic 从书架移除漫画。
func (h *ShelfHandler) RemoveComic(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid shelf id"})
		return
	}

	var req struct {
		ComicID string `json:"comicId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicId required"})
		return
	}

	if err := store.RemoveComicFromShelf(req.ComicID, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetComicShelves 获取一本漫画所在的所有书架。
func (h *ShelfHandler) GetComicShelves(c *gin.Context) {
	comicID := c.Param("id")
	shelves, err := store.GetComicShelves(comicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"shelves": shelves})
}

// GetEnhancedStats 获取增强版阅读统计。
func (h *ShelfHandler) GetEnhancedStats(c *gin.Context) {
	stats, err := store.GetEnhancedReadingStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// InitShelves 初始化预定义书架。
func (h *ShelfHandler) InitShelves(c *gin.Context) {
	var req struct {
		Lang string `json:"lang"`
	}
	c.ShouldBindJSON(&req)
	if req.Lang == "" {
		req.Lang = "zh"
	}

	if err := store.InitShelves(req.Lang); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	shelves, err := store.GetAllShelves()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"shelves": shelves})
}
