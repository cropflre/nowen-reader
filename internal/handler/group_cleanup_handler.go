package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// POST /api/groups/detect-dirty — 检测系列脏数据
// ============================================================

func (h *GroupHandler) DetectDirty(c *gin.Context) {
	issues, err := store.DetectGroupDirtyData()
	if err != nil {
		log.Printf("[API] DetectDirty error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "检测脏数据失败: " + err.Error()})
		return
	}
	if issues == nil {
		issues = []store.GroupDirtyIssue{}
	}

	// 统计各类问题数量
	stats := map[string]int{
		"empty_group":    0,
		"orphan_link":    0,
		"dirty_name":     0,
		"duplicate_name": 0,
	}
	for _, issue := range issues {
		stats[issue.Type]++
	}

	c.JSON(http.StatusOK, gin.H{
		"issues": issues,
		"stats":  stats,
		"total":  len(issues),
	})
}

// ============================================================
// POST /api/groups/cleanup — 执行系列数据清理
// ============================================================

func (h *GroupHandler) Cleanup(c *gin.Context) {
	var body struct {
		Actions []string `json:"actions"` // 要执行的清理动作: empty_groups, orphan_links, dirty_names, full
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		body.Actions = []string{"full"}
	}

	// 默认执行全部清理
	if len(body.Actions) == 0 || contains(body.Actions, "full") {
		result, err := store.RunFullGroupCleanup()
		if err != nil {
			log.Printf("[API] Cleanup error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "清理失败: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"result":  result,
		})
		return
	}

	// 按指定动作执行
	result := store.GroupCleanupResult{}
	for _, action := range body.Actions {
		switch action {
		case "empty_groups":
			n, err := store.CleanupEmptyGroups()
			if err != nil {
				log.Printf("[API] Cleanup empty_groups error: %v", err)
			}
			result.EmptyGroupsDeleted = n
		case "orphan_links":
			n, err := store.CleanupOrphanLinks()
			if err != nil {
				log.Printf("[API] Cleanup orphan_links error: %v", err)
			}
			result.OrphanLinksRemoved = n
		case "dirty_names":
			n, err := store.FixDirtyGroupNames()
			if err != nil {
				log.Printf("[API] Cleanup dirty_names error: %v", err)
			}
			result.DirtyNamesFixed = n
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"result":  result,
	})
}

// ============================================================
// POST /api/groups/fix-name — 修复单个系列名称
// ============================================================

func (h *GroupHandler) FixName(c *gin.Context) {
	var body struct {
		GroupID int    `json:"groupId"`
		NewName string `json:"newName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.GroupID == 0 || body.NewName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数不完整"})
		return
	}

	if err := store.FixSingleGroupName(body.GroupID, body.NewName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "修复名称失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// ============================================================
// POST /api/groups/batch-scrape — 批量刮削系列元数据
// ============================================================

// BatchScrapeResult 单个系列的批量刮削结果
type BatchScrapeResult struct {
	GroupID   int                    `json:"groupId"`
	GroupName string                 `json:"groupName"`
	Success   bool                   `json:"success"`
	Error     string                 `json:"error,omitempty"`
	Metadata  *service.ComicMetadata `json:"metadata,omitempty"`
	Applied   bool                   `json:"applied"`
	Volumes   int                    `json:"volumes"`
}

func (h *GroupHandler) BatchScrape(c *gin.Context) {
	var body struct {
		GroupIDs      []int    `json:"groupIds"`
		Sources       []string `json:"sources"`
		Lang          string   `json:"lang"`
		Fields        []string `json:"fields"`
		Overwrite     bool     `json:"overwrite"`
		SyncTags      bool     `json:"syncTags"`
		SyncToVolumes bool     `json:"syncToVolumes"`
		AutoApply     bool     `json:"autoApply"`
		DryRun        bool     `json:"dryRun"`      // 预览模式，不实际应用
		ContentType   string   `json:"contentType"` // 可选："comic" | "novel"，为空时自动检测
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	if len(body.GroupIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择至少一个系列"})
		return
	}
	if len(body.GroupIDs) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "单次最多处理 100 个系列"})
		return
	}

	if body.Lang == "" {
		body.Lang = "zh"
	}
	// 如果未指定数据源，根据 contentType 自动选择默认数据源
	// 注意：如果 contentType 为空，将在每个系列处理时自动检测
	if len(body.Sources) == 0 && body.ContentType != "" {
		if body.ContentType == "novel" {
			body.Sources = []string{"googlebooks", "anilist_novel", "bangumi_novel"}
		} else {
			body.Sources = []string{"anilist", "bangumi", "mangadex", "mangaupdates", "kitsu"}
		}
	} else if len(body.Sources) == 0 {
		// 未指定 contentType 时使用漫画源作为默认（后续会按系列自动检测）
		body.Sources = []string{"anilist", "bangumi", "mangadex", "mangaupdates", "kitsu"}
	}

	fieldsSet := make(map[string]bool)
	for _, f := range body.Fields {
		fieldsSet[f] = true
	}

	results := make([]BatchScrapeResult, 0, len(body.GroupIDs))

	for _, gid := range body.GroupIDs {
		result := BatchScrapeResult{GroupID: gid}

		group, err := store.GetGroupByID(gid)
		if err != nil || group == nil {
			result.Error = "系列不存在"
			results = append(results, result)
			continue
		}
		result.GroupName = group.Name
		result.Volumes = len(group.Comics)

		// 自动检测系列内容类型，选择对应的数据源和搜索策略
		groupCT := body.ContentType
		if groupCT == "" {
			groupCT = detectGroupContentType(group)
		}
		// 根据内容类型选择数据源
		sources := body.Sources
		if body.ContentType == "" {
			// 未指定全局 contentType 时，按每个系列的类型自动选择数据源
			if groupCT == "novel" {
				sources = []string{"googlebooks", "anilist_novel", "bangumi_novel"}
			} else {
				sources = []string{"anilist", "bangumi", "mangadex", "mangaupdates", "kitsu"}
			}
		}
		metaResults := service.SearchMetadata(group.Name, sources, body.Lang, groupCT)
		if len(metaResults) == 0 {
			result.Error = "未找到匹配的元数据"
			results = append(results, result)
			continue
		}

		// 取第一个结果（最佳匹配）
		bestMatch := metaResults[0]
		result.Metadata = &bestMatch
		result.Success = true

		// 预览模式不实际应用
		if body.DryRun {
			results = append(results, result)
			continue
		}

		// 自动应用模式
		if body.AutoApply {
			applyAll := len(body.Fields) == 0
			shouldApply := func(field string) bool {
				return applyAll || fieldsSet[field]
			}

			update := store.GroupMetadataUpdate{}
			if bestMatch.Title != "" && shouldApply("title") {
				if body.Overwrite || group.Name == "" {
					update.Name = &bestMatch.Title
				}
			}
			if bestMatch.Author != "" && shouldApply("author") {
				if body.Overwrite || group.Author == "" {
					update.Author = &bestMatch.Author
				}
			}
			if bestMatch.Description != "" && shouldApply("description") {
				if body.Overwrite || group.Description == "" {
					update.Description = &bestMatch.Description
				}
			}
			if bestMatch.Genre != "" && shouldApply("genre") {
				if body.Overwrite || group.Genre == "" {
					update.Genre = &bestMatch.Genre
				}
			}
			if bestMatch.Publisher != "" && shouldApply("publisher") {
				if body.Overwrite || group.Publisher == "" {
					update.Publisher = &bestMatch.Publisher
				}
			}
			if bestMatch.Language != "" && shouldApply("language") {
				if body.Overwrite || group.Language == "" {
					update.Language = &bestMatch.Language
				}
			}
			if bestMatch.Year != nil && shouldApply("year") {
				if body.Overwrite || group.Year == nil {
					update.Year = bestMatch.Year
				}
			}
			if bestMatch.CoverURL != "" && shouldApply("cover") {
				update.CoverURL = &bestMatch.CoverURL
			}

			if err := store.UpdateGroupMetadata(gid, update); err != nil {
				result.Error = "应用元数据失败: " + err.Error()
				result.Success = false
				results = append(results, result)
				continue
			}

			// 处理标签
			if bestMatch.Genre != "" && shouldApply("tags") {
				genres := splitAndTrim(bestMatch.Genre)
				if len(genres) > 0 {
					existingTags, _ := store.GetGroupTags(gid)
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
					_ = store.SetGroupTags(gid, allNames)
					if body.SyncTags {
						_, _, _, _ = store.SyncGroupTagsToVolumes(gid)
					}
				}
			}

			// 下载封面
			if bestMatch.CoverURL != "" && shouldApply("cover") {
				go service.DownloadGroupCover(gid, bestMatch.CoverURL)
			}

			// 同步到所有卷
			if body.SyncToVolumes {
				if err := syncGroupMetadataToVolumes(gid, bestMatch, fieldsSet, body.Overwrite); err != nil {
					log.Printf("[API] BatchScrape: syncToVolumes error for group %d: %v", gid, err)
				}
			}

			result.Applied = true
		}

		results = append(results, result)
	}

	// 统计
	totalSuccess := 0
	totalFailed := 0
	totalApplied := 0
	for _, r := range results {
		if r.Success {
			totalSuccess++
		} else {
			totalFailed++
		}
		if r.Applied {
			totalApplied++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results": results,
		"total":   len(body.GroupIDs),
		"success": totalSuccess,
		"failed":  totalFailed,
		"applied": totalApplied,
	})
}
