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

type AIHandler struct{}

func NewAIHandler() *AIHandler { return &AIHandler{} }

// GET /api/ai/status
func (h *AIHandler) Status(c *gin.Context) {
	status := service.GetAIStatus()
	c.JSON(200, status)
}

// GET /api/ai/settings
func (h *AIHandler) GetSettings(c *gin.Context) {
	cfg := service.LoadAIConfig()
	// Mask API key
	maskedKey := ""
	if cfg.CloudAPIKey != "" {
		if len(cfg.CloudAPIKey) > 8 {
			maskedKey = cfg.CloudAPIKey[:4] + "****" + cfg.CloudAPIKey[len(cfg.CloudAPIKey)-4:]
		} else {
			maskedKey = "****"
		}
	}

	c.JSON(200, gin.H{
		"enableCloudAI":   cfg.EnableCloudAI,
		"cloudProvider":   cfg.CloudProvider,
		"cloudApiKey":     maskedKey,
		"cloudApiUrl":     cfg.CloudAPIURL,
		"cloudModel":      cfg.CloudModel,
		"maxTokens":       cfg.MaxTokens,
		"maxRetries":      cfg.MaxRetries,
		"providerPresets": service.ProviderPresets,
	})
}

// PUT /api/ai/settings
func (h *AIHandler) UpdateSettings(c *gin.Context) {
	var body service.AIConfig
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}

	// Protect existing API key if masked
	if strings.Contains(body.CloudAPIKey, "****") {
		existing := service.LoadAIConfig()
		body.CloudAPIKey = existing.CloudAPIKey
	}

	if err := service.SaveAIConfig(body); err != nil {
		c.JSON(500, gin.H{"error": "Failed to save AI config"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// GET /api/ai/models?provider=...&apiUrl=...&apiKey=...
func (h *AIHandler) Models(c *gin.Context) {
	provider := c.Query("provider")
	apiURL := c.Query("apiUrl")
	apiKey := c.Query("apiKey")

	if provider == "" {
		cfg := service.LoadAIConfig()
		provider = cfg.CloudProvider
		if apiURL == "" {
			apiURL = cfg.CloudAPIURL
		}
		if apiKey == "" {
			apiKey = cfg.CloudAPIKey
		}
	}

	if apiKey == "" || strings.Contains(apiKey, "****") {
		cfg := service.LoadAIConfig()
		apiKey = cfg.CloudAPIKey
	}

	preset, ok := service.ProviderPresets[provider]
	if ok && apiURL == "" {
		apiURL = preset.APIURL
	}

	// Return preset models
	if ok && len(preset.Models) > 0 {
		c.JSON(200, gin.H{
			"models":   preset.Models,
			"provider": provider,
			"source":   "preset",
		})
		return
	}

	c.JSON(200, gin.H{
		"models":   []string{},
		"provider": provider,
		"source":   "none",
	})
}

// GET /api/ai/usage — 获取 AI 使用量统计
func (h *AIHandler) GetUsageStats(c *gin.Context) {
	stats := service.GetAIUsageStats()
	c.JSON(200, stats)
}

// DELETE /api/ai/usage — 重置 AI 使用量统计
func (h *AIHandler) ResetUsageStats(c *gin.Context) {
	service.ResetAIUsageStats()
	c.JSON(200, gin.H{"success": true})
}

// POST /api/ai/test — 测试 AI 连接
func (h *AIHandler) TestConnection(c *gin.Context) {
	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	result, err := service.CallCloudLLM(cfg, "You are a helpful assistant.", "Reply with exactly: OK", &service.LLMCallOptions{
		Scenario:  "test",
		MaxTokens: 10,
	})
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"success": true,
		"reply":   result,
	})
}

// ============================================================
// Phase 1-1: POST /api/comics/:id/ai-summary — AI 生成摘要
// ============================================================

func (h *AIHandler) GenerateSummary(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

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

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 判断内容类型
	contentType := "comic/manga"
	if service.IsNovelFilename(comic.Filename) {
		contentType = "novel/light novel"
	}

	summary, err := service.GenerateSummary(
		cfg,
		comic.Title,
		comic.Author,
		comic.Genre,
		comic.Description,
		contentType,
		body.TargetLang,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	// 自动保存到 description 字段
	if err := store.UpdateComicFields(comicID, map[string]interface{}{
		"description":    summary,
		"metadataSource": "ai",
	}); err != nil {
		c.JSON(500, gin.H{"error": "Failed to save summary"})
		return
	}

	updated, _ := store.GetComicByID(comicID)
	c.JSON(200, gin.H{
		"success": true,
		"summary": summary,
		"comic":   updated,
	})
}

// ============================================================
// Phase 1-2: POST /api/comics/:id/ai-parse-filename — AI 解析文件名
// ============================================================

func (h *AIHandler) ParseFilename(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		Apply bool `json:"apply"` // 是否自动应用解析结果到元数据
	}
	_ = c.ShouldBindJSON(&body)

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

	parsed, err := service.AIParseFilename(cfg, comic.Filename)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	result := gin.H{
		"success": true,
		"parsed":  parsed,
	}

	// 如果 apply=true，自动将解析结果写入元数据
	if body.Apply && parsed != nil {
		updates := map[string]interface{}{}
		if parsed.Title != "" && comic.Title == store.FilenameToTitle(comic.Filename) {
			// 只在标题是从文件名自动生成的情况下才覆盖
			updates["title"] = parsed.Title
		}
		if parsed.Author != "" && comic.Author == "" {
			updates["author"] = parsed.Author
		}
		if parsed.Language != "" && comic.Language == "" {
			updates["language"] = parsed.Language
		}
		if parsed.Genre != "" && comic.Genre == "" {
			updates["genre"] = parsed.Genre
		}
		if parsed.Year != nil && comic.Year == nil {
			updates["year"] = *parsed.Year
		}
		if len(updates) > 0 {
			updates["metadataSource"] = "ai_parse"
			_ = store.UpdateComicFields(comicID, updates)
		}

		// 添加标签（group + tags）
		var tags []string
		if parsed.Group != "" {
			tags = append(tags, parsed.Group)
		}
		if parsed.Tags != "" {
			for _, t := range strings.Split(parsed.Tags, ",") {
				t = strings.TrimSpace(t)
				if t != "" {
					tags = append(tags, t)
				}
			}
		}
		if len(tags) > 0 {
			_ = store.AddTagsToComic(comicID, tags)
		}

		updated, _ := store.GetComicByID(comicID)
		result["comic"] = updated
		result["applied"] = updates
	}

	c.JSON(200, result)
}

// ============================================================
// Phase 1-3: POST /api/comics/:id/ai-suggest-tags — AI 建议标签
// ============================================================

func (h *AIHandler) SuggestTags(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		TargetLang string `json:"targetLang"`
		Apply      bool   `json:"apply"` // 是否自动添加到标签
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

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 收集已有标签
	var existingTags []string
	for _, t := range comic.Tags {
		existingTags = append(existingTags, t.Name)
	}

	// 判断内容类型
	contentType := "comic/manga"
	if service.IsNovelFilename(comic.Filename) {
		contentType = "novel/light novel"
	}

	suggestedTags, err := service.SuggestTags(
		cfg,
		comic.Title,
		comic.Author,
		comic.Genre,
		comic.Description,
		contentType,
		body.TargetLang,
		existingTags,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	result := gin.H{
		"success":       true,
		"suggestedTags": suggestedTags,
	}

	// 如果 apply=true，自动添加到标签
	if body.Apply && len(suggestedTags) > 0 {
		_ = store.AddTagsToComic(comicID, suggestedTags)
		updated, _ := store.GetComicByID(comicID)
		result["comic"] = updated
	}

	c.JSON(200, result)
}

// ============================================================
// Phase 2-1: POST /api/comics/:id/ai-analyze-cover — Vision 封面分析
// ============================================================

func (h *AIHandler) AnalyzeCover(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		TargetLang string `json:"targetLang"`
		Apply      bool   `json:"apply"` // 是否自动应用分析结果到元数据
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

	// 检查 provider 是否支持 Vision
	if preset, ok := service.ProviderPresets[cfg.CloudProvider]; ok {
		if !preset.SupportsVision {
			c.JSON(400, gin.H{"error": "Current AI provider does not support vision/image analysis. Please switch to a provider with vision support (OpenAI, Anthropic, Google Gemini, etc.)"})
			return
		}
	}

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 获取封面图片数据
	coverData, _, err := service.GetComicThumbnail(comicID)
	if err != nil || len(coverData) == 0 {
		c.JSON(500, gin.H{"error": "Failed to get cover image"})
		return
	}

	// 判断内容类型
	contentType := "comic/manga"
	if service.IsNovelFilename(comic.Filename) {
		contentType = "novel/light novel"
	}

	analysis, err := service.AnalyzeCoverWithVision(cfg, coverData, comic.Title, contentType, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	result := gin.H{
		"success":  true,
		"analysis": analysis,
	}

	// 如果 apply=true，将分析结果写入元数据
	if body.Apply && analysis != nil {
		updates := map[string]interface{}{}

		// 如果当前没有 genre，用分析出的 theme+style 组合
		if comic.Genre == "" && analysis.Theme != "" {
			genre := analysis.Theme
			if analysis.Style != "" {
				genre = analysis.Style + ", " + genre
			}
			updates["genre"] = genre
		}

		// 如果没有描述，用分析出的描述
		if comic.Description == "" && analysis.Description != "" {
			updates["description"] = analysis.Description
		}

		if len(updates) > 0 {
			updates["metadataSource"] = "ai_vision"
			_ = store.UpdateComicFields(comicID, updates)
		}

		// 添加分析出的标签
		if len(analysis.Tags) > 0 {
			tagsToAdd := analysis.Tags
			if analysis.Mood != "" {
				tagsToAdd = append(tagsToAdd, analysis.Mood)
			}
			if analysis.ColorTone != "" {
				tagsToAdd = append(tagsToAdd, analysis.ColorTone)
			}
			_ = store.AddTagsToComic(comicID, tagsToAdd)
		}

		updated, _ := store.GetComicByID(comicID)
		result["comic"] = updated
		result["applied"] = true
	}

	c.JSON(200, result)
}

// ============================================================
// Phase 2-2: POST /api/recommendations/ai-reasons — AI 推荐理由
// ============================================================

func (h *AIHandler) GenerateRecommendationReasons(c *gin.Context) {
	var body struct {
		TargetLang string `json:"targetLang"`
		Items      []struct {
			ID      string   `json:"id"`
			Title   string   `json:"title"`
			Reasons []string `json:"reasons"`
			Genre   string   `json:"genre"`
			Author  string   `json:"author"`
		} `json:"items"`
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

	// 转换为 service 层结构
	var items []service.RecommendationItem
	for _, item := range body.Items {
		items = append(items, service.RecommendationItem{
			ID:      item.ID,
			Title:   item.Title,
			Reasons: item.Reasons,
			Genre:   item.Genre,
			Author:  item.Author,
		})
	}

	// 获取用户收藏作品名称
	var userFavorites []string
	favs, err := store.GetFavoriteComicTitles(5)
	if err == nil {
		userFavorites = favs
	}

	reasons, err := service.GenerateRecommendationReasons(cfg, items, userFavorites, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"success": true,
		"reasons": reasons,
	})
}

// ============================================================
// Phase 2-3: Prompt 模板管理 API
// ============================================================

// GET /api/ai/prompts — 获取 prompt 模板
func (h *AIHandler) GetPromptTemplates(c *gin.Context) {
	templates := service.LoadPromptTemplates()
	defaults := service.GetDefaultPromptTemplates()
	c.JSON(200, gin.H{
		"templates": templates,
		"defaults":  defaults,
	})
}

// PUT /api/ai/prompts — 保存自定义 prompt 模板
func (h *AIHandler) UpdatePromptTemplates(c *gin.Context) {
	var templates service.PromptTemplates
	if err := c.ShouldBindJSON(&templates); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if err := service.SavePromptTemplates(templates); err != nil {
		c.JSON(500, gin.H{"error": "Failed to save prompt templates"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// DELETE /api/ai/prompts — 重置 prompt 模板为默认
func (h *AIHandler) ResetPromptTemplates(c *gin.Context) {
	_ = service.ResetPromptTemplates()
	c.JSON(200, gin.H{
		"success":  true,
		"defaults": service.GetDefaultPromptTemplates(),
	})
}

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
	enhancedStats, err := store.GetEnhancedReadingStats()
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

// ============================================================
// Phase 5-2: POST /api/ai/batch-suggest-tags — AI 批量标签标注 (SSE)
// ============================================================

func (h *AIHandler) BatchSuggestTags(c *gin.Context) {
	var body struct {
		ComicIDs   []string `json:"comicIds"`
		TargetLang string   `json:"targetLang"`
		Apply      bool     `json:"apply"` // 是否自动应用标签
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.ComicIDs) == 0 {
		c.JSON(400, gin.H{"error": "comicIds array is required"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}
	// 限制单次最多处理 30 本
	if len(body.ComicIDs) > 30 {
		body.ComicIDs = body.ComicIDs[:30]
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	// SSE 流式返回，逐条推送
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.Flush()

	successCount := 0
	failCount := 0

	for i, comicID := range body.ComicIDs {
		comic, err := store.GetComicByID(comicID)
		if err != nil || comic == nil {
			failCount++
			data, _ := json.Marshal(gin.H{
				"comicId": comicID,
				"index":   i,
				"total":   len(body.ComicIDs),
				"error":   "Comic not found",
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			continue
		}

		// 收集已有标签
		var existingTags []string
		for _, t := range comic.Tags {
			existingTags = append(existingTags, t.Name)
		}

		// 判断内容类型
		contentType := "comic/manga"
		if service.IsNovelFilename(comic.Filename) {
			contentType = "novel/light novel"
		}

		suggestedTags, err := service.SuggestTags(
			cfg,
			comic.Title,
			comic.Author,
			comic.Genre,
			comic.Description,
			contentType,
			body.TargetLang,
			existingTags,
		)

		if err != nil {
			failCount++
			data, _ := json.Marshal(gin.H{
				"comicId": comicID,
				"title":   comic.Title,
				"index":   i,
				"total":   len(body.ComicIDs),
				"error":   err.Error(),
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			continue
		}

		// 如果 apply=true，自动添加标签
		if body.Apply && len(suggestedTags) > 0 {
			_ = store.AddTagsToComic(comicID, suggestedTags)
		}

		successCount++
		data, _ := json.Marshal(gin.H{
			"comicId":       comicID,
			"title":         comic.Title,
			"index":         i,
			"total":         len(body.ComicIDs),
			"suggestedTags": suggestedTags,
			"applied":       body.Apply,
		})
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		c.Writer.Flush()
	}

	// 完成标记
	doneData, _ := json.Marshal(gin.H{
		"done":    true,
		"success": successCount,
		"failed":  failCount,
		"total":   len(body.ComicIDs),
	})
	fmt.Fprintf(c.Writer, "data: %s\n\n", doneData)
	c.Writer.Flush()
}

// ============================================================
// Phase 6-1: POST /api/ai/enhance-group-detect — AI 智能分组检测增强
// ============================================================

func (h *AIHandler) EnhanceGroupDetect(c *gin.Context) {
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

	// ── 第一阶段：先跑自带智能分组 ──
	localSuggestions, err := store.AutoDetectGroups()
	if err != nil {
		localSuggestions = []store.AutoDetectGroup{}
	}

	// 收集已被自带检测命中的漫画ID
	localMatchedIDs := make(map[string]bool)
	for _, sg := range localSuggestions {
		for _, id := range sg.ComicIDs {
			localMatchedIDs[id] = true
		}
	}

	// ── 第二阶段：收集自带检测未命中的漫画，交给 AI 分析 ──
	grouped, err := store.GetGroupedComicIDs()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get grouped comics"})
		return
	}

	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	var candidates []service.AIGroupCandidate
	for _, comic := range allComics {
		if _, ok := grouped[comic.ID]; ok {
			continue // 跳过已分组的
		}
		if localMatchedIDs[comic.ID] {
			continue // 跳过已被自带检测命中的
		}
		detail, _ := store.GetComicByID(comic.ID)
		title := comic.Filename
		if detail != nil && detail.Title != "" {
			title = detail.Title
		}
		candidates = append(candidates, service.AIGroupCandidate{
			ID:    comic.ID,
			Title: title,
		})
	}

	// ── 第三阶段：合并结果 ──
	var results []gin.H

	// 先添加自带检测的结果（标记来源为 local）
	for _, sg := range localSuggestions {
		results = append(results, gin.H{
			"name":     sg.Name,
			"comicIds": sg.ComicIDs,
			"titles":   sg.Titles,
			"reason":   "",
			"source":   "local",
		})
	}

	// 如果有未匹配的漫画，调用 AI 分析
	if len(candidates) >= 2 {
		aiSuggestions, err := service.AIAnalyzeGroupCandidates(cfg, candidates, body.TargetLang)
		if err == nil && len(aiSuggestions) > 0 {
			for _, s := range aiSuggestions {
				var titles []string
				for _, id := range s.ComicIDs {
					comic, _ := store.GetComicByID(id)
					if comic != nil {
						titles = append(titles, comic.Title)
					} else {
						titles = append(titles, id)
					}
				}
				results = append(results, gin.H{
					"name":     s.GroupName,
					"comicIds": s.ComicIDs,
					"titles":   titles,
					"reason":   s.Reason,
					"source":   "ai",
				})
			}
		}
	}

	if results == nil {
		results = []gin.H{}
	}

	c.JSON(200, gin.H{
		"success":     true,
		"suggestions": results,
	})
}

// ============================================================
// Phase 6-2: POST /api/comics/:id/ai-complete-metadata — AI 智能元数据补全
// ============================================================

func (h *AIHandler) CompleteMetadata(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		TargetLang string `json:"targetLang"`
		Apply      bool   `json:"apply"` // 是否自动应用到元数据
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

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 获取封面数据（可选，用于 Vision 分析）
	var coverData []byte
	coverBytes, _, err := service.GetComicThumbnail(comicID)
	if err == nil && len(coverBytes) > 0 {
		coverData = coverBytes
	}

	meta, err := service.AICompleteMetadata(cfg, comic.Filename, comic.Title, coverData, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	result := gin.H{
		"success":  true,
		"metadata": meta,
	}

	// 如果 apply=true，自动应用到元数据
	if body.Apply && meta != nil {
		updates := map[string]interface{}{}
		if meta.Title != "" && comic.Title == store.FilenameToTitle(comic.Filename) {
			updates["title"] = meta.Title
		}
		if meta.Author != "" && comic.Author == "" {
			updates["author"] = meta.Author
		}
		if meta.Genre != "" && comic.Genre == "" {
			updates["genre"] = meta.Genre
		}
		if meta.Description != "" && comic.Description == "" {
			updates["description"] = meta.Description
		}
		if meta.Language != "" && comic.Language == "" {
			updates["language"] = meta.Language
		}
		if meta.Year != nil && comic.Year == nil {
			updates["year"] = *meta.Year
		}

		if len(updates) > 0 {
			updates["metadataSource"] = "ai_complete"
			_ = store.UpdateComicFields(comicID, updates)
		}

		// 添加标签
		if meta.Tags != "" {
			var tags []string
			for _, t := range strings.Split(meta.Tags, ",") {
				t = strings.TrimSpace(t)
				if t != "" {
					tags = append(tags, t)
				}
			}
			if len(tags) > 0 {
				_ = store.AddTagsToComic(comicID, tags)
			}
		}

		updated, _ := store.GetComicByID(comicID)
		result["comic"] = updated
		result["applied"] = updates
	}

	c.JSON(200, result)
}

// ============================================================
// Phase 6-3: POST /api/ai/suggest-category — AI 自动分类（单本）
// ============================================================

func (h *AIHandler) SuggestCategory(c *gin.Context) {
	var body struct {
		ComicID    string `json:"comicId"`
		TargetLang string `json:"targetLang"`
		Apply      bool   `json:"apply"` // 是否自动应用
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ComicID == "" {
		c.JSON(400, gin.H{"error": "comicId is required"})
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

	comic, err := store.GetComicByID(body.ComicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 获取可用分类
	categories, err := store.GetAllCategories()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get categories"})
		return
	}
	var availCats []map[string]string
	for _, cat := range categories {
		availCats = append(availCats, map[string]string{
			"slug": cat.Slug,
			"name": cat.Name,
		})
	}
	if len(availCats) == 0 {
		c.JSON(400, gin.H{"error": "No categories available. Please initialize categories first."})
		return
	}

	// 收集标签
	var tags []string
	for _, t := range comic.Tags {
		tags = append(tags, t.Name)
	}

	contentType := "comic/manga"
	if service.IsNovelFilename(comic.Filename) {
		contentType = "novel/light novel"
	}

	suggestedSlugs, err := service.SuggestCategory(cfg, comic.Title, comic.Author, comic.Genre, comic.Description, contentType, tags, availCats, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	result := gin.H{
		"success":             true,
		"suggestedCategories": suggestedSlugs,
	}

	if body.Apply && len(suggestedSlugs) > 0 {
		_ = store.BatchSetCategory([]string{body.ComicID}, suggestedSlugs)
		updated, _ := store.GetComicByID(body.ComicID)
		result["comic"] = updated
	}

	c.JSON(200, result)
}

// ============================================================
// Phase 6-3b: POST /api/ai/batch-suggest-category — AI 批量自动分类 (SSE)
// ============================================================

func (h *AIHandler) BatchSuggestCategory(c *gin.Context) {
	var body struct {
		ComicIDs   []string `json:"comicIds"`
		TargetLang string   `json:"targetLang"`
		Apply      bool     `json:"apply"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.ComicIDs) == 0 {
		c.JSON(400, gin.H{"error": "comicIds array is required"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}
	if len(body.ComicIDs) > 30 {
		body.ComicIDs = body.ComicIDs[:30]
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	// 获取可用分类
	categories, err := store.GetAllCategories()
	if err != nil || len(categories) == 0 {
		c.JSON(400, gin.H{"error": "No categories available"})
		return
	}
	var availCats []map[string]string
	for _, cat := range categories {
		availCats = append(availCats, map[string]string{
			"slug": cat.Slug,
			"name": cat.Name,
		})
	}

	// SSE 流式返回
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.Flush()

	successCount := 0
	failCount := 0

	for i, comicID := range body.ComicIDs {
		comic, err := store.GetComicByID(comicID)
		if err != nil || comic == nil {
			failCount++
			data, _ := json.Marshal(gin.H{
				"comicId": comicID,
				"index":   i,
				"total":   len(body.ComicIDs),
				"error":   "Comic not found",
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			continue
		}

		var tags []string
		for _, t := range comic.Tags {
			tags = append(tags, t.Name)
		}

		contentType := "comic/manga"
		if service.IsNovelFilename(comic.Filename) {
			contentType = "novel/light novel"
		}

		slugs, err := service.SuggestCategory(cfg, comic.Title, comic.Author, comic.Genre, comic.Description, contentType, tags, availCats, body.TargetLang)
		if err != nil {
			failCount++
			data, _ := json.Marshal(gin.H{
				"comicId": comicID,
				"title":   comic.Title,
				"index":   i,
				"total":   len(body.ComicIDs),
				"error":   err.Error(),
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			continue
		}

		if body.Apply && len(slugs) > 0 {
			_ = store.BatchSetCategory([]string{comicID}, slugs)
		}

		successCount++
		data, _ := json.Marshal(gin.H{
			"comicId":             comicID,
			"title":               comic.Title,
			"index":               i,
			"total":               len(body.ComicIDs),
			"suggestedCategories": slugs,
			"applied":             body.Apply,
		})
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		c.Writer.Flush()
	}

	doneData, _ := json.Marshal(gin.H{
		"done":    true,
		"success": successCount,
		"failed":  failCount,
		"total":   len(body.ComicIDs),
	})
	fmt.Fprintf(c.Writer, "data: %s\n\n", doneData)
	c.Writer.Flush()
}

// ============================================================
// Phase 7-1: POST /api/comics/:id/ai-chapter-recap — AI 章节回顾/前情提要
// ============================================================

func (h *AIHandler) ChapterRecap(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		ChapterIndex int    `json:"chapterIndex"` // 当前要阅读的章节索引
		TargetLang   string `json:"targetLang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}
	if body.ChapterIndex < 1 {
		c.JSON(400, gin.H{"error": "chapterIndex must be >= 1 (need at least 1 previous chapter)"})
		return
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

	// 收集之前章节的摘要（从缓存或即时生成）
	var previousSummaries []string
	startIdx := 0
	if body.ChapterIndex > 10 {
		startIdx = body.ChapterIndex - 10 // 最多回顾前 10 章
	}

	for i := startIdx; i < body.ChapterIndex; i++ {
		cached := service.GetChapterSummaryFromCache(comicID, i)
		if cached != nil {
			previousSummaries = append(previousSummaries, cached.Summary)
			continue
		}

		// 如果没有缓存，尝试即时生成
		chapter, err := service.GetChapterContent(comicID, i)
		if err != nil {
			previousSummaries = append(previousSummaries, "")
			continue
		}

		chapterText := chapter.Content
		if strings.Contains(chapter.MimeType, "html") {
			chapterText = stripHTMLTags(chapterText)
		}

		summary, err := service.SummarizeChapter(cfg, comicID, i, chapter.Title, chapterText, comic.Title, body.TargetLang)
		if err != nil {
			previousSummaries = append(previousSummaries, "")
			continue
		}
		previousSummaries = append(previousSummaries, summary.Summary)
	}

	// 获取当前章节标题
	currentChapterTitle := fmt.Sprintf("Chapter %d", body.ChapterIndex+1)
	currentChapter, err := service.GetChapterContent(comicID, body.ChapterIndex)
	if err == nil && currentChapter.Title != "" {
		currentChapterTitle = currentChapter.Title
	}

	recap, err := service.GenerateChapterRecap(cfg, comic.Title, previousSummaries, currentChapterTitle, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"success": true,
		"recap":   recap,
	})
}

// ============================================================
// Phase 7-2: POST /api/ai/verify-duplicates — AI 重复漫画智能判定
// ============================================================

func (h *AIHandler) VerifyDuplicates(c *gin.Context) {
	var body struct {
		Groups []struct {
			Reason string `json:"reason"`
			Comics []struct {
				ID        string `json:"id"`
				Filename  string `json:"filename"`
				Title     string `json:"title"`
				FileSize  int64  `json:"fileSize"`
				PageCount int    `json:"pageCount"`
			} `json:"comics"`
		} `json:"groups"`
		TargetLang string `json:"targetLang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Groups) == 0 {
		c.JSON(400, gin.H{"error": "groups array is required"})
		return
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}
	if len(body.Groups) > 10 {
		body.Groups = body.Groups[:10] // 最多分析 10 组
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	type GroupVerification struct {
		GroupIndex   int                              `json:"groupIndex"`
		Verification *service.AIDuplicateVerification `json:"verification"`
		Error        string                           `json:"error,omitempty"`
	}

	var results []GroupVerification

	for gi, group := range body.Groups {
		if len(group.Comics) < 2 {
			results = append(results, GroupVerification{
				GroupIndex: gi,
				Error:      "group has less than 2 comics",
			})
			continue
		}

		// 构建候选信息
		var candidates []map[string]string
		var coverDataList [][]byte
		for _, comic := range group.Comics {
			candidates = append(candidates, map[string]string{
				"filename":  comic.Filename,
				"title":     comic.Title,
				"fileSize":  fmt.Sprintf("%d", comic.FileSize),
				"pageCount": fmt.Sprintf("%d", comic.PageCount),
			})
			// 获取封面数据
			coverData, _, err := service.GetComicThumbnail(comic.ID)
			if err == nil && len(coverData) > 0 {
				coverDataList = append(coverDataList, coverData)
			}
		}

		verifications, err := service.AIVerifyDuplicates(cfg, candidates, coverDataList, body.TargetLang)
		if err != nil {
			results = append(results, GroupVerification{
				GroupIndex: gi,
				Error:      err.Error(),
			})
			continue
		}

		var verification *service.AIDuplicateVerification
		if len(verifications) > 0 {
			verification = &verifications[0]
		}

		results = append(results, GroupVerification{
			GroupIndex:   gi,
			Verification: verification,
		})
	}

	c.JSON(200, gin.H{
		"success": true,
		"results": results,
	})
}

// ============================================================
// Phase 7-3: POST /api/ai/recommend-goal — AI 阅读目标推荐
// ============================================================

func (h *AIHandler) RecommendGoal(c *gin.Context) {
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
	enhancedStats, err := store.GetEnhancedReadingStats()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get reading stats"})
		return
	}

	// 收集当前目标
	goalProgress, _ := store.GetAllGoalProgress(getUserID(c))
	var currentGoals []map[string]interface{}
	for _, gp := range goalProgress {
		currentGoals = append(currentGoals, map[string]interface{}{
			"goalType":    gp.Goal.GoalType,
			"targetMins":  gp.Goal.TargetMins,
			"targetBooks": gp.Goal.TargetBooks,
			"currentMins": gp.CurrentMins,
			"progressPct": gp.ProgressPct,
			"achieved":    gp.Achieved,
		})
	}

	// 简化统计数据
	statsData := map[string]interface{}{
		"totalReadTime":   enhancedStats["totalReadTime"],
		"totalSessions":   enhancedStats["totalSessions"],
		"totalComicsRead": enhancedStats["totalComicsRead"],
		"todayReadTime":   enhancedStats["todayReadTime"],
		"weekReadTime":    enhancedStats["weekReadTime"],
		"currentStreak":   enhancedStats["currentStreak"],
		"avgPagesPerHour": enhancedStats["avgPagesPerHour"],
		"monthlyStats":    enhancedStats["monthlyStats"],
	}

	rec, err := service.AIRecommendGoal(cfg, statsData, currentGoals, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"success":        true,
		"recommendation": rec,
	})
}

// ============================================================
// Phase 4-2: POST /api/comics/:id/ai-translate-page — 漫画页面翻译
// ============================================================

func (h *AIHandler) TranslatePage(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		PageIndex  int    `json:"pageIndex"`
		SourceLang string `json:"sourceLang"` // 原文语言，空则自动检测
		TargetLang string `json:"targetLang"`
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

	// 检查缓存
	if cached := service.GetPageTranslationFromCache(comicID, body.PageIndex, body.TargetLang); cached != nil {
		c.JSON(200, gin.H{
			"success":     true,
			"translation": cached,
			"cached":      true,
		})
		return
	}

	// 验证作品存在
	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 获取页面图片数据
	pageImg, err := service.GetPageImage(comicID, body.PageIndex)
	if err != nil {
		c.JSON(404, gin.H{"error": "Page not found: " + err.Error()})
		return
	}
	if pageImg == nil || len(pageImg.Data) == 0 {
		c.JSON(404, gin.H{"error": "Page image data is empty"})
		return
	}

	// 调用 Vision LLM 翻译
	translation, err := service.TranslatePageImage(cfg, pageImg.Data, body.SourceLang, body.TargetLang)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	// 写入缓存
	service.CachePageTranslation(comicID, body.PageIndex, body.TargetLang, translation)

	c.JSON(200, gin.H{
		"success":     true,
		"translation": translation,
		"cached":      false,
	})
}
