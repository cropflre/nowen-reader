package handler

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// GroupHandler 处理分组相关的 API 端点。
type GroupHandler struct{}

func NewGroupHandler() *GroupHandler {
	return &GroupHandler{}
}

// ============================================================
// GET /api/groups — 获取所有分组
// ============================================================

func (h *GroupHandler) ListGroups(c *gin.Context) {
	// 解析标签参数（逗号分隔）
	var tags []string
	if tagsParam := c.Query("tags"); tagsParam != "" {
		for _, t := range strings.Split(tagsParam, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				tags = append(tags, t)
			}
		}
	}

	groups, err := store.GetAllGroupsWithOptions(store.GroupListOptions{
		UserID:      getUserID(c),
		ContentType: c.Query("contentType"),
		Category:    c.Query("category"),
		Tags:        tags,
	})
	if err != nil {
		log.Printf("[API] ListGroups error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取分组列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

// ============================================================
// GET /api/groups/:id — 获取分组详情
// ============================================================

func (h *GroupHandler) GetGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的分组ID"})
		return
	}

	// 支持按内容类型过滤分组内的漫画
	contentType := c.Query("contentType")
	group, err := store.GetGroupByID(id, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取分组详情失败"})
		return
	}
	if group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "分组不存在"})
		return
	}
	c.JSON(http.StatusOK, group)
}

// ============================================================
// POST /api/groups — 创建分组
// ============================================================

