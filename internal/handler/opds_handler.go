package handler

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const opdsMIMEType = "application/atom+xml;profile=opds-catalog;kind=navigation"

type OPDSHandler struct{}

func NewOPDSHandler() *OPDSHandler { return &OPDSHandler{} }

func getBaseURL(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, c.Request.Host)
}

// GET /api/opds
func (h *OPDSHandler) Root(c *gin.Context) {
	baseURL := getBaseURL(c)
	xml := service.GenerateRootCatalog(baseURL)
	c.Data(200, opdsMIMEType, []byte(xml))
}

// GET /api/opds/all
func (h *OPDSHandler) All(c *gin.Context) {
	baseURL := getBaseURL(c)
	comics, err := store.GetOPDSComics("", nil, `ORDER BY c."title" ASC`, 0)
	if err != nil {
		c.Data(500, "text/plain", []byte("Failed to get comics"))
		return
	}

	opdsComics := toOPDSComics(comics)
	xml := service.GenerateAcquisitionFeed(baseURL, "All Comics", baseURL+"/api/opds/all", opdsComics, "/api/opds/all")
	c.Data(200, opdsMIMEType, []byte(xml))
}

// GET /api/opds/recent
func (h *OPDSHandler) Recent(c *gin.Context) {
	baseURL := getBaseURL(c)
	comics, err := store.GetOPDSComics("", nil, `ORDER BY c."addedAt" DESC`, 50)
	if err != nil {
		c.Data(500, "text/plain", []byte("Failed to get comics"))
		return
	}

	opdsComics := toOPDSComics(comics)
	xml := service.GenerateAcquisitionFeed(baseURL, "Recently Added", baseURL+"/api/opds/recent", opdsComics, "/api/opds/recent")
	c.Data(200, opdsMIMEType, []byte(xml))
}

// GET /api/opds/favorites
func (h *OPDSHandler) Favorites(c *gin.Context) {
	baseURL := getBaseURL(c)
	comics, err := store.GetOPDSComics(`WHERE c."isFavorite" = 1`, nil, `ORDER BY c."title" ASC`, 0)
	if err != nil {
		c.Data(500, "text/plain", []byte("Failed to get comics"))
		return
	}

	opdsComics := toOPDSComics(comics)
	xml := service.GenerateAcquisitionFeed(baseURL, "Favorites", baseURL+"/api/opds/favorites", opdsComics, "/api/opds/favorites")
	c.Data(200, opdsMIMEType, []byte(xml))
}

// GET /api/opds/search?q=...
func (h *OPDSHandler) Search(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.Data(400, "text/plain", []byte("q parameter required"))
		return
	}

	baseURL := getBaseURL(c)
	searchPattern := "%" + query + "%"
	where := `WHERE (c."title" LIKE ? OR c."author" LIKE ? OR c."seriesName" LIKE ?)`
	args := []interface{}{searchPattern, searchPattern, searchPattern}

	comics, err := store.GetOPDSComics(where, args, `ORDER BY c."title" ASC`, 0)
	if err != nil {
		c.Data(500, "text/plain", []byte("Failed to search"))
		return
	}

	opdsComics := toOPDSComics(comics)
	xml := service.GenerateAcquisitionFeed(baseURL, "Search: "+query, baseURL+"/api/opds/search?q="+query, opdsComics, "/api/opds/search?q="+query)
	c.Data(200, opdsMIMEType, []byte(xml))
}

// GET /api/opds/download/:id
func (h *OPDSHandler) Download(c *gin.Context) {
	comicID := c.Param("id")
	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// Find file on disk
	var filePath string
	for _, dir := range config.GetAllComicsDirs() {
		fp := filepath.Join(dir, comic.Filename)
		if _, err := os.Stat(fp); err == nil {
			filePath = fp
			break
		}
	}

	if filePath == "" {
		c.JSON(404, gin.H{"error": "File not found"})
		return
	}

	ext := strings.ToLower(filepath.Ext(comic.Filename))
	var contentType string
	switch ext {
	case ".cbz", ".zip":
		contentType = "application/x-cbz"
	case ".cbr", ".rar":
		contentType = "application/x-cbr"
	case ".cb7", ".7z":
		contentType = "application/x-cb7"
	case ".pdf":
		contentType = "application/pdf"
	default:
		contentType = "application/octet-stream"
	}

	f, err := os.Open(filePath)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to open file"})
		return
	}
	defer f.Close()

	fi, _ := f.Stat()
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, comic.Filename))
	c.Header("Content-Length", fmt.Sprintf("%d", fi.Size()))
	c.Header("Content-Type", contentType)
	c.Status(200)
	io.Copy(c.Writer, f)
}

func toOPDSComics(rows []store.OPDSComicRow) []service.OPDSComic {
	comics := make([]service.OPDSComic, 0, len(rows))
	for _, r := range rows {
		comics = append(comics, service.OPDSComic{
			ID:          r.ID,
			Title:       r.Title,
			Author:      r.Author,
			Description: r.Description,
			Language:    r.Language,
			Genre:       r.Genre,
			Publisher:   r.Publisher,
			Year:        r.Year,
			PageCount:   r.PageCount,
			AddedAt:     r.AddedAt,
			UpdatedAt:   r.UpdatedAt,
			Tags:        r.Tags,
			Filename:    r.Filename,
		})
	}
	return comics
}
