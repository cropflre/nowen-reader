package handler

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// Phase 3-1: POST /api/ai/chat — AI 阅读助手 (SSE 流式)
// ============================================================

func (h *AIHandler) Chat(c *gin.Context) {
	var body struct {
		ComicID      string                `json:"comicId"`
		TargetLang   string                `json:"targetLang"`
		Question     string                `json:"question"`
		ContextText  string                `json:"contextText"`  // 小说：当前章节文本
		ContextImage *service.ImageContent `json:"contextImage"` // 漫画：当前页图片 base64
		History      []service.ChatMessage `json:"history"`      // 对话历史
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Question == "" {
		c.JSON(400, gin.H{"error": "question is required"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	// 权限校验：如果指定了漫画ID，检查用户是否有权访问
	if body.ComicID != "" {
		if err := checkComicAccess(c, body.ComicID); err != nil {
			return
		}
	}

	// 获取作品标题和类型
	title := "Unknown"
	contentType := "content"
	if body.ComicID != "" {
		if comic, err := store.GetComicByID(body.ComicID); err == nil && comic != nil {
			title = comic.Title
			contentType = "comic/manga"
			if service.IsNovelFilename(comic.Filename) {
				contentType = "novel/light novel"
			}
		}
	}

	// 设置 SSE 响应头
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.Flush()

	err := service.ChatWithContextStream(cfg, title, contentType, body.TargetLang,
		body.ContextText, body.ContextImage,
		body.History, body.Question,
		func(chunk service.StreamChunk) bool {
			if chunk.Error != "" {
				data, _ := json.Marshal(chunk)
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				c.Writer.Flush()
				return false
			}
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

// ============================================================
// Phase 3-2: POST /api/comics/:id/ai-chapter-summary — 章节 AI 总结
// ============================================================

func (h *AIHandler) ChapterSummary(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	// 权限校验：检查用户是否有权访问该漫画
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}

	var body struct {
		ChapterIndex int    `json:"chapterIndex"`
		TargetLang   string `json:"targetLang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 获取章节内容
	chapter, err := service.GetChapterContent(comicID, body.ChapterIndex)
	if err != nil {
		c.JSON(404, gin.H{"error": "Chapter not found: " + err.Error()})
		return
	}

	// 清理 HTML 标签（如果是 EPUB），提取纯文本
	chapterText := chapter.Content
	if strings.Contains(chapter.MimeType, "html") {
		chapterText = stripHTMLTags(chapterText)
	}

	summary, err := service.SummarizeChapter(cfg, comicID, body.ChapterIndex, chapter.Title, chapterText, comic.Title, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"success": true,
		"summary": summary,
	})
}

// POST /api/comics/:id/ai-chapter-summaries — 批量章节总结
func (h *AIHandler) BatchChapterSummaries(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	// 权限校验：检查用户是否有权访问该漫画
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}

	var body struct {
		ChapterIndices []int  `json:"chapterIndices"` // 要总结的章节索引列表
		TargetLang     string `json:"targetLang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}
	if len(body.ChapterIndices) == 0 {
		c.JSON(400, gin.H{"error": "chapterIndices is required"})
		return
	}
	// 限制单次最多处理 10 个章节
	if len(body.ChapterIndices) > 10 {
		body.ChapterIndices = body.ChapterIndices[:10]
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 设置 SSE 流式返回，逐条推送
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.Flush()

	for _, idx := range body.ChapterIndices {
		chapter, err := service.GetChapterContent(comicID, idx)
		if err != nil {
			// 跳过失败的章节
			data, _ := json.Marshal(gin.H{
				"chapterIndex": idx,
				"error":        err.Error(),
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			continue
		}

		chapterText := chapter.Content
		if strings.Contains(chapter.MimeType, "html") {
			chapterText = stripHTMLTags(chapterText)
		}

		summary, err := service.SummarizeChapter(cfg, comicID, idx, chapter.Title, chapterText, comic.Title, body.TargetLang)
		if err != nil {
			data, _ := json.Marshal(gin.H{
				"chapterIndex": idx,
				"title":        chapter.Title,
				"error":        err.Error(),
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			continue
		}

		data, _ := json.Marshal(gin.H{
			"chapterIndex": summary.ChapterIndex,
			"title":        summary.Title,
			"summary":      summary.Summary,
		})
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		c.Writer.Flush()
	}

	// 完成标记
	fmt.Fprintf(c.Writer, "data: {\"done\":true}\n\n")
	c.Writer.Flush()
}

// stripHTMLTags 简单的 HTML 标签移除（用于章节摘要时获取纯文本）
func stripHTMLTags(s string) string {
	result := strings.Builder{}
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			result.WriteRune(' ')
			continue
		}
		if !inTag {
			result.WriteRune(r)
		}
	}
	// 压缩连续空白
	text := result.String()
	for strings.Contains(text, "  ") {
		text = strings.ReplaceAll(text, "  ", " ")
	}
	return strings.TrimSpace(text)
}
