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

// NewStatsHandler creates a new StatsHandler.
func NewStatsHandler() *StatsHandler {
	return &StatsHandler{}
}

// GET /api/stats — Get reading statistics
func (h *StatsHandler) GetStats(c *gin.Context) {
	stats, err := store.GetReadingStats()
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

	report, err := store.GetYearlyReadingReport(year)
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

	sessionID, err := store.StartReadingSession(body.ComicID, body.StartPage)
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

	if err := store.EndReadingSession(body.SessionID, body.EndPage, body.Duration); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to end session"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GET /api/stats/enhanced — 增强版阅读统计
func (h *StatsHandler) GetEnhancedStats(c *gin.Context) {
	stats, err := store.GetEnhancedReadingStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}
