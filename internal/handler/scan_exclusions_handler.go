package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

type ScanExclusionsHandler struct{}

func NewScanExclusionsHandler() *ScanExclusionsHandler {
	return &ScanExclusionsHandler{}
}

func (h *ScanExclusionsHandler) Get(c *gin.Context) {
	cfg := config.GetSiteConfig()
	pattern := ""
	if cfg.ScannerConfig != nil {
		pattern = cfg.ScannerConfig.ExcludePathRegex
	}
	c.JSON(http.StatusOK, gin.H{"excludePathRegex": pattern})
}

func (h *ScanExclusionsHandler) Update(c *gin.Context) {
	var body struct {
		ExcludePathRegex *string `json:"excludePathRegex"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ExcludePathRegex == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "需要提供 excludePathRegex"})
		return
	}
	matcher, err := service.CompileScanExclusion(*body.ExcludePathRegex)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cfg := config.GetSiteConfig()
	scanner := config.ScannerConfig{}
	if cfg.ScannerConfig != nil {
		scanner = *cfg.ScannerConfig
	}
	if scanner.ExcludePathRegex != matcher.Pattern() {
		scanner.ExcludePathRegex = matcher.Pattern()
		cfg.ScannerConfig = &scanner
		if err := config.SaveSiteConfig(&cfg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存扫描排除规则失败"})
			return
		}
		service.ResetScannerDirectorySnapshot()
		service.RefreshScanWatcher()
	}
	c.JSON(http.StatusOK, gin.H{"excludePathRegex": matcher.Pattern()})
}

func (h *ScanExclusionsHandler) Preview(c *gin.Context) {
	var body struct {
		ExcludePathRegex *string `json:"excludePathRegex"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ExcludePathRegex == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "需要提供 excludePathRegex"})
		return
	}
	preview, err := service.PreviewScanExclusions(*body.ExcludePathRegex)
	if err != nil {
		if _, compileErr := service.CompileScanExclusion(*body.ExcludePathRegex); compileErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": compileErr.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, preview)
}

func (h *ScanExclusionsHandler) Cleanup(c *gin.Context) {
	var body struct {
		MatchHash string `json:"matchHash"`
		Confirm   bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || !body.Confirm || body.MatchHash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先预览并确认清理"})
		return
	}
	removed, err := service.CleanupScanExclusions(body.MatchHash)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, service.ErrScanExclusionBusy) || errors.Is(err, service.ErrScanExclusionChanged) {
			status = http.StatusConflict
		} else if errors.Is(err, service.ErrScanExclusionInactive) {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error(), "removed": removed})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": removed})
}
