package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

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
	enhancedStats, err := store.GetEnhancedReadingStats(getUserID(c))
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
