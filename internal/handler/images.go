package handler

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ImageHandler handles all image-serving API endpoints.
type ImageHandler struct{}

// NewImageHandler creates a new ImageHandler.
func NewImageHandler() *ImageHandler {
	return &ImageHandler{}
}

// ============================================================
// GET /api/comics/:id/pages — Get page list
// ============================================================

func (h *ImageHandler) GetPages(c *gin.Context) {
	id := c.Param("id")

	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	start := time.Now()
	result, err := service.GetComicPagesEx(id)
	if err != nil {
		log.Printf("[pages] GetComicPagesEx failed for %s (%s) after %v: %v", id, comic.Filename, time.Since(start), err)
		errMsg := err.Error()
		// 为用户提供更友好的错误提示
		if strings.Contains(errMsg, "parse MOBI") || strings.Contains(errMsg, "ebook-convert") {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "MOBI/AZW3 文件解析失败，该文件可能已损坏或使用了不支持的加密/压缩格式。"})
		} else if strings.Contains(errMsg, "PDF page count") {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法获取 PDF 总页数，该文件可能已加密或结构异常。请确认服务器已安装 mutool / pdfinfo / pdftoppm。"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": errMsg})
		}
		return
	}
	elapsed := time.Since(start)
	if elapsed > 2*time.Second {
		log.Printf("[pages] Slow page list for %s (%s): %d pages in %v", id, comic.Filename, len(result.Entries), elapsed)
	}

	type pageInfo struct {
		Index int    `json:"index"`
		Name  string `json:"name"`
		URL   string `json:"url"`
		Title string `json:"title,omitempty"`
	}
	pageList := make([]pageInfo, len(result.Entries))
	for i, name := range result.Entries {
		pi := pageInfo{
			Index: i,
			Name:  name,
		}
		if result.IsNovel {
			pi.URL = fmt.Sprintf("/api/comics/%s/chapter/%d", id, i)
			if result.ChapterTitles != nil && i < len(result.ChapterTitles) {
				pi.Title = result.ChapterTitles[i]
			}
		} else {
			pi.URL = fmt.Sprintf("/api/comics/%s/page/%d", id, i)
		}
		pageList[i] = pi
	}

	c.JSON(http.StatusOK, gin.H{
		"comicId":    id,
		"title":      comic.Title,
		"totalPages": len(result.Entries),
		"pages":      pageList,
		"isNovel":    result.IsNovel,
		"isPdf":      result.IsPdf,
	})
}

// ============================================================
// GET /api/comics/:id/page/:pageIndex — Get page image
// ============================================================

func (h *ImageHandler) GetPageImage(c *gin.Context) {
	id := c.Param("id")
	pageIndexStr := c.Param("pageIndex")

	pageIndex, err := strconv.Atoi(pageIndexStr)
	if err != nil || pageIndex < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid page index"})
		return
	}

	// Verify comic exists
	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	result, err := service.GetPageImage(id, pageIndex)
	if err != nil {
		errMsg := err.Error()
		log.Printf("[page] GetPageImage failed for %s page %d: %v", id, pageIndex, err)
		// PDF渲染工具缺失 → 返回 500 + 友好提示
		if strings.Contains(errMsg, "no PDF renderer available") {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "PDF 阅读需要安装 PDF 渲染工具（mutool / pdftoppm / imagemagick），Docker 镜像已内置。如非 Docker 部署请手动安装。"})
		} else if strings.Contains(errMsg, "render PDF page") {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("PDF 页面渲染失败: %s", errMsg)})
		} else {
			c.JSON(http.StatusNotFound, gin.H{"error": "Page not found: " + errMsg})
		}
		return
	}
	if result == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Page not found"})
		return
	}

	// Generate ETag from content MD5
	etag := `"` + archive.ContentMD5(result.Data) + `"`

	// Check If-None-Match for 304
	if c.GetHeader("If-None-Match") == etag {
		c.Header("ETag", etag)
		c.Status(http.StatusNotModified)
		return
	}

	c.Header("Content-Type", result.MimeType)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Content-Length", strconv.Itoa(len(result.Data)))
	c.Header("ETag", etag)
	c.Data(http.StatusOK, result.MimeType, result.Data)
}

