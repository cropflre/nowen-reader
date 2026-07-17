package handler

import (
	"crypto/sha256"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const (
	opdsDefaultPageSize = 100
	opdsMaxPageSize     = 500
)

type OPDSHandler struct{}

func NewOPDSHandler() *OPDSHandler {
	return &OPDSHandler{}
}

func getBaseURL(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if forwardedProto := strings.ToLower(firstForwardedValue(c.GetHeader("X-Forwarded-Proto"))); forwardedProto == "http" || forwardedProto == "https" {
		scheme = forwardedProto
	}
	host := c.Request.Host
	if forwardedHost := firstForwardedValue(c.GetHeader("X-Forwarded-Host")); forwardedHost != "" {
		host = forwardedHost
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}

func firstForwardedValue(value string) string {
	if index := strings.Index(value, ","); index >= 0 {
		value = value[:index]
	}
	return strings.TrimSpace(value)
}

// GET /api/opds
func (h *OPDSHandler) Root(c *gin.Context) {
	setOPDSPrivateResponseHeaders(c)
	xml := service.GenerateRootCatalog(getBaseURL(c))
	c.Data(http.StatusOK, service.OPDSNavigationMIME, []byte(xml))
}

// GET /api/opds/search.xml
func (h *OPDSHandler) SearchDescription(c *gin.Context) {
	setOPDSPrivateResponseHeaders(c)
	xml := service.GenerateOpenSearchDescription(getBaseURL(c))
	c.Data(http.StatusOK, service.OpenSearchMIME, []byte(xml))
}

// GET /api/opds/all
func (h *OPDSHandler) All(c *gin.Context) {
	h.renderAcquisitionFeed(c, "All Comics", store.OPDSQueryOptions{Sort: store.OPDSSortTitle})
}

// GET /api/opds/recent
func (h *OPDSHandler) Recent(c *gin.Context) {
	h.renderAcquisitionFeed(c, "Recently Added", store.OPDSQueryOptions{Sort: store.OPDSSortRecent})
}

// GET /api/opds/favorites
func (h *OPDSHandler) Favorites(c *gin.Context) {
	h.renderAcquisitionFeed(c, "Favorites", store.OPDSQueryOptions{
		UserID:        getOPDSUserID(c),
		FavoritesOnly: true,
		Sort:          store.OPDSSortTitle,
	})
}

// GET /api/opds/series
func (h *OPDSHandler) Series(c *gin.Context) {
	if err := service.EnsureComicSeriesFresh(); err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to refresh comic series"))
		return
	}
	libraryIDs, err := store.GetUserDownloadableLibraryIDs(getOPDSUserID(c))
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to resolve library access"))
		return
	}
	page, pageSize := parseOPDSPagination(c)
	rows, total, err := store.GetOPDSSeries(store.OPDSSeriesQueryOptions{
		LibraryIDs: libraryIDs,
		Limit:      pageSize,
		Offset:     (page - 1) * pageSize,
	})
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to get comic series"))
		return
	}

	baseURL := getBaseURL(c)
	xml := service.GenerateSeriesNavigationFeed(service.OPDSSeriesFeedOptions{
		BaseURL:    baseURL,
		Title:      "Series",
		FeedID:     opdsFeedID(baseURL, c),
		Series:     toOPDSSeries(rows),
		Pagination: buildOPDSPagination(c, page, pageSize, total),
	})
	setOPDSPrivateResponseHeaders(c)
	c.Data(http.StatusOK, service.OPDSNavigationMIME, []byte(xml))
}

// GET /api/opds/series/:id
func (h *OPDSHandler) SeriesDetail(c *gin.Context) {
	series, libraryIDs, ok := getAccessibleOPDSSeries(c, c.Param("id"))
	if !ok {
		return
	}
	page, pageSize := parseOPDSPagination(c)
	rows, total, err := store.GetOPDSComics(store.OPDSQueryOptions{
		LibraryIDs: libraryIDs,
		SeriesID:   series.ID,
		Limit:      pageSize,
		Offset:     (page - 1) * pageSize,
	})
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to get series comics"))
		return
	}

	baseURL := getBaseURL(c)
	xml := service.GenerateAcquisitionFeed(service.OPDSAcquisitionFeedOptions{
		BaseURL:    baseURL,
		Title:      series.Title,
		FeedID:     opdsFeedID(baseURL, c),
		Comics:     toOPDSSeriesComics(rows),
		Pagination: buildOPDSPagination(c, page, pageSize, total),
	})
	setOPDSPrivateResponseHeaders(c)
	c.Data(http.StatusOK, service.OPDSAcquisitionMIME, []byte(xml))
}

