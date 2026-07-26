package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func (h *GroupHandler) GetComicMap(c *gin.Context) {
	groupedIDs, err := store.GetExpandedGroupedComicIDs()
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
	if body.CoverURL != nil {
		switch coverURL := *body.CoverURL; {
		case coverURL == "":
			archive.ClearGroupCoverCache(id)
		case strings.HasPrefix(coverURL, "http://") || strings.HasPrefix(coverURL, "https://"):
			go service.DownloadGroupCover(id, coverURL)
		case strings.HasPrefix(coverURL, "data:image/"):
			if err := service.CacheGroupCoverDataURL(id, coverURL); err != nil {
				log.Printf("[API] UpdateMetadata: cache group cover failed: %v", err)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// POST /api/groups/:id/inherit-metadata — 从单个目录作品或第一本直属漫画继承元数据
// ============================================================

func (h *GroupHandler) InheritMetadata(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	result, err := store.InheritGroupMetadata(id)
	if err != nil {
		log.Printf("[API] InheritMetadata error: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "继承元数据失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "inheritance": result})
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
