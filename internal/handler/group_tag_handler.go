package handler

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func (h *GroupHandler) GetGroupTags(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}
	group, ok := accessibleGroup(c, id)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"tags": group.TagItems})
}

// PUT /api/groups/:id/tags — 设置系列标签
func (h *GroupHandler) SetGroupTags(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	var body struct {
		Tags *[]string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Tags == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取合集失败"})
		return
	}
	if group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "合集不存在"})
		return
	}
	previous := group.TagItems
	if err := store.SetGroupTags(id, *body.Tags); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "设置系列标签失败"})
		return
	}
	tags, err := store.GetGroupTags(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取合集标签失败"})
		return
	}
	oldNames := make(map[string]bool, len(previous))
	newNames := make(map[string]bool, len(tags))
	for _, tag := range previous {
		oldNames[tag.Name] = true
	}
	added, removed, unchanged := []string{}, []string{}, []string{}
	for _, tag := range tags {
		newNames[tag.Name] = true
		if oldNames[tag.Name] {
			unchanged = append(unchanged, tag.Name)
		} else {
			added = append(added, tag.Name)
		}
	}
	for _, tag := range previous {
		if !newNames[tag.Name] {
			removed = append(removed, tag.Name)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true, "tags": tags, "added": added, "removed": removed,
		"unchanged": unchanged, "syncedTo": 0,
	})
}

// POST /api/groups/:id/sync-tags — 将系列标签同步到所有卷
func (h *GroupHandler) SyncGroupTags(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	totalVolumes, syncedVolumes, tagsCount, err := store.SyncGroupTagsToVolumes(id)
	if err != nil {
		log.Printf("[API] SyncGroupTags error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "同步标签到所有卷失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"totalVolumes":  totalVolumes,
		"syncedVolumes": syncedVolumes,
		"tagsAdded":     tagsCount,
		"tagsRemoved":   0,
	})
}

// POST /api/groups/:id/override-tags — 将系列标签覆盖到所有卷（先清除卷标签再设置）
func (h *GroupHandler) OverrideGroupTags(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	totalVolumes, syncedVolumes, tagsSet, err := store.OverrideGroupTagsToVolumes(id)
	if err != nil {
		log.Printf("[API] OverrideGroupTags error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "覆盖标签到所有卷失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"totalVolumes":  totalVolumes,
		"syncedVolumes": syncedVolumes,
		"tagsSet":       tagsSet,
	})
}

// POST /api/groups/:id/ai-suggest-tags — AI 智能建议系列标签
func (h *GroupHandler) AISuggestTags(c *gin.Context) {
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

	// 收集已有标签
	existingTags, _ := store.GetGroupTags(id)
	var existingTagNames []string
	for _, t := range existingTags {
		existingTagNames = append(existingTagNames, t.Name)
	}

	// 收集所有卷的标题
	var volumeTitles []string
	for _, comic := range group.Comics {
		if comic.Title != "" {
			volumeTitles = append(volumeTitles, comic.Title)
		}
	}

	// 判断内容类型
	contentType := "comic/manga"
	if len(group.Comics) > 0 {
		firstFilename := group.Comics[0].Filename
		if service.IsNovelFilename(firstFilename) {
			contentType = "novel/light novel"
		}
	}

	suggestedTags, err := service.SuggestGroupTags(
		cfg,
		group.Name,
		group.Author,
		group.Genre,
		group.Description,
		volumeTitles,
		contentType,
		body.TargetLang,
		existingTagNames,
	)
	if err != nil {
		log.Printf("[API] AISuggestTags for group %d error: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 标签建议失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"suggestedTags": suggestedTags,
	})
}
