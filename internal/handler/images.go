package handler

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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

	pages, err := service.GetComicPages(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get pages"})
		return
	}

	type pageInfo struct {
		Index int    `json:"index"`
		Name  string `json:"name"`
		URL   string `json:"url"`
	}
	pageList := make([]pageInfo, len(pages))
	for i, name := range pages {
		pageList[i] = pageInfo{
			Index: i,
			Name:  name,
			URL:   fmt.Sprintf("/api/comics/%s/page/%d", id, i),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"comicId":    id,
		"title":      comic.Title,
		"totalPages": len(pages),
		"pages":      pageList,
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
	if err != nil || result == nil {
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

	thumbnail, err := service.GetComicThumbnail(id)
	if err != nil || thumbnail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thumbnail unavailable"})
		return
	}

	// Generate ETag based on thumbnail file mtime + size
	cachePath := filepath.Join(config.GetThumbnailsDir(), id+".webp")
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
	c.Header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
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
	cachePath := filepath.Join(thumbDir, id+".webp")

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
		URL   string `json:"url"`
		Reset bool   `json:"reset"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Reset to default
	if body.Reset {
		os.Remove(cachePath)
		c.JSON(http.StatusOK, gin.H{"success": true, "source": "reset"})
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
