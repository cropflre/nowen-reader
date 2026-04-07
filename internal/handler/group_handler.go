package handler

import (
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
	groups, err := store.GetAllGroupsWithOptions(store.GroupListOptions{
		UserID:      getUserID(c),
		ContentType: c.Query("contentType"),
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

	if err := store.SyncGroupTagsToVolumes(id); err != nil {
		log.Printf("[API] SyncGroupTags error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "同步标签到所有卷失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
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
		Metadata  service.ComicMetadata `json:"metadata"`
		Fields    []string              `json:"fields"`
		Overwrite bool                  `json:"overwrite"`
		SyncTags  bool                  `json:"syncTags"`
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
				_ = store.SyncGroupTagsToVolumes(id)
			}
		}
	}

	// 下载封面
	if meta.CoverURL != "" && shouldApply("cover") {
		go service.DownloadGroupCover(id, meta.CoverURL)
	}

	updated, _ := store.GetGroupByID(id)
	c.JSON(http.StatusOK, gin.H{"success": true, "group": updated})
}

// POST /api/groups/:id/ai-recognize — AI 智能识别系列元数据
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
		Lang string `json:"lang"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Lang == "" {
		body.Lang = "zh"
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
	var coverData []byte
	coverBytes, _, coverErr := service.GetComicThumbnail(firstComic.ComicID)
	if coverErr == nil && len(coverBytes) > 0 {
		coverData = coverBytes
	}

	var pageImages [][]byte
	for pi := 0; pi < 2; pi++ {
		pageImg, err := service.GetPageImage(firstComic.ComicID, pi)
		if err == nil && pageImg != nil && len(pageImg.Data) > 0 {
			pageImages = append(pageImages, pageImg.Data)
		}
	}

	recognized, err := service.AIRecognizeComicContent(cfg, coverData, pageImages, body.Lang)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 识别失败: " + err.Error()})
		return
	}

	meta, _ := service.AICompleteMetadata(cfg, firstComic.Filename, group.Name, coverData, body.Lang)

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
