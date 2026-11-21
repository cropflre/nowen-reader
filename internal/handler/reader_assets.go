package handler

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type ReaderAssetsHandler struct{}

func NewReaderAssetsHandler() *ReaderAssetsHandler { return &ReaderAssetsHandler{} }

// ============================================================
// Bookmarks
// ============================================================

func (h *ReaderAssetsHandler) ListBookmarks(c *gin.Context) {
	comicID := c.Param("id")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	items, err := store.ListUserBookmarks(uid, comicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load bookmarks"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookmarks": items})
}

func (h *ReaderAssetsHandler) UpsertBookmark(c *gin.Context) {
	comicID := c.Param("id")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		ID            string   `json:"id"`
		PageIndex     *int     `json:"pageIndex"`
		ChapterIndex  *int     `json:"chapterIndex"`
		PositionRatio float64  `json:"positionRatio"`
		ChapterTitle  string   `json:"chapterTitle"`
		Name          string   `json:"name"`
		Note          string   `json:"note"`
		CreatedAt     int64    `json:"createdAt"`
		Timestamp     int64    `json:"timestamp"`
		UpdatedAt     int64    `json:"updatedAt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bookmark payload"})
		return
	}

	pageIndex := 0
	if req.PageIndex != nil {
		pageIndex = *req.PageIndex
	} else if req.ChapterIndex != nil {
		pageIndex = *req.ChapterIndex
	}
	createdAt := req.CreatedAt
	if createdAt <= 0 {
		createdAt = req.Timestamp
	}

	saved, err := store.UpsertUserBookmark(uid, comicID, model.UserBookmark{
		ID:            req.ID,
		PageIndex:     pageIndex,
		PositionRatio: req.PositionRatio,
		ChapterTitle:  req.ChapterTitle,
		Name:          req.Name,
		Note:          req.Note,
		CreatedAt:     createdAt,
		UpdatedAt:     req.UpdatedAt,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save bookmark"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookmark": saved})
}

func (h *ReaderAssetsHandler) UpdateBookmark(c *gin.Context) {
	comicID := c.Param("id")
	bookmarkID := c.Param("bookmarkId")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		Name string `json:"name"`
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bookmark payload"})
		return
	}

	updated, err := store.UpdateUserBookmark(uid, comicID, bookmarkID, req.Name, req.Note)
	if errors.Is(err, store.ErrBookmarkNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bookmark not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update bookmark"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookmark": updated})
}

func (h *ReaderAssetsHandler) DeleteBookmark(c *gin.Context) {
	comicID := c.Param("id")
	bookmarkID := c.Param("bookmarkId")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	if err := store.DeleteUserBookmark(uid, comicID, bookmarkID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete bookmark"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *ReaderAssetsHandler) ImportBookmarks(c *gin.Context) {
	comicID := c.Param("id")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		Bookmarks []struct {
			ID            string  `json:"id"`
			PageIndex     *int    `json:"pageIndex"`
			ChapterIndex  *int    `json:"chapterIndex"`
			PositionRatio float64 `json:"positionRatio"`
			ChapterTitle  string  `json:"chapterTitle"`
			Name          string  `json:"name"`
			Note          string  `json:"note"`
			CreatedAt     int64   `json:"createdAt"`
			Timestamp     int64   `json:"timestamp"`
			UpdatedAt     int64   `json:"updatedAt"`
		} `json:"bookmarks"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid import payload"})
		return
	}

	items := make([]model.UserBookmark, 0, len(req.Bookmarks))
	for _, raw := range req.Bookmarks {
		pageIndex := 0
		if raw.PageIndex != nil {
			pageIndex = *raw.PageIndex
		} else if raw.ChapterIndex != nil {
			pageIndex = *raw.ChapterIndex
		}
		createdAt := raw.CreatedAt
		if createdAt <= 0 {
			createdAt = raw.Timestamp
		}
		items = append(items, model.UserBookmark{
			ID:            raw.ID,
			PageIndex:     pageIndex,
			PositionRatio: raw.PositionRatio,
			ChapterTitle:  raw.ChapterTitle,
			Name:          raw.Name,
			Note:          raw.Note,
			CreatedAt:     createdAt,
			UpdatedAt:     raw.UpdatedAt,
		})
	}

	merged, err := store.ImportUserBookmarks(uid, comicID, items)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to import bookmarks"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookmarks": merged})
}

