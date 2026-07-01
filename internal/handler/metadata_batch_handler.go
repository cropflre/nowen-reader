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

func (h *MetadataHandler) Batch(c *gin.Context) {
	var body struct {
		Mode        string `json:"mode"` // "all" or "missing"
		Lang        string `json:"lang"`
		UpdateTitle bool   `json:"updateTitle"` // 是否同时更新书名/漫画名
		SkipCover   bool   `json:"skipCover"`   // P2-A: 不替换封面
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		body.Mode = "all"
		body.Lang = "en"
	}
	if body.Lang == "" {
		body.Lang = "en"
	}

	// Get all comics
	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	// If mode=missing, filter to only those without metadata
	var comics []store.ComicIDFilename
	if body.Mode == "missing" {
		for _, comic := range allComics {
			detail, _ := store.GetComicByID(comic.ID)
			if detail != nil && detail.MetadataSource == "" {
				comics = append(comics, comic)
			}
		}
	} else {
		comics = allComics
	}

	total := len(comics)

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

		resolved, err := service.GlobalFileResolver.ResolveContentPath(comic.ID)
		if err != nil || resolved.AbsolutePath == "" {
			failed++
			continue
		}
		filePath := resolved.AbsolutePath

		isNovel := service.IsNovelFilename(comic.Filename)

		// 如果是文件夹漫画，跳过：优先尝试从 EPUB OPF 提取本地元数据
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

		// 漫画文件：尝试从 ComicInfo.xml 提取
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

		// Online search fallback — 优先使用标题
		searchQuery := service.BuildSearchQuery(comic.Title, comic.Filename)
		if searchQuery == "" {
			progress["status"] = "skipped"
			progress["message"] = "No search query"
			sendSSE(progress)
			failed++
			continue
		}

		// 批量在线搜索限流：每次请求之间间隔 1.5 秒，避免触发外部 API 的 429
		time.Sleep(1500 * time.Millisecond)

		// 根据文件名自动判断内容类型
		batchContentType := "comic"
		if service.IsNovelFilename(comic.Filename) {
			batchContentType = "novel"
		}

		results := service.SearchMetadata(searchQuery, nil, body.Lang, batchContentType)
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

// POST /api/metadata/translate-batch — SSE stream（多引擎支持）
func (h *MetadataHandler) TranslateBatch(c *gin.Context) {
	var body struct {
		TargetLang string                  `json:"targetLang"`
		Engine     service.TranslateEngine `json:"engine"` // 可选，指定翻译引擎
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TargetLang == "" {
		c.JSON(400, gin.H{"error": "targetLang is required"})
		return
	}

	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	total := len(allComics)

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

	translated := 0
	skipped := 0
	failed := 0

	for i, comic := range allComics {
		detail, err := store.GetComicByID(comic.ID)
		if err != nil || detail == nil {
			sendSSE(gin.H{"type": "progress", "current": i + 1, "total": total, "status": "skipped"})
			skipped++
			continue
		}

		// 构建待翻译字段
		fields := map[string]string{}
		if detail.Title != "" {
			fields["title"] = detail.Title
		}
		if detail.Description != "" {
			fields["description"] = detail.Description
		}
		if detail.Genre != "" {
			fields["genre"] = detail.Genre
		}

		if len(fields) == 0 {
			sendSSE(gin.H{"type": "progress", "current": i + 1, "total": total, "status": "skipped"})
			skipped++
			continue
		}

		// 使用多引擎翻译服务
		result, err := service.TranslateMetadataFieldsMultiEngine(fields, body.TargetLang, body.Engine)
		if err != nil {
			sendSSE(gin.H{
				"type": "progress", "current": i + 1, "total": total,
				"status": "failed", "comicId": comic.ID, "error": err.Error(),
			})
			failed++
			continue
		}

		updates := map[string]interface{}{}
		for k, v := range result.Fields {
			if v != "" {
				updates[k] = v
			}
		}

		if len(updates) > 0 {
			_ = store.UpdateComicFields(comic.ID, updates)
			translated++
			sendSSE(gin.H{
				"type": "progress", "current": i + 1, "total": total,
				"status": "translated", "comicId": comic.ID,
				"engine": string(result.Engine), "cached": result.Cached,
			})
		} else {
			skipped++
			sendSSE(gin.H{"type": "progress", "current": i + 1, "total": total, "status": "skipped"})
		}
	}

	sendSSE(gin.H{
		"type":       "done",
		"total":      total,
		"translated": translated,
		"skipped":    skipped,
		"failed":     failed,
	})
}

// GET /api/metadata/stats — 元数据统计概览
func (h *MetadataHandler) Stats(c *gin.Context) {
	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	total := len(allComics)
	withMeta := 0
	missing := 0

	for _, comic := range allComics {
		detail, _ := store.GetComicByID(comic.ID)
		if detail != nil && detail.MetadataSource != "" {
			withMeta++
		} else {
			missing++
		}
	}

	c.JSON(200, gin.H{
		"total":        total,
		"withMetadata": withMeta,
		"missing":      missing,
	})
}

// POST /api/metadata/ai-batch — AI 智能批量刮削 (SSE)
// 流水线：AI 解析文件名 → 在线搜索 → AI 补全 → 应用元数据
func (h *MetadataHandler) AIBatch(c *gin.Context) {
	var body struct {
		Mode        string `json:"mode"` // "all" or "missing"
		Lang        string `json:"lang"`
		UpdateTitle bool   `json:"updateTitle"` // 是否同时更新书名/漫画名
		SkipCover   bool   `json:"skipCover"`   // P2-A: 不替换封面
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		body.Mode = "missing"
		body.Lang = "zh"
	}
	if body.Lang == "" {
		body.Lang = "zh"
	}

	// 检查 AI 配置
	aiCfg := service.LoadAIConfig()
	if !aiCfg.EnableCloudAI || aiCfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	// 根据 mode 过滤
	var comics []store.ComicIDFilename
	if body.Mode == "missing" {
		for _, comic := range allComics {
			detail, _ := store.GetComicByID(comic.ID)
			if detail != nil && detail.MetadataSource == "" {
				comics = append(comics, comic)
			}
		}
	} else {
		comics = allComics
	}

	total := len(comics)

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

		// Step 1: AI 内容识别（封面+内页 Vision 分析）
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

		recognized, err := service.AIRecognizeComicContent(aiCfg, coverData, pageImages, body.Lang)
		if err == nil && recognized != nil && recognized.Title != "" {
			searchQuery = recognized.Title
			if recognized.Author != "" {
				searchQuery = recognized.Title + " " + recognized.Author
			}
			progress["recognized"] = recognized
		} else {
			// Vision 识别失败，降级为 AI 解析文件名
			parsed, parseErr := service.AIParseFilename(aiCfg, comic.Filename)
			if parseErr == nil && parsed != nil && parsed.Title != "" {
				searchQuery = parsed.Title
				if parsed.Author != "" {
					searchQuery = parsed.Title + " " + parsed.Author
				}
				progress["parsed"] = parsed
			} else {
				// 再次降级为智能名称匹配（优先标题）
				searchQuery = service.BuildSearchQuery(comic.Title, comic.Filename)
			}
		}

		if searchQuery == "" {
			progress["status"] = "failed"
			progress["step"] = "done"
			progress["message"] = "No search query"
			sendSSE(progress)
			failed++
			continue
		}

		// Step 2: 在线搜索元数据
		progress["step"] = "search"
		sendSSE(progress)

		// 限流防429
		time.Sleep(1500 * time.Millisecond)

		contentType := "comic"
		if service.IsNovelFilename(comic.Filename) {
			contentType = "novel"
		}

		results := service.SearchMetadata(searchQuery, nil, body.Lang, contentType)

		if len(results) > 0 {
			// Step 3: 找到结果，应用最佳匹配
			progress["step"] = "apply"
			progress["resultsCount"] = len(results)
			sendSSE(progress)

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

		// Step 4: 在线搜索无结果，尝试 AI 补全元数据
		progress["step"] = "ai-complete"
		sendSSE(progress)

		detail, _ := store.GetComicByID(comic.ID)
		// 复用 Step 1 中已获取的 coverData（如果没有则重新获取）
		if len(coverData) == 0 {
			if cb, _, _, cbErr := service.GetComicThumbnail(comic.ID); cbErr == nil && len(cb) > 0 {
				coverData = cb
			}
		}

		title := comic.Filename
		if detail != nil && detail.Title != "" {
			title = detail.Title
		}

		meta, err := service.AICompleteMetadata(aiCfg, comic.Filename, title, coverData, body.Lang)
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
			// 添加标签
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

		progress["status"] = "failed"
		progress["step"] = "done"
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

// GET /api/metadata/library — 书库管理列表（带元数据状态过滤）
