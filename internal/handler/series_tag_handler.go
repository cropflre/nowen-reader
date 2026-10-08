package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func (h *SeriesHandler) SetTags(c *gin.Context) {
	detail, err := store.GetSeriesDetail(c.Param("id"), getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取目录作品失败"})
		return
	}
	if detail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "目录作品不存在"})
		return
	}
	canManage, err := store.UserCanManageLibrary(getUserID(c), detail.Series.LibraryID)
	if err != nil || !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权管理该目录作品"})
		return
	}
	var body struct {
		Tags *[]string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Tags == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供标签列表"})
		return
	}
	if err := store.SetSeriesTags(detail.Series.ID, *body.Tags); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存目录作品标签失败"})
		return
	}
	tags, err := store.GetSeriesTags(detail.Series.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取目录作品标签失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tags": tags})
}
