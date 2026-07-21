package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// StatsHandler handles reading statistics API endpoints.
type StatsHandler struct{}

type readingActivityRequest struct {
	ClientSessionID string `json:"clientSessionId"`
	Page            int    `json:"page"`
	TotalPages      int    `json:"totalPages"`
	ActiveSeconds   int    `json:"activeSeconds"`
	Sequence        int    `json:"sequence"`
	Finalize        bool   `json:"finalize"`
	TrackProgress   *bool  `json:"trackProgress"`
}

// NewStatsHandler creates a new StatsHandler.
func NewStatsHandler() *StatsHandler {
	return &StatsHandler{}
}

// POST /api/reading/:id/activity — 幂等记录阅读进度与会话心跳。
func (h *StatsHandler) RecordActivity(c *gin.Context) {
	comicID := c.Param("id")
	var body readingActivityRequest
	if err := c.ShouldBindJSON(&body); err != nil || body.ClientSessionID == "" || len(body.ClientSessionID) > 128 || body.Sequence <= 0 || body.ActiveSeconds < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid reading activity"})
		return
	}
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	trackProgress := true
	if body.TrackProgress != nil {
		trackProgress = *body.TrackProgress
	}
	if err := store.RecordReadingActivity(
		comicID, getUserID(c), body.ClientSessionID, body.Page, body.TotalPages,
		body.ActiveSeconds, body.Sequence, body.Finalize, trackProgress,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record reading activity"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GET /api/stats — Get reading statistics
func (h *StatsHandler) GetStats(c *gin.Context) {
	uid := getUserID(c)
	stats, err := store.GetReadingStats(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get stats"})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// GET /api/stats/yearly?year=2024 — 年度阅读报告
func (h *StatsHandler) GetYearlyReport(c *gin.Context) {
	yearStr := c.DefaultQuery("year", strconv.Itoa(time.Now().Year()))
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2000 || year > 2100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid year"})
		return
	}

	report, err := store.GetYearlyReadingReport(year, getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get yearly report"})
		return
	}
	c.JSON(http.StatusOK, report)
}

// POST /api/stats/session — Start reading session
func (h *StatsHandler) StartSession(c *gin.Context) {
	var body struct {
		ComicID   string `json:"comicId"`
		StartPage int    `json:"startPage"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if body.ComicID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicId required"})
		return
	}

	if err := checkComicAccess(c, body.ComicID); err != nil {
		return
	}

	sessionID, err := store.StartReadingSession(body.ComicID, body.StartPage, getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start session"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessionId": sessionID})
}

// PUT /api/stats/session — End reading session
func (h *StatsHandler) EndSession(c *gin.Context) {
	var body struct {
		SessionID int `json:"sessionId"`
		EndPage   int `json:"endPage"`
		Duration  int `json:"duration"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if body.SessionID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sessionId and duration required"})
		return
	}

	// 校验会话关联漫画的书库权限
	if comicID, err := store.GetReadingSessionComicID(body.SessionID); err == nil {
		if err := checkComicAccess(c, comicID); err != nil {
			return
		}
	}

	if err := store.EndReadingSession(body.SessionID, body.EndPage, body.Duration, getUserID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to end session"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GET /api/stats/enhanced — 增强版阅读统计
func (h *StatsHandler) GetEnhancedStats(c *gin.Context) {
	stats, err := store.GetEnhancedReadingStats(getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// GET /api/stats/files — 文件统计
func (h *StatsHandler) GetFileStats(c *gin.Context) {
	stats, err := store.GetFileStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get file stats"})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// GET /api/stats/folder-tree — 文件夹树形统计
func (h *StatsHandler) GetFolderTreeStats(c *gin.Context) {
	tree, err := store.GetFolderTreeStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get folder tree stats"})
		return
	}
	c.JSON(http.StatusOK, tree)
}
