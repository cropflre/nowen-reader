package handler

import (
	"net/http"
	"strings"

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
	libraryIDs, err := requestedAccessibleLibraries(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve library access"})
		return
	}
	user := middleware.GetCurrentUser(c)
	if user == nil || (user.Role != "admin" && len(libraryIDs) == 0) {
		c.JSON(http.StatusOK, gin.H{"series": []store.SeriesSummary{}})
		return
	}
	series, err := store.ListSeriesSummaries(libraryIDs, getUserID(c), c.Query("search"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list comic series"})
		return
	}
	for index := range series {
		series[index].CanManage, _ = store.UserCanManageLibrary(getUserID(c), series[index].LibraryID)
	}
	c.JSON(http.StatusOK, gin.H{"series": series})
}

func (h *SeriesHandler) Get(c *gin.Context) {
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
	itemCount, tooLarge, err := service.ComicSeriesLibrarySize(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to inspect library size"})
		return
	}
	if tooLarge {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error":     "Library is too large for synchronous series preview; use background rebuild instead",
			"itemCount": itemCount,
		})
		return
	}
	items, err := store.GetSeriesSourceItems(libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to inspect library"})
		return
	}
	candidates := service.DetectComicSeries(libraryID, items)
	c.JSON(http.StatusOK, gin.H{
		"libraryId":   libraryID,
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
		service.ScheduleComicSeriesRebuild(libraryID)
	} else {
		user := middleware.GetCurrentUser(c)
		if user == nil || user.Role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin permission required"})
			return
		}
		service.ScheduleComicSeriesRebuild("")
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true, "queued": true})
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
	service.ScheduleComicSeriesRebuild(detail.Series.LibraryID)
	c.JSON(http.StatusAccepted, gin.H{"success": true, "queued": true})
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
