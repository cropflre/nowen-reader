package handler

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
)

type UploadHandler struct{}

func NewUploadHandler() *UploadHandler { return &UploadHandler{} }

type uploadResult struct {
	Filename string `json:"filename"`
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
}

// POST /api/upload
func (h *UploadHandler) Upload(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse multipart form"})
		return
	}

	files := form.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No files provided"})
		return
	}

	// 可选：当前页面的内容类别（"comic" | "novel"），用于消除歧义扩展名（如 .azw3）。
	// 不传则按扩展名自动判断；漫画归档 → comicsDir；电子书 → novelsDir。
	categoryHint := strings.ToLower(strings.TrimSpace(c.PostForm("category")))

	comicsDir := config.GetComicsDir()
	novelsDir := config.GetNovelsDir()
	_ = os.MkdirAll(comicsDir, 0755)
	_ = os.MkdirAll(novelsDir, 0755)

	var results []uploadResult
	for _, fh := range files {
		ext := strings.ToLower(filepath.Ext(fh.Filename))
		if !config.IsSupportedFile(fh.Filename) {
			results = append(results, uploadResult{Filename: fh.Filename, Error: "Unsupported format: " + ext})
			continue
		}

		// 按扩展名 + 类别提示选择目标目录
		destDir := pickUploadDir(fh.Filename, categoryHint, comicsDir, novelsDir)

		destPath := filepath.Join(destDir, fh.Filename)
		if _, err := os.Stat(destPath); err == nil {
			results = append(results, uploadResult{Filename: fh.Filename, Error: "File already exists"})
			continue
		}

		src, err := fh.Open()
		if err != nil {
			results = append(results, uploadResult{Filename: fh.Filename, Error: "Failed to read file"})
			continue
		}

		dst, err := os.Create(destPath)
		if err != nil {
			src.Close()
			results = append(results, uploadResult{Filename: fh.Filename, Error: "Failed to save file"})
			continue
		}

		_, copyErr := io.Copy(dst, src)
		src.Close()
		dst.Close()

		if copyErr != nil {
			os.Remove(destPath)
			results = append(results, uploadResult{Filename: fh.Filename, Error: "Failed to save file"})
			continue
		}

		results = append(results, uploadResult{Filename: fh.Filename, Success: true})
	}

	successCount := 0
	for _, r := range results {
		if r.Success {
			successCount++
		}
	}

	totalCount := len(results)
	var message string
	if successCount == totalCount {
		message = fmt.Sprintf("Successfully uploaded %d file(s)", successCount)
	} else if successCount > 0 {
		message = fmt.Sprintf("Uploaded %d of %d file(s), %d failed", successCount, totalCount, totalCount-successCount)
	} else {
		message = fmt.Sprintf("Upload failed: all %d file(s) failed", totalCount)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      message,
		"results":      results,
		"successCount": successCount,
		"totalCount":   totalCount,
	})
}

// pickUploadDir 根据扩展名（以及可选的页面类别提示）决定目标目录。
//   - 纯漫画归档扩展名（.zip/.cbz/.cbr/.rar/.7z/.cb7/.pdf）→ comicsDir
//   - 纯电子书扩展名（.txt/.epub/.mobi/.html/.htm）→ novelsDir
//   - 同属两类的歧义扩展名（.azw3）→ 优先看 categoryHint；为空时默认电子书
func pickUploadDir(filename, categoryHint, comicsDir, novelsDir string) string {
	isArchive := config.IsSupportedArchive(filename)
	isNovel := config.IsNovelFile(filename)

	switch categoryHint {
	case "novel", "novels", "ebook":
		if isNovel {
			return novelsDir
		}
		return comicsDir
	case "comic", "comics", "manga":
		if isArchive {
			return comicsDir
		}
		return novelsDir
	}

	// 无 hint：歧义时优先视为电子书（.azw3 多见于 Kindle 电子书）
	if isNovel && !isArchive {
		return novelsDir
	}
	if isArchive && !isNovel {
		return comicsDir
	}
	if isNovel {
		return novelsDir
	}
	return comicsDir
}
