package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type SeriesHandler struct{}

func NewSeriesHandler() *SeriesHandler { return &SeriesHandler{} }

func requestedAccessibleLibraries(c *gin.Context) ([]string, error) {
	uid := getUserID(c)
	user := middleware.GetCurrentUser(c)
	requested := splitQueryIDs(c.Query("libraryIds"))
	if user != nil && user.Role == "admin" {
		return requested, nil
	}
	accessible, err := store.GetUserAccessibleLibraryIDs(uid)
	if err != nil {
		return nil, err
	}
	if len(requested) == 0 {
		return accessible, nil
	}
	allowed := make(map[string]struct{}, len(accessible))
	for _, id := range accessible {
		allowed[id] = struct{}{}
	}
	filtered := make([]string, 0, len(requested))
	for _, id := range requested {
		if _, ok := allowed[id]; ok {
			filtered = append(filtered, id)
		}
	}
	return filtered, nil
}

func splitQueryIDs(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if id := strings.TrimSpace(part); id != "" {
			result = append(result, id)
		}
	}
	return result
}

func (h *SeriesHandler) List(c *gin.Context) {
	paginated := c.Query("page") != "" || c.Query("pageSize") != ""
	page, pageSize := 1, 50
	if paginated {
		var err error
		page, err = strconv.Atoi(c.DefaultQuery("page", "1"))
		if err != nil || page < 1 || page > 2147483647 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid page"})
			return
		}
		pageSize, err = strconv.Atoi(c.DefaultQuery("pageSize", "50"))
		if err != nil || pageSize < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid pageSize"})
			return
		}
		if pageSize > 200 {
			pageSize = 200
		}
	}
	respond := func(series []store.SeriesSummary, total int) {
		body := gin.H{"series": series}
		if paginated {
			body["total"] = total
			body["page"] = page
			body["pageSize"] = pageSize
			body["totalPages"] = (total + pageSize - 1) / pageSize
		}
		c.JSON(http.StatusOK, body)
	}
	if err := service.EnsureComicSeriesFresh(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh comic series"})
		return
	}
	libraryIDs, err := requestedAccessibleLibraries(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve library access"})
		return
	}
	user := middleware.GetCurrentUser(c)
	if user == nil || (user.Role != "admin" && len(libraryIDs) == 0) {
		respond([]store.SeriesSummary{}, 0)
		return
	}
	queryStarted := time.Now()
	limit := 0
	if paginated {
		limit = pageSize
	}
	series, total, err := store.ListSeriesSummariesPage(libraryIDs, getUserID(c), c.Query("search"), page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list comic series"})
		return
	}
	manageable, err := store.GetUserManageableLibraryIDs(getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve library permissions"})
		return
	}
	for index := range series {
		series[index].CanManage = manageable[series[index].LibraryID]
	}
	recordLibraryQuery(c, "series", queryStarted, len(series), total)
	respond(series, total)
}

func (h *SeriesHandler) Get(c *gin.Context) {
	if err := service.EnsureComicSeriesFresh(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh comic series"})
		return
	}
	detail, err := store.GetSeriesDetail(c.Param("id"), getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load comic series"})
		return
	}
	if detail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic series not found"})
		return
	}
	allowed, err := store.UserCanViewLibrary(getUserID(c), detail.Series.LibraryID)
	if err != nil || !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "No access to this library"})
		return
	}
	detail.Series.CanManage, _ = store.UserCanManageLibrary(getUserID(c), detail.Series.LibraryID)
	store.SortSeriesDetail(detail)
	c.JSON(http.StatusOK, detail)
}

