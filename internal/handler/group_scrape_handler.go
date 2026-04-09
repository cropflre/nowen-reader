package handler

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func (h *GroupHandler) AutoGroupByDirectory(c *gin.Context) {
	created, err := store.AutoGroupByDirectory()
	if err != nil {
		log.Printf("[API] AutoGroupByDirectory error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "自动分组失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "created": created})
}

// ============================================================
// P4: 系列级元数据刮削 & AI 识别
// ============================================================

// POST /api/groups/:id/scrape-metadata — 搜索系列元数据（在线数据源）
func (h *GroupHandler) ScrapeMetadata(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil || group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "系列不存在"})
		return
	}

	var body struct {
		Query       string   `json:"query"`
		Sources     []string `json:"sources"`
		Lang        string   `json:"lang"`
		ContentType string   `json:"contentType"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Lang == "" {
		body.Lang = "zh"
	}

	query := body.Query
	if query == "" {
		query = group.Name
	}

	// 自动检测系列内容类型：优先使用前端传入的 contentType，否则根据系列内漫画的文件类型自动判断
	ct := body.ContentType
	if ct == "" {
		ct = detectGroupContentType(group)
	}

	results := service.SearchMetadata(query, body.Sources, body.Lang, ct)
	if results == nil {
		results = []service.ComicMetadata{}
	}
	c.JSON(http.StatusOK, gin.H{"results": results, "detectedContentType": ct})
}

// POST /api/groups/:id/apply-metadata — 将刮削结果应用到系列元数据
func (h *GroupHandler) ApplyScrapedMetadata(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil || group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "系列不存在"})
		return
	}

	var body struct {
		Metadata      service.ComicMetadata `json:"metadata"`
		Fields        []string              `json:"fields"`
		Overwrite     bool                  `json:"overwrite"`
		SyncTags      bool                  `json:"syncTags"`
		SyncToVolumes bool                  `json:"syncToVolumes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	meta := body.Metadata
	fieldsSet := make(map[string]bool)
	for _, f := range body.Fields {
		fieldsSet[f] = true
	}
	applyAll := len(body.Fields) == 0

	shouldApply := func(field string) bool {
		return applyAll || fieldsSet[field]
	}

	update := store.GroupMetadataUpdate{}

	// 标题 → 系列名称（需要用户显式选择 title 字段才会应用）
	if meta.Title != "" && shouldApply("title") {
		if body.Overwrite || group.Name == "" {
			update.Name = &meta.Title
		}
	}

	if meta.Author != "" && shouldApply("author") {
		if body.Overwrite || group.Author == "" {
			update.Author = &meta.Author
		}
	}
	if meta.Description != "" && shouldApply("description") {
		if body.Overwrite || group.Description == "" {
			update.Description = &meta.Description
		}
	}
	if meta.Genre != "" && shouldApply("genre") {
		if body.Overwrite || group.Genre == "" {
			update.Genre = &meta.Genre
		}
	}
	if meta.Publisher != "" && shouldApply("publisher") {
		if body.Overwrite || group.Publisher == "" {
			update.Publisher = &meta.Publisher
		}
	}
	if meta.Language != "" && shouldApply("language") {
		if body.Overwrite || group.Language == "" {
			update.Language = &meta.Language
		}
	}
	if meta.Year != nil && shouldApply("year") {
		if body.Overwrite || group.Year == nil {
			update.Year = meta.Year
		}
	}
	if meta.CoverURL != "" && shouldApply("cover") {
		update.CoverURL = &meta.CoverURL
	}

	if err := store.UpdateGroupMetadata(id, update); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "应用元数据失败"})
		return
	}

	// 处理标签
	if meta.Genre != "" && shouldApply("tags") {
		genres := splitAndTrim(meta.Genre)
		if len(genres) > 0 {
			existingTags, _ := store.GetGroupTags(id)
			existingNames := make(map[string]bool)
			for _, t := range existingTags {
				existingNames[t.Name] = true
			}
			allNames := make([]string, 0)
			for _, t := range existingTags {
				allNames = append(allNames, t.Name)
			}
			for _, g := range genres {
				if !existingNames[g] {
					allNames = append(allNames, g)
				}
			}
			_ = store.SetGroupTags(id, allNames)
			if body.SyncTags {
				_, _, _, _ = store.SyncGroupTagsToVolumes(id)
			}
		}
	}

	// 下载封面
	if meta.CoverURL != "" && shouldApply("cover") {
		go service.DownloadGroupCover(id, meta.CoverURL)
	}

	// 同步元数据到所有卷
	if body.SyncToVolumes {
		go func() {
			if err := syncGroupMetadataToVolumes(id, meta, fieldsSet, body.Overwrite); err != nil {
				log.Printf("[API] syncGroupMetadataToVolumes error for group %d: %v", id, err)
			}
		}()
	}

	updated, _ := store.GetGroupByID(id)
	c.JSON(http.StatusOK, gin.H{"success": true, "group": updated})
}

