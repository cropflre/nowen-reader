package handler

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
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
		"enableLocalAI":        cfg.EnableLocalAI,
		"enablePerceptualHash": cfg.EnablePerceptualHash,
		"enableCloudAI":        cfg.EnableCloudAI,
		"cloudProvider":        cfg.CloudProvider,
		"cloudApiKey":          maskedKey,
		"cloudApiUrl":          cfg.CloudAPIURL,
		"cloudModel":           cfg.CloudModel,
		"providerPresets":      service.ProviderPresets,
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

// GET /api/ai/duplicates
func (h *AIHandler) Duplicates(c *gin.Context) {
	cfg := service.LoadAIConfig()
	if !cfg.EnablePerceptualHash {
		c.JSON(200, gin.H{"groups": []interface{}{}, "message": "Perceptual hash is disabled"})
		return
	}

	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to load comics"})
		return
	}

	var comics []struct {
		ID       string
		Filename string
		Title    string
	}
	for _, c := range allComics {
		title := store.FilenameToTitle(c.Filename)
		comics = append(comics, struct {
			ID       string
			Filename string
			Title    string
		}{c.ID, c.Filename, title})
	}

	threshold := 10 // Hamming distance threshold
	groups := service.FindVisuallySimilarCovers(comics, config.GetThumbnailsDir(), threshold)

	c.JSON(200, gin.H{"groups": groups})
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
