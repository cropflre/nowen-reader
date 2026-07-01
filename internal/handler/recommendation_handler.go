package handler

import (
	"strconv"
	"time"

	"log"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
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

	contentType := c.Query("contentType")

	// 支持 shuffle 参数，为推荐结果引入随机性
	seed := int64(0)
	if s := c.Query("seed"); s != "" {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			seed = n
		}
	}
	if c.Query("shuffle") == "true" || c.Query("shuffle") == "1" {
		if seed == 0 {
			seed = time.Now().UnixNano()
		}
	}

	// 获取用户可访问的书库ID
	var libraryIDs []string
	filterLibraryIDs := false
	if uid := getUserID(c); uid != "" {
		filterLibraryIDs = true
		if ids, err := store.GetUserAccessibleLibraryIDs(uid); err == nil {
			libraryIDs = ids
		}
	}
	recommendations, err := service.GetRecommendations(limit, excludeRead, contentType, seed, filterLibraryIDs, libraryIDs...)
	if err != nil {
		log.Printf("[RecommendationHandler] error: %v, userID=%q, libraryIDs=%v, contentType=%q", err, getUserID(c), libraryIDs, contentType)
		c.JSON(500, gin.H{"error": "Failed to get recommendations", "detail": err.Error()})
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
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}

	limit := 10
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	var libraryIDs []string
	filterLibraryIDs := false
	if uid := getUserID(c); uid != "" {
		filterLibraryIDs = true
		if ids, err := store.GetUserAccessibleLibraryIDs(uid); err == nil {
			libraryIDs = ids
		}
	}
	similar, err := service.GetSimilarComics(comicID, limit, filterLibraryIDs, libraryIDs...)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get similar comics"})
		return
	}

	c.JSON(200, gin.H{"similar": similar})
}