// ============================================================
// GET /api/comics/:id/thumbnail — Get thumbnail
// ============================================================

func (h *ImageHandler) GetThumbnail(c *gin.Context) {
	id := c.Param("id")

	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	thumbnail, aspectRatio, err := service.GetComicThumbnail(id)
	if err != nil || thumbnail == nil {
		log.Printf("[thumbnail] Failed for %s (%s): %v", id, comic.Filename, err)
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Thumbnail unavailable: %v", err)})
		return
	}

	// Store aspect ratio to DB if it was detected (non-zero) and comic doesn't have one yet
	if aspectRatio > 0 && comic.CoverAspectRatio == 0 {
		go func() {
			_ = store.UpdateComicFields(id, map[string]interface{}{"coverAspectRatio": aspectRatio})
		}()
	}

	// Generate ETag based on thumbnail file mtime + size
	cachePath := filepath.Join(config.GetThumbnailsDir(), archive.ThumbnailCacheName(id))
	etag := fmt.Sprintf(`"%d"`, len(thumbnail))
	if stat, err := os.Stat(cachePath); err == nil {
		etag = fmt.Sprintf(`"%s-%s"`,
			strconv.FormatInt(stat.ModTime().UnixMilli(), 36),
			strconv.FormatInt(stat.Size(), 36),
		)
	}

	// Check If-None-Match for 304
	if c.GetHeader("If-None-Match") == etag {
		c.Header("ETag", etag)
		c.Status(http.StatusNotModified)
		return
	}

	c.Header("Content-Type", "image/webp")
	c.Header("Cache-Control", "public, max-age=300, must-revalidate")
	c.Header("Content-Length", strconv.Itoa(len(thumbnail)))
	c.Header("ETag", etag)
	c.Data(http.StatusOK, "image/webp", thumbnail)
}

// ============================================================
// POST /api/comics/:id/cover — Upload/fetch/reset cover
// ============================================================

func (h *ImageHandler) UpdateCover(c *gin.Context) {
	id := c.Param("id")

	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	thumbDir := config.GetThumbnailsDir()
	if err := os.MkdirAll(thumbDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create thumbnails dir"})
		return
	}
	// Use canonical cache path (consistent with GenerateThumbnail)
	cachePath := filepath.Join(thumbDir, archive.ThumbnailCacheName(id))
	// Remove old-format cache file ({id}.webp) if it exists to avoid stale data
	oldCachePath := filepath.Join(thumbDir, id+".webp")
	_ = os.Remove(oldCachePath)

	contentType := c.GetHeader("Content-Type")

	// Case 1: FormData file upload
	if isMultipart(contentType) {
		file, _, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided"})
			return
		}
		defer file.Close()

		imgData, err := io.ReadAll(file)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file"})
			return
		}

		thumbnail, err := archive.ResizeImageToWebP(imgData,
			config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process image"})
			return
		}

		if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save thumbnail"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "source": "upload"})
		return
	}

	// Case 2: JSON body
	var body struct {
		URL                string `json:"url"`
		Reset              bool   `json:"reset"`
		PageIndex          *int   `json:"pageIndex"`          // 从内页选择（漫画/PDF）
		EmbeddedImageIndex *int   `json:"embeddedImageIndex"` // 从小说内嵌图片选择
		UseFirstPage       bool   `json:"useFirstPage"`       // 一键"使用第一张图"
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Reset to default
	if body.Reset {
		archive.ClearThumbnailCache(id)
		c.JSON(http.StatusOK, gin.H{"success": true, "source": "reset"})
		return
	}

	// 一键"使用第一张图"作为封面：
	// - 漫画/图片夹/PDF/EPUB/MOBI/AZW3 都通过 GenerateThumbnail 自动选择最合适的来源
	if body.UseFirstPage {
		if err := generateAndSaveFirstPageCover(id, cachePath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "source": "first_page"})
		return
	}

	// 小说内嵌图片选择
	if body.EmbeddedImageIndex != nil {
		img, err := service.GetEmbeddedImageData(id, *body.EmbeddedImageIndex)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to extract embedded image: " + err.Error()})
			return
		}
		thumbnail, err := archive.ResizeImageToWebP(img.Data,
			config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process image"})
			return
		}
		if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save thumbnail"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "source": "embedded", "embeddedImageIndex": *body.EmbeddedImageIndex})
		return
	}

	// P4: Select cover from archive page
	if body.PageIndex != nil {
		imgData, err := service.GetPageImageData(id, *body.PageIndex)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to extract page: " + err.Error()})
			return
		}

		thumbnail, err := archive.ResizeImageToWebP(imgData,
			config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process image"})
			return
		}

		if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save thumbnail"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "source": "archive", "pageIndex": *body.PageIndex})
		return
	}

	// Fetch from URL
	if body.URL != "" {
		resp, err := http.Get(body.URL)
		if err != nil || resp.StatusCode != 200 {
			status := 0
			if resp != nil {
				status = resp.StatusCode
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Failed to fetch image: %d", status)})
			return
		}
		defer resp.Body.Close()

		imgData, err := io.ReadAll(resp.Body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read image"})
			return
		}

		thumbnail, err := archive.ResizeImageToWebP(imgData,
			config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process image"})
			return
		}

		if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save thumbnail"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "source": "url"})
		return
	}

	c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
}

