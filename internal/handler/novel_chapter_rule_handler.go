package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type NovelChapterRuleHandler struct{}

func NewNovelChapterRuleHandler() *NovelChapterRuleHandler {
	return &NovelChapterRuleHandler{}
}

func (h *NovelChapterRuleHandler) List(c *gin.Context) {
	rules, err := store.ListNovelChapterRules()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rules": rules})
}

func (h *NovelChapterRuleHandler) Create(c *gin.Context) {
	var body struct {
		Name    string `json:"name"`
		Pattern string `json:"pattern"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	rule, err := store.CreateNovelChapterRule(body.Name, body.Pattern)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"rule": rule})
}

func (h *NovelChapterRuleHandler) Update(c *gin.Context) {
	ruleID := c.Param("ruleId")
	var body struct {
		Name    string `json:"name"`
		Pattern string `json:"pattern"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	affected, err := store.ListComicIDsByChapterRule(ruleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := store.UpdateNovelChapterRule(ruleID, body.Name, body.Pattern); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, comicID := range affected {
		service.InvalidateConfiguredTxtCache(comicID)
	}
	rule, _ := store.GetNovelChapterRuleByID(ruleID)
	c.JSON(http.StatusOK, gin.H{"rule": rule, "affectedBooks": len(affected)})
}

func (h *NovelChapterRuleHandler) Delete(c *gin.Context) {
	ruleID := c.Param("ruleId")
	affected, err := store.ListComicIDsByChapterRule(ruleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := store.DeleteNovelChapterRule(ruleID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, comicID := range affected {
		service.InvalidateConfiguredTxtCache(comicID)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "affectedBooks": len(affected)})
}

func (h *NovelChapterRuleHandler) Preview(c *gin.Context) {
	var body struct {
		ComicID string `json:"comicId"`
		Regex   string `json:"regex"`
		RuleID  string `json:"ruleId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.ComicID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comicId is required"})
		return
	}
	if err := checkComicAccess(c, body.ComicID); err != nil {
		return
	}

	pattern := strings.TrimSpace(body.Regex)
	if pattern == "" && strings.TrimSpace(body.RuleID) != "" {
		rule, err := store.GetNovelChapterRuleByID(body.RuleID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if rule == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chapter rule not found"})
			return
		}
		if rule.ID == store.ChapterRuleAutoID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Automatic mode does not use a single preview regex"})
			return
		}
		pattern = rule.Pattern
	}
	if pattern == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "regex or ruleId is required"})
		return
	}

	count, chapters, err := service.PreviewTxtChapterRule(body.ComicID, pattern)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	response := gin.H{"matchCount": count, "chapters": chapters}
	if count < 2 {
		response["warning"] = "Matched fewer than 2 chapter headings; the reader will fall back to fixed-size pages"
	}
	c.JSON(http.StatusOK, response)
}

func (h *NovelChapterRuleHandler) GetComicRule(c *gin.Context) {
	comicID := c.Param("id")
	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	fp, _, pathErr := service.FindComicFilePath(comicID)
	isTxt := pathErr == nil && archive.DetectType(fp) == archive.TypeTxt
	selection, err := store.GetComicChapterRuleSelection(comicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	canManage := true
	canEditGlobalRules := true
	if uid := getUserID(c); uid != "" {
		canManage, _ = store.UserCanManageComic(uid, comicID)
		canEditGlobalRules = false
		if user, userErr := store.GetUserByID(uid); userErr == nil && user != nil {
			canEditGlobalRules = user.Role == "admin"
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"comicId":            comicID,
		"ruleId":             selection.RuleID,
		"rule":               selection.Rule,
		"isTxt":              isTxt,
		"canManage":          canManage,
		"canEditGlobalRules": canEditGlobalRules,
	})
}

func (h *NovelChapterRuleHandler) SetComicRule(c *gin.Context) {
	comicID := c.Param("id")
	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	fp, _, err := service.FindComicFilePath(comicID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found: " + err.Error()})
		return
	}
	if archive.DetectType(fp) != archive.TypeTxt {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Custom chapter rules are only supported for TXT novels"})
		return
	}
	var body struct {
		RuleID string `json:"ruleId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	if strings.TrimSpace(body.RuleID) == "" {
		body.RuleID = store.ChapterRuleAutoID
	}
	if err := store.SetComicChapterRuleSelection(comicID, body.RuleID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	service.InvalidateConfiguredTxtCache(comicID)

	chapterCount := 0
	if body.RuleID == store.ChapterRuleAutoID {
		if result, err := service.GetComicPagesEx(comicID); err == nil {
			chapterCount = len(result.Entries)
		}
	} else if result, configured, err := service.GetConfiguredTxtPages(comicID); err == nil && configured {
		chapterCount = len(result.Entries)
	}
	if chapterCount > 0 && comic.PageCount != chapterCount {
		_ = store.UpdateComicPageCount(comicID, chapterCount)
	}
	selection, _ := store.GetComicChapterRuleSelection(comicID)
	c.JSON(http.StatusOK, gin.H{"success": true, "selection": selection, "chapterCount": chapterCount})
}

// GetPagesConfigured keeps the existing /pages contract while applying an
// explicitly selected TXT chapter rule. Auto mode and non-TXT formats delegate
// to the existing parser unchanged.
func (h *ImageHandler) GetPagesConfigured(c *gin.Context) {
	comicID := c.Param("id")
	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	result, configured, err := service.GetConfiguredTxtPages(comicID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !configured {
		h.GetPages(c)
		return
	}

	type pageInfo struct {
		Index       int    `json:"index"`
		Name        string `json:"name"`
		URL         string `json:"url"`
		Title       string `json:"title,omitempty"`
		Level       *int   `json:"level,omitempty"`
		ParentIndex *int   `json:"parentIndex,omitempty"`
		HasChildren bool   `json:"hasChildren,omitempty"`
	}
	pages := make([]pageInfo, len(result.Entries))
	for i, name := range result.Entries {
		level := 0
		pages[i] = pageInfo{
			Index: i,
			Name:  name,
			URL:   fmt.Sprintf("/api/comics/%s/chapter/%d", comicID, i),
			Level: &level,
		}
		if i < len(result.ChapterTitles) {
			pages[i].Title = result.ChapterTitles[i]
		}
	}
	if len(result.Entries) > 0 && comic.PageCount != len(result.Entries) {
		_ = store.UpdateComicPageCount(comicID, len(result.Entries))
	}
	c.JSON(http.StatusOK, gin.H{
		"comicId":    comicID,
		"title":      comic.Title,
		"totalPages": len(result.Entries),
		"pages":      pages,
		"isNovel":    true,
		"isPdf":      false,
		"chapterRule": gin.H{"configured": true},
	})
}

func (h *ImageHandler) GetChapterContentConfigured(c *gin.Context) {
	comicID := c.Param("id")
	chapterIndex, err := strconv.Atoi(c.Param("chapterIndex"))
	if err != nil || chapterIndex < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chapter index"})
		return
	}
	if err := checkComicAccess(c, comicID); err != nil {
		return
	}
	chapter, configured, err := service.GetConfiguredTxtChapter(comicID, chapterIndex)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Chapter not found: " + err.Error()})
		return
	}
	if !configured {
		h.GetChapterContent(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"content":  chapter.Content,
		"title":    chapter.Title,
		"mimeType": chapter.MimeType,
	})
}
