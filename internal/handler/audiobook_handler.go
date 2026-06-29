package handler

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

// ============================================================
// 听书 AI 增强 API
// ============================================================

// AudiobookHandler 听书 handler
type AudiobookHandler struct{}

// Prepare 准备听书文本
// POST /api/comics/:id/chapter/:index/audiobook/prepare
func (h *AudiobookHandler) Prepare(c *gin.Context) {
	comicID := c.Param("id")
	chapterIndexStr := c.Param("index")

	chapterIndex, err := strconv.Atoi(chapterIndexStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的章节索引"})
		return
	}

	// 解析请求参数
	var req struct {
		IncludeRecap bool `json:"includeRecap"`
		ForceRefresh bool `json:"forceRefresh"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		// 使用默认值
		req.IncludeRecap = true
		req.ForceRefresh = false
	}

	// 获取章节内容
	chapterContent, err := service.GetChapterContent(comicID, chapterIndex)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取章节内容失败"})
		return
	}

	// 调用听书准备
	result, err := service.PrepareAudiobook(
		comicID,
		chapterIndex,
		chapterContent.Title,
		chapterContent.Content,
		req.IncludeRecap,
		req.ForceRefresh,
	)
	if err != nil {
		// AI 调用失败，返回 fallback（错误信息脱敏）
		log.Printf("[audiobook] AI 准备失败: %v", err)
		c.JSON(http.StatusOK, gin.H{
			"chapterIndex": chapterIndex,
			"title":        chapterContent.Title,
			"recap":        "",
			"segments": []gin.H{
				{
					"type":         "narration",
					"speaker":      "",
					"text":         chapterContent.Content,
					"pauseAfterMs": 500,
				},
			},
			"source":  "fallback",
			"model":   "",
			"cached":  false,
			"error":   "AI 处理失败，使用原始文本",
		})
		return
	}

	c.JSON(http.StatusOK, result)
}
