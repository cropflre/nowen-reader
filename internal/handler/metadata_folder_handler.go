package handler

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// GET /api/metadata/folder-tree — 文件夹树形结构（带元数据状态）
func (h *MetadataHandler) FolderTree(c *gin.Context) {
	tree, err := store.GetMetadataFolderTree()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get folder tree"})
		return
	}
	c.JSON(200, tree)
}

// POST /api/metadata/batch-folder — 按文件夹批量刮削
func (h *MetadataHandler) BatchFolder(c *gin.Context) {
	var body struct {
		FolderPath string `json:"folderPath"` // 文件夹路径前缀
		Mode       string `json:"mode"`       // "standard" | "ai"
		Scope      string `json:"scope"`      // "missing" | "all"
		Lang       string `json:"lang"`
		SkipCover  bool   `json:"skipCover"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.FolderPath == "" {
		c.JSON(400, gin.H{"error": "folderPath is required"})
		return
	}
	if body.Lang == "" {
		body.Lang = "en"
	}

	// 获取该文件夹下的所有漫画
	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	var comics []store.ComicIDFilename
	for _, comic := range allComics {
		if !strings.HasPrefix(comic.Filename, body.FolderPath+"/") && comic.Filename != body.FolderPath {
			continue
		}
		if body.Scope == "missing" {
			detail, _ := store.GetComicByID(comic.ID)
			if detail != nil && detail.MetadataSource != "" {
				continue
			}
		}
		comics = append(comics, comic)
	}

	total := len(comics)
	if total == 0 {
		c.JSON(200, gin.H{"message": "No comics to scrape in this folder"})
		return
	}

	// SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.Flush()

	sendSSE := func(data interface{}) {
		jsonData, _ := json.Marshal(data)
		fmt.Fprintf(c.Writer, "data: %s\n\n", jsonData)
		c.Writer.Flush()
	}

	success := 0
	failed := 0

	for i, comic := range comics {
		var filePath string
		if resolved, err := service.GlobalFileResolver.ResolveContentPath(comic.ID); err == nil {
			filePath = resolved.AbsolutePath
		}
		if filePath == "" {
			failed++
			sendSSE(gin.H{
				"type": "progress", "current": i + 1, "total": total,
				"comicId": comic.ID, "filename": comic.Filename,
				"status": "failed", "message": "File not found",
			})
			continue
		}

		sendSSE(gin.H{
			"type": "progress", "current": i + 1, "total": total,
			"comicId": comic.ID, "filename": comic.Filename,
			"status": "processing", "step": "searching",
		})

		// 构建搜索查询
		detail, _ := store.GetComicByID(comic.ID)
		if detail == nil {
			failed++
			continue
		}

		searchQuery := service.BuildSearchQuery(detail.Title, detail.Filename)
		if searchQuery == "" {
			failed++
			sendSSE(gin.H{
				"type": "progress", "current": i + 1, "total": total,
				"comicId": comic.ID, "filename": comic.Filename,
				"status": "failed", "message": "No search query",
			})
			continue
		}

		scanContentType := "comic"
		if service.IsNovelFilename(comic.Filename) {
			scanContentType = "novel"
		}

		results := service.SearchMetadata(searchQuery, nil, body.Lang, scanContentType)
		if len(results) == 0 {
			failed++
			sendSSE(gin.H{
				"type": "progress", "current": i + 1, "total": total,
				"comicId": comic.ID, "filename": comic.Filename,
				"status": "failed", "message": "No metadata found",
			})
			continue
		}

		_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, true, service.ApplyOption{SkipCover: body.SkipCover})
		if err != nil {
			failed++
			sendSSE(gin.H{
				"type": "progress", "current": i + 1, "total": total,
				"comicId": comic.ID, "filename": comic.Filename,
				"status": "failed", "message": err.Error(),
			})
			continue
		}

		success++
		sendSSE(gin.H{
			"type": "progress", "current": i + 1, "total": total,
			"comicId": comic.ID, "filename": comic.Filename,
			"status": "success", "source": results[0].Source,
			"matchTitle": results[0].Title,
		})
	}

	sendSSE(gin.H{
		"type":    "complete",
		"total":   total,
		"success": success,
		"failed":  failed,
	})
}

