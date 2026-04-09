package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

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
