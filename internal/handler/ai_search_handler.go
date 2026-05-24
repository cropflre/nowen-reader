package handler

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// Phase 4-1: POST /api/ai/semantic-search — AI 语义搜索
// ============================================================

func (h *AIHandler) SemanticSearch(c *gin.Context) {
	var body struct {
		Query      string `json:"query"`
		TargetLang string `json:"targetLang"`
		Limit      int    `json:"limit"` // 候选列表上限
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Query == "" {
		c.JSON(400, gin.H{"error": "query is required"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}
	if body.Limit <= 0 || body.Limit > 80 {
		body.Limit = 80
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	// 获取库中所有作品的基本信息作为候选
	result, err := store.GetAllComics(store.ComicListOptions{
		PageSize: body.Limit,
		Page:     1,
		SortBy:   "title",
	})
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch library"})
		return
	}

	// 构建候选列表
	var candidates []map[string]string
	for _, comic := range result.Comics {
		c := map[string]string{
			"id":    comic.ID,
			"title": comic.Title,
		}
		if comic.Author != "" {
			c["author"] = comic.Author
		}
		if comic.Genre != "" {
			c["genre"] = comic.Genre
		}
		if comic.Description != "" {
			c["description"] = comic.Description
		}
		// 收集标签
		if len(comic.Tags) > 0 {
			var tagNames []string
			for _, t := range comic.Tags {
				tagNames = append(tagNames, t.Name)
			}
			c["tags"] = strings.Join(tagNames, ", ")
		}
		candidates = append(candidates, c)
	}

	if len(candidates) == 0 {
		c.JSON(200, gin.H{
			"success": true,
			"results": []interface{}{},
		})
		return
	}

	results, err := service.SemanticSearch(cfg, body.Query, candidates, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"success": true,
		"results": results,
	})
}

// ============================================================
// Phase 5-1: POST /api/ai/reading-insight — AI 阅读统计洞察报告
// ============================================================

func (h *AIHandler) GenerateReadingInsight(c *gin.Context) {
	var body struct {
		TargetLang string `json:"targetLang"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	// 收集阅读统计数据
	enhancedStats, err := store.GetEnhancedReadingStats(getUserID(c))
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get reading stats"})
		return
	}

	// 获取年度报告（当前年）
	yearlyReport, _ := store.GetYearlyReadingReport(currentYear())

	// 构建统计摘要给 AI
	statsData := map[string]interface{}{
		"totalReadTime":   enhancedStats["totalReadTime"],
		"totalSessions":   enhancedStats["totalSessions"],
		"totalComicsRead": enhancedStats["totalComicsRead"],
		"todayReadTime":   enhancedStats["todayReadTime"],
		"weekReadTime":    enhancedStats["weekReadTime"],
		"currentStreak":   enhancedStats["currentStreak"],
		"longestStreak":   enhancedStats["longestStreak"],
		"avgPagesPerHour": enhancedStats["avgPagesPerHour"],
		"genreStats":      enhancedStats["genreStats"],
		"monthlyStats":    enhancedStats["monthlyStats"],
	}

	if yearlyReport != nil {
		statsData["yearlyTopComics"] = yearlyReport.TopComics
		statsData["yearlyGenreDistribution"] = yearlyReport.GenreDistribution
	}

	// SSE 流式返回
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.Flush()

	err = service.GenerateReadingInsight(cfg, statsData, body.TargetLang, func(chunk service.StreamChunk) bool {
		data, _ := json.Marshal(chunk)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		c.Writer.Flush()
		return true
	})

	if err != nil {
		errChunk, _ := json.Marshal(service.StreamChunk{Error: err.Error(), Done: true})
		fmt.Fprintf(c.Writer, "data: %s\n\n", errChunk)
		c.Writer.Flush()
	}
}

// currentYear 返回当前年份
func currentYear() int {
	return time.Now().Year()
}
