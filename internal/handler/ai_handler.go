package handler

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
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
