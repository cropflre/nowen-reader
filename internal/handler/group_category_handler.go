package handler

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// P5: 系列级分类管理
// ============================================================

// GET /api/groups/:id/categories — 获取系列分类
func (h *GroupHandler) GetGroupCategories(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	cats, err := store.GetGroupCategories(id)
	if err != nil {
		log.Printf("[API] GetGroupCategories error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取系列分类失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": cats})
}

// PUT /api/groups/:id/categories — 设置系列分类（替换所有）
func (h *GroupHandler) SetGroupCategories(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	var body struct {
		CategorySlugs []string `json:"categorySlugs"`
		AutoSync      bool     `json:"autoSync"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	if err := store.SetGroupCategories(id, body.CategorySlugs); err != nil {
		log.Printf("[API] SetGroupCategories error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "设置系列分类失败"})
		return
	}

	// 自动同步到所有卷
	var syncedTo int
	if body.AutoSync && len(body.CategorySlugs) > 0 {
		_, syncedTo, _ = store.SyncGroupCategoriesToVolumes(id)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"syncedTo": syncedTo,
	})
}

// POST /api/groups/:id/sync-categories — 将系列分类同步到所有卷
func (h *GroupHandler) SyncGroupCategories(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	totalVolumes, syncedVolumes, err := store.SyncGroupCategoriesToVolumes(id)
	if err != nil {
		log.Printf("[API] SyncGroupCategories error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "同步分类到所有卷失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"totalVolumes":  totalVolumes,
		"syncedVolumes": syncedVolumes,
	})
}

// POST /api/groups/:id/ai-suggest-categories — AI 智能建议系列分类
func (h *GroupHandler) AISuggestCategories(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	var body struct {
		TargetLang string `json:"targetLang"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.TargetLang == "" {
		body.TargetLang = "zh"
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 未配置"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil || group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "系列不存在"})
		return
	}

	// 获取所有可用分类
	allCats, err := store.GetAllCategories()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取分类列表失败"})
		return
	}

	// 获取已有分类
	existingCats, _ := store.GetGroupCategories(id)
	existingMap := make(map[string]bool)
	for _, c := range existingCats {
		existingMap[c.Slug] = true
	}

	// 收集所有卷的标题
	var volumeTitles []string
	for _, comic := range group.Comics {
		if comic.Title != "" {
			volumeTitles = append(volumeTitles, comic.Title)
		}
	}

	// 收集已有标签
	existingTags, _ := store.GetGroupTags(id)
	var tagNames []string
	for _, t := range existingTags {
		tagNames = append(tagNames, t.Name)
	}

	// 判断内容类型
	contentType := "comic/manga"
	if len(group.Comics) > 0 {
		firstFilename := group.Comics[0].Filename
		if service.IsNovelFilename(firstFilename) {
			contentType = "novel/light novel"
		}
	}

	// 构建可选分类列表
	var availableCats []string
	for _, cat := range allCats {
		availableCats = append(availableCats, cat.Slug+":"+cat.Name)
	}

	suggestedSlugs, err := service.SuggestGroupCategories(
		cfg,
		group.Name,
		group.Author,
		group.Genre,
		group.Description,
		volumeTitles,
		contentType,
		body.TargetLang,
		tagNames,
		availableCats,
	)
	if err != nil {
		log.Printf("[API] AISuggestCategories for group %d error: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 分类建议失败: " + err.Error()})
		return
	}

	// 过滤掉已有的分类
	var newSuggestions []string
	for _, slug := range suggestedSlugs {
		if !existingMap[slug] {
			newSuggestions = append(newSuggestions, slug)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":             true,
		"suggestedCategories": newSuggestions,
	})
}

// ============================================================
// P3: 按话/卷自动分组
// ============================================================

// POST /api/groups/auto-group-by-dir — 按文件夹自动创建分组
