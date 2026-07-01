package handler

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/model"
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

// opdsDefaultPageSize 是 OPDS 分页的默认每页数量，避免万级数据一次性返回。
const opdsDefaultPageSize = 100

// parseOPDSPagination 从查询参数中解析 OPDS 分页参数。
func parseOPDSPagination(c *gin.Context) (limit, offset int) {
	limit = opdsDefaultPageSize
	offset = 0
	if ps := c.Query("pageSize"); ps != "" {
		if n, err := strconv.Atoi(ps); err == nil && n > 0 {
			limit = n
			if limit > 500 {
				limit = 500 // 上限保护
			}
		}
	}
	if p := c.Query("page"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 1 {
			offset = (n - 1) * limit
		}
	}
	return
}

// GET /api/opds/all —— 支持分页（?page=1&pageSize=100）
func (h *OPDSHandler) All(c *gin.Context) {
	baseURL := getBaseURL(c)
	limit, offset := parseOPDSPagination(c)
	filterWhere, filterArgs := opdsLibraryFilter(c)
	comics, err := store.GetOPDSComics(filterWhere, filterArgs, `ORDER BY c."title" ASC`, limit, offset)
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
	filterWhere, filterArgs := opdsLibraryFilter(c)
	comics, err := store.GetOPDSComics(filterWhere, filterArgs, `ORDER BY c."addedAt" DESC`, 50)
	if err != nil {
		c.Data(500, "text/plain", []byte("Failed to get comics"))
		return
	}

	opdsComics := toOPDSComics(comics)
	xml := service.GenerateAcquisitionFeed(baseURL, "Recently Added", baseURL+"/api/opds/recent", opdsComics, "/api/opds/recent")
	c.Data(200, opdsMIMEType, []byte(xml))
}

// GET /api/opds/favorites —— 支持分页
func (h *OPDSHandler) Favorites(c *gin.Context) {
	baseURL := getBaseURL(c)
	limit, offset := parseOPDSPagination(c)
	filterWhere, filterArgs := opdsLibraryFilter(c)
	where := `WHERE c."isFavorite" = 1`
	var args []interface{}
	if filterWhere != "" {
		where = where + " AND " + strings.TrimPrefix(filterWhere, "WHERE ")
		args = append(args, filterArgs...)
	}
	comics, err := store.GetOPDSComics(where, args, `ORDER BY c."title" ASC`, limit, offset)
	if err != nil {
		c.Data(500, "text/plain", []byte("Failed to get comics"))
		return
	}

	opdsComics := toOPDSComics(comics)
	xml := service.GenerateAcquisitionFeed(baseURL, "Favorites", baseURL+"/api/opds/favorites", opdsComics, "/api/opds/favorites")
	c.Data(200, opdsMIMEType, []byte(xml))
}

// GET /api/opds/search?q=... —— 支持分页
func (h *OPDSHandler) Search(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.Data(400, "text/plain", []byte("q parameter required"))
		return
	}

	baseURL := getBaseURL(c)
	searchPattern := "%" + query + "%"
	filterWhere, filterArgs := opdsLibraryFilter(c)
	where := `WHERE (c."title" LIKE ? OR c."author" LIKE ?)`
	args := []interface{}{searchPattern, searchPattern}
	if filterWhere != "" {
		where = where + " AND " + strings.TrimPrefix(filterWhere, "WHERE ")
		args = append(args, filterArgs...)
	}

	limit, offset := parseOPDSPagination(c)
	comics, err := store.GetOPDSComics(where, args, `ORDER BY c."title" ASC`, limit, offset)
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

	if err := checkComicDownloadAccess(c, comicID); err != nil {
		return
	}

	resolved, err := service.GlobalFileResolver.ResolveContentPath(comicID)
	if err != nil {
		c.JSON(404, gin.H{"error": "File not found"})
		return
	}
	filePath := resolved.AbsolutePath

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
	case ".epub":
		contentType = "application/epub+zip"
	case ".txt":
		contentType = "text/plain; charset=utf-8"
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

// getOPDSUserID 从 OPDS 请求中提取当前用户 ID。
func getOPDSUserID(c *gin.Context) string {
	if u, exists := c.Get("auth_user"); exists {
		if user, ok := u.(*model.AuthUser); ok {
			return user.ID
		}
	}
	return ""
}

// opdsLibraryFilter 返回基于用户书库权限的 WHERE 子句片段和参数。
// 管理员或空用户不过滤。
func opdsLibraryFilter(c *gin.Context) (string, []interface{}) {
	uid := getOPDSUserID(c)
	if uid == "" {
		return "WHERE 1 = 0", nil
	}
	ids, err := store.GetUserAccessibleLibraryIDs(uid)
	if err != nil {
		return "WHERE 1 = 0", nil
	}
	if len(ids) == 0 {
		return "WHERE 1 = 0", nil
	}
	var role string
	_ = store.GetUserRole(uid, &role)
	if role == "admin" {
		return "", nil
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	return fmt.Sprintf(`WHERE c."libraryId" IN (%s)`, strings.Join(placeholders, ",")), args
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
