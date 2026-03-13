package handler

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type MetadataHandler struct{}

func NewMetadataHandler() *MetadataHandler { return &MetadataHandler{} }

// POST /api/metadata/search
// Also handles GET /api/metadata/search?q=...&sources=...&lang=...
func (h *MetadataHandler) Search(c *gin.Context) {
	var query, lang string
	var sources []string

	if c.Request.Method == "GET" {
		query = c.Query("q")
		lang = c.DefaultQuery("lang", "en")
		if s := c.Query("sources"); s != "" {
			sources = strings.Split(s, ",")
		}
	} else {
		var body struct {
			Query   string   `json:"query"`
			Sources []string `json:"sources"`
			Lang    string   `json:"lang"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": "invalid request body"})
			return
		}
		query = body.Query
		sources = body.Sources
		lang = body.Lang
		if lang == "" {
			lang = "en"
		}
	}

	if query == "" {
		c.JSON(400, gin.H{"error": "query is required"})
		return
	}

	results := service.SearchMetadata(query, sources, lang)
	if results == nil {
		results = []service.ComicMetadata{}
	}
	c.JSON(200, gin.H{"results": results})
}

// POST /api/metadata/apply
func (h *MetadataHandler) Apply(c *gin.Context) {
	var body struct {
		ComicID   string                `json:"comicId"`
		Metadata  service.ComicMetadata `json:"metadata"`
		Lang      string                `json:"lang"`
		Overwrite bool                  `json:"overwrite"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if body.ComicID == "" {
		c.JSON(400, gin.H{"error": "comicId and metadata are required"})
		return
	}

	comic, err := service.ApplyMetadata(body.ComicID, body.Metadata, body.Lang, body.Overwrite)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to apply metadata"})
		return
	}
	c.JSON(200, gin.H{"comic": comic})
}

// POST /api/metadata/scan
func (h *MetadataHandler) Scan(c *gin.Context) {
	var body struct {
		ComicID string `json:"comicId"`
		Lang    string `json:"lang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ComicID == "" {
		c.JSON(400, gin.H{"error": "comicId is required"})
		return
	}
	if body.Lang == "" {
		body.Lang = "en"
	}

	comic, err := store.GetComicByID(body.ComicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// Find actual file path
	filePath := findComicFile(comic.Filename)
	if filePath == "" {
		c.JSON(404, gin.H{"error": "Comic file not found on disk"})
		return
	}

	// Try extracting ComicInfo.xml first
	comicInfo, _ := service.ExtractComicInfoFromArchive(filePath)
	if comicInfo != nil && comicInfo.Title != "" {
		result, err := service.ApplyMetadata(body.ComicID, *comicInfo, body.Lang, false)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to apply metadata"})
			return
		}
		c.JSON(200, gin.H{
			"comic":  result,
			"source": "comicinfo",
		})
		return
	}

	// Fallback: search online by filename
	searchQuery := service.ExtractSearchQuery(comic.Filename)
	if searchQuery == "" {
		c.JSON(200, gin.H{
			"comic":   comic,
			"source":  "none",
			"message": "No search query could be derived from filename",
		})
		return
	}

	results := service.SearchMetadata(searchQuery, nil, body.Lang)
	if len(results) == 0 {
		c.JSON(200, gin.H{
			"comic":   comic,
			"source":  "none",
			"message": "No metadata found online",
		})
		return
	}

	// Apply best match
	updated, err := service.ApplyMetadata(body.ComicID, results[0], body.Lang, false)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to apply metadata"})
		return
	}
	c.JSON(200, gin.H{
		"comic":  updated,
		"source": results[0].Source,
	})
}

// POST /api/metadata/batch — SSE stream
func (h *MetadataHandler) Batch(c *gin.Context) {
	var body struct {
		Mode string `json:"mode"` // "all" or "missing"
		Lang string `json:"lang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		body.Mode = "all"
		body.Lang = "en"
	}
	if body.Lang == "" {
		body.Lang = "en"
	}

	// Get all comics
	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	// If mode=missing, filter to only those without metadata
	var comics []store.ComicIDFilename
	if body.Mode == "missing" {
		for _, comic := range allComics {
			detail, _ := store.GetComicByID(comic.ID)
			if detail != nil && detail.MetadataSource == "" {
				comics = append(comics, comic)
			}
		}
	} else {
		comics = allComics
	}

	total := len(comics)

	// SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.Flush()

	sendSSE := func(data interface{}) {
		jsonData, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(jsonData))
		c.Writer.Flush()
	}

	sendSSE(gin.H{"type": "start", "total": total})

	success := 0
	failed := 0

	for i, comic := range comics {
		progress := gin.H{
			"type":     "progress",
			"current":  i + 1,
			"total":    total,
			"comicId":  comic.ID,
			"filename": comic.Filename,
		}

		filePath := findComicFile(comic.Filename)

		// Try ComicInfo.xml first
		if filePath != "" {
			comicInfo, _ := service.ExtractComicInfoFromArchive(filePath)
			if comicInfo != nil && comicInfo.Title != "" {
				_, err := service.ApplyMetadata(comic.ID, *comicInfo, body.Lang, false)
				if err == nil {
					progress["status"] = "success"
					progress["source"] = "comicinfo"
					sendSSE(progress)
					success++
					continue
				}
			}
		}

		// Online search fallback
		searchQuery := service.ExtractSearchQuery(comic.Filename)
		if searchQuery == "" {
			progress["status"] = "skipped"
			progress["message"] = "No search query"
			sendSSE(progress)
			failed++
			continue
		}

		results := service.SearchMetadata(searchQuery, nil, body.Lang)
		if len(results) > 0 {
			_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, false)
			if err == nil {
				progress["status"] = "success"
				progress["source"] = results[0].Source
				sendSSE(progress)
				success++
				continue
			}
		}

		progress["status"] = "failed"
		progress["message"] = "No metadata found"
		sendSSE(progress)
		failed++
	}

	sendSSE(gin.H{
		"type":    "complete",
		"total":   total,
		"success": success,
		"failed":  failed,
	})
}

