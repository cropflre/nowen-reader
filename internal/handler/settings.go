package handler

import (
	"net/http"
	"os"
	"path/filepath"

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
	SiteName         string   `json:"siteName"`
	ComicsDir        string   `json:"comicsDir"`
	ExtraComicsDirs  []string `json:"extraComicsDirs"`
	NovelsDir        string   `json:"novelsDir"`
	ExtraNovelsDirs  []string `json:"extraNovelsDirs"`
	ThumbnailWidth   int      `json:"thumbnailWidth"`
	ThumbnailHeight  int      `json:"thumbnailHeight"`
	PageSize         int      `json:"pageSize"`
	Language         string   `json:"language"`
	Theme            string   `json:"theme"`
	RegistrationMode string   `json:"registrationMode"`
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
		SiteName:         config.GetSiteName(),
		ComicsDir:        comicsDir,
		ExtraComicsDirs:  extraDirs,
		NovelsDir:        novelsDir,
		ExtraNovelsDirs:  extraNovelsDirs,
		ThumbnailWidth:   config.GetThumbnailWidth(),
		ThumbnailHeight:  config.GetThumbnailHeight(),
		PageSize:         config.GetPageSize(),
		Language:         cfg.Language,
		Theme:            cfg.Theme,
		RegistrationMode: config.GetRegistrationMode(),
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
		SiteName         *string  `json:"siteName"`
		ComicsDir        *string  `json:"comicsDir"`
		ExtraComicsDirs  []string `json:"extraComicsDirs"`
		NovelsDir        *string  `json:"novelsDir"`
		ExtraNovelsDirs  []string `json:"extraNovelsDirs"`
		ThumbnailWidth   *int     `json:"thumbnailWidth"`
		ThumbnailHeight  *int     `json:"thumbnailHeight"`
		PageSize         *int     `json:"pageSize"`
		Language         *string  `json:"language"`
		Theme            *string  `json:"theme"`
		RegistrationMode *string  `json:"registrationMode"`
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

	if err := config.SaveSiteConfig(&current); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "Failed to save settings",
			"detail": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "config": current})
}
