package handler

import (
	"encoding/json"
	"fmt"
	"strings"

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
		comic.SeriesName,
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
		if parsed.SeriesName != "" && comic.SeriesName == "" {
			updates["seriesName"] = parsed.SeriesName
		}
		if parsed.SeriesIndex != nil && comic.SeriesIndex == nil {
			updates["seriesIndex"] = *parsed.SeriesIndex
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
	coverData, err := service.GetComicThumbnail(comicID)
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
