package handler

import (
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
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
		SkipCover bool                  `json:"skipCover"` // P2-A: 不替换封面
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}
	if body.ComicID == "" {
		c.JSON(400, gin.H{"error": "comicId and metadata are required"})
		return
	}

	// 获取修改前的旧值（用于同步日志）
	existing, _ := store.GetComicByID(body.ComicID)
	prevValues := map[string]interface{}{}
	if existing != nil {
		prevValues["title"] = existing.Title
		prevValues["author"] = existing.Author
		prevValues["publisher"] = existing.Publisher
		prevValues["description"] = existing.Description
		prevValues["language"] = existing.Language
		prevValues["genre"] = existing.Genre
		prevValues["metadataSource"] = existing.MetadataSource
		if existing.Year != nil {
			prevValues["year"] = *existing.Year
		}
	}

	comic, err := service.ApplyMetadata(body.ComicID, body.Metadata, body.Lang, body.Overwrite, service.ApplyOption{SkipCover: body.SkipCover})
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to apply metadata"})
		return
	}

	// 记录同步日志
	fields := map[string]interface{}{}
	if body.Metadata.Title != "" {
		fields["title"] = body.Metadata.Title
	}
	if body.Metadata.Author != "" {
		fields["author"] = body.Metadata.Author
	}
	if body.Metadata.Publisher != "" {
		fields["publisher"] = body.Metadata.Publisher
	}
	if body.Metadata.Description != "" {
		fields["description"] = body.Metadata.Description
	}
	if body.Metadata.Language != "" {
		fields["language"] = body.Metadata.Language
	}
	if body.Metadata.Genre != "" {
		fields["genre"] = body.Metadata.Genre
	}
	if body.Metadata.Source != "" {
		fields["metadataSource"] = body.Metadata.Source
	}
	if body.Metadata.Year != nil {
		fields["year"] = *body.Metadata.Year
	}
	syncSource := c.GetHeader("X-Sync-Source")
	if syncSource == "" {
		syncSource = "scraper"
	}
	userID, _ := c.Get("userId")
	userIDStr, _ := userID.(string)
	_ = store.InsertSyncLog(body.ComicID, "scrape_apply", syncSource, userIDStr, fields, prevValues)

	c.JSON(200, gin.H{"comic": comic})
}

// POST /api/metadata/scan
func (h *MetadataHandler) Scan(c *gin.Context) {
	var body struct {
		ComicID   string `json:"comicId"`
		Lang      string `json:"lang"`
		SkipCover bool   `json:"skipCover"` // P2-A: 不替换封面
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
		result, err := service.ApplyMetadata(body.ComicID, *comicInfo, body.Lang, false, service.ApplyOption{SkipCover: body.SkipCover})
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
	updated, err := service.ApplyMetadata(body.ComicID, results[0], body.Lang, true, service.ApplyOption{SkipCover: body.SkipCover})
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
		ComicID   string `json:"comicId"`
		Lang      string `json:"lang"`
		SkipCover bool   `json:"skipCover"` // P2-A: 不替换封面
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
			result, err := service.ApplyMetadata(body.ComicID, *epubMeta, body.Lang, false, service.ApplyOption{SkipCover: body.SkipCover})
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
	updated, err := service.ApplyMetadata(body.ComicID, results[0], body.Lang, true, service.ApplyOption{SkipCover: body.SkipCover})
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
