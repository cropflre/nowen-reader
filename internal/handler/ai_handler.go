package handler

import (
	"strconv"
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
		"enableAutoTag":        cfg.EnableAutoTag,
		"enableSemanticSearch": cfg.EnableSemanticSearch,
		"enablePerceptualHash": cfg.EnablePerceptualHash,
		"autoTagConfidence":    cfg.AutoTagConfidence,
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

// GET /api/ai/search?q=...&limit=...
func (h *AIHandler) Search(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(400, gin.H{"error": "q parameter is required"})
		return
	}

	limit := 20
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableSemanticSearch {
		c.JSON(200, gin.H{"results": []interface{}{}, "message": "Semantic search is disabled"})
		return
	}

	// Get all comics for semantic search
	allComics, err := store.GetAllComicsForRecommendation()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to load comics"})
		return
	}

	// Convert to semantic search format
	var searchCorpus []struct {
		ID          string
		Title       string
		Tags        []string
		Genre       string
		Author      string
		Description string
	}
	for _, comic := range allComics {
		var tagNames []string
		for _, t := range comic.Tags {
			tagNames = append(tagNames, t.Name)
		}
		searchCorpus = append(searchCorpus, struct {
			ID          string
			Title       string
			Tags        []string
			Genre       string
			Author      string
			Description string
		}{
			ID:    comic.ID,
			Title: comic.Title,
			Tags:  tagNames,
			Genre: comic.Genre,
			Author: comic.Author,
		})
	}

	results := service.SemanticSearch(query, searchCorpus, limit)

	// Enrich results with comic details
	type enrichedResult struct {
		ID       string  `json:"id"`
		Title    string  `json:"title"`
		Score    float64 `json:"score"`
		CoverURL string  `json:"coverUrl"`
		Author   string  `json:"author"`
		Genre    string  `json:"genre"`
	}

	var enriched []enrichedResult
	for _, r := range results {
		comic, _ := store.GetComicByID(r.ID)
		if comic != nil {
			enriched = append(enriched, enrichedResult{
				ID:       r.ID,
				Title:    comic.Title,
				Score:    r.Score,
				CoverURL: comic.CoverURL,
				Author:   comic.Author,
				Genre:    comic.Genre,
			})
		}
	}

	c.JSON(200, gin.H{"results": enriched})
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

// POST /api/ai/analyze
func (h *AIHandler) Analyze(c *gin.Context) {
	var body struct {
		ComicID string `json:"comicId"`
		Action  string `json:"action"` // "analyzeCover" or "completeMetadata"
		Type    string `json:"type"`
		Title   string `json:"title"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "Cloud AI not configured"})
		return
	}

	switch body.Action {
	case "analyzeCover":
		// Simplified: return placeholder since cover analysis requires multimodal
		c.JSON(200, gin.H{"message": "Cover analysis not yet implemented in Go backend"})
	case "completeMetadata":
		if body.ComicID == "" {
			c.JSON(400, gin.H{"error": "comicId required"})
			return
		}
		comic, err := store.GetComicByID(body.ComicID)
		if err != nil || comic == nil {
			c.JSON(404, gin.H{"error": "Comic not found"})
			return
		}

		fields := map[string]string{
			"title":  comic.Title,
			"author": comic.Author,
			"genre":  comic.Genre,
		}
		result, err := service.TranslateMetadataFields(cfg, fields, "en")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"result": result})
	default:
		c.JSON(400, gin.H{"error": "Unknown action"})
	}
}