func (h *SeriesHandler) Preview(c *gin.Context) {
	libraryID := strings.TrimSpace(c.Query("libraryId"))
	if libraryID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "libraryId is required"})
		return
	}
	canManage, err := store.UserCanManageLibrary(getUserID(c), libraryID)
	if err != nil || !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "No permission to manage this library"})
		return
	}
	lib, err := store.GetLibraryByID(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch library"})
		return
	}
	seriesDepth := store.DefaultLibrarySeriesDepth
	if lib != nil {
		seriesDepth = store.NormalizeSeriesDepth(lib.SeriesDepth)
	}
	items, err := store.GetSeriesSourceItems(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to inspect library"})
		return
	}
	candidates := service.DetectComicSeriesWithDepth(libraryID, seriesDepth, items)
	c.JSON(http.StatusOK, gin.H{
		"libraryId":   libraryID,
		"seriesDepth": seriesDepth,
		"seriesCount": len(candidates),
		"candidates":  candidates,
	})
}

func (h *SeriesHandler) Rebuild(c *gin.Context) {
	libraryID := strings.TrimSpace(c.Query("libraryId"))
	if libraryID != "" {
		canManage, err := store.UserCanManageLibrary(getUserID(c), libraryID)
		if err != nil || !canManage {
			c.JSON(http.StatusForbidden, gin.H{"error": "No permission to manage this library"})
			return
		}
		if err := service.RebuildComicSeriesForLibrary(libraryID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rebuild comic series"})
			return
		}
	} else {
		user := middleware.GetCurrentUser(c)
		if user == nil || user.Role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin permission required"})
			return
		}
		if err := service.RebuildAllComicSeries(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rebuild comic series"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *SeriesHandler) Update(c *gin.Context) {
	detail, err := store.GetSeriesDetail(c.Param("id"), getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load comic series"})
		return
	}
	if detail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic series not found"})
		return
	}
	canManage, _ := store.UserCanManageLibrary(getUserID(c), detail.Series.LibraryID)
	if !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "No permission to manage this series"})
		return
	}
	var body struct {
		Title        string `json:"title"`
		CoverComicID string `json:"coverComicId"`
		ManualLocked *bool  `json:"manualLocked"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if err := store.UpdateSeries(c.Param("id"), body.Title, body.CoverComicID, body.ManualLocked); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update comic series"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *SeriesHandler) UpdateStructure(c *gin.Context) {
	detail, err := store.GetSeriesDetail(c.Param("id"), getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load comic series"})
		return
	}
	if detail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic series not found"})
		return
	}
	canManage, _ := store.UserCanManageLibrary(getUserID(c), detail.Series.LibraryID)
	if !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "No permission to manage this series"})
		return
	}
	var body struct {
		Items []struct {
			ComicID   string `json:"comicId"`
			SectionID string `json:"sectionId"`
			SortIndex int    `json:"sortIndex"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	for _, item := range body.Items {
		if err := store.SetSeriesItemStructure(c.Param("id"), item.ComicID, item.SectionID, item.SortIndex); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update series structure"})
			return
		}
	}
	locked := true
	_ = store.UpdateSeries(c.Param("id"), "", "", &locked)
	_ = store.TouchSeries(c.Param("id"))
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *SeriesHandler) Redetect(c *gin.Context) {
	detail, err := store.GetSeriesDetail(c.Param("id"), getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load comic series"})
		return
	}
	if detail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic series not found"})
		return
	}
	canManage, _ := store.UserCanManageLibrary(getUserID(c), detail.Series.LibraryID)
	if !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "No permission to manage this series"})
		return
	}

	unlocked := false
	if err := store.UpdateSeries(c.Param("id"), "", "", &unlocked); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlock comic series"})
		return
	}
	if err := service.RebuildComicSeriesForLibrary(detail.Series.LibraryID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to re-detect comic series"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *SeriesHandler) Delete(c *gin.Context) {
	detail, err := store.GetSeriesDetail(c.Param("id"), getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load comic series"})
		return
	}
	if detail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic series not found"})
		return
	}
	canManage, _ := store.UserCanManageLibrary(getUserID(c), detail.Series.LibraryID)
	if !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "No permission to manage this series"})
		return
	}
	if err := store.DeleteSeriesRelationship(c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove series relationship"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "filesDeleted": false, "comicsDeleted": false})
}
