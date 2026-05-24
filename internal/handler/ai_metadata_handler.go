package handler

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

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
		if parsed.Title != "" && (comic.Title == store.FilenameToTitle(comic.Filename) || comic.Title == store.FilenameToSmartTitle(comic.Filename)) {
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
