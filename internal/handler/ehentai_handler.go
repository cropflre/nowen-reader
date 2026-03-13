package handler

import (
	"io"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

type EHentaiHandler struct{}

func NewEHentaiHandler() *EHentaiHandler { return &EHentaiHandler{} }

// GET /api/ehentai/status
func (h *EHentaiHandler) Status(c *gin.Context) {
	configured := service.EHentaiIsConfigured()
	c.JSON(200, gin.H{"configured": configured})
}

// GET /api/ehentai/settings
func (h *EHentaiHandler) GetSettings(c *gin.Context) {
	cfg := service.LoadEHentaiConfig()
	// Mask values
	masked := gin.H{
		"memberId": maskString(cfg.MemberID),
		"passHash": maskString(cfg.PassHash),
		"igneous":  maskString(cfg.Igneous),
		"hasMemberId": cfg.MemberID != "",
		"hasPassHash": cfg.PassHash != "",
		"hasIgneous":  cfg.Igneous != "",
	}
	c.JSON(200, masked)
}

// PUT /api/ehentai/settings
func (h *EHentaiHandler) UpdateSettings(c *gin.Context) {
	var body service.EHentaiConfig
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}

	// Preserve existing values if masked
	existing := service.LoadEHentaiConfig()
	if strings.Contains(body.MemberID, "****") || body.MemberID == "" {
		body.MemberID = existing.MemberID
	}
	if strings.Contains(body.PassHash, "****") || body.PassHash == "" {
		body.PassHash = existing.PassHash
	}
	if strings.Contains(body.Igneous, "****") || body.Igneous == "" {
		body.Igneous = existing.Igneous
	}

	if err := service.SaveEHentaiConfig(body); err != nil {
		c.JSON(500, gin.H{"error": "Failed to save config"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// DELETE /api/ehentai/settings
func (h *EHentaiHandler) DeleteSettings(c *gin.Context) {
	if err := service.SaveEHentaiConfig(service.EHentaiConfig{}); err != nil {
		c.JSON(500, gin.H{"error": "Failed to reset config"})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// GET /api/ehentai/search?q=...&page=0&category=0
func (h *EHentaiHandler) Search(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(400, gin.H{"error": "q parameter is required"})
		return
	}

	if !service.EHentaiIsConfigured() {
		c.JSON(400, gin.H{"error": "E-Hentai not configured. Set cookies in settings."})
		return
	}

	page := 0
	if p := c.Query("page"); p != "" {
		page, _ = strconv.Atoi(p)
	}

	category := 0
	if cat := c.Query("category"); cat != "" {
		category, _ = strconv.Atoi(cat)
	}

	result, err := service.EHentaiSearch(query, page, category)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, result)
}

// GET /api/ehentai/gallery/:gid/:token
func (h *EHentaiHandler) GalleryDetail(c *gin.Context) {
	gid := c.Param("gid")
	token := c.Param("token")
	if gid == "" || token == "" {
		c.JSON(400, gin.H{"error": "gid and token required"})
		return
	}

	detail, err := service.EHentaiGetGalleryDetail(gid, token)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, detail)
}

// POST /api/ehentai/gallery/:gid/:token — resolve page image URLs
func (h *EHentaiHandler) ResolvePageImages(c *gin.Context) {
	var body struct {
		PageLinks []string `json:"pageLinks"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.PageLinks) == 0 {
		c.JSON(400, gin.H{"error": "pageLinks array required"})
		return
	}

	// Limit batch size
	links := body.PageLinks
	if len(links) > 10 {
		links = links[:10]
	}

	type imageResult struct {
		PageURL  string `json:"pageUrl"`
		ImageURL string `json:"imageUrl"`
		Filename string `json:"filename"`
		Error    string `json:"error,omitempty"`
	}

	var results []imageResult
	for i, link := range links {
		if i > 0 {
			// Rate limiting
			// time.Sleep(500 * time.Millisecond)
		}
		imgURL, filename, err := service.EHentaiGetRealImageURL(link)
		if err != nil {
			results = append(results, imageResult{PageURL: link, Error: err.Error()})
		} else {
			results = append(results, imageResult{PageURL: link, ImageURL: imgURL, Filename: filename})
		}
	}

	c.JSON(200, gin.H{"images": results})
}

// GET /api/ehentai/proxy?url=...
func (h *EHentaiHandler) Proxy(c *gin.Context) {
	imageURL := c.Query("url")
	if imageURL == "" {
		c.JSON(400, gin.H{"error": "url parameter required"})
		return
	}

	// Validate domain
	if !service.IsAllowedImageDomain(imageURL) {
		c.JSON(403, gin.H{"error": "Domain not in whitelist"})
		return
	}

	resp, err := service.EHentaiFetchImage(imageURL)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	contentLength := resp.Header.Get("Content-Length")

	c.Header("Content-Type", contentType)
	if contentLength != "" {
		c.Header("Content-Length", contentLength)
	}
	c.Header("Cache-Control", "public, max-age=86400")
	c.Status(200)
	io.Copy(c.Writer, resp.Body)
}

// GET /api/ehentai/download?gid=...
// POST /api/ehentai/download
func (h *EHentaiHandler) Download(c *gin.Context) {
	if c.Request.Method == "GET" {
		// Check download status (simplified placeholder)
		c.JSON(200, gin.H{"status": "not_started", "message": "Gallery download not yet implemented in Go backend"})
		return
	}

	// POST: start download (placeholder)
	c.JSON(200, gin.H{"status": "not_implemented", "message": "Gallery download will be implemented in a future phase"})
}

func maskString(s string) string {
	if s == "" {
		return ""
	}
	if len(s) > 6 {
		return s[:3] + "****" + s[len(s)-3:]
	}
	return "****"
}
