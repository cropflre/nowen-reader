package handler

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ExportHandler 处理数据导出相关的API请求。
type ExportHandler struct{}

// NewExportHandler 创建新的导出处理器。
func NewExportHandler() *ExportHandler {
	return &ExportHandler{}
}

// ExportJSON 导出所有阅读数据为JSON格式。
func (h *ExportHandler) ExportJSON(c *gin.Context) {
	data, err := collectExportData()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	filename := fmt.Sprintf("nowen-reader-export-%s.json", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Header("Content-Type", "application/json; charset=utf-8")
	c.JSON(http.StatusOK, data)
}

// ExportCSV 导出阅读会话数据为CSV格式。
func (h *ExportHandler) ExportCSV(c *gin.Context) {
	stats, err := store.GetEnhancedReadingStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	filename := fmt.Sprintf("nowen-reader-sessions-%s.csv", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	// 写入 BOM 使 Excel 正确识别 UTF-8
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	// 表头
	w.Write([]string{
		"会话ID", "漫画ID", "漫画标题", "开始时间", "结束时间",
		"时长(秒)", "起始页", "结束页",
	})

	sessions, ok := stats["recentSessions"].([]map[string]interface{})
	if !ok {
		return
	}

	for _, s := range sessions {
		endedAt := ""
		if v, ok := s["endedAt"]; ok && v != nil {
			endedAt = fmt.Sprintf("%v", v)
		}
		w.Write([]string{
			fmt.Sprintf("%v", s["id"]),
			fmt.Sprintf("%v", s["comicId"]),
			fmt.Sprintf("%v", s["comicTitle"]),
			fmt.Sprintf("%v", s["startedAt"]),
			endedAt,
			fmt.Sprintf("%v", s["duration"]),
			fmt.Sprintf("%v", s["startPage"]),
			fmt.Sprintf("%v", s["endPage"]),
		})
	}
}

// ExportComicsCSV 导出漫画库为CSV格式。
func (h *ExportHandler) ExportComicsCSV(c *gin.Context) {
	result, err := store.GetAllComics(store.ComicListOptions{
		Page:     1,
		PageSize: 0, // 全部
		SortBy:   "title",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	filename := fmt.Sprintf("nowen-reader-comics-%s.csv", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	w.Write([]string{
		"ID", "标题", "文件名", "作者", "出版社", "年份",
		"类型", "语言", "系列", "页数", "文件大小(bytes)",
		"阅读进度(%)", "总阅读时长(秒)", "评分", "收藏",
		"标签", "分类", "添加时间", "最后阅读时间",
	})

	for _, c := range result.Comics {
		// 组合标签名
		tags := ""
		for i, t := range c.Tags {
			if i > 0 {
				tags += "; "
			}
			tags += t.Name
		}
		// 组合分类名
		cats := ""
		for i, cat := range c.Categories {
			if i > 0 {
				cats += "; "
			}
			cats += cat.Name
		}
		// 阅读进度
		progress := 0
		if c.PageCount > 0 {
			progress = c.LastReadPage * 100 / c.PageCount
		}
		// 评分
		rating := ""
		if c.Rating != nil {
			rating = strconv.Itoa(*c.Rating)
		}
		// 收藏
		fav := "否"
		if c.IsFavorite {
			fav = "是"
		}
		// 年份
		year := ""
		if c.Year != nil {
			year = strconv.Itoa(*c.Year)
		}
		// 最后阅读
		lastRead := ""
		if c.LastReadAt != nil {
			lastRead = *c.LastReadAt
		}

		w.Write([]string{
			c.ID, c.Title, c.Filename, c.Author, c.Publisher, year,
			c.Genre, c.Language, c.SeriesName,
			strconv.Itoa(c.PageCount), strconv.FormatInt(c.FileSize, 10),
			strconv.Itoa(progress), strconv.Itoa(c.TotalReadTime), rating, fav,
			tags, cats, c.AddedAt, lastRead,
		})
	}
}

// collectExportData 收集完整的导出数据。
func collectExportData() (map[string]interface{}, error) {
	data := make(map[string]interface{})
	data["exportedAt"] = time.Now().UTC().Format(time.RFC3339)
	data["version"] = "1.0"

	// 漫画列表
	result, err := store.GetAllComics(store.ComicListOptions{
		Page:     1,
		PageSize: 0, // 全部
		SortBy:   "title",
	})
	if err != nil {
		return nil, err
	}
	data["comics"] = result.Comics
	data["totalComics"] = result.Total

	// 阅读统计
	stats, err := store.GetEnhancedReadingStats()
	if err == nil {
		data["readingStats"] = stats
	}

	// 标签
	tags, err := store.GetAllTags()
	if err == nil {
		data["tags"] = tags
	}

	// 分类
	categories, err := store.GetAllCategories()
	if err == nil {
		data["categories"] = categories
	}

	// 格式化为美化JSON
	_, err = json.MarshalIndent(data, "", "  ")
	if err != nil {
		return nil, err
	}

	return data, nil
}
