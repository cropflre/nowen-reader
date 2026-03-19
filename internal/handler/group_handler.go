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
	groups, err := store.GetAllGroups(getUserID(c))
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
	suggestions, err := store.AutoDetectGroups()
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

	created, err := store.BatchCreateGroups(body.Groups)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量创建分组失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "created": created})
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
