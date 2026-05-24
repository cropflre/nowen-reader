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
		if meta.Title != "" && (comic.Title == store.FilenameToTitle(comic.Filename) || comic.Title == store.FilenameToSmartTitle(comic.Filename)) {
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