func (h *GroupHandler) CreateGroup(c *gin.Context) {
	var body struct {
		Name     string   `json:"name"`
		ComicIDs []string `json:"comicIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "分组名称不能为空"})
		return
	}

	id, err := store.CreateGroup(body.Name, getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建分组失败"})
		return
	}

	// 如果提供了漫画ID，直接添加
	if len(body.ComicIDs) > 0 {
		if err := store.AddComicsToGroup(int(id), body.ComicIDs); err != nil {
			log.Printf("[API] CreateGroup: 添加漫画到分组失败: %v", err)
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "id": id})
}

// ============================================================
// PUT /api/groups/:id — 编辑分组
// ============================================================

func (h *GroupHandler) UpdateGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的分组ID"})
		return
	}

	var body struct {
		Name        string  `json:"name"`
		CoverURL    string  `json:"coverUrl"`
		Author      *string `json:"author"`
		Description *string `json:"description"`
		Tags        *string `json:"tags"`
		Year        *int    `json:"year"`
		Publisher   *string `json:"publisher"`
		Language    *string `json:"language"`
		Genre       *string `json:"genre"`
		Status      *string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	// 更新基本信息（名称和封面）
	if err := store.UpdateGroup(id, body.Name, body.CoverURL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新分组失败"})
		return
	}

	// 如果有元数据字段，也一并更新
	update := store.GroupMetadataUpdate{
		Author:      body.Author,
		Description: body.Description,
		Tags:        body.Tags,
		Year:        body.Year,
		Publisher:   body.Publisher,
		Language:    body.Language,
		Genre:       body.Genre,
		Status:      body.Status,
	}
	if err := store.UpdateGroupMetadata(id, update); err != nil {
		log.Printf("[API] UpdateGroup: 更新元数据失败: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// DELETE /api/groups/:id — 删除分组
// ============================================================

func (h *GroupHandler) DeleteGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的分组ID"})
		return
	}

	if err := store.DeleteGroup(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除分组失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/groups/:id/comics — 添加漫画到分组
// ============================================================

func (h *GroupHandler) AddComics(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的分组ID"})
		return
	}

	var body struct {
		ComicIDs []string `json:"comicIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.ComicIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "漫画ID列表不能为空"})
		return
	}

	if err := store.AddComicsToGroup(id, body.ComicIDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加漫画到分组失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// DELETE /api/groups/:id/comics/:comicId — 从分组移除漫画
// ============================================================

func (h *GroupHandler) RemoveComic(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的分组ID"})
		return
	}

	comicID := c.Param("comicId")
	if comicID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "漫画ID不能为空"})
		return
	}

	if err := store.RemoveComicFromGroup(id, comicID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "从分组移除漫画失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// PUT /api/groups/:id/reorder — 重新排序分组内漫画
// ============================================================

func (h *GroupHandler) ReorderComics(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的分组ID"})
		return
	}

	var body struct {
		ComicIDs []string `json:"comicIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.ComicIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "漫画ID列表不能为空"})
		return
	}

	if err := store.ReorderGroupComics(id, body.ComicIDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "重新排序失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/groups/auto-detect — 智能分组可合并的系列
// ============================================================

func (h *GroupHandler) AutoDetect(c *gin.Context) {
	// 支持通过请求体传入 contentType 过滤
	var body struct {
		ContentType string `json:"contentType"`
	}
	c.ShouldBindJSON(&body)

	suggestions, err := store.AutoDetectGroups(body.ContentType)
	if err != nil {
		log.Printf("[API] AutoDetect error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "自动检测失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"suggestions": suggestions,
		"total":       len(suggestions),
	})
}

// ============================================================
// POST /api/groups/batch-create — 批量创建分组
// ============================================================

func (h *GroupHandler) BatchCreate(c *gin.Context) {
	var body struct {
		Groups      []store.AutoDetectGroup `json:"groups"`
		AutoInherit bool                    `json:"autoInherit"` // 自动从首卷继承元数据
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Groups) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "分组列表不能为空"})
		return
	}

	created, err := store.BatchCreateGroups(body.Groups, body.AutoInherit, getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量创建分组失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "created": created})
}

// ============================================================
// POST /api/groups/batch-delete — 批量删除分组
// ============================================================

func (h *GroupHandler) BatchDelete(c *gin.Context) {
	var body struct {
		GroupIDs []int `json:"groupIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.GroupIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "分组ID列表不能为空"})
		return
	}

	deleted, err := store.BatchDeleteGroups(body.GroupIDs)
	if err != nil {
		log.Printf("[API] BatchDelete error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "deleted": deleted})
}

// ============================================================
// POST /api/groups/merge — 合并多个分组
// ============================================================

func (h *GroupHandler) MergeGroups(c *gin.Context) {
	var body struct {
		GroupIDs []int  `json:"groupIds"`
		NewName  string `json:"newName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.GroupIDs) < 2 || body.NewName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "至少选择两个分组并提供合并后的名称"})
		return
	}

	newID, err := store.MergeGroups(body.GroupIDs, body.NewName, getUserID(c))
	if err != nil {
		log.Printf("[API] MergeGroups error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "合并分组失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "newGroupId": newID})
}

// ============================================================
// POST /api/groups/export — 导出分组数据
// ============================================================

func (h *GroupHandler) ExportGroups(c *gin.Context) {
	var body struct {
		GroupIDs []int `json:"groupIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.GroupIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "分组ID列表不能为空"})
		return
	}

	data, err := store.ExportGroupsData(body.GroupIDs)
	if err != nil {
		log.Printf("[API] ExportGroups error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "导出分组数据失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"groups": data})
}

// ============================================================
// GET /api/groups/comic-map — 获取所有已分组的漫画ID映射
// ============================================================

func (h *GroupHandler) GetComicMap(c *gin.Context) {
	groupedIDs, err := store.GetGroupedComicIDs()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取分组映射失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"map": groupedIDs})
}

// ============================================================
// PUT /api/groups/:id/metadata — 更新系列元数据
// ============================================================

