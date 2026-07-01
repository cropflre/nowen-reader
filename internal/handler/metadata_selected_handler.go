package handler

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func (h *MetadataHandler) BatchSelected(c *gin.Context) {
	var body struct {
		ComicIDs    []string `json:"comicIds"`
		Lang        string   `json:"lang"`
		UpdateTitle bool     `json:"updateTitle"`
		Mode        string   `json:"mode"`      // "standard" | "ai"
		SkipCover   bool     `json:"skipCover"` // P2-A: 不替换封面
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.ComicIDs) == 0 {
		c.JSON(400, gin.H{"error": "comicIds array required"})
		return
	}
	if body.Lang == "" {
		body.Lang = "en"
	}

	// 获取所有选中漫画的信息（含标题，用于智能搜索）
	type comicItem struct {
		ID       string
		Filename string
		Title    string
	}
	var comics []comicItem
	for _, id := range body.ComicIDs {
		detail, err := store.GetComicByID(id)
		if err != nil || detail == nil {
			continue
		}
		comics = append(comics, comicItem{ID: detail.ID, Filename: detail.Filename, Title: detail.Title})
	}

	total := len(comics)
	if total == 0 {
		c.JSON(400, gin.H{"error": "No valid comics found"})
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
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(jsonData))
		c.Writer.Flush()
	}

	sendSSE(gin.H{"type": "start", "total": total})

	// 检查 AI 配置（如果是 AI 模式）
	var aiCfg *service.AIConfig
	if body.Mode == "ai" {
		cfg := service.LoadAIConfig()
		if cfg.EnableCloudAI && cfg.CloudAPIKey != "" {
			aiCfg = &cfg
		} else {
			// AI 未配置，发送降级警告
			sendSSE(gin.H{
				"type":    "progress",
				"current": 0,
				"total":   total,
				"status":  "warning",
				"message": "AI not configured, falling back to standard mode",
			})
		}
	}

	success := 0
	failed := 0

	for i, comic := range comics {
		progress := gin.H{
			"type":     "progress",
			"current":  i + 1,
			"total":    total,
			"comicId":  comic.ID,
			"filename": comic.Filename,
		}

		isNovel := service.IsNovelFilename(comic.Filename)
		resolved, err := service.GlobalFileResolver.ResolveContentPath(comic.ID)
		filePath := ""
		if err == nil {
			filePath = resolved.AbsolutePath
		}

		// AI 模式：使用 AI 内容识别（封面+内页 Vision 分析）
		if body.Mode == "ai" && aiCfg != nil {
			progress["step"] = "recognize"
			sendSSE(progress)

			var searchQuery string
			// 优先尝试 Vision 内容识别
			var coverData []byte
			coverBytes, _, _, coverErr := service.GetComicThumbnail(comic.ID)
			if coverErr == nil && len(coverBytes) > 0 {
				coverData = coverBytes
			}

			// 获取前 2 页内页图片用于辅助识别
			var pageImages [][]byte
			for pi := 0; pi < 2; pi++ {
				pageImg, err := service.GetPageImage(comic.ID, pi)
				if err == nil && pageImg != nil && len(pageImg.Data) > 0 {
					pageImages = append(pageImages, pageImg.Data)
				}
			}

			recognized, err := service.AIRecognizeComicContent(*aiCfg, coverData, pageImages, body.Lang)
			if err == nil && recognized != nil && recognized.Title != "" {
				searchQuery = recognized.Title
				if recognized.Author != "" {
					searchQuery += " " + recognized.Author
				}
				progress["recognized"] = recognized
			} else {
				// Vision 识别失败，降级为 AI 解析文件名
				parsed, parseErr := service.AIParseFilename(*aiCfg, comic.Filename)
				if parseErr == nil && parsed != nil && parsed.Title != "" {
					searchQuery = parsed.Title
					if parsed.Author != "" {
						searchQuery += " " + parsed.Author
					}
					progress["parsed"] = parsed
				} else {
					// 再次降级为智能名称匹配（优先标题）
					searchQuery = service.BuildSearchQuery(comic.Title, comic.Filename)
				}
			}

			if searchQuery != "" {
				progress["step"] = "search"
				sendSSE(progress)
				time.Sleep(1500 * time.Millisecond)

				ct := "comic"
				if isNovel {
					ct = "novel"
				}
				results := service.SearchMetadata(searchQuery, nil, body.Lang, ct)
				if len(results) > 0 {
					_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, body.UpdateTitle, service.ApplyOption{SkipCover: body.SkipCover})
					if err == nil {
						progress["status"] = "success"
						progress["step"] = "done"
						progress["source"] = results[0].Source
						progress["matchTitle"] = results[0].Title
						sendSSE(progress)
						success++
						continue
					}
				}

				// AI 补全回退
				progress["step"] = "ai-complete"
				sendSSE(progress)

				detail, _ := store.GetComicByID(comic.ID)
				title := comic.Filename
				if detail != nil && detail.Title != "" {
					title = detail.Title
				}
				var coverData []byte
				if cb, _, _, err := service.GetComicThumbnail(comic.ID); err == nil {
					coverData = cb
				}
				meta, err := service.AICompleteMetadata(*aiCfg, comic.Filename, title, coverData, body.Lang)
				if err == nil && meta != nil {
					updates := map[string]interface{}{}
					if meta.Title != "" && body.UpdateTitle {
						updates["title"] = meta.Title
					}
					if meta.Author != "" {
						updates["author"] = meta.Author
					}
					if meta.Genre != "" {
						updates["genre"] = meta.Genre
					}
					if meta.Description != "" {
						updates["description"] = meta.Description
					}
					if meta.Language != "" {
						updates["language"] = meta.Language
					}
					if meta.Year != nil {
						updates["year"] = *meta.Year
					}
					if len(updates) > 0 {
						updates["metadataSource"] = "ai_complete"
						_ = store.UpdateComicFields(comic.ID, updates)
					}
					if meta.Tags != "" {
						var tags []string
						for _, t := range strings.Split(meta.Tags, ",") {
							t = strings.TrimSpace(t)
							if t != "" {
								tags = append(tags, t)
							}
						}
						if len(tags) > 0 {
							_ = store.AddTagsToComic(comic.ID, tags)
						}
					}
					progress["status"] = "success"
					progress["step"] = "done"
					progress["source"] = "ai_complete"
					sendSSE(progress)
					success++
					continue
				}
			}

			progress["status"] = "failed"
			progress["step"] = "done"
			progress["message"] = "No metadata found"
			sendSSE(progress)
			failed++
			continue
		}

		// 标准模式
		// 尝试本地提取
		if isNovel && filePath != "" {
			ext := strings.ToLower(filepath.Ext(comic.Filename))
			if ext == ".epub" {
				epubMeta, err := service.ExtractEpubMetadata(filePath)
				if err == nil && epubMeta != nil && epubMeta.Title != "" {
					_, err := service.ApplyMetadata(comic.ID, *epubMeta, body.Lang, body.UpdateTitle, service.ApplyOption{SkipCover: body.SkipCover})
					if err == nil {
						progress["status"] = "success"
						progress["source"] = "epub_opf"
						if body.UpdateTitle && epubMeta.Title != "" {
							progress["matchTitle"] = epubMeta.Title
						}
						sendSSE(progress)
						success++
						continue
					}
				}
			}
		}

		if !isNovel && filePath != "" {
			comicInfo, _ := service.ExtractComicInfoFromArchive(filePath)
			if comicInfo != nil && comicInfo.Title != "" {
				_, err := service.ApplyMetadata(comic.ID, *comicInfo, body.Lang, body.UpdateTitle, service.ApplyOption{SkipCover: body.SkipCover})
				if err == nil {
					progress["status"] = "success"
					progress["source"] = "comicinfo"
					if body.UpdateTitle && comicInfo.Title != "" {
						progress["matchTitle"] = comicInfo.Title
					}
					sendSSE(progress)
					success++
					continue
				}
			}
		}

		// 在线搜索 — 优先使用标题
		searchQuery := service.BuildSearchQuery(comic.Title, comic.Filename)
		if searchQuery == "" {
			progress["status"] = "skipped"
			progress["message"] = "No search query"
			sendSSE(progress)
			failed++
			continue
		}

		time.Sleep(1500 * time.Millisecond)
		ct := "comic"
		if isNovel {
			ct = "novel"
		}
		results := service.SearchMetadata(searchQuery, nil, body.Lang, ct)
		if len(results) > 0 {
			_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, body.UpdateTitle, service.ApplyOption{SkipCover: body.SkipCover})
			if err == nil {
				progress["status"] = "success"
				progress["source"] = results[0].Source
				if body.UpdateTitle && results[0].Title != "" {
					progress["matchTitle"] = results[0].Title
				}
				sendSSE(progress)
				success++
				continue
			}
		}

		progress["status"] = "failed"
		progress["message"] = "No metadata found"
		sendSSE(progress)
		failed++
	}

	sendSSE(gin.H{
		"type":    "complete",
		"total":   total,
		"success": success,
		"failed":  failed,
	})
}

// POST /api/metadata/clear — 清除选中项的元数据
func (h *MetadataHandler) ClearMetadata(c *gin.Context) {
	var body struct {
		ComicIDs []string `json:"comicIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.ComicIDs) == 0 {
		c.JSON(400, gin.H{"error": "comicIds array required"})
		return
	}

	cleared := 0
	for _, id := range body.ComicIDs {
		err := store.UpdateComicFields(id, map[string]interface{}{
			"author":         "",
			"publisher":      "",
			"description":    "",
			"genre":          "",
			"language":       "",
			"metadataSource": "",
			"coverImageUrl":  "",
		})
		if err == nil {
			cleared++
		}
	}

	c.JSON(200, gin.H{"success": true, "cleared": cleared})
}

// POST /api/metadata/batch-rename — 批量重命名书籍标题
