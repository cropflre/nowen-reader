package handler

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
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

	group, err := store.GetGroupByID(id)
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
		Name     string `json:"name"`
		CoverURL string `json:"coverUrl"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	if err := store.UpdateGroup(id, body.Name, body.CoverURL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新分组失败"})
		return
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
		Groups []store.AutoDetectGroup `json:"groups"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Groups) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "分组列表不能为空"})
		return
	}

	created, err := store.BatchCreateGroups(body.Groups, getUserID(c))
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