// isMultipart checks if a Content-Type header indicates multipart form data.
func isMultipart(ct string) bool {
	return strings.HasPrefix(ct, "multipart/form-data")
}

// generateAndSaveFirstPageCover 通过通用的 GenerateThumbnail 流程生成封面，
// 内部按文件类型自动选择：PDF=渲染第一页；EPUB/MOBI/AZW3=取内嵌封面；漫画=取第一张图。
// 同时把结果按 cover 上传规格 (85% 质量) 重新落盘到 cachePath。
func generateAndSaveFirstPageCover(comicID, cachePath string) error {
	// 先清掉可能存在的旧缓存（避免 GenerateThumbnail 直接命中缓存）
	archive.ClearThumbnailCache(comicID)

	fp, _, err := service.FindComicFilePath(comicID)
	if err != nil {
		return fmt.Errorf("file not found: %w", err)
	}

	// GenerateThumbnail 已经自动处理了所有格式的 "第一张图" 提取逻辑
	thumbnail, _, err := archive.GenerateThumbnail(fp, comicID)
	if err != nil {
		return fmt.Errorf("generate thumbnail: %w", err)
	}
	if len(thumbnail) == 0 {
		return fmt.Errorf("empty thumbnail generated")
	}

	// GenerateThumbnail 内部已经按 thumbnail 规格落盘到 ThumbnailCacheName(id) 路径，
	// 这里 cachePath 与之一致，无需重复写入。但保险起见再写一次以与上传/URL分支对齐。
	if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
		return fmt.Errorf("save thumbnail: %w", err)
	}
	return nil
}

// ============================================================
// GET /api/comics/:id/pdf — Stream PDF file for frontend rendering
// ============================================================

func (h *ImageHandler) GetPdfFile(c *gin.Context) {
	id := c.Param("id")

	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	fp, _, err := service.FindComicFilePath(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found: " + err.Error()})
		return
	}

	// 验证是 PDF 文件
	if archive.DetectType(fp) != archive.TypePdf {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Not a PDF file"})
		return
	}

	// 获取文件信息
	fileInfo, err := os.Stat(fp)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// 设置响应头
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Length", strconv.FormatInt(fileInfo.Size(), 10))
	c.Header("Content-Disposition", "inline") // 防止微信浏览器触发下载
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "public, max-age=86400")
	c.Header("Accept-Ranges", "bytes")

	// 支持 Range 请求（PDF.js 需要）
	c.File(fp)
}

// ============================================================
// GET /api/comics/:id/chapter/:chapterIndex — Get chapter text content
// ============================================================