func (h *GroupHandler) UpdateMetadata(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	var body store.GroupMetadataUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	if err := store.UpdateGroupMetadata(id, body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新系列元数据失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/groups/:id/inherit-metadata — 从第一本漫画继承元数据
// ============================================================

func (h *GroupHandler) InheritMetadata(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	if err := store.InheritGroupMetadataFromFirstComic(id); err != nil {
		log.Printf("[API] InheritMetadata error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "继承元数据失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/groups/:id/preview-inherit — 预览元数据继承结果
// ============================================================

func (h *GroupHandler) PreviewInherit(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	preview, err := store.PreviewInheritMetadata(id)
	if err != nil {
		log.Printf("[API] PreviewInherit error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "预览继承失败"})
		return
	}
	c.JSON(http.StatusOK, preview)
}

// ============================================================
// POST /api/groups/:id/inherit-to-volumes — 从首卷继承元数据到所有卷
// ============================================================

func (h *GroupHandler) InheritToVolumes(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	if err := store.InheritMetadataToAllVolumes(id); err != nil {
		log.Printf("[API] InheritToVolumes error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "继承元数据到所有卷失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// P2: 系列级标签管理
// ============================================================

// GET /api/groups/:id/tags — 获取系列标签
func (h *GroupHandler) GetGroupTags(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	tags, err := store.GetGroupTags(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取系列标签失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tags": tags})
}

// PUT /api/groups/:id/tags — 设置系列标签
func (h *GroupHandler) SetGroupTags(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	var body struct {
		Tags []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	if err := store.SetGroupTags(id, body.Tags); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "设置系列标签失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
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
func (h *GroupHandler) AutoGroupByDirectory(c *gin.Context) {
	created, err := store.AutoGroupByDirectory()
	if err != nil {
		log.Printf("[API] AutoGroupByDirectory error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "自动分组失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "created": created})
}

// ============================================================
// P4: 系列级元数据刮削 & AI 识别
// ============================================================

// POST /api/groups/:id/scrape-metadata — 搜索系列元数据（在线数据源）
func (h *GroupHandler) ScrapeMetadata(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil || group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "系列不存在"})
		return
	}

	var body struct {
		Query       string   `json:"query"`
		Sources     []string `json:"sources"`
		Lang        string   `json:"lang"`
		ContentType string   `json:"contentType"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Lang == "" {
		body.Lang = "zh"
	}

	query := body.Query
	if query == "" {
		query = group.Name
	}

	ct := body.ContentType
	if ct == "" {
		ct = "comic"
	}

	results := service.SearchMetadata(query, body.Sources, body.Lang, ct)
	if results == nil {
		results = []service.ComicMetadata{}
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

// POST /api/groups/:id/apply-metadata — 将刮削结果应用到系列元数据
func (h *GroupHandler) ApplyScrapedMetadata(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil || group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "系列不存在"})
		return
	}

	var body struct {
		Metadata      service.ComicMetadata `json:"metadata"`
		Fields        []string              `json:"fields"`
		Overwrite     bool                  `json:"overwrite"`
		SyncTags      bool                  `json:"syncTags"`
		SyncToVolumes bool                  `json:"syncToVolumes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	meta := body.Metadata
	fieldsSet := make(map[string]bool)
	for _, f := range body.Fields {
		fieldsSet[f] = true
	}
	applyAll := len(body.Fields) == 0

	shouldApply := func(field string) bool {
		return applyAll || fieldsSet[field]
	}

	update := store.GroupMetadataUpdate{}

	// 标题 → 系列名称（需要用户显式选择 title 字段才会应用）
	if meta.Title != "" && shouldApply("title") {
		if body.Overwrite || group.Name == "" {
			update.Name = &meta.Title
		}
	}

	if meta.Author != "" && shouldApply("author") {
		if body.Overwrite || group.Author == "" {
			update.Author = &meta.Author
		}
	}
	if meta.Description != "" && shouldApply("description") {
		if body.Overwrite || group.Description == "" {
			update.Description = &meta.Description
		}
	}
	if meta.Genre != "" && shouldApply("genre") {
		if body.Overwrite || group.Genre == "" {
			update.Genre = &meta.Genre
		}
	}
	if meta.Publisher != "" && shouldApply("publisher") {
		if body.Overwrite || group.Publisher == "" {
			update.Publisher = &meta.Publisher
		}
	}
	if meta.Language != "" && shouldApply("language") {
		if body.Overwrite || group.Language == "" {
			update.Language = &meta.Language
		}
	}
	if meta.Year != nil && shouldApply("year") {
		if body.Overwrite || group.Year == nil {
			update.Year = meta.Year
		}
	}
	if meta.CoverURL != "" && shouldApply("cover") {
		update.CoverURL = &meta.CoverURL
	}

	if err := store.UpdateGroupMetadata(id, update); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "应用元数据失败"})
		return
	}

	// 处理标签
	if meta.Genre != "" && shouldApply("tags") {
		genres := splitAndTrim(meta.Genre)
		if len(genres) > 0 {
			existingTags, _ := store.GetGroupTags(id)
			existingNames := make(map[string]bool)
			for _, t := range existingTags {
				existingNames[t.Name] = true
			}
			allNames := make([]string, 0)
			for _, t := range existingTags {
				allNames = append(allNames, t.Name)
			}
			for _, g := range genres {
				if !existingNames[g] {
					allNames = append(allNames, g)
				}
			}
			_ = store.SetGroupTags(id, allNames)
			if body.SyncTags {
				_, _, _, _ = store.SyncGroupTagsToVolumes(id)
			}
		}
	}

	// 下载封面
	if meta.CoverURL != "" && shouldApply("cover") {
		go service.DownloadGroupCover(id, meta.CoverURL)
	}

	// 同步元数据到所有卷
	if body.SyncToVolumes {
		go func() {
			if err := syncGroupMetadataToVolumes(id, meta, fieldsSet, body.Overwrite); err != nil {
				log.Printf("[API] syncGroupMetadataToVolumes error for group %d: %v", id, err)
			}
		}()
	}

	updated, _ := store.GetGroupByID(id)
	c.JSON(http.StatusOK, gin.H{"success": true, "group": updated})
}

// syncGroupMetadataToVolumes 将刮削的元数据同步到系列下所有卷
func syncGroupMetadataToVolumes(groupID int, meta service.ComicMetadata, fieldsSet map[string]bool, overwrite bool) error {
	group, err := store.GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return fmt.Errorf("系列不存在或没有漫画")
	}

	applyAll := len(fieldsSet) == 0
	shouldApply := func(field string) bool {
		return applyAll || fieldsSet[field]
	}

	for _, comic := range group.Comics {
		updates := map[string]interface{}{}

		if meta.Author != "" && shouldApply("author") {
			updates["author"] = meta.Author
		}
		if meta.Publisher != "" && shouldApply("publisher") {
			updates["publisher"] = meta.Publisher
		}
		if meta.Language != "" && shouldApply("language") {
			updates["language"] = meta.Language
		}
		if meta.Genre != "" && shouldApply("genre") {
			updates["genre"] = meta.Genre
		}
		if meta.Description != "" && shouldApply("description") {
			updates["description"] = meta.Description
		}
		if meta.Year != nil && shouldApply("year") {
			updates["year"] = *meta.Year
		}

		if !overwrite {
			// 非覆盖模式：只填充空字段，需要先查询当前值
			updates = filterEmptyFieldsOnly(comic.ComicID, updates)
		}

		if len(updates) > 0 {
			if err := store.UpdateComicFields(comic.ComicID, updates); err != nil {
				log.Printf("[API] syncGroupMetadataToVolumes: failed to update comic %s: %v", comic.ComicID, err)
			}
		}
	}
	return nil
}

// filterEmptyFieldsOnly 过滤掉漫画中已有值的字段，只保留空字段的更新
func filterEmptyFieldsOnly(comicID string, updates map[string]interface{}) map[string]interface{} {
	if len(updates) == 0 {
		return updates
	}

	var author, publisher, language, genre, description string
	var year *int
	err := store.DB().QueryRow(`
		SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
		       COALESCE("genre",''), COALESCE("description",''), "year"
		FROM "Comic" WHERE "id" = ?
	`, comicID).Scan(&author, &publisher, &language, &genre, &description, &year)
	if err != nil {
		return updates // 查询失败时保留所有更新
	}

	filtered := map[string]interface{}{}
	for k, v := range updates {
		switch k {
		case "author":
			if author == "" {
				filtered[k] = v
			}
		case "publisher":
			if publisher == "" {
				filtered[k] = v
			}
		case "language":
			if language == "" {
				filtered[k] = v
			}
		case "genre":
			if genre == "" {
				filtered[k] = v
			}
		case "description":
			if description == "" {
				filtered[k] = v
			}
		case "year":
			if year == nil {
				filtered[k] = v
			}
		default:
			filtered[k] = v
		}
	}
	return filtered
}

// POST /api/groups/:id/ai-recognize
func (h *GroupHandler) AIRecognize(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil || group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "系列不存在"})
		return
	}

	var body struct {
		Lang       string `json:"lang"`
		TargetLang string `json:"targetLang"`
		AutoApply  bool   `json:"autoApply"`
	}
	_ = c.ShouldBindJSON(&body)
	// 兼容 targetLang 和 lang 两种字段名
	lang := body.Lang
	if lang == "" {
		lang = body.TargetLang
	}
	if lang == "" {
		lang = "zh"
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 未配置"})
		return
	}

	if len(group.Comics) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "系列内没有漫画，无法进行AI识别"})
		return
	}

	firstComic := group.Comics[0]
	log.Printf("[AI-Recognize] group=%d firstComic=%s filename=%s", id, firstComic.ComicID, firstComic.Filename)

	var coverData []byte
	coverBytes, _, coverErr := service.GetComicThumbnail(firstComic.ComicID)
	if coverErr != nil {
		log.Printf("[AI-Recognize] GetComicThumbnail failed: %v", coverErr)
	} else if len(coverBytes) > 0 {
		coverData = coverBytes
		log.Printf("[AI-Recognize] cover loaded: %d bytes", len(coverData))
	}

	var pageImages [][]byte
	for pi := 0; pi < 2; pi++ {
		pageImg, err := service.GetPageImage(firstComic.ComicID, pi)
		if err != nil {
			log.Printf("[AI-Recognize] GetPageImage(%d) failed: %v", pi, err)
		} else if pageImg != nil && len(pageImg.Data) > 0 {
			pageImages = append(pageImages, pageImg.Data)
			log.Printf("[AI-Recognize] page %d loaded: %d bytes", pi, len(pageImg.Data))
		}
	}

	// 如果没有获取到任何图片，提前返回明确错误
	if len(coverData) == 0 && len(pageImages) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法获取漫画图片数据，请确认漫画文件是否存在且可读"})
		return
	}

	recognized, err := service.AIRecognizeComicContent(cfg, coverData, pageImages, lang)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 识别失败: " + err.Error()})
		return
	}

	meta, _ := service.AICompleteMetadata(cfg, firstComic.Filename, group.Name, coverData, lang)

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"recognized": recognized,
		"metadata":   meta,
	})
}

