package handler

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
)

// SettingsHandler handles site settings API endpoints.
type SettingsHandler struct{}

// NewSettingsHandler creates a new SettingsHandler.
func NewSettingsHandler() *SettingsHandler {
	return &SettingsHandler{}
}

// SiteConfigResponse is the full settings response.
type SiteConfigResponse struct {
	SiteName            string   `json:"siteName"`
	SiteIcon            string   `json:"siteIcon"`
	ComicsDir           string   `json:"comicsDir"`
	ExtraComicsDirs     []string `json:"extraComicsDirs"`
	NovelsDir           string   `json:"novelsDir"`
	ExtraNovelsDirs     []string `json:"extraNovelsDirs"`
	ThumbnailWidth      int      `json:"thumbnailWidth"`
	ThumbnailHeight     int      `json:"thumbnailHeight"`
	PageSize            int      `json:"pageSize"`
	Language            string   `json:"language"`
	Theme               string   `json:"theme"`
	RegistrationMode    string   `json:"registrationMode"`
	ScraperEnabled      bool     `json:"scraperEnabled"`
	EbookTypeAutoDetect string   `json:"ebookTypeAutoDetect"` // off | comics | all
	PdfRendererPath     string   `json:"pdfRendererPath"`     // PDF 渲染外部工具路径
}

// GET /api/site-settings — Get site settings
func (h *SettingsHandler) GetSettings(c *gin.Context) {
	cfg := config.GetSiteConfig()

	// Apply defaults
	comicsDir := cfg.ComicsDir
	if comicsDir == "" {
		if d := os.Getenv("COMICS_DIR"); d != "" {
			comicsDir = d
		} else {
			cwd, _ := os.Getwd()
			comicsDir = filepath.Join(cwd, "comics")
		}
	}

	extraDirs := cfg.ExtraComicsDirs
	if extraDirs == nil {
		extraDirs = []string{}
	}

	// 电子书目录
	novelsDir := cfg.NovelsDir
	if novelsDir == "" {
		if d := os.Getenv("NOVELS_DIR"); d != "" {
			novelsDir = d
		} else {
			cwd, _ := os.Getwd()
			novelsDir = filepath.Join(cwd, "novels")
		}
	}

	extraNovelsDirs := cfg.ExtraNovelsDirs
	if extraNovelsDirs == nil {
		extraNovelsDirs = []string{}
	}

	resp := SiteConfigResponse{
		SiteName:            config.GetSiteName(),
		SiteIcon:            config.GetSiteIcon(),
		ComicsDir:           comicsDir,
		ExtraComicsDirs:     extraDirs,
		NovelsDir:           novelsDir,
		ExtraNovelsDirs:     extraNovelsDirs,
		ThumbnailWidth:      config.GetThumbnailWidth(),
		ThumbnailHeight:     config.GetThumbnailHeight(),
		PageSize:            config.GetPageSize(),
		Language:            cfg.Language,
		Theme:               cfg.Theme,
		RegistrationMode:    config.GetRegistrationMode(),
		ScraperEnabled:      config.IsScraperEnabled(),
		EbookTypeAutoDetect: cfg.ScannerConfig.EbookAutoDetectMode(),
		PdfRendererPath:     cfg.PdfRendererPath,
	}

	if resp.Language == "" {
		resp.Language = "auto"
	}
	if resp.Theme == "" {
		resp.Theme = "dark"
	}

	c.JSON(http.StatusOK, resp)
}

