package handler

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type MetadataHandler struct{}

func NewMetadataHandler() *MetadataHandler { return &MetadataHandler{} }

// POST /api/metadata/search
// Also handles GET /api/metadata/search?q=...&sources=...&lang=...
func (h *MetadataHandler) Search(c *gin.Context) {
	var query, lang string
	var sources []string

	var contentType string

	if c.Request.Method == "GET" {
		query = c.Query("q")
		lang = c.DefaultQuery("lang", "en")
		contentType = c.Query("contentType")
		if s := c.Query("sources"); s != "" {
			sources = strings.Split(s, ",")
		}
	} else {
		var body struct {
			Query       string   `json:"query"`
			Sources     []string `json:"sources"`
			Lang        string   `json:"lang"`
			ContentType string   `json:"contentType"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": "invalid request body"})
			return
		}
		query = body.Query
		sources = body.Sources
		lang = body.Lang
		contentType = body.ContentType
		if lang == "" {
			lang = "en"
		}
	}

	if query == "" {
		c.JSON(400, gin.H{"error": "query is required"})
		return
	}

	results := service.SearchMetadata(query, sources, lang, contentType)
	if results == nil {
		results = []service.ComicMetadata{}
	}
	c.JSON(200, gin.H{"results": results})
}

// POST /api/metadata/apply
func (h *MetadataHandler) Apply(c *gin.Context) {
	var body struct {
		ComicID   string                `json:"comicId"`
		Metadata  service.ComicMetadata `json:"metadata"`
		Lang      string                `json:"lang"`
		Overwrite bool                  `json:"overwrite"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if body.ComicID == "" {
		c.JSON(400, gin.H{"error": "comicId and metadata are required"})
		return
	}

	comic, err := service.ApplyMetadata(body.ComicID, body.Metadata, body.Lang, body.Overwrite)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to apply metadata"})
		return
	}
	c.JSON(200, gin.H{"comic": comic})
}

// POST /api/metadata/scan
func (h *MetadataHandler) Scan(c *gin.Context) {
	var body struct {
		ComicID string `json:"comicId"`
		Lang    string `json:"lang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ComicID == "" {
		c.JSON(400, gin.H{"error": "comicId is required"})
		return
	}
	if body.Lang == "" {
		body.Lang = "en"
	}

	comic, err := store.GetComicByID(body.ComicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// Find actual file path
	filePath := findComicFile(comic.Filename)
	if filePath == "" {
		c.JSON(404, gin.H{"error": "Comic file not found on disk"})
		return
	}

	// Try extracting ComicInfo.xml first
	comicInfo, _ := service.ExtractComicInfoFromArchive(filePath)
	if comicInfo != nil && comicInfo.Title != "" {
		result, err := service.ApplyMetadata(body.ComicID, *comicInfo, body.Lang, false)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to apply metadata"})
			return
		}
		c.JSON(200, gin.H{
			"comic":  result,
			"source": "comicinfo",
		})
		return
	}

	// Fallback: search online — 优先使用标题，回退到文件名
	searchQuery := service.BuildSearchQuery(comic.Title, comic.Filename)
	if searchQuery == "" {
		c.JSON(200, gin.H{
			"comic":   comic,
			"source":  "none",
			"message": "No search query could be derived from filename",
		})
		return
	}

	// 根据文件名自动判断内容类型
	scanContentType := "comic"
	if service.IsNovelFilename(comic.Filename) {
		scanContentType = "novel"
	}

	results := service.SearchMetadata(searchQuery, nil, body.Lang, scanContentType)
	if len(results) == 0 {
		c.JSON(200, gin.H{
			"comic":   comic,
			"source":  "none",
			"message": "No metadata found online",
		})
		return
	}

	// Apply best match — scan 是用户主动触发的，使用 overwrite 覆盖旧数据
	updated, err := service.ApplyMetadata(body.ComicID, results[0], body.Lang, true)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to apply metadata"})
		return
	}
	c.JSON(200, gin.H{
		"comic":  updated,
		"source": results[0].Source,
	})
}

// POST /api/metadata/novel-scan — 小说专用刮削接口
// 优先从 EPUB OPF 提取本地元数据，再通过小说数据源在线搜索。
func (h *MetadataHandler) NovelScan(c *gin.Context) {
	var body struct {
		ComicID string `json:"comicId"`
		Lang    string `json:"lang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ComicID == "" {
		c.JSON(400, gin.H{"error": "comicId is required"})
		return
	}
	if body.Lang == "" {
		body.Lang = "en"
	}

	comic, err := store.GetComicByID(body.ComicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 查找文件路径
	filePath := findComicFile(comic.Filename)
	if filePath == "" {
		c.JSON(404, gin.H{"error": "File not found on disk"})
		return
	}

	// 步骤1：尝试从 EPUB OPF 提取本地元数据
	ext := strings.ToLower(filepath.Ext(comic.Filename))
	if ext == ".epub" {
		epubMeta, err := service.ExtractEpubMetadata(filePath)
		if err == nil && epubMeta != nil && epubMeta.Title != "" {
			result, err := service.ApplyMetadata(body.ComicID, *epubMeta, body.Lang, false)
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to apply metadata"})
				return
			}
			c.JSON(200, gin.H{
				"comic":  result,
				"source": "epub_opf",
			})
			return
		}
	}

	// 步骤2：对于 MOBI/AZW3，尝试先转换为 EPUB 再提取
	if ext == ".mobi" || ext == ".azw3" {
		// MOBI/AZW3 会通过 Calibre 转换为 EPUB，转换后的路径在 cache 中
		// 直接走在线搜索即可（MOBI 内嵌元数据较少且不标准）
	}

	// 步骤3：在线搜索兜底 — 优先使用标题
	searchQuery := service.BuildSearchQuery(comic.Title, comic.Filename)
	if searchQuery == "" {
		c.JSON(200, gin.H{
			"comic":   comic,
			"source":  "none",
			"message": "No search query could be derived from filename",
		})
		return
	}

	results := service.SearchMetadata(searchQuery, nil, body.Lang, "novel")
	if len(results) == 0 {
		c.JSON(200, gin.H{
			"comic":   comic,
			"source":  "none",
			"message": "No metadata found online",
		})
		return
	}

	// 应用最佳匹配结果 — novel-scan 是用户主动触发的，使用 overwrite 覆盖旧数据
	updated, err := service.ApplyMetadata(body.ComicID, results[0], body.Lang, true)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to apply metadata"})
		return
	}
	c.JSON(200, gin.H{
		"comic":  updated,
		"source": results[0].Source,
	})
}

