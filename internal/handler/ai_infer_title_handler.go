package handler

import (
	"path"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// POST /api/comics/:id/ai-infer-title
// AI 目录级标题推断 —— 综合分析"父目录 + 同伴文件名样本"，
// 返回结构化的作品名/作者/扫图组/版本/状态等元数据，
// 用于解决像 "誰在乎版 YongBing-000" 这种把扫图组当标题的扫描问题。
// ============================================================

// listSiblingFilenames 返回同目录下其他漫画的相对路径（最多 limit 条）。
func listSiblingFilenames(dir, excludeComicID string, limit int) []string {
	if limit <= 0 {
		limit = 5
	}
	dbConn := store.DB()
	if dbConn == nil {
		return nil
	}
	// 用 LIKE 前缀匹配同一目录下的文件
	prefix := strings.TrimRight(dir, "/") + "/"
	rows, err := dbConn.Query(
		`SELECT "filename" FROM "Comic" WHERE "filename" LIKE ? AND "id" <> ? ORDER BY "filename" ASC LIMIT ?`,
		prefix+"%", excludeComicID, limit,
	)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var siblings []string
	for rows.Next() {
		var fn string
		if rows.Scan(&fn) != nil {
			continue
		}
		// 仅保留直接子项，不要更深层的孙子目录
		rest := strings.TrimPrefix(strings.ReplaceAll(fn, "\\", "/"), prefix)
		if strings.Contains(rest, "/") {
			continue
		}
		siblings = append(siblings, fn)
	}
	return siblings
}

// findGroupIDByComicID 查询给定漫画所属的第一个分组 ID（0 表示未分组）。
func findGroupIDByComicID(comicID string) int {
	dbConn := store.DB()
	if dbConn == nil {
		return 0
	}
	var gid int
	err := dbConn.QueryRow(
		`SELECT "groupId" FROM "ComicGroupItem" WHERE "comicId" = ? ORDER BY "sortIndex" ASC LIMIT 1`,
		comicID,
	).Scan(&gid)
	if err != nil {
		return 0
	}
	return gid
}

func ptrStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// AIInferTitle 调用 AI 推断当前漫画所在目录的真实作品结构。
//
// Body:
//
//	{
//	  "apply": false,           // 是否将推断结果写回 Comic（覆盖 title/author/...）
//	  "applyToGroup": false     // 是否将推断结果同步写入所属分组（系列名/作者/状态等）
//	}
func (h *AIHandler) InferTitle(c *gin.Context) {
	comicID := c.Param("id")
	if comicID == "" {
		c.JSON(400, gin.H{"error": "comic id required"})
		return
	}

	var body struct {
		Apply        bool `json:"apply"`
		ApplyToGroup bool `json:"applyToGroup"`
	}
	_ = c.ShouldBindJSON(&body)

	cfg := service.LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		c.JSON(400, gin.H{"error": "AI not configured"})
		return
	}

	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		c.JSON(404, gin.H{"error": "Comic not found"})
		return
	}

	// 1. 提取父目录名（最近一级）
	relPath := strings.ReplaceAll(comic.Filename, "\\", "/")
	dir := path.Dir(relPath)
	dirName := ""
	if dir != "." && dir != "/" && dir != "" {
		dirName = path.Base(dir)
	}

	// 2. 收集同目录下其他漫画的文件名作为样本（最多 8 个）
	samples := []string{path.Base(relPath)}
	if dir != "." && dir != "/" && dir != "" {
		for _, sib := range listSiblingFilenames(dir, comicID, 7) {
			samples = append(samples, path.Base(strings.ReplaceAll(sib, "\\", "/")))
		}
	}

	// 3. 调用 AI 推断
	inferred, err := service.AIInferTitleStructure(cfg, dirName, samples, comic.Title)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	result := gin.H{
		"success":  true,
		"inferred": inferred,
		"context": gin.H{
			"dirName": dirName,
			"samples": samples,
		},
	}

	// 4. 可选：将结果写回 Comic
	if body.Apply && inferred != nil {
		updates := map[string]interface{}{}
		if inferred.Title != "" {
			// 关键修复：把 VolumeTitleTemplate 中的 {N}/{NNN} 占位符替换为实际卷号。
			// 提取不到卷号则回退到干净的 Title，绝不允许 "{N}" 落库。
			filenameOnly := path.Base(strings.ReplaceAll(comic.Filename, "\\", "/"))
			newTitle := service.RenderVolumeTitle(inferred.VolumeTitleTemplate, inferred.Title, filenameOnly)
			newTitle = service.SanitizeTitle(newTitle)
			if newTitle != "" {
				updates["title"] = newTitle
			}
		}
		if inferred.Author != "" && comic.Author == "" {
			updates["author"] = inferred.Author
		}
		if inferred.Publisher != "" && comic.Publisher == "" {
			updates["publisher"] = inferred.Publisher
		}
		if inferred.Language != "" && comic.Language == "" {
			updates["language"] = inferred.Language
		}
		if inferred.Genre != "" && comic.Genre == "" {
			updates["genre"] = inferred.Genre
		}
		if inferred.Year != nil && comic.Year == nil {
			updates["year"] = *inferred.Year
		}
		if len(updates) > 0 {
			updates["metadataSource"] = "ai_infer_title"
			_ = store.UpdateComicFields(comicID, updates)
		}

		// 把扫图组、版本、状态作为标签写入
		var tags []string
		if inferred.ScanGroup != "" {
			tags = append(tags, "扫图组:"+inferred.ScanGroup)
		}
		if inferred.Version != "" {
			tags = append(tags, "版本:"+inferred.Version)
		}
		if inferred.Status != "" {
			tags = append(tags, "状态:"+inferred.Status)
		}
		if len(tags) > 0 {
			_ = store.AddTagsToComic(comicID, tags)
		}

		updated, _ := store.GetComicByID(comicID)
		result["comic"] = updated
		result["applied"] = updates
	}

	// 5. 可选：将结果同步写回所属分组（系列名 / 作者 / 状态 等）
	if body.ApplyToGroup && inferred != nil && inferred.Title != "" {
		gid := findGroupIDByComicID(comicID)
		if gid > 0 {
			update := store.GroupMetadataUpdate{
				Name:      ptrStr(inferred.Title),
				Author:    ptrStr(inferred.Author),
				Publisher: ptrStr(inferred.Publisher),
				Language:  ptrStr(inferred.Language),
				Genre:     ptrStr(inferred.Genre),
				Status:    ptrStr(inferred.Status),
			}
			if inferred.Year != nil {
				y := *inferred.Year
				update.Year = &y
			}
			_ = store.UpdateGroupMetadata(gid, update)
			result["groupUpdated"] = gin.H{
				"id":     gid,
				"name":   inferred.Title,
				"author": inferred.Author,
				"status": inferred.Status,
			}
		}
	}

	c.JSON(200, result)
}
