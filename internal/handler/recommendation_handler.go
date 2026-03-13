package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

type RecommendationHandler struct{}

func NewRecommendationHandler() *RecommendationHandler { return &RecommendationHandler{} }

// GET /api/recommendations?limit=20&excludeRead=false
func (h *RecommendationHandler) GetRecommendations(c *gin.Context) {
	limit := 20
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	excludeRead := false
	if e := c.Query("excludeRead"); e == "true" || e == "1" {
		excludeRead = true
	}

	recommendations, err := service.GetRecommendations(limit, excludeRead)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get recommendations"})
		return
	}

	c.JSON(200, gin.H{"recommendations": recommendations})
}

// GET /api/recommendations/similar/:id?limit=10
func (h *RecommendationHandler) GetSimilar(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	limit := 10
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	similar, err := service.GetSimilarComics(comicID, limit)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get similar comics"})
		return
	}

	c.JSON(200, gin.H{"similar": similar})
}