// POST /api/metadata/translate-batch — SSE stream
func (h *MetadataHandler) TranslateBatch(c *gin.Context) {
	var body struct {
		TargetLang string `json:"targetLang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TargetLang == "" {
		c.JSON(400, gin.H{"error": "targetLang is required"})
		return
	}

	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	total := len(allComics)

	// SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.Flush()

	sendSSE := func(data interface{}) {
		jsonData, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(jsonData))
		c.Writer.Flush()
	}

	sendSSE(gin.H{"type": "start", "total": total})

	aiCfg := service.LoadAIConfig()
	translated := 0
	skipped := 0

	for i, comic := range allComics {
		detail, err := store.GetComicByID(comic.ID)
		if err != nil || detail == nil {
			sendSSE(gin.H{"type": "progress", "current": i + 1, "total": total, "status": "skipped"})
			skipped++
			continue
		}

		updates := map[string]interface{}{}

		// Translate genre locally
		if detail.Genre != "" {
			translatedGenre := service.TranslateGenre(detail.Genre, body.TargetLang)
			if translatedGenre != detail.Genre {
				updates["genre"] = translatedGenre
			}
		}

		// Try AI translation for other fields
		if aiCfg.EnableCloudAI && aiCfg.CloudAPIKey != "" {
			fields := map[string]string{}
			if detail.Title != "" {
				fields["title"] = detail.Title
			}
			if detail.Description != "" {
				fields["description"] = detail.Description
			}
			if detail.SeriesName != "" {
				fields["seriesName"] = detail.SeriesName
			}

			if len(fields) > 0 {
				result, err := service.TranslateMetadataFields(aiCfg, fields, body.TargetLang)
				if err == nil && result != nil {
					for k, v := range result {
						if v != "" {
							updates[k] = v
						}
					}
				}
			}
		}

		if len(updates) > 0 {
			_ = store.UpdateComicFields(comic.ID, updates)
			translated++
			sendSSE(gin.H{"type": "progress", "current": i + 1, "total": total, "status": "translated", "comicId": comic.ID})
		} else {
			skipped++
			sendSSE(gin.H{"type": "progress", "current": i + 1, "total": total, "status": "skipped"})
		}
	}

	sendSSE(gin.H{
		"type":       "complete",
		"total":      total,
		"translated": translated,
		"skipped":    skipped,
	})
}

// Helper: find comic file on disk across all comic directories.
func findComicFile(filename string) string {
	for _, dir := range config.GetAllComicsDirs() {
		fp := filepath.Join(dir, filename)
		if _, err := os.Stat(fp); err == nil {
			return fp
		}
	}
	return ""
}
