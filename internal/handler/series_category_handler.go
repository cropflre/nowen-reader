package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func (h *SeriesHandler) SetCategories(c *gin.Context) {
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
		CategorySlugs *[]string `json:"categorySlugs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.CategorySlugs == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供分类列表"})
		return
	}
	if err := store.SetSeriesCategories(detail.Series.ID, *body.CategorySlugs); err != nil {
		if errors.Is(err, store.ErrCategoryNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "所选分类不存在，请刷新后重试"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存目录作品分类失败"})
		}
		return
	}
	categories, err := store.GetSeriesCategories(detail.Series.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取目录作品分类失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "categories": categories})
}