func (h *ImageHandler) GetChapterContent(c *gin.Context) {
	id := c.Param("id")
	chapterIndexStr := c.Param("chapterIndex")

	chapterIndex, err := strconv.Atoi(chapterIndexStr)
	if err != nil || chapterIndex < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chapter index"})
		return
	}

	// Verify comic exists
	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	start := time.Now()
	chapter, err := service.GetChapterContent(id, chapterIndex)
	if err != nil {
		log.Printf("[chapter] GetChapterContent failed for %s chapter %d after %v: %v", id, chapterIndex, time.Since(start), err)
		c.JSON(http.StatusNotFound, gin.H{"error": "Chapter not found: " + err.Error()})
		return
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		log.Printf("[chapter] Slow chapter load for %s chapter %d: %v", id, chapterIndex, elapsed)
	}

	c.JSON(http.StatusOK, gin.H{
		"content":  chapter.Content,
		"title":    chapter.Title,
		"mimeType": chapter.MimeType,
	})
}

// ============================================================
// GET /api/comics/:id/epub-resource/*resourcePath — Get EPUB resource (images, etc.)
// ============================================================

func (h *ImageHandler) GetEpubResource(c *gin.Context) {
	id := c.Param("id")
	resourcePath := c.Param("resourcePath")

	// Strip leading slash
	if len(resourcePath) > 0 && resourcePath[0] == '/' {
		resourcePath = resourcePath[1:]
	}

	if resourcePath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No resource path provided"})
		return
	}

	// Verify comic exists
	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	result, err := service.GetEpubResource(id, resourcePath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Resource not found: " + err.Error()})
		return
	}

	// Generate ETag
	etag := `"` + archive.ContentMD5(result.Data) + `"`
	if c.GetHeader("If-None-Match") == etag {
		c.Header("ETag", etag)
		c.Status(http.StatusNotModified)
		return
	}

	c.Header("Content-Type", result.MimeType)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Content-Length", strconv.Itoa(len(result.Data)))
	c.Header("ETag", etag)
	c.Data(http.StatusOK, result.MimeType, result.Data)
}

// ============================================================
// POST /api/comics/:id/warmup — 预热页面缓存（减少阅读时的冷启动延迟）
// ============================================================

func (h *ImageHandler) WarmupPages(c *gin.Context) {
	id := c.Param("id")

	// Verify comic exists
	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	var body struct {
		StartPage int `json:"startPage"` // 起始页码（0-based）
		Count     int `json:"count"`     // 预热页数
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		// 默认值：从第 0 页开始预热 10 页
		body.StartPage = 0
		body.Count = 10
	}
	if body.Count <= 0 {
		body.Count = 10
	}
	if body.Count > 30 {
		body.Count = 30 // 限制最大预热页数
	}

	// 标记开始阅读，暂停后台扫描
	service.AcquireReadingLock()

	// 异步预热（不阻塞响应）
	service.WarmupPages(id, body.StartPage, body.Count)

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"comicId":   id,
		"startPage": body.StartPage,
		"count":     body.Count,
		"message":   "Warmup started in background",
	})
}

// ============================================================
// POST /api/comics/:id/warmup-done — 阅读结束，释放阅读锁
// ============================================================

func (h *ImageHandler) WarmupDone(c *gin.Context) {
	service.ReleaseReadingLock()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================================
// GET /api/comics/:id/embedded-images — 列出小说类型内嵌图片
// ============================================================

func (h *ImageHandler) GetEmbeddedImages(c *gin.Context) {
	id := c.Param("id")

	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	images, supported, err := service.ListEmbeddedImages(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "supported": supported})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"comicId":   id,
		"supported": supported,
		"total":     len(images),
		"images":    images,
	})
}

// ============================================================
// GET /api/comics/:id/embedded-image/:index — 获取单张内嵌图片
// ============================================================

func (h *ImageHandler) GetEmbeddedImage(c *gin.Context) {
	id := c.Param("id")
	indexStr := c.Param("index")
	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid image index"})
		return
	}

	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}

	img, err := service.GetEmbeddedImageData(id, index)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Embedded image not found: " + err.Error()})
		return
	}

	etag := `"` + archive.ContentMD5(img.Data) + `"`
	if c.GetHeader("If-None-Match") == etag {
		c.Header("ETag", etag)
		c.Status(http.StatusNotModified)
		return
	}

	c.Header("Content-Type", img.MimeType)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Content-Length", strconv.Itoa(len(img.Data)))
	c.Header("ETag", etag)
	c.Data(http.StatusOK, img.MimeType, img.Data)
}