// PUT /api/site-settings — Update site settings
func (h *SettingsHandler) UpdateSettings(c *gin.Context) {
	var body struct {
		SiteName            *string  `json:"siteName"`
		ComicsDir           *string  `json:"comicsDir"`
		ExtraComicsDirs     []string `json:"extraComicsDirs"`
		NovelsDir           *string  `json:"novelsDir"`
		ExtraNovelsDirs     []string `json:"extraNovelsDirs"`
		ThumbnailWidth      *int     `json:"thumbnailWidth"`
		ThumbnailHeight     *int     `json:"thumbnailHeight"`
		PageSize            *int     `json:"pageSize"`
		Language            *string  `json:"language"`
		Theme               *string  `json:"theme"`
		RegistrationMode    *string  `json:"registrationMode"`
		ScraperEnabled      *bool    `json:"scraperEnabled"`
		EbookTypeAutoDetect *string  `json:"ebookTypeAutoDetect"`
		PdfRendererPath     *string  `json:"pdfRendererPath"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Load current config and apply updates
	current := config.GetSiteConfig()

	if body.SiteName != nil {
		current.SiteName = *body.SiteName
	}
	if body.ComicsDir != nil {
		current.ComicsDir = *body.ComicsDir
	}
	if body.ExtraComicsDirs != nil {
		current.ExtraComicsDirs = body.ExtraComicsDirs
	}
	if body.NovelsDir != nil {
		current.NovelsDir = *body.NovelsDir
	}
	if body.ExtraNovelsDirs != nil {
		current.ExtraNovelsDirs = body.ExtraNovelsDirs
	}
	if body.ThumbnailWidth != nil && *body.ThumbnailWidth > 0 {
		current.ThumbnailWidth = *body.ThumbnailWidth
	}
	if body.ThumbnailHeight != nil && *body.ThumbnailHeight > 0 {
		current.ThumbnailHeight = *body.ThumbnailHeight
	}
	if body.PageSize != nil && *body.PageSize > 0 {
		current.PageSize = *body.PageSize
	}
	if body.Language != nil {
		current.Language = *body.Language
	}
	if body.Theme != nil {
		current.Theme = *body.Theme
	}
	if body.RegistrationMode != nil {
		mode := *body.RegistrationMode
		if mode == "open" || mode == "invite" || mode == "closed" {
			current.RegistrationMode = mode
		}
	}
	if body.ScraperEnabled != nil {
		current.ScraperEnabled = body.ScraperEnabled
	}
	if body.EbookTypeAutoDetect != nil {
		mode := *body.EbookTypeAutoDetect
		if mode == "off" || mode == "comics" || mode == "all" {
			if current.ScannerConfig == nil {
				current.ScannerConfig = &config.ScannerConfig{}
			}
			current.ScannerConfig.EbookTypeAutoDetect = mode
		}
	}
	if body.PdfRendererPath != nil {
		current.PdfRendererPath = strings.TrimSpace(*body.PdfRendererPath)
	}

	if err := config.SaveSiteConfig(&current); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "Failed to save settings",
			"detail": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "config": current})
}

// POST /api/site-settings/icon — Upload site icon
func (h *SettingsHandler) UploadIcon(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的图标文件"})
		return
	}

	// 验证文件类型（不支持 SVG，存在 XSS 风险）
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{
		".png": true, ".jpg": true, ".jpeg": true, ".webp": true,
	}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的文件格式，请上传 PNG、JPG 或 WebP 格式的图标"})
		return
	}

	// 验证文件大小（最大 2MB）
	if file.Size > 2*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "图标文件大小不能超过 2MB"})
		return
	}

	// 保存图标文件
	dataDir := config.DataDir()
	iconPath := filepath.Join(dataDir, "site-icon"+ext)

	// 删除旧的图标文件（如果有，且在安全目录内）
	oldIcon := config.GetSiteIcon()
	if oldIcon != "" && oldIcon != iconPath {
		cleanDataDir := filepath.Clean(dataDir)
		cleanOldIcon := filepath.Clean(oldIcon)
		if strings.HasPrefix(cleanOldIcon, cleanDataDir) {
			if err := os.Remove(oldIcon); err != nil {
				log.Printf("[settings] Failed to remove old icon: %v", err)
			}
		}
	}

	if err := c.SaveUploadedFile(file, iconPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存图标文件失败"})
		return
	}

	// 更新配置
	current := config.GetSiteConfig()
	current.SiteIcon = iconPath
	if err := config.SaveSiteConfig(&current); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "iconPath": iconPath})
}

// GET /api/site-settings/icon — Get site icon
func (h *SettingsHandler) GetIcon(c *gin.Context) {
	iconPath := config.GetSiteIcon()
	if iconPath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "未设置自定义图标"})
		return
	}

	// 检查文件是否存在
	if _, err := os.Stat(iconPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "图标文件不存在"})
		return
	}

	// 根据扩展名设置 Content-Type
	ext := strings.ToLower(filepath.Ext(iconPath))
	contentTypes := map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".svg":  "image/svg+xml",
		".webp": "image/webp",
	}
	contentType := contentTypes[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "public, max-age=3600")
	c.File(iconPath)
}

// DELETE /api/site-settings/icon — Delete site icon (reset to default)
func (h *SettingsHandler) DeleteIcon(c *gin.Context) {
	iconPath := config.GetSiteIcon()
	if iconPath != "" {
		// 验证路径在安全目录内
		dataDir := config.DataDir()
		cleanDataDir := filepath.Clean(dataDir)
		cleanIconPath := filepath.Clean(iconPath)
		if strings.HasPrefix(cleanIconPath, cleanDataDir) {
			if err := os.Remove(iconPath); err != nil {
				log.Printf("[settings] Failed to remove icon: %v", err)
			}
		}
	}

	current := config.GetSiteConfig()
	current.SiteIcon = ""
	if err := config.SaveSiteConfig(&current); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