// syncGroupMetadataToVolumes 将刮削的元数据同步到系列下所有卷
func syncGroupMetadataToVolumes(groupID int, meta service.ComicMetadata, fieldsSet map[string]bool, overwrite bool) error {
	group, err := store.GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return fmt.Errorf("系列不存在或没有漫画")
	}

	applyAll := len(fieldsSet) == 0
	shouldApply := func(field string) bool {
		return applyAll || fieldsSet[field]
	}

	for _, comic := range group.Comics {
		updates := map[string]interface{}{}

		if meta.Author != "" && shouldApply("author") {
			updates["author"] = meta.Author
		}
		if meta.Publisher != "" && shouldApply("publisher") {
			updates["publisher"] = meta.Publisher
		}
		if meta.Language != "" && shouldApply("language") {
			updates["language"] = meta.Language
		}
		if meta.Genre != "" && shouldApply("genre") {
			updates["genre"] = meta.Genre
		}
		if meta.Description != "" && shouldApply("description") {
			updates["description"] = meta.Description
		}
		if meta.Year != nil && shouldApply("year") {
			updates["year"] = *meta.Year
		}

		if !overwrite {
			// 非覆盖模式：只填充空字段，需要先查询当前值
			updates = filterEmptyFieldsOnly(comic.ComicID, updates)
		}

		if len(updates) > 0 {
			if err := store.UpdateComicFields(comic.ComicID, updates); err != nil {
				log.Printf("[API] syncGroupMetadataToVolumes: failed to update comic %s: %v", comic.ComicID, err)
			}
		}
	}
	return nil
}

// filterEmptyFieldsOnly 过滤掉漫画中已有值的字段，只保留空字段的更新
func filterEmptyFieldsOnly(comicID string, updates map[string]interface{}) map[string]interface{} {
	if len(updates) == 0 {
		return updates
	}

	var author, publisher, language, genre, description string
	var year *int
	err := store.DB().QueryRow(`
		SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
		       COALESCE("genre",''), COALESCE("description",''), "year"
		FROM "Comic" WHERE "id" = ?
	`, comicID).Scan(&author, &publisher, &language, &genre, &description, &year)
	if err != nil {
		return updates // 查询失败时保留所有更新
	}

	filtered := map[string]interface{}{}
	for k, v := range updates {
		switch k {
		case "author":
			if author == "" {
				filtered[k] = v
			}
		case "publisher":
			if publisher == "" {
				filtered[k] = v
			}
		case "language":
			if language == "" {
				filtered[k] = v
			}
		case "genre":
			if genre == "" {
				filtered[k] = v
			}
		case "description":
			if description == "" {
				filtered[k] = v
			}
		case "year":
			if year == nil {
				filtered[k] = v
			}
		default:
			filtered[k] = v
		}
	}
	return filtered
}

// POST /api/groups/:id/ai-recognize
func (h *GroupHandler) AIRecognize(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的系列ID"})
		return
	}

	group, err := store.GetGroupByID(id)
	if err != nil || group == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "系列不存在"})
		return
	}

	var body struct {
		Lang       string `json:"lang"`
		TargetLang string `json:"targetLang"`
		AutoApply  bool   `json:"autoApply"`
	}
	_ = c.ShouldBindJSON(&body)
	// 兼容 targetLang 和 lang 两种字段名
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

	if len(group.Comics) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "系列内没有漫画，无法进行AI识别"})
		return
	}

	firstComic := group.Comics[0]
	log.Printf("[AI-Recognize] group=%d firstComic=%s filename=%s", id, firstComic.ComicID, firstComic.Filename)

	var coverData []byte
	coverBytes, _, coverErr := service.GetComicThumbnail(firstComic.ComicID)
	if coverErr != nil {
		log.Printf("[AI-Recognize] GetComicThumbnail failed: %v", coverErr)
	} else if len(coverBytes) > 0 {
		coverData = coverBytes
		log.Printf("[AI-Recognize] cover loaded: %d bytes", len(coverData))
	}

	var pageImages [][]byte
	for pi := 0; pi < 2; pi++ {
		pageImg, err := service.GetPageImage(firstComic.ComicID, pi)
		if err != nil {
			log.Printf("[AI-Recognize] GetPageImage(%d) failed: %v", pi, err)
		} else if pageImg != nil && len(pageImg.Data) > 0 {
			pageImages = append(pageImages, pageImg.Data)
			log.Printf("[AI-Recognize] page %d loaded: %d bytes", pi, len(pageImg.Data))
		}
	}

	// 如果没有获取到任何图片，提前返回明确错误
	if len(coverData) == 0 && len(pageImages) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法获取漫画图片数据，请确认漫画文件是否存在且可读"})
		return
	}

	recognized, err := service.AIRecognizeComicContent(cfg, coverData, pageImages, lang)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 识别失败: " + err.Error()})
		return
	}

	meta, _ := service.AICompleteMetadata(cfg, firstComic.Filename, group.Name, coverData, lang)

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"recognized": recognized,
		"metadata":   meta,
	})
}

// detectGroupContentType 根据系列内漫画的文件类型自动检测内容类型。
// 如果系列内大多数文件是小说格式（epub/txt/mobi/azw3），返回 "novel"，否则返回 "comic"。
func detectGroupContentType(group *store.ComicGroupDetail) string {
	if group == nil || len(group.Comics) == 0 {
		return "comic"
	}
	novelCount := 0
	for _, c := range group.Comics {
		// 优先使用数据库中的 type 字段
		if c.ComicType == "novel" {
			novelCount++
		} else if c.ComicType == "" && service.IsNovelFilename(c.Filename) {
			// fallback: 根据文件名判断
			novelCount++
		}
	}
	// 如果超过一半的文件是小说格式，认为是小说系列
	if novelCount > len(group.Comics)/2 {
		return "novel"
	}
	return "comic"
}

// splitAndTrim 分割逗号分隔的字符串并去除空白。
func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}
