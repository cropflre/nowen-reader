package handler

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func (h *SeriesHandler) manageableDetail(c *gin.Context) (*store.SeriesDetail, bool) {
	detail, err := store.GetSeriesDetail(c.Param("id"), getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "目录作品加载失败"})
		return nil, false
	}
	if detail == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "目录作品不存在"})
		return nil, false
	}
	canManage, err := store.UserCanManageLibrary(getUserID(c), detail.Series.LibraryID)
	if err != nil || !canManage {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权管理该目录作品"})
		return nil, false
	}
	return detail, true
}

func (h *SeriesHandler) ScrapeMetadata(c *gin.Context) {
	detail, ok := h.manageableDetail(c)
	if !ok {
		return
	}
	var body struct {
		Query       string   `json:"query"`
		Sources     []string `json:"sources"`
		Lang        string   `json:"lang"`
		ContentType string   `json:"contentType"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Query == "" {
		body.Query = detail.Series.Title
	}
	if body.Lang == "" {
		body.Lang = "zh"
	}
	if body.ContentType == "" {
		body.ContentType = detectSeriesContentType(detail)
	}
	results := service.SearchMetadata(body.Query, body.Sources, body.Lang, body.ContentType)
	if results == nil {
		results = []service.ComicMetadata{}
	}
	c.JSON(http.StatusOK, gin.H{"results": results, "detectedContentType": body.ContentType})
}

func (h *SeriesHandler) ApplyScrapedMetadata(c *gin.Context) {
	detail, ok := h.manageableDetail(c)
	if !ok {
		return
	}
	var body struct {
		Metadata      service.ComicMetadata `json:"metadata"`
		Fields        []string              `json:"fields"`
		Overwrite     bool                  `json:"overwrite"`
		SyncTags      bool                  `json:"syncTags"`
		SyncToVolumes bool                  `json:"syncToVolumes"`
		SyncRating    bool                  `json:"syncRating"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	fields := make(map[string]bool, len(body.Fields))
	for _, field := range body.Fields {
		fields[field] = true
	}
	applyAll := len(fields) == 0
	shouldApply := func(field string) bool { return applyAll || fields[field] }
	meta := body.Metadata
	update := store.SeriesMetadataUpdate{}
	metadataChanged := false

	if meta.Title != "" && shouldApply("title") && (body.Overwrite || detail.Series.Title == "") {
		update.Title = &meta.Title
		metadataChanged = true
	}
	if meta.Author != "" && shouldApply("author") && (body.Overwrite || detail.Series.Author == "") {
		update.Author = &meta.Author
		metadataChanged = true
	}
	if meta.Description != "" && shouldApply("description") && (body.Overwrite || detail.Series.Description == "") {
		update.Description = &meta.Description
		metadataChanged = true
	}
	if meta.Genre != "" && shouldApply("genre") && (body.Overwrite || detail.Series.Genre == "") {
		update.Genre = &meta.Genre
		metadataChanged = true
	}
	if meta.Publisher != "" && shouldApply("publisher") && (body.Overwrite || detail.Series.Publisher == "") {
		update.Publisher = &meta.Publisher
		metadataChanged = true
	}
	if meta.Language != "" && shouldApply("language") && (body.Overwrite || detail.Series.Language == "") {
		update.Language = &meta.Language
		metadataChanged = true
	}
	if meta.Year != nil && shouldApply("year") && (body.Overwrite || detail.Series.Year == nil) {
		update.Year = meta.Year
		metadataChanged = true
	}
	if meta.CoverURL != "" && shouldApply("cover") {
		update.CoverURL = &meta.CoverURL
		metadataChanged = true
	}
	if meta.ExternalRating != nil && shouldApply("rating") {
		update.ExternalRating = meta.ExternalRating
		update.ExternalRatingMax = meta.ExternalRatingMax
		update.ExternalRatingSource = &meta.ExternalRatingSource
		now := time.Now().UTC()
		update.ExternalRatingUpdatedAt = &now
		metadataChanged = true
	}
	if meta.Genre != "" && shouldApply("tags") {
		metadataChanged = true
	}
	if metadataChanged {
		metadataLocked := true
		update.MetadataLocked = &metadataLocked
	}
	if err := store.UpdateSeriesMetadata(detail.Series.ID, update); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "应用目录作品元数据失败"})
		return
	}

	if meta.Genre != "" && shouldApply("tags") {
		existing, _ := store.GetSeriesTags(detail.Series.ID)
		names := make([]string, 0, len(existing))
		seen := make(map[string]struct{}, len(existing))
		for _, tag := range existing {
			names = append(names, tag.Name)
			seen[tag.Name] = struct{}{}
		}
		for _, name := range splitAndTrim(meta.Genre) {
			if _, exists := seen[name]; !exists {
				names = append(names, name)
				seen[name] = struct{}{}
			}
		}
		if err := store.SetSeriesTags(detail.Series.ID, names); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "保存目录作品标签失败"})
			return
		}
		if body.SyncTags {
			_, _, _, _ = store.SyncSeriesTagsToItems(detail.Series.ID)
		}
	}
	if meta.CoverURL != "" && shouldApply("cover") {
		go service.DownloadSeriesCover(detail.Series.ID, meta.CoverURL)
	}

	var syncSuccess, syncErrors int
	if body.SyncToVolumes {
		ids, err := store.GetSeriesMemberComicIDs(detail.Series.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "目录作品阅读单元加载失败"})
			return
		}
		syncSuccess, syncErrors, _ = syncMetadataToComicIDs(ids, meta, fields, body.Overwrite, body.SyncRating)
	}
	updated, err := store.GetSeriesDetail(detail.Series.ID, getUserID(c))
	if err != nil || updated == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "目录作品元数据已保存，但刷新详情失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"series":      updated.Series,
		"syncSuccess": syncSuccess,
		"syncErrors":  syncErrors,
	})
}

