package handler

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
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
	categoryHint := strings.ToLower(strings.TrimSpace(c.PostForm("category")))

	// 可选：目标书库 ID。传入时上传到该书库的 rootPath；不传时走旧目录逻辑。
	libraryID := strings.TrimSpace(c.PostForm("libraryId"))

	// 解析目标书库（如果指定了）
	var targetLibrary *model.Library
	if libraryID != "" {
		lib, err := store.GetLibraryByID(libraryID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query library"})
			return
		}
		if lib == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Library not found: " + libraryID})
			return
		}
		if !lib.Enabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Library is disabled"})
			return
		}
		if lib.RootPath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Library rootPath is empty"})
			return
		}
		targetLibrary = lib
		_ = os.MkdirAll(lib.RootPath, 0755)
		log.Printf("[Upload] Targeting library %s (%s) at %s", lib.ID, lib.Type, lib.RootPath)
	} else {
		// 旧逻辑：使用 comicsDir / novelsDir
		comicsDir := config.GetComicsDir()
		novelsDir := config.GetNovelsDir()
		_ = os.MkdirAll(comicsDir, 0755)
		_ = os.MkdirAll(novelsDir, 0755)
	}

	var results []uploadResult
	for _, fh := range files {
		ext := strings.ToLower(filepath.Ext(fh.Filename))
		if !config.IsSupportedFile(fh.Filename) {
			results = append(results, uploadResult{Filename: fh.Filename, Error: "Unsupported format: " + ext})
			continue
		}

		// 确定写入目录
		var destDir string
		if targetLibrary != nil {
			// 按书库类型校验文件格式
			if !isFileAllowedForLibraryType(fh.Filename, targetLibrary.Type) {
				results = append(results, uploadResult{
					Filename: fh.Filename,
					Error:    fmt.Sprintf("File type not allowed for %s library", targetLibrary.Type),
				})
				continue
			}
			destDir = targetLibrary.RootPath
		} else {
			comicsDir := config.GetComicsDir()
			novelsDir := config.GetNovelsDir()
			destDir = pickUploadDir(fh.Filename, categoryHint, comicsDir, novelsDir)
		}

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

	resp := gin.H{
		"message":      message,
		"results":      results,
		"successCount": successCount,
		"totalCount":   totalCount,
	}
	if targetLibrary != nil {
		resp["libraryId"] = targetLibrary.ID
	}
	c.JSON(http.StatusOK, resp)
}

// isFileAllowedForLibraryType 根据书库类型判断文件是否允许上传。
func isFileAllowedForLibraryType(filename, libraryType string) bool {
	switch libraryType {
	case "comic":
		// 漫画书库只允许归档类格式
		return config.IsSupportedArchive(filename)
	case "novel":
		// 小说书库只允许电子书格式
		return config.IsNovelFile(filename)
	case "mixed":
		// 混合书库允许所有支持的格式
		return config.IsSupportedFile(filename)
	default:
		return config.IsSupportedFile(filename)
	}
}

// pickUploadDir 根据扩展名（以及可选的页面类别提示）决定目标目录。
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