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
	apiURL := strings.TrimSpace(c.Query("apiUrl"))
	apiKey := c.Query("apiKey")

	cfg := service.LoadAIConfig()
	if provider == "" {
		provider = cfg.CloudProvider
	}
	if apiURL == "" {
		apiURL = cfg.CloudAPIURL
	}
	if apiKey == "" || strings.Contains(apiKey, "****") {
		apiKey = cfg.CloudAPIKey
	}

	preset, ok := service.ProviderPresets[provider]
	if ok && apiURL == "" {
		apiURL = preset.APIURL
	}

	// Known providers keep their curated list, but normalize it to the object
	// shape expected by the settings UI.
	if ok && provider != "compatible" && len(preset.Models) > 0 {
		models := make([]service.OpenAICompatibleModel, 0, len(preset.Models))
		for _, id := range preset.Models {
			models = append(models, service.OpenAICompatibleModel{ID: id})
		}
		c.JSON(200, gin.H{
			"models":   models,
			"provider": provider,
			"source":   "preset",
		})
		return
	}

	// Custom/OpenAI-compatible providers must be queried dynamically. The
	// configured URL may be either a base URL (/v1) or a full chat endpoint;
	// the service normalizes both forms before requesting /models.
	if apiURL == "" {
		c.JSON(400, gin.H{"error": "API URL is required for a custom OpenAI-compatible provider"})
		return
	}
	if apiKey == "" {
		c.JSON(400, gin.H{"error": "API key is required to fetch provider models"})
		return
	}

	models, err := service.FetchOpenAICompatibleModels(apiURL, apiKey)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{
		"models":   models,
		"provider": provider,
		"source":   "remote",
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