func (h *SeriesHandler) AIRecognize(c *gin.Context) {
	detail, ok := h.manageableDetail(c)
	if !ok {
		return
	}
	var body struct {
		Lang       string `json:"lang"`
		TargetLang string `json:"targetLang"`
	}
	_ = c.ShouldBindJSON(&body)
	lang := body.Lang
	if lang == "" {
		lang = body.TargetLang
	}
	if lang == "" {
		lang = "zh"
	}
	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 未配置"})
		return
	}
	ids, err := store.GetSeriesMemberComicIDs(detail.Series.ID)
	if err != nil || len(ids) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "目录作品中没有可识别的阅读单元"})
		return
	}
	firstComic, err := store.GetComicByID(ids[0])
	if err != nil || firstComic == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "首个阅读单元不可用"})
		return
	}

	var coverData []byte
	if data, _, _, err := service.GetComicThumbnail(firstComic.ID); err == nil {
		coverData = data
	}
	pageImages := make([][]byte, 0, 2)
	for page := 0; page < 2; page++ {
		image, err := service.GetPageImage(firstComic.ID, page)
		if err == nil && image != nil && len(image.Data) > 0 {
			pageImages = append(pageImages, image.Data)
		}
	}
	if len(coverData) == 0 && len(pageImages) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法获取阅读单元图片数据"})
		return
	}
	recognized, err := service.AIRecognizeComicContent(cfg, coverData, pageImages, lang)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 识别失败: " + err.Error()})
		return
	}
	meta, err := service.AICompleteMetadata(cfg, firstComic.Filename, detail.Series.Title, coverData, lang)
	if err != nil {
		log.Printf("[series] AI metadata completion failed for %s: %v", detail.Series.ID, err)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "recognized": recognized, "metadata": meta})
}

func detectSeriesContentType(detail *store.SeriesDetail) string {
	if detail == nil {
		return "comic"
	}
	items := append([]store.SeriesItemDetail{}, detail.Unsectioned...)
	for _, section := range detail.Sections {
		items = append(items, section.Items...)
	}
	novels := 0
	for _, item := range items {
		if item.Comic.ComicType == "novel" || (item.Comic.ComicType == "" && service.IsNovelFilename(item.Comic.Filename)) {
			novels++
		}
	}
	if len(items) > 0 && novels > len(items)/2 {
		return "novel"
	}
	return "comic"
}
