package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type TagTranslateHandler struct{}

func NewTagTranslateHandler() *TagTranslateHandler { return &TagTranslateHandler{} }

// POST /api/tags/translate
func (h *TagTranslateHandler) TranslateTags(c *gin.Context) {
	var body struct {
		TargetLang string `json:"targetLang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TargetLang == "" {
		c.JSON(400, gin.H{"error": "targetLang is required"})
		return
	}

	// Get all tags
	tags, err := store.GetAllTags()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get tags"})
		return
	}

	var tagNames []string
	for _, t := range tags {
		tagNames = append(tagNames, t.Name)
	}

	// Translate
	translations := service.TranslateTags(tagNames, body.TargetLang)

	// Apply translations (rename tags in DB)
	renamed := 0
	for oldName, newName := range translations {
		if oldName != newName && newName != "" {
			if err := store.RenameTag(oldName, newName); err == nil {
				renamed++
			}
		}
	}

	c.JSON(200, gin.H{
		"success":      true,
		"translations": translations,
		"renamed":      renamed,
		"total":        len(tagNames),
	})
}

// POST /api/comics/:id/translate-metadata — 支持多引擎翻译
func (h *TagTranslateHandler) TranslateMetadata(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		TargetLang string                  `json:"targetLang"`
		Engine     service.TranslateEngine `json:"engine"` // 可选，指定翻译引擎
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TargetLang == "" {
		c.JSON(400, gin.H{"error": "targetLang is required"})
		return
	}

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 构建待翻译字段
	fields := map[string]string{}
	if comic.Title != "" {
		fields["title"] = comic.Title
	}
	if comic.Description != "" {
		fields["description"] = comic.Description
	}
	if comic.Genre != "" {
		fields["genre"] = comic.Genre
	}

	if len(fields) == 0 {
		c.JSON(200, gin.H{
			"comic":      comic,
			"translated": false,
			"fields":     gin.H{},
			"engine":     "",
		})
		return
	}

	// 使用多引擎翻译服务
	result, err := service.TranslateMetadataFieldsMultiEngine(fields, body.TargetLang, body.Engine)
	if err != nil {
		// 降级：尝试仅本地翻译 genre
		updates := map[string]interface{}{}
		if comic.Genre != "" {
			translatedGenre := service.TranslateGenre(comic.Genre, body.TargetLang)
			if translatedGenre != comic.Genre {
				updates["genre"] = translatedGenre
			}
		}
		if len(updates) > 0 {
			_ = store.UpdateComicFields(comicID, updates)
			updated, _ := store.GetComicByID(comicID)
			c.JSON(200, gin.H{
				"comic":      updated,
				"translated": true,
				"fields":     updates,
				"engine":     "local",
				"warning":    err.Error(),
			})
			return
		}
		c.JSON(500, gin.H{"error": "Translation failed: " + err.Error()})
		return
	}

	// 应用翻译结果
	updates := map[string]interface{}{}
	for k, v := range result.Fields {
		if v != "" {
			updates[k] = v
		}
	}

	if len(updates) > 0 {
		if err := store.UpdateComicFields(comicID, updates); err != nil {
			c.JSON(500, gin.H{"error": "Failed to update comic"})
			return
		}
	}

	// Get updated comic
	updated, _ := store.GetComicByID(comicID)
	c.JSON(200, gin.H{
		"comic":      updated,
		"translated": len(updates) > 0,
		"fields":     updates,
		"engine":     string(result.Engine),
		"cached":     result.Cached,
	})
}

// ============================================================
// 翻译引擎配置与管理 API
// ============================================================

// GET /api/translate/engines — 获取可用翻译引擎列表
func (h *TagTranslateHandler) GetEngines(c *gin.Context) {
	engines := service.GetAvailableEngines()
	c.JSON(200, gin.H{
		"engines": engines,
	})
}

// GET /api/translate/config — 获取翻译配置
func (h *TagTranslateHandler) GetTranslateConfig(c *gin.Context) {
	cfg := service.LoadTranslateConfig()
	// 隐藏敏感信息
	masked := gin.H{
		"preferredEngine":  cfg.PreferredEngine,
		"enginePriority":   cfg.EnginePriority,
		"enableCache":      cfg.EnableCache,
		"cacheExpireDays":  cfg.CacheExpireDays,
		"maxConcurrency":   cfg.MaxConcurrency,
		"deeplFreeApi":     cfg.DeepLFreeAPI,
		"googleConfigured": cfg.GoogleAPIKey != "",
		"baiduConfigured":  cfg.BaiduAppID != "" && cfg.BaiduSecret != "",
		"deeplConfigured":  cfg.DeepLAPIKey != "",
	}
	c.JSON(200, masked)
}

// PUT /api/translate/config — 更新翻译配置
func (h *TagTranslateHandler) UpdateTranslateConfig(c *gin.Context) {
	var body service.TranslateConfig
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}

	// 合并：如果新请求中 API Key 为空，保留旧值
	existing := service.LoadTranslateConfig()
	if body.GoogleAPIKey == "" {
		body.GoogleAPIKey = existing.GoogleAPIKey
	}
	if body.BaiduAppID == "" {
		body.BaiduAppID = existing.BaiduAppID
	}
	if body.BaiduSecret == "" {
		body.BaiduSecret = existing.BaiduSecret
	}
	if body.DeepLAPIKey == "" {
		body.DeepLAPIKey = existing.DeepLAPIKey
	}
	if body.MaxConcurrency <= 0 {
		body.MaxConcurrency = 3
	}

	if err := service.SaveTranslateConfig(&body); err != nil {
		c.JSON(500, gin.H{"error": "Failed to save config"})
		return
	}

	c.JSON(200, gin.H{"success": true})
}

// GET /api/translate/cache/stats — 获取翻译缓存统计
func (h *TagTranslateHandler) GetCacheStats(c *gin.Context) {
	stats := service.GetTranslateCacheStats()
	c.JSON(200, stats)
}

// DELETE /api/translate/cache — 清空翻译缓存
func (h *TagTranslateHandler) ClearCache(c *gin.Context) {
	service.ClearTranslateCache()
	c.JSON(200, gin.H{"success": true})
}

// GET /api/translate/health — 获取引擎健康度
func (h *TagTranslateHandler) GetEngineHealth(c *gin.Context) {
	health := service.GetEngineHealth()
	c.JSON(200, gin.H{
		"engines": health,
	})
}

// POST /api/translate/test — 测试翻译引擎
func (h *TagTranslateHandler) TestEngine(c *gin.Context) {
	var body struct {
		Text       string                  `json:"text"`
		TargetLang string                  `json:"targetLang"`
		Engine     service.TranslateEngine `json:"engine"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if body.Text == "" {
		body.Text = "Action, Adventure, Fantasy"
	}
	if body.TargetLang == "" {
		body.TargetLang = "zh-CN"
	}

	result, err := service.TranslateText(body.Text, body.TargetLang, body.Engine)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"original":   body.Text,
		"translated": result.Text,
		"engine":     string(result.Engine),
		"cached":     result.FromCache,
	})
}
