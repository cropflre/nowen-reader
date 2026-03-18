package handler

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// SeriesHandler 处理系列相关的 API 接口。
type SeriesHandler struct{}

// NewSeriesHandler 创建新的 SeriesHandler。
func NewSeriesHandler() *SeriesHandler {
	return &SeriesHandler{}
}

// ============================================================
// GET /api/series — 系列列表（按 seriesName 分组聚合）
// ============================================================

func (h *SeriesHandler) ListSeries(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "24"))
	search := c.Query("search")
	sortBy := c.DefaultQuery("sortBy", "name")
	sortOrder := c.DefaultQuery("sortOrder", "asc")

	result, err := store.GetSeriesList(store.SeriesListOptions{
		Search:    search,
		SortBy:    sortBy,
		SortOrder: sortOrder,
		Page:      page,
		PageSize:  pageSize,
	})
	if err != nil {
		log.Printf("[SeriesHandler] ListSeries error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch series list"})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ============================================================
// GET /api/series/:name — 获取系列详情（该系列下所有漫画）
// ============================================================

func (h *SeriesHandler) GetSeriesComics(c *gin.Context) {
	seriesName := c.Param("name")
	if seriesName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Series name required"})
		return
	}

	comics, err := store.GetSeriesComics(seriesName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch series comics"})
		return
	}

	// 获取跨卷页面映射
	volumes, err := store.GetSeriesVolumeMap(seriesName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch series volume map"})
		return
	}

	// 计算总页数和总体阅读进度
	totalPages := 0
	totalReadPages := 0
	for _, v := range volumes {
		totalPages += v.PageCount
		totalReadPages += v.LastReadPage
	}

	progress := 0
	if totalPages > 0 {
		progress = totalReadPages * 100 / totalPages
	}

	c.JSON(http.StatusOK, gin.H{
		"seriesName": seriesName,
		"comics":     comics,
		"volumes":    volumes,
		"totalPages": totalPages,
		"progress":   progress,
	})
}

// ============================================================
// PUT /api/series/assign — 手动分配系列信息
// ============================================================

func (h *SeriesHandler) AssignSeries(c *gin.Context) {
	var body struct {
		ComicIDs    []string `json:"comicIds"`
		SeriesName  string   `json:"seriesName"`
		SeriesIndex *int     `json:"seriesIndex"` // 仅在单个漫画时使用
		AutoIndex   bool     `json:"autoIndex"`   // 自动按顺序分配卷号
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if len(body.ComicIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicIds required"})
		return
	}

	for i, id := range body.ComicIDs {
		var idx *int
		if body.AutoIndex {
			v := i + 1
			idx = &v
		} else if body.SeriesIndex != nil && len(body.ComicIDs) == 1 {
			idx = body.SeriesIndex
		}
		if err := store.UpdateSeriesInfo(id, body.SeriesName, idx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to assign series"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Series assigned"})
}

// ============================================================
// DELETE /api/series/remove — 移除系列关联
// ============================================================

func (h *SeriesHandler) RemoveSeries(c *gin.Context) {
	var body struct {
		ComicIDs []string `json:"comicIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if len(body.ComicIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicIds required"})
		return
	}

	for _, id := range body.ComicIDs {
		if err := store.UpdateSeriesInfo(id, "", nil); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove series"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Series removed"})
}