// ============================================================
// Highlights & Notes Export
// ============================================================

func (h *ReaderAssetsHandler) ListHighlights(c *gin.Context) {
	comicID := c.Param("id")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	items, err := store.ListUserHighlights(uid, comicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load highlights"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"highlights": items})
}

func (h *ReaderAssetsHandler) UpsertHighlight(c *gin.Context) {
	comicID := c.Param("id")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		ID           string `json:"id"`
		ChapterIndex int    `json:"chapterIndex"`
		ChapterTitle string `json:"chapterTitle"`
		Text         string `json:"text"`
		Note         string `json:"note"`
		Color        string `json:"color"`
		StartOffset  int    `json:"startOffset"`
		CreatedAt    int64  `json:"createdAt"`
		Timestamp    int64  `json:"timestamp"`
		UpdatedAt    int64  `json:"updatedAt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid highlight payload"})
		return
	}
	createdAt := req.CreatedAt
	if createdAt <= 0 {
		createdAt = req.Timestamp
	}
	startOffset := req.StartOffset
	if startOffset == 0 {
		startOffset = -1
	}

	saved, err := store.UpsertUserHighlight(uid, comicID, model.UserHighlight{
		ID:           req.ID,
		ChapterIndex: req.ChapterIndex,
		ChapterTitle: req.ChapterTitle,
		Text:         req.Text,
		Note:         req.Note,
		Color:        req.Color,
		StartOffset:  startOffset,
		CreatedAt:    createdAt,
		UpdatedAt:    req.UpdatedAt,
	})
	if errors.Is(err, store.ErrInvalidHighlightText) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save highlight"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"highlight": saved})
}

func (h *ReaderAssetsHandler) UpdateHighlight(c *gin.Context) {
	comicID := c.Param("id")
	highlightID := c.Param("highlightId")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		Note  string `json:"note"`
		Color string `json:"color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid highlight payload"})
		return
	}

	updated, err := store.UpdateUserHighlight(uid, comicID, highlightID, req.Note, req.Color)
	if errors.Is(err, store.ErrHighlightNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Highlight not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update highlight"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"highlight": updated})
}