// GET /api/opds/series/:id/cover
func (h *OPDSHandler) SeriesCover(c *gin.Context) {
	series, _, ok := getAccessibleOPDSSeries(c, c.Param("id"))
	if !ok {
		return
	}
	h.renderCover(c, series.CoverComicID)
}

// GET /api/opds/search?q=...
func (h *OPDSHandler) Search(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.Data(http.StatusBadRequest, "text/plain; charset=utf-8", []byte("q parameter required"))
		return
	}
	h.renderAcquisitionFeed(c, "Search: "+query, store.OPDSQueryOptions{
		Search: query,
		Sort:   store.OPDSSortTitle,
	})
}

func (h *OPDSHandler) renderAcquisitionFeed(c *gin.Context, title string, opts store.OPDSQueryOptions) {
	userID := getOPDSUserID(c)
	libraryIDs, err := store.GetUserDownloadableLibraryIDs(userID)
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to resolve library access"))
		return
	}

	page, pageSize := parseOPDSPagination(c)
	opts.LibraryIDs = libraryIDs
	opts.Limit = pageSize
	opts.Offset = (page - 1) * pageSize
	rows, total, err := store.GetOPDSComics(opts)
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to get comics"))
		return
	}

	baseURL := getBaseURL(c)
	pagination := buildOPDSPagination(c, page, pageSize, total)
	xml := service.GenerateAcquisitionFeed(service.OPDSAcquisitionFeedOptions{
		BaseURL:    baseURL,
		Title:      title,
		FeedID:     opdsFeedID(baseURL, c),
		Comics:     toOPDSComics(rows),
		Pagination: pagination,
	})
	setOPDSPrivateResponseHeaders(c)
	c.Data(http.StatusOK, service.OPDSAcquisitionMIME, []byte(xml))
}

func parseOPDSPagination(c *gin.Context) (page, pageSize int) {
	page = 1
	pageSize = opdsDefaultPageSize
	if value, err := strconv.Atoi(c.Query("page")); err == nil && value > 0 {
		page = value
	}
	if value, err := strconv.Atoi(c.Query("pageSize")); err == nil && value > 0 {
		pageSize = value
	}
	if pageSize > opdsMaxPageSize {
		pageSize = opdsMaxPageSize
	}
	return page, pageSize
}

func buildOPDSPagination(c *gin.Context, page, pageSize, total int) service.OPDSPagination {
	lastPage := 1
	startIndex := 0
	if total > 0 {
		lastPage = (total + pageSize - 1) / pageSize
		startIndex = (page-1)*pageSize + 1
	}
	result := service.OPDSPagination{
		SelfHref:     opdsPageHref(c, page, pageSize),
		FirstHref:    opdsPageHref(c, 1, pageSize),
		LastHref:     opdsPageHref(c, lastPage, pageSize),
		TotalResults: total,
		ItemsPerPage: pageSize,
		StartIndex:   startIndex,
	}
	if page > 1 {
		result.PreviousHref = opdsPageHref(c, page-1, pageSize)
	}
	if page < lastPage {
		result.NextHref = opdsPageHref(c, page+1, pageSize)
	}
	return result
}

func opdsPageHref(c *gin.Context, page, pageSize int) string {
	query := cloneURLValues(c.Request.URL.Query())
	query.Set("page", strconv.Itoa(page))
	query.Set("pageSize", strconv.Itoa(pageSize))
	return (&url.URL{Path: c.Request.URL.Path, RawQuery: query.Encode()}).String()
}

func opdsFeedID(baseURL string, c *gin.Context) string {
	query := make(url.Values)
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		query.Set("q", search)
	}
	feedURL := &url.URL{Path: c.Request.URL.Path, RawQuery: query.Encode()}
	return strings.TrimRight(baseURL, "/") + feedURL.String()
}

func cloneURLValues(values url.Values) url.Values {
	clone := make(url.Values, len(values))
	for key, entries := range values {
		clone[key] = append([]string(nil), entries...)
	}
	return clone
}

// GET /api/opds/cover/:id
func (h *OPDSHandler) Cover(c *gin.Context) {
	h.renderCover(c, c.Param("id"))
}

func (h *OPDSHandler) renderCover(c *gin.Context, comicID string) {
	comic, ok := getOPDSPublication(comicID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	if err := checkComicDownloadAccess(c, comic.ID); err != nil {
		return
	}
	thumbnail, mimeType, _, err := service.GetComicThumbnail(comic.ID)
	if err != nil || len(thumbnail) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thumbnail unavailable"})
		return
	}
	sum := sha256.Sum256(thumbnail)
	etag := fmt.Sprintf(`"%x"`, sum[:12])
	c.Header("Cache-Control", "private, max-age=300, must-revalidate")
	c.Header("Vary", "Authorization, Cookie")
	c.Header("ETag", etag)
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Data(http.StatusOK, mimeType, thumbnail)
}

