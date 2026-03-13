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

// POST /api/comics/:id/translate-metadata
func (h *TagTranslateHandler) TranslateMetadata(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		TargetLang string `json:"targetLang"`
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

	updates := map[string]interface{}{}

	// Translate genre locally
	if comic.Genre != "" {
		translatedGenre := service.TranslateGenre(comic.Genre, body.TargetLang)
		if translatedGenre != comic.Genre {
			updates["genre"] = translatedGenre
		}
	}

	// Try AI translation for other fields
	aiCfg := service.LoadAIConfig()
	if aiCfg.EnableCloudAI && aiCfg.CloudAPIKey != "" {
		fields := map[string]string{}
		if comic.Title != "" {
			fields["title"] = comic.Title
		}
		if comic.Description != "" {
			fields["description"] = comic.Description
		}
		if comic.SeriesName != "" {
			fields["seriesName"] = comic.SeriesName
		}
		if comic.Genre != "" {
			fields["genre"] = comic.Genre
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
	})
}