func (h *ReaderAssetsHandler) DeleteHighlight(c *gin.Context) {
	comicID := c.Param("id")
	highlightID := c.Param("highlightId")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	if err := store.DeleteUserHighlight(uid, comicID, highlightID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete highlight"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *ReaderAssetsHandler) ImportHighlights(c *gin.Context) {
	comicID := c.Param("id")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		Highlights []struct {
			ID           string `json:"id"`
			ChapterIndex int    `json:"chapterIndex"`
			ChapterTitle string `json:"chapterTitle"`
			Text         string `json:"text"`
			Note         string `json:"note"`
			Color        string `json:"color"`
			StartOffset  int    `json:"startOffset"`
			CreatedAt    int64  `json:"createdAt"`
			Timestamp    int64  `json:"timestamp"`
			UpdatedAt    int64  `json:"updatedAt"`
		} `json:"highlights"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid import payload"})
		return
	}

	items := make([]model.UserHighlight, 0, len(req.Highlights))
	for _, raw := range req.Highlights {
		createdAt := raw.CreatedAt
		if createdAt <= 0 {
			createdAt = raw.Timestamp
		}
		items = append(items, model.UserHighlight{
			ID:           raw.ID,
			ChapterIndex: raw.ChapterIndex,
			ChapterTitle: raw.ChapterTitle,
			Text:         raw.Text,
			Note:         raw.Note,
			Color:        raw.Color,
			StartOffset:  raw.StartOffset,
			CreatedAt:    createdAt,
			UpdatedAt:    raw.UpdatedAt,
		})
	}

	merged, err := store.ImportUserHighlights(uid, comicID, items)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to import highlights"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"highlights": merged})
}

func (h *ReaderAssetsHandler) ExportHighlights(c *gin.Context) {
	comicID := c.Param("id")
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	comic, err := store.GetComicByIDForUser(comicID, uid)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	bookmarks, err := store.ListUserBookmarks(uid, comicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load bookmarks"})
		return
	}
	highlights, err := store.ListUserHighlights(uid, comicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load highlights"})
		return
	}

	var sb strings.Builder
	sb.WriteString("# " + comic.Title + "\n\n")
	if strings.TrimSpace(comic.Author) != "" {
		sb.WriteString("- 作者: " + comic.Author + "\n")
	}
	sb.WriteString("- 导出时间: " + time.Now().Format("2006-01-02 15:04:05") + "\n\n")

	if len(bookmarks) > 0 {
		sb.WriteString("## 书签\n\n")
		for _, bm := range bookmarks {
			title := bm.Name
			if title == "" {
				title = bm.ChapterTitle
			}
			if title == "" {
				title = fmt.Sprintf("第 %d 页/章", bm.PageIndex+1)
			}
			pct := int(bm.PositionRatio*100 + 0.5)
			sb.WriteString(fmt.Sprintf("- **%s** (第 %d 节 · %d%%)\n", title, bm.PageIndex+1, pct))
			if bm.Note != "" {
				sb.WriteString("  > " + strings.ReplaceAll(bm.Note, "\n", "\n  > ") + "\n")
			}
		}
		sb.WriteString("\n")
	}

	sb.WriteString("## 划线与批注\n\n")
	if len(highlights) == 0 {
		sb.WriteString("暂无划线笔记。\n")
	} else {
		byChapter := make(map[int][]model.UserHighlight)
		var chapterOrder []int
		for _, hl := range highlights {
			if _, exists := byChapter[hl.ChapterIndex]; !exists {
				chapterOrder = append(chapterOrder, hl.ChapterIndex)
			}
			byChapter[hl.ChapterIndex] = append(byChapter[hl.ChapterIndex], hl)
		}
		sort.Ints(chapterOrder)
		for _, chIdx := range chapterOrder {
			items := byChapter[chIdx]
			chTitle := items[0].ChapterTitle
			if chTitle == "" {
				chTitle = fmt.Sprintf("第 %d 章", chIdx+1)
			}
			sb.WriteString("### " + chTitle + "\n\n")
			for _, hl := range items {
				sb.WriteString("> " + strings.ReplaceAll(hl.Text, "\n", "\n> ") + "\n")
				if hl.Note != "" {
					sb.WriteString("\n笔记: " + hl.Note + "\n")
				}
				sb.WriteString("\n")
			}
		}
	}

	safeTitle := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "", "<", "", ">", "", "|", "_").Replace(comic.Title)
	if strings.TrimSpace(safeTitle) == "" {
		safeTitle = comicID
	}
	filename := safeTitle + "-notes.md"
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": filename})
	if disposition == "" {
		disposition = `attachment; filename="notes.md"`
	}
	c.Header("Content-Disposition", disposition)
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(sb.String()))
}

// ============================================================
// Scoped Reader Preferences
// ============================================================

func (h *ReaderAssetsHandler) GetReaderPreferences(c *gin.Context) {
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	comicID := strings.TrimSpace(c.Query("comicId"))
	seriesID := strings.TrimSpace(c.Query("seriesId"))
	prefs, err := store.GetUserReaderPreferences(uid, comicID, seriesID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load reader preferences"})
		return
	}
	c.JSON(http.StatusOK, prefs)
}

func (h *ReaderAssetsHandler) PutReaderPreferences(c *gin.Context) {
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	var req struct {
		Scope string                 `json:"scope"`
		Prefs map[string]interface{} `json:"prefs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid preferences payload"})
		return
	}
	err := store.SetUserReaderPreference(uid, strings.TrimSpace(req.Scope), req.Prefs)
	if errors.Is(err, store.ErrInvalidPreferenceScope) || errors.Is(err, store.ErrPreferencePayloadTooLarge) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save reader preferences"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *ReaderAssetsHandler) DeleteReaderPreferences(c *gin.Context) {
	uid := getUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	scope := strings.TrimSpace(c.Query("scope"))
	err := store.DeleteUserReaderPreference(uid, scope)
	if errors.Is(err, store.ErrInvalidPreferenceScope) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset reader preferences"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