// POST /api/metadata/batch — SSE stream
func (h *MetadataHandler) Batch(c *gin.Context) {
	var body struct {
		Mode        string `json:"mode"` // "all" or "missing"
		Lang        string `json:"lang"`
		UpdateTitle bool   `json:"updateTitle"` // 是否同时更新书名/漫画名
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

		filePath := findComicFile(comic.Filename)

		isNovel := service.IsNovelFilename(comic.Filename)

		// 小说文件：优先尝试从 EPUB OPF 提取本地元数据
		if isNovel && filePath != "" {
			ext := strings.ToLower(filepath.Ext(comic.Filename))
			if ext == ".epub" {
				epubMeta, err := service.ExtractEpubMetadata(filePath)
				if err == nil && epubMeta != nil && epubMeta.Title != "" {
					_, err := service.ApplyMetadata(comic.ID, *epubMeta, body.Lang, body.UpdateTitle)
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
				_, err := service.ApplyMetadata(comic.ID, *comicInfo, body.Lang, body.UpdateTitle)
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
			_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, body.UpdateTitle)
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
		coverBytes, coverErr := service.GetComicThumbnail(comic.ID)
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

			_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, body.UpdateTitle)
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
			if cb, cbErr := service.GetComicThumbnail(comic.ID); cbErr == nil && len(cb) > 0 {
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
func (h *MetadataHandler) Library(c *gin.Context) {
	search := c.Query("search")
	metaFilter := c.DefaultQuery("metaFilter", "all") // "all" | "with" | "missing"
	contentType := c.Query("contentType")             // "comic" | "novel" | ""
	sortBy := c.DefaultQuery("sortBy", "title")       // "title" | "fileSize" | "updatedAt" | "metaStatus"
	sortOrder := c.DefaultQuery("sortOrder", "asc")   // "asc" | "desc"
	page := 1
	pageSize := 20
	if p := c.Query("page"); p != "" {
		if n, err := fmt.Sscanf(p, "%d", &page); n == 0 || err != nil {
			page = 1
		}
	}
	if ps := c.Query("pageSize"); ps != "" {
		if n, err := fmt.Sscanf(ps, "%d", &pageSize); n == 0 || err != nil {
			pageSize = 20
		}
	}
	if pageSize > 100 {
		pageSize = 100
	}

	// 验证排序字段白名单
	allowedSortBy := map[string]bool{"title": true, "fileSize": true, "updatedAt": true, "metaStatus": true, "addedAt": true}
	if !allowedSortBy[sortBy] {
		sortBy = "title"
	}
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "asc"
	}

	// metaStatus 排序需要特殊处理：映射到数据库字段
	dbSortBy := sortBy
	if sortBy == "metaStatus" {
		dbSortBy = "metadataSource"
	}

	result, err := store.GetAllComics(store.ComicListOptions{
		Search:      search,
		SortBy:      dbSortBy,
		SortOrder:   sortOrder,
		Page:        page,
		PageSize:    pageSize,
		ContentType: contentType,
		MetaFilter:  metaFilter, // SQL 层面过滤，分页准确
	})
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to get comics"})
		return
	}

	type LibraryItemTag struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	type LibraryItem struct {
		ID             string           `json:"id"`
		Title          string           `json:"title"`
		Filename       string           `json:"filename"`
		Author         string           `json:"author"`
		Genre          string           `json:"genre"`
		Description    string           `json:"description"`
		Year           *int             `json:"year"`
		FileSize       int64            `json:"fileSize"`
		UpdatedAt      string           `json:"updatedAt"`
		MetadataSource string           `json:"metadataSource"`
		HasMetadata    bool             `json:"hasMetadata"`
		ContentType    string           `json:"contentType"`
		Tags           []LibraryItemTag `json:"tags"`
	}

	var items []LibraryItem
	for _, comic := range result.Comics {
		hasMeta := comic.MetadataSource != ""

		ct := comic.ComicType
		if ct == "" {
			if service.IsNovelFilename(comic.Filename) {
				ct = "novel"
			} else {
				ct = "comic"
			}
		}

		var tags []LibraryItemTag
		for _, t := range comic.Tags {
			tags = append(tags, LibraryItemTag{Name: t.Name, Color: t.Color})
		}
		if tags == nil {
			tags = []LibraryItemTag{}
		}

		items = append(items, LibraryItem{
			ID:             comic.ID,
			Title:          comic.Title,
			Filename:       comic.Filename,
			Author:         comic.Author,
			Genre:          comic.Genre,
			Description:    comic.Description,
			Year:           comic.Year,
			FileSize:       comic.FileSize,
			UpdatedAt:      comic.UpdatedAt,
			MetadataSource: comic.MetadataSource,
			HasMetadata:    hasMeta,
			ContentType:    ct,
			Tags:           tags,
		})
	}

	if items == nil {
		items = []LibraryItem{}
	}

	c.JSON(200, gin.H{
		"items":      items,
		"total":      result.Total,
		"page":       result.Page,
		"pageSize":   result.PageSize,
		"totalPages": result.TotalPages,
	})
}

// POST /api/metadata/batch-selected — 对选中项执行批量刮削 (SSE)
func (h *MetadataHandler) BatchSelected(c *gin.Context) {
	var body struct {
		ComicIDs    []string `json:"comicIds"`
		Lang        string   `json:"lang"`
		UpdateTitle bool     `json:"updateTitle"`
		Mode        string   `json:"mode"` // "standard" | "ai"
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
		filePath := findComicFile(comic.Filename)

		// AI 模式：使用 AI 内容识别（封面+内页 Vision 分析）
		if body.Mode == "ai" && aiCfg != nil {
			progress["step"] = "recognize"
			sendSSE(progress)

			var searchQuery string
			// 优先尝试 Vision 内容识别
			var coverData []byte
			coverBytes, coverErr := service.GetComicThumbnail(comic.ID)
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
					_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, body.UpdateTitle)
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
				if cb, err := service.GetComicThumbnail(comic.ID); err == nil {
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
					_, err := service.ApplyMetadata(comic.ID, *epubMeta, body.Lang, body.UpdateTitle)
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
				_, err := service.ApplyMetadata(comic.ID, *comicInfo, body.Lang, body.UpdateTitle)
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
			_, err := service.ApplyMetadata(comic.ID, results[0], body.Lang, body.UpdateTitle)
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
func (h *MetadataHandler) BatchRename(c *gin.Context) {
	var body struct {
		Items []struct {
			ComicID  string `json:"comicId"`
			NewTitle string `json:"newTitle"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Items) == 0 {
		c.JSON(400, gin.H{"error": "items array required"})
		return
	}

	success := 0
	failed := 0
	var results []gin.H

	for _, item := range body.Items {
		newTitle := strings.TrimSpace(item.NewTitle)
		if newTitle == "" {
			failed++
			results = append(results, gin.H{"comicId": item.ComicID, "status": "skipped", "message": "empty title"})
			continue
		}

		err := store.UpdateComicFields(item.ComicID, map[string]interface{}{
			"title": newTitle,
		})
		if err != nil {
			failed++
			results = append(results, gin.H{"comicId": item.ComicID, "status": "failed", "message": err.Error()})
		} else {
			success++
			results = append(results, gin.H{"comicId": item.ComicID, "status": "success", "newTitle": newTitle})
		}
	}

	c.JSON(200, gin.H{
		"success": success,
		"failed":  failed,
		"total":   len(body.Items),
		"results": results,
	})
}

// POST /api/metadata/ai-rename — AI 智能批量命名
func (h *MetadataHandler) AIRename(c *gin.Context) {
	var body struct {
		Items []struct {
			ComicID  string `json:"comicId"`
			Filename string `json:"filename"`
			Title    string `json:"title"`
		} `json:"items"`
		Prompt string `json:"prompt"` // 用户的命名需求描述
		Lang   string `json:"lang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Items) == 0 {
		c.JSON(400, gin.H{"error": "items array and prompt required"})
		return
	}
	if body.Lang == "" {
		body.Lang = "zh"
	}

	aiCfg := service.LoadAIConfig()
	if !aiCfg.EnableCloudAI || aiCfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	// 构建待命名列表
	var itemList string
	for i, item := range body.Items {
		itemList += fmt.Sprintf("%d. filename=\"%s\", current_title=\"%s\"\n", i+1, item.Filename, item.Title)
	}

	langName := "中文"
	if body.Lang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`你是一个专业的漫画/小说命名助手。根据用户的命名需求，为每本书生成合适的名称。

规则：
- 根据用户的命名需求描述来生成新名称
- 如果用户没有特殊要求，则从文件名中智能提取出清晰美观的书名
- 去除文件名中的方括号标记、版本号、扫描组名、文件扩展名等杂项
- 保留核心作品名称、作者等关键信息
- 输出语言为%s
- 返回JSON数组格式，每项包含 index(从1开始) 和 newTitle 字段
- 只返回JSON数组，不要其他内容`, langName)

	userPrompt := fmt.Sprintf(`命名需求：%s

待命名的书籍列表：
%s

请为以上每本书生成新名称，返回JSON数组格式：
[{"index": 1, "newTitle": "新名称"}, ...]`, body.Prompt, itemList)

	content, err := service.CallCloudLLM(aiCfg, systemPrompt, userPrompt, &service.LLMCallOptions{
		Scenario:  "rename",
		MaxTokens: 2000,
	})
	if err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("AI call failed: %v", err)})
		return
	}

	// 清理 markdown 代码块
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	// 提取 JSON 数组
	start := strings.Index(content, "[")
	end := strings.LastIndex(content, "]")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var aiResults []struct {
		Index    int    `json:"index"`
		NewTitle string `json:"newTitle"`
	}
	if err := json.Unmarshal([]byte(content), &aiResults); err != nil {
		c.JSON(500, gin.H{"error": "Failed to parse AI response", "raw": content})
		return
	}

	// 映射回原始项
	type RenameResult struct {
		ComicID  string `json:"comicId"`
		Filename string `json:"filename"`
		OldTitle string `json:"oldTitle"`
		NewTitle string `json:"newTitle"`
	}
	var results []RenameResult
	for _, ar := range aiResults {
		idx := ar.Index - 1 // 转换为0-based索引
		if idx >= 0 && idx < len(body.Items) {
			results = append(results, RenameResult{
				ComicID:  body.Items[idx].ComicID,
				Filename: body.Items[idx].Filename,
				OldTitle: body.Items[idx].Title,
				NewTitle: ar.NewTitle,
			})
		}
	}

	c.JSON(200, gin.H{"results": results})
}

// POST /api/metadata/ai-chat — 刮削助手 AI 聊天 (SSE 流式)
// 支持自然语言对话 + 智能指令识别，可控制刮削操作
func (h *MetadataHandler) AIChat(c *gin.Context) {
	var body struct {
		Question string                 `json:"question"`
		History  []service.ChatMessage  `json:"history"`
		Context  map[string]interface{} `json:"context"` // 前端状态上下文
		Lang     string                 `json:"lang"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Question == "" {
		c.JSON(400, gin.H{"error": "question is required"})
		return
	}
	if body.Lang == "" {
		body.Lang = "zh"
	}

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	langName := "中文"
	if body.Lang == "en" {
		langName = "English"
	}

	// 构建上下文信息
	contextJSON, _ := json.Marshal(body.Context)
	contextStr := string(contextJSON)
	if len(contextStr) > 3000 {
		contextStr = contextStr[:3000] + "..."
	}

	systemPrompt := fmt.Sprintf(`你是一个专业的元数据刮削管理助手。你正在帮助用户管理他们的漫画和小说书库的元数据。

## 你的能力：
1. 回答关于元数据刮削的问题（什么是刮削、如何使用、最佳实践等）
2. 帮助用户理解当前的刮削状态和统计信息
3. 通过指令控制刮削操作（需要输出特殊的 JSON 指令块）
4. 提供书库管理建议

## 指令系统：
当用户要求你执行操作时，在回复文本之后，**另起一行**输出特殊标记（注意结尾用 ]] 双方括号关闭）：
<<COMMAND:{"action":"动作名","params":{"参数":"值"}}>>

可用的指令：
- scrape_selected: 刮削选中的项目
- scrape_all: 批量刮削。params.mode = "missing"(仅缺失) 或 "all"(全部)
- set_mode: 设置刮削模式。params.mode = "standard"(标准) 或 "ai"(AI智能)
- select_all: 全选当前页
- deselect_all: 取消全选
- filter: 筛选。params.filter = "all" / "missing" / "with"
- search: 搜索。params.query = 搜索关键词
- enter_batch_edit: 进入批量编辑模式
- stop_scraping: 停止当前刮削
- refresh: 刷新统计和列表
- clear_metadata: 清除选中项的元数据

## 当前书库状态：
%s

## 规则：
- 使用%s回复
- 简洁专业，1-3 句话即可，除非需要更详细的说明
- 如果用户的请求不明确，先确认再执行
- 对危险操作（如清除元数据、全部重刮）要先警告用户
- 如果不需要执行指令，就正常对话即可，不要输出指令标记
- 友好且专业，像一个经验丰富的书库管理员`, contextStr, langName)

	// 构建用户消息
	fullUserMsg := body.Question

	// 构建历史消息
	if len(body.History) > 0 {
		recent := body.History
		if len(recent) > 12 {
			recent = recent[len(recent)-12:]
		}
		var historyText strings.Builder
		historyText.WriteString("[对话历史]\n")
		for _, msg := range recent {
			if msg.Role == "user" {
				historyText.WriteString(fmt.Sprintf("用户: %s\n", msg.Content))
			} else if msg.Role == "assistant" {
				// 移除指令标记避免混淆
				content := msg.Content
				if idx := strings.Index(content, "<<COMMAND:"); idx >= 0 {
					content = strings.TrimSpace(content[:idx])
				}
				historyText.WriteString(fmt.Sprintf("助手: %s\n", content))
			}
		}
		historyText.WriteString("\n")
		fullUserMsg = historyText.String() + "[用户提问]\n" + body.Question
	}

	// 设置 SSE 响应头
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	// 发送初始化事件（确保代理/中间件开始转发SSE流）
	initData, _ := json.Marshal(gin.H{"type": "init"})
	fmt.Fprintf(c.Writer, "data: %s\n\n", initData)
	c.Writer.Flush()

	maxTokens := cfg.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 2000
	}

	var fullResponse strings.Builder

	err := service.CallCloudLLMStream(cfg, systemPrompt, fullUserMsg, &service.LLMCallOptions{
		Scenario:  "scraper_chat",
		MaxTokens: maxTokens,
	}, func(chunk service.StreamChunk) bool {
		if chunk.Error != "" {
			data, _ := json.Marshal(gin.H{"error": chunk.Error, "done": true})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
			return false
		}

		if chunk.Content != "" {
			fullResponse.WriteString(chunk.Content)

			// 检查是否有指令标记（使用 <<COMMAND:...>> 避免 ] 冲突）
			current := fullResponse.String()
			cmdPrefix := "<<COMMAND:"
			cmdSuffix := ">>"
			if cmdIdx := strings.Index(current, cmdPrefix); cmdIdx >= 0 {
				afterPrefix := current[cmdIdx+len(cmdPrefix):]
				if endIdx := strings.Index(afterPrefix, cmdSuffix); endIdx >= 0 {
					cmdStr := afterPrefix[:endIdx]
					// 发送指令事件
					var cmdObj map[string]interface{}
					if err := json.Unmarshal([]byte(cmdStr), &cmdObj); err == nil {
						cmdData, _ := json.Marshal(gin.H{"command": cmdObj})
						fmt.Fprintf(c.Writer, "data: %s\n\n", cmdData)
						c.Writer.Flush()
					}
					// 发送指令之后的剩余文本
					afterCmd := strings.TrimSpace(afterPrefix[endIdx+len(cmdSuffix):])
					if afterCmd != "" {
						data, _ := json.Marshal(gin.H{"content": afterCmd})
						fmt.Fprintf(c.Writer, "data: %s\n\n", data)
						c.Writer.Flush()
					}
					// 重置 fullResponse 为只包含指令之前的文本
					beforeCmd := current[:cmdIdx]
					fullResponse.Reset()
					fullResponse.WriteString(beforeCmd)
					return true
				}
				// 如果还没看到 >>，说明指令还没传输完，暂不输出
				return true
			}

			// 正常的文本块（没有指令标记开头）
			data, _ := json.Marshal(gin.H{"content": chunk.Content})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
		}

		if chunk.Done {
			// 最后检查一次是否有未处理的指令
			final := fullResponse.String()
			cmdPrefix := "<<COMMAND:"
			cmdSuffix := ">>"
			if cmdIdx := strings.Index(final, cmdPrefix); cmdIdx >= 0 {
				afterPrefix := final[cmdIdx+len(cmdPrefix):]
				if endIdx := strings.Index(afterPrefix, cmdSuffix); endIdx >= 0 {
					cmdStr := afterPrefix[:endIdx]
					var cmdObj map[string]interface{}
					if err := json.Unmarshal([]byte(cmdStr), &cmdObj); err == nil {
						cmdData, _ := json.Marshal(gin.H{"command": cmdObj})
						fmt.Fprintf(c.Writer, "data: %s\n\n", cmdData)
						c.Writer.Flush()
					}
				}
			}

			doneData, _ := json.Marshal(gin.H{"done": true})
			fmt.Fprintf(c.Writer, "data: %s\n\n", doneData)
			c.Writer.Flush()
			return false
		}

		return true
	})

	if err != nil {
		errData, _ := json.Marshal(gin.H{"error": err.Error(), "done": true})
		fmt.Fprintf(c.Writer, "data: %s\n\n", errData)
		c.Writer.Flush()
	}
}

// Helper: find comic file on disk across all comic directories.
func findComicFile(filename string) string {
	for _, dir := range config.GetAllComicsDirs() {
		fp := filepath.Join(dir, filename)
		if _, err := os.Stat(fp); err == nil {
			return fp
		}
	}
	return ""
}