// splitAndTrim 分割逗号分隔的字符串并去除空白。
func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// ============================================================
// POST /api/groups/detect-dirty — 检测系列脏数据
// ============================================================

func (h *GroupHandler) DetectDirty(c *gin.Context) {
	issues, err := store.DetectGroupDirtyData()
	if err != nil {
		log.Printf("[API] DetectDirty error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "检测脏数据失败: " + err.Error()})
		return
	}
	if issues == nil {
		issues = []store.GroupDirtyIssue{}
	}

	// 统计各类问题数量
	stats := map[string]int{
		"empty_group":    0,
		"orphan_link":    0,
		"dirty_name":     0,
		"duplicate_name": 0,
	}
	for _, issue := range issues {
		stats[issue.Type]++
	}

	c.JSON(http.StatusOK, gin.H{
		"issues": issues,
		"stats":  stats,
		"total":  len(issues),
	})
}

// ============================================================
// POST /api/groups/cleanup — 执行系列数据清理
// ============================================================

func (h *GroupHandler) Cleanup(c *gin.Context) {
	var body struct {
		Actions []string `json:"actions"` // 要执行的清理动作: empty_groups, orphan_links, dirty_names, full
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		body.Actions = []string{"full"}
	}

	// 默认执行全部清理
	if len(body.Actions) == 0 || contains(body.Actions, "full") {
		result, err := store.RunFullGroupCleanup()
		if err != nil {
			log.Printf("[API] Cleanup error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "清理失败: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"result":  result,
		})
		return
	}

	// 按指定动作执行
	result := store.GroupCleanupResult{}
	for _, action := range body.Actions {
		switch action {
		case "empty_groups":
			n, err := store.CleanupEmptyGroups()
			if err != nil {
				log.Printf("[API] Cleanup empty_groups error: %v", err)
			}
			result.EmptyGroupsDeleted = n
		case "orphan_links":
			n, err := store.CleanupOrphanLinks()
			if err != nil {
				log.Printf("[API] Cleanup orphan_links error: %v", err)
			}
			result.OrphanLinksRemoved = n
		case "dirty_names":
			n, err := store.FixDirtyGroupNames()
			if err != nil {
				log.Printf("[API] Cleanup dirty_names error: %v", err)
			}
			result.DirtyNamesFixed = n
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"result":  result,
	})
}

// ============================================================
// POST /api/groups/fix-name — 修复单个系列名称
// ============================================================

func (h *GroupHandler) FixName(c *gin.Context) {
	var body struct {
		GroupID int    `json:"groupId"`
		NewName string `json:"newName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.GroupID == 0 || body.NewName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数不完整"})
		return
	}

	if err := store.FixSingleGroupName(body.GroupID, body.NewName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "修复名称失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// ============================================================
// POST /api/groups/batch-scrape — 批量刮削系列元数据
// ============================================================

// BatchScrapeResult 单个系列的批量刮削结果
type BatchScrapeResult struct {
	GroupID   int                    `json:"groupId"`
	GroupName string                 `json:"groupName"`
	Success   bool                   `json:"success"`
	Error     string                 `json:"error,omitempty"`
	Metadata  *service.ComicMetadata `json:"metadata,omitempty"`
	Applied   bool                   `json:"applied"`
	Volumes   int                    `json:"volumes"`
}

func (h *GroupHandler) BatchScrape(c *gin.Context) {
	var body struct {
		GroupIDs      []int    `json:"groupIds"`
		Sources       []string `json:"sources"`
		Lang          string   `json:"lang"`
		Fields        []string `json:"fields"`
		Overwrite     bool     `json:"overwrite"`
		SyncTags      bool     `json:"syncTags"`
		SyncToVolumes bool     `json:"syncToVolumes"`
		AutoApply     bool     `json:"autoApply"`
		DryRun        bool     `json:"dryRun"` // 预览模式，不实际应用
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	if len(body.GroupIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择至少一个系列"})
		return
	}
	if len(body.GroupIDs) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "单次最多处理 100 个系列"})
		return
	}

	if body.Lang == "" {
		body.Lang = "zh"
	}
	if len(body.Sources) == 0 {
		body.Sources = []string{"anilist", "bangumi", "mangadex", "mangaupdates", "kitsu"}
	}

	fieldsSet := make(map[string]bool)
	for _, f := range body.Fields {
		fieldsSet[f] = true
	}

	results := make([]BatchScrapeResult, 0, len(body.GroupIDs))

	for _, gid := range body.GroupIDs {
		result := BatchScrapeResult{GroupID: gid}

		group, err := store.GetGroupByID(gid)
		if err != nil || group == nil {
			result.Error = "系列不存在"
			results = append(results, result)
			continue
		}
		result.GroupName = group.Name
		result.Volumes = len(group.Comics)

		// 搜索元数据
		metaResults := service.SearchMetadata(group.Name, body.Sources, body.Lang, "comic")
		if len(metaResults) == 0 {
			result.Error = "未找到匹配的元数据"
			results = append(results, result)
			continue
		}

		// 取第一个结果（最佳匹配）
		bestMatch := metaResults[0]
		result.Metadata = &bestMatch
		result.Success = true

		// 预览模式不实际应用
		if body.DryRun {
			results = append(results, result)
			continue
		}

		// 自动应用模式
		if body.AutoApply {
			applyAll := len(body.Fields) == 0
			shouldApply := func(field string) bool {
				return applyAll || fieldsSet[field]
			}

			update := store.GroupMetadataUpdate{}
			if bestMatch.Title != "" && shouldApply("title") {
				if body.Overwrite || group.Name == "" {
					update.Name = &bestMatch.Title
				}
			}
			if bestMatch.Author != "" && shouldApply("author") {
				if body.Overwrite || group.Author == "" {
					update.Author = &bestMatch.Author
				}
			}
			if bestMatch.Description != "" && shouldApply("description") {
				if body.Overwrite || group.Description == "" {
					update.Description = &bestMatch.Description
				}
			}
			if bestMatch.Genre != "" && shouldApply("genre") {
				if body.Overwrite || group.Genre == "" {
					update.Genre = &bestMatch.Genre
				}
			}
			if bestMatch.Publisher != "" && shouldApply("publisher") {
				if body.Overwrite || group.Publisher == "" {
					update.Publisher = &bestMatch.Publisher
				}
			}
			if bestMatch.Language != "" && shouldApply("language") {
				if body.Overwrite || group.Language == "" {
					update.Language = &bestMatch.Language
				}
			}
			if bestMatch.Year != nil && shouldApply("year") {
				if body.Overwrite || group.Year == nil {
					update.Year = bestMatch.Year
				}
			}
			if bestMatch.CoverURL != "" && shouldApply("cover") {
				update.CoverURL = &bestMatch.CoverURL
			}

			if err := store.UpdateGroupMetadata(gid, update); err != nil {
				result.Error = "应用元数据失败: " + err.Error()
				result.Success = false
				results = append(results, result)
				continue
			}

			// 处理标签
			if bestMatch.Genre != "" && shouldApply("tags") {
				genres := splitAndTrim(bestMatch.Genre)
				if len(genres) > 0 {
					existingTags, _ := store.GetGroupTags(gid)
					existingNames := make(map[string]bool)
					for _, t := range existingTags {
						existingNames[t.Name] = true
					}
					allNames := make([]string, 0)
					for _, t := range existingTags {
						allNames = append(allNames, t.Name)
					}
					for _, g := range genres {
						if !existingNames[g] {
							allNames = append(allNames, g)
						}
					}
					_ = store.SetGroupTags(gid, allNames)
					if body.SyncTags {
						_, _, _, _ = store.SyncGroupTagsToVolumes(gid)
					}
				}
			}

			// 下载封面
			if bestMatch.CoverURL != "" && shouldApply("cover") {
				go service.DownloadGroupCover(gid, bestMatch.CoverURL)
			}

			// 同步到所有卷
			if body.SyncToVolumes {
				if err := syncGroupMetadataToVolumes(gid, bestMatch, fieldsSet, body.Overwrite); err != nil {
					log.Printf("[API] BatchScrape: syncToVolumes error for group %d: %v", gid, err)
				}
			}

			result.Applied = true
		}

		results = append(results, result)
	}

	// 统计
	totalSuccess := 0
	totalFailed := 0
	totalApplied := 0
	for _, r := range results {
		if r.Success {
			totalSuccess++
		} else {
			totalFailed++
		}
		if r.Applied {
			totalApplied++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results": results,
		"total":   len(body.GroupIDs),
		"success": totalSuccess,
		"failed":  totalFailed,
		"applied": totalApplied,
	})
}