// GET/HEAD /api/opds/download/:id
func (h *OPDSHandler) Download(c *gin.Context) {
	comic, ok := getOPDSPublication(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	if err := checkComicDownloadAccess(c, comic.ID); err != nil {
		return
	}

	resolved, err := service.GlobalFileResolver.ResolveContentPath(comic.ID)
	if err != nil || resolved.AbsolutePath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	file, err := os.Open(resolved.AbsolutePath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	contentType, _ := service.OPDSAcquisitionMIMEForFilename(comic.Filename)
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": filepath.Base(comic.Filename)})
	c.Header("Content-Disposition", disposition)
	c.Header("Content-Type", contentType)
	c.Header("Accept-Ranges", "bytes")
	c.Header("X-Accel-Buffering", "no")
	c.Header("X-Content-Type-Options", "nosniff")
	setOPDSPrivateResponseHeaders(c)
	http.ServeContent(c.Writer, c.Request, filepath.Base(comic.Filename), info.ModTime(), file)
}

func setOPDSPrivateResponseHeaders(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Vary", "Authorization, Cookie")
}

func getOPDSPublication(comicID string) (*store.ComicListItem, bool) {
	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil || comic.ComicType != "comic" || comic.LibraryID == "" {
		return nil, false
	}
	if _, supported := service.OPDSAcquisitionMIMEForFilename(comic.Filename); !supported {
		return nil, false
	}
	library, err := store.GetLibraryByID(comic.LibraryID)
	if err != nil || library == nil || !library.Enabled || library.Type != "comic" {
		return nil, false
	}
	return comic, true
}

func getOPDSUserID(c *gin.Context) string {
	if value, exists := c.Get("auth_user"); exists {
		if user, ok := value.(*model.AuthUser); ok {
			return user.ID
		}
	}
	return ""
}

func getAccessibleOPDSSeries(c *gin.Context, seriesID string) (*store.OPDSSeriesRow, []string, bool) {
	if err := service.EnsureComicSeriesFresh(); err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to refresh comic series"))
		return nil, nil, false
	}
	libraryIDs, err := store.GetUserDownloadableLibraryIDs(getOPDSUserID(c))
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to resolve library access"))
		return nil, nil, false
	}
	rows, _, err := store.GetOPDSSeries(store.OPDSSeriesQueryOptions{
		LibraryIDs: libraryIDs,
		SeriesID:   seriesID,
		Limit:      1,
	})
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/plain; charset=utf-8", []byte("Failed to get comic series"))
		return nil, nil, false
	}
	if len(rows) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic series not found"})
		return nil, nil, false
	}
	return &rows[0], libraryIDs, true
}

func toOPDSComics(rows []store.OPDSComicRow) []service.OPDSComic {
	comics := make([]service.OPDSComic, 0, len(rows))
	for _, row := range rows {
		comics = append(comics, service.OPDSComic{
			ID:          row.ID,
			Title:       row.Title,
			Author:      row.Author,
			Description: row.Description,
			Language:    row.Language,
			Genre:       row.Genre,
			Publisher:   row.Publisher,
			Year:        row.Year,
			PageCount:   row.PageCount,
			FileSize:    row.FileSize,
			AddedAt:     row.AddedAt,
			UpdatedAt:   row.UpdatedAt,
			Tags:        row.Tags,
			Filename:    row.Filename,
			SeriesID:    row.SeriesID,
			SeriesTitle: row.SeriesTitle,
		})
	}
	return comics
}

func toOPDSSeriesComics(rows []store.OPDSComicRow) []service.OPDSComic {
	comics := toOPDSComics(rows)
	for i, row := range rows {
		title := strings.TrimSpace(row.DisplayLabel)
		if title == "" {
			title = strings.TrimSpace(row.Title)
		}
		if title == "" {
			title = strings.TrimSuffix(filepath.Base(row.Filename), filepath.Ext(row.Filename))
		}
		if section := strings.TrimSpace(row.SectionTitle); section != "" {
			title = section + " - " + title
		}
		comics[i].Title = title
	}
	return comics
}

func toOPDSSeries(rows []store.OPDSSeriesRow) []service.OPDSSeries {
	series := make([]service.OPDSSeries, 0, len(rows))
	for _, row := range rows {
		series = append(series, service.OPDSSeries{
			ID:        row.ID,
			Title:     row.Title,
			ItemCount: row.ItemCount,
			UpdatedAt: row.UpdatedAt,
		})
	}
	return series
}
