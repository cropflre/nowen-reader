package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// SyncHandler 处理元数据同步相关的 API。
type SyncHandler struct{}

func NewSyncHandler() *SyncHandler { return &SyncHandler{} }

// GET /api/sync/status — 获取同步状态概览
func (h *SyncHandler) Status(c *gin.Context) {
	stats, err := store.GetSyncStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get sync stats"})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// GET /api/sync/history — 获取同步历史日志
// 查询参数: comicId (可选), limit (可选, 默认50)
func (h *SyncHandler) History(c *gin.Context) {
	comicID := c.Query("comicId")
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 200 {
		limit = 200
	}

	var logs []store.SyncLogEntry
	var err error

	if comicID != "" {
		logs, err = store.GetSyncLogsByComic(comicID, limit)
	} else {
		logs, err = store.GetRecentSyncLogs(limit)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get sync history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"logs": logs, "total": len(logs)})
}

// POST /api/sync/revert — 回滚指定的同步操作
func (h *SyncHandler) Revert(c *gin.Context) {
	var body struct {
		LogID int `json:"logId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.LogID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "logId is required"})
		return
	}

	if err := store.RevertSyncLog(body.LogID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// POST /api/sync/push — 手动触发同步（将刮削元数据推送到详情页）
// 实际上就是重新读取数据库中的最新数据，前端通过事件总线通知各页面刷新
func (h *SyncHandler) Push(c *gin.Context) {
	var body struct {
		ComicID string `json:"comicId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ComicID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicId is required"})
		return
	}

	comic, err := store.GetComicByID(body.ComicID)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"comic":   comic,
	})
}

// GET /api/sync/diff/:id — 获取指定漫画的元数据差异（当前值 vs 最近一次刮削值）
func (h *SyncHandler) Diff(c *gin.Context) {
	comicID := c.Param("id")

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	// 获取最近的刮削日志
	logs, err := store.GetSyncLogsByComic(comicID, 1)
	if err != nil || len(logs) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"hasDiff":  false,
			"current":  buildComicMetaMap(comic),
			"lastSync": nil,
		})
		return
	}

	lastLog := logs[0]
	current := buildComicMetaMap(comic)

	// 比较差异
	diffs := map[string]gin.H{}
	for key, newVal := range lastLog.Fields {
		if curVal, ok := current[key]; ok {
			curStr := toString(curVal)
			newStr := toString(newVal)
			if curStr != newStr {
				diffs[key] = gin.H{
					"current":  curVal,
					"lastSync": newVal,
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"hasDiff":     len(diffs) > 0,
		"current":     current,
		"lastSync":    lastLog,
		"differences": diffs,
	})
}

// buildComicMetaMap 将漫画对象转换为元数据 map。
func buildComicMetaMap(comic *store.ComicListItem) map[string]interface{} {
	m := map[string]interface{}{
		"title":          comic.Title,
		"author":         comic.Author,
		"publisher":      comic.Publisher,
		"description":    comic.Description,
		"language":       comic.Language,
		"genre":          comic.Genre,
		"metadataSource": comic.MetadataSource,
	}
	if comic.Year != nil {
		m["year"] = *comic.Year
	}
	return m
}

// toString 将 interface{} 转换为字符串。
func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case int:
		return strconv.Itoa(val)
	default:
		return ""
	}
}
