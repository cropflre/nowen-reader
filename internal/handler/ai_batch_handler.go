package handler

import (
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

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
		// 权限校验：检查用户是否有权访问该漫画
		if err := checkComicAccess(c, comicID); err != nil {
			failCount++
			data, _ := json.Marshal(gin.H{
				"comicId": comicID,
				"index":   i,
				"total":   len(body.ComicIDs),
				"error":   "access denied",
			})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			continue
		}

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
