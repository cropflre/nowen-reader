package handler

import (
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

	comicsDir := config.GetComicsDir()
	_ = os.MkdirAll(comicsDir, 0755)

	var results []uploadResult
	for _, fh := range files {
		ext := strings.ToLower(filepath.Ext(fh.Filename))
		if !config.IsSupportedArchive(fh.Filename) {
			results = append(results, uploadResult{Filename: fh.Filename, Error: "Unsupported format: " + ext})
			continue
		}

		destPath := filepath.Join(comicsDir, fh.Filename)
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

	c.JSON(http.StatusOK, gin.H{
		"message": successCount,
		"results": results,
	})
}
