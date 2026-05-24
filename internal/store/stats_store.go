package store

import (
	"database/sql"
	"strings"
	"time"
)

// GetEnhancedReadingStats 返回增强版阅读统计数据。
// 传入非空 userID 时仅返回该用户的会话统计；传入空串时返回全局统计（管理员/单用户场景向后兼容）。
func GetEnhancedReadingStats(userID ...string) (map[string]interface{}, error) {
	result := make(map[string]interface{})

	// 拼接用户过滤条件
	userCond := ""
	userArgs := []interface{}{}
	if len(userID) > 0 && userID[0] != "" {
		userCond = ` AND rs."userId" = ?`
		userArgs = append(userArgs, userID[0])
	}
	// 主表不带 rs. 别名的查询使用
	userCondNoAlias := ""
	if len(userID) > 0 && userID[0] != "" {
		userCondNoAlias = ` AND "userId" = ?`
	}

	// 基础统计
	var totalReadTime, totalSessions, totalComicsRead int
	db.QueryRow(`SELECT COALESCE(SUM("duration"), 0), COUNT(*) FROM "ReadingSession" WHERE 1=1`+userCondNoAlias, userArgs...).
		Scan(&totalReadTime, &totalSessions)
	db.QueryRow(`SELECT COUNT(DISTINCT "comicId") FROM "ReadingSession" WHERE 1=1`+userCondNoAlias, userArgs...).
		Scan(&totalComicsRead)

	result["totalReadTime"] = totalReadTime
	result["totalSessions"] = totalSessions
	result["totalComicsRead"] = totalComicsRead

	// 最近 50 条会话
	recentSessions := []map[string]interface{}{}
	recentArgs := append([]interface{}{}, userArgs...)
	rows, err := db.Query(`
		SELECT rs."id", rs."comicId", c."title", rs."startedAt", rs."endedAt",
		       rs."duration", rs."startPage", rs."endPage"
		FROM "ReadingSession" rs
		JOIN "Comic" c ON rs."comicId" = c."id"
		WHERE 1=1`+userCond+`
		ORDER BY rs."startedAt" DESC
		LIMIT 50
	`, recentArgs...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, startPage, endPage, duration int
			var comicID, comicTitle string
			var startedAt time.Time
			var endedAt sql.NullTime
			if rows.Scan(&id, &comicID, &comicTitle, &startedAt, &endedAt, &duration, &startPage, &endPage) != nil {
				continue
			}
			session := map[string]interface{}{
				"id":         id,
				"comicId":    comicID,
				"comicTitle": comicTitle,
				"startedAt":  startedAt.UTC().Format(time.RFC3339Nano),
				"duration":   duration,
				"startPage":  startPage,
				"endPage":    endPage,
			}
			if endedAt.Valid {
				session["endedAt"] = endedAt.Time.UTC().Format(time.RFC3339Nano)
			} else {
				session["endedAt"] = nil
			}
			recentSessions = append(recentSessions, session)
		}
	}
	result["recentSessions"] = recentSessions

	// 每日统计（最近 90 天）
	ninetyDaysAgo := time.Now().AddDate(0, 0, -90).UTC().Format(time.RFC3339)
	dailyStats := []map[string]interface{}{}
	dailyArgs := append([]interface{}{ninetyDaysAgo}, userArgs...)
	dailyRows, err := db.Query(`
		SELECT DATE(rs."startedAt") as d, SUM(rs."duration"), COUNT(*)
		FROM "ReadingSession" rs
		WHERE rs."startedAt" >= ?`+userCond+`
		GROUP BY d
		ORDER BY d ASC
	`, dailyArgs...)
	if err == nil {
		defer dailyRows.Close()
		for dailyRows.Next() {
			var date string
			var duration, sessions int
			if dailyRows.Scan(&date, &duration, &sessions) == nil {
				dailyStats = append(dailyStats, map[string]interface{}{
					"date":     date,
					"duration": duration,
					"sessions": sessions,
				})
			}
		}
	}
	result["dailyStats"] = dailyStats

	// 每月统计（最近 12 个月）
	twelveMonthsAgo := time.Now().AddDate(-1, 0, 0).UTC().Format(time.RFC3339)
	monthlyStats := []map[string]interface{}{}
	monthlyArgs := append([]interface{}{twelveMonthsAgo}, userArgs...)
	monthlyRows, err := db.Query(`
		SELECT strftime('%Y-%m', rs."startedAt") as m,
		       SUM(rs."duration"), COUNT(*), COUNT(DISTINCT rs."comicId")
		FROM "ReadingSession" rs
		WHERE rs."startedAt" >= ?`+userCond+`
		GROUP BY m
		ORDER BY m ASC
	`, monthlyArgs...)
	if err == nil {
		defer monthlyRows.Close()
		for monthlyRows.Next() {
			var month string
			var duration, sessions, comics int
			if monthlyRows.Scan(&month, &duration, &sessions, &comics) == nil {
				monthlyStats = append(monthlyStats, map[string]interface{}{
					"month":    month,
					"duration": duration,
					"sessions": sessions,
					"comics":   comics,
				})
			}
		}
	}
	result["monthlyStats"] = monthlyStats

	// 类型偏好统计
	genreStats := []map[string]interface{}{}
	genreRows, err := db.Query(`
		SELECT c."genre", SUM(rs."duration") as totalTime, COUNT(DISTINCT c."id") as comicCount
		FROM "ReadingSession" rs
		JOIN "Comic" c ON rs."comicId" = c."id"
		WHERE c."genre" != ''`+userCond+`
		GROUP BY c."genre"
		ORDER BY totalTime DESC
		LIMIT 10
	`, userArgs...)
	if err == nil {
		defer genreRows.Close()
		for genreRows.Next() {
			var genre string
			var totalTime, comicCount int
			if genreRows.Scan(&genre, &totalTime, &comicCount) == nil {
				genreStats = append(genreStats, map[string]interface{}{
					"genre":      genre,
					"totalTime":  totalTime,
					"comicCount": comicCount,
				})
			}
		}
	}
	result["genreStats"] = genreStats

	// 阅读连续天数（streak）
	var currentStreak, longestStreak int
	streakRows, err := db.Query(`
		SELECT DISTINCT DATE(rs."startedAt") as d
		FROM "ReadingSession" rs
		WHERE 1=1`+userCond+`
		ORDER BY d DESC
	`, userArgs...)
	if err == nil {
		defer streakRows.Close()
		var dates []string
		for streakRows.Next() {
			var d string
			if streakRows.Scan(&d) == nil {
				dates = append(dates, d)
			}
		}

		if len(dates) > 0 {
			today := time.Now().UTC().Format("2006-01-02")
			yesterday := time.Now().AddDate(0, 0, -1).UTC().Format("2006-01-02")

			// 从最近日期开始算当前连续天数
			if dates[0] == today || dates[0] == yesterday {
				currentStreak = 1
				for i := 1; i < len(dates); i++ {
					d1, _ := time.Parse("2006-01-02", dates[i-1])
					d2, _ := time.Parse("2006-01-02", dates[i])
					if d1.Sub(d2).Hours() <= 24 {
						currentStreak++
					} else {
						break
					}
				}
			}

			// 计算最长连续天数
			streak := 1
			for i := 1; i < len(dates); i++ {
				d1, _ := time.Parse("2006-01-02", dates[i-1])
				d2, _ := time.Parse("2006-01-02", dates[i])
				if d1.Sub(d2).Hours() <= 24 {
					streak++
				} else {
					if streak > longestStreak {
						longestStreak = streak
					}
					streak = 1
				}
			}
			if streak > longestStreak {
				longestStreak = streak
			}
		}
	}
	result["currentStreak"] = currentStreak
	result["longestStreak"] = longestStreak

	// 平均阅读速度（页/小时）
	var totalPages int
	var totalDuration int
	db.QueryRow(`
		SELECT COALESCE(SUM(rs."endPage" - rs."startPage"), 0), COALESCE(SUM(rs."duration"), 0)
		FROM "ReadingSession" rs
		WHERE rs."duration" > 0 AND rs."endPage" > rs."startPage"`+userCond+`
	`, userArgs...).Scan(&totalPages, &totalDuration)

	if totalDuration > 0 {
		result["avgPagesPerHour"] = float64(totalPages) / (float64(totalDuration) / 3600.0)
	} else {
		result["avgPagesPerHour"] = 0
	}

	// 今日阅读时长
	todayStart := time.Now().UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
	var todayReadTime int
	todayArgs := append([]interface{}{todayStart}, userArgs...)
	db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0) FROM "ReadingSession"
		WHERE "startedAt" >= ?`+userCondNoAlias, todayArgs...).Scan(&todayReadTime)
	result["todayReadTime"] = todayReadTime

	// 本周阅读时长
	now := time.Now().UTC()
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	weekStart := now.AddDate(0, 0, -(weekday - 1)).Truncate(24 * time.Hour).Format(time.RFC3339)
	var weekReadTime int
	weekArgs := append([]interface{}{weekStart}, userArgs...)
	db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0) FROM "ReadingSession"
		WHERE "startedAt" >= ?`+userCondNoAlias, weekArgs...).Scan(&weekReadTime)
	result["weekReadTime"] = weekReadTime

	return result, nil
}

// ============================================================
// 文件统计
// ============================================================

// FileStats 文件统计汇总数据。
type FileStats struct {
	// 总体概览
	TotalFiles      int   `json:"totalFiles"`
	TotalSize       int64 `json:"totalSize"` // bytes
	TotalPages      int   `json:"totalPages"`
	ComicCount      int   `json:"comicCount"`
	NovelCount      int   `json:"novelCount"`
	AvgFileSize     int64 `json:"avgFileSize"` // bytes
	AvgPageCount    int   `json:"avgPageCount"`
	WithMetadata    int   `json:"withMetadata"` // 有元数据的文件数
	WithoutMetadata int   `json:"withoutMetadata"`

	// 格式分布
	FormatStats []FormatStatItem `json:"formatStats"`
	// 大小分布
	SizeDistribution []SizeDistItem `json:"sizeDistribution"`
	// 页数分布
	PageDistribution []PageDistItem `json:"pageDistribution"`
	// 语言分布
	LanguageStats []LanguageStatItem `json:"languageStats"`
	// 入库时间线（按月）
	AddedTimeline []AddedTimelineItem `json:"addedTimeline"`
	// Top 10 最大文件
	LargestFiles []LargestFileItem `json:"largestFiles"`
	// Top 10 页数最多
	MostPages []LargestFileItem `json:"mostPages"`
	// 作者分布 Top 10
	AuthorStats []AuthorStatItem `json:"authorStats"`
}

type FormatStatItem struct {
	Format    string `json:"format"`
	Count     int    `json:"count"`
	TotalSize int64  `json:"totalSize"` // bytes
}

type SizeDistItem struct {
	Range string `json:"range"`
	Count int    `json:"count"`
}

type PageDistItem struct {
	Range string `json:"range"`
	Count int    `json:"count"`
}

type LanguageStatItem struct {
	Language string `json:"language"`
	Count    int    `json:"count"`
}

type AddedTimelineItem struct {
	Month string `json:"month"` // "2024-01"
	Count int    `json:"count"`
}

type LargestFileItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Filename  string `json:"filename"`
	FileSize  int64  `json:"fileSize"`
	PageCount int    `json:"pageCount"`
	Type      string `json:"type"`
}

type AuthorStatItem struct {
	Author string `json:"author"`
	Count  int    `json:"count"`
}

// GetFileStats 返回文件统计汇总数据。
func GetFileStats() (*FileStats, error) {
	stats := &FileStats{
		FormatStats:      []FormatStatItem{},
		SizeDistribution: []SizeDistItem{},
		PageDistribution: []PageDistItem{},
		LanguageStats:    []LanguageStatItem{},
		AddedTimeline:    []AddedTimelineItem{},
		LargestFiles:     []LargestFileItem{},
		MostPages:        []LargestFileItem{},
		AuthorStats:      []AuthorStatItem{},
	}

	// 1. 总体概览
	db.QueryRow(`
		SELECT COUNT(*),
		       COALESCE(SUM("fileSize"), 0),
		       COALESCE(SUM("pageCount"), 0),
		       COALESCE(AVG("fileSize"), 0),
		       COALESCE(AVG("pageCount"), 0)
		FROM "Comic"
	`).Scan(&stats.TotalFiles, &stats.TotalSize, &stats.TotalPages, &stats.AvgFileSize, &stats.AvgPageCount)

	db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "type" = 'comic'`).Scan(&stats.ComicCount)
	db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "type" = 'novel'`).Scan(&stats.NovelCount)

	// 有元数据 = author 或 genre 或 metadataSource 非空
	db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "author" != '' OR "genre" != '' OR "metadataSource" != ''`).Scan(&stats.WithMetadata)
	stats.WithoutMetadata = stats.TotalFiles - stats.WithMetadata

	// 2. 格式分布（按文件扩展名）
	formatRows, err := db.Query(`
		SELECT
			LOWER(
				CASE
					WHEN "filename" LIKE '%.cbz' THEN 'CBZ'
					WHEN "filename" LIKE '%.zip' THEN 'ZIP'
					WHEN "filename" LIKE '%.cbr' THEN 'CBR'
					WHEN "filename" LIKE '%.rar' THEN 'RAR'
					WHEN "filename" LIKE '%.cb7' THEN 'CB7'
					WHEN "filename" LIKE '%.7z'  THEN '7Z'
					WHEN "filename" LIKE '%.pdf' THEN 'PDF'
					WHEN "filename" LIKE '%.epub' THEN 'EPUB'
					WHEN "filename" LIKE '%.mobi' THEN 'MOBI'
					WHEN "filename" LIKE '%.azw3' THEN 'AZW3'
					WHEN "filename" LIKE '%.txt' THEN 'TXT'
					WHEN "filename" LIKE '%.html' THEN 'HTML'
					WHEN "filename" LIKE '%.htm' THEN 'HTML'
					ELSE 'OTHER'
				END
			) as fmt,
			COUNT(*) as cnt,
			COALESCE(SUM("fileSize"), 0) as totalSize
		FROM "Comic"
		GROUP BY fmt
		ORDER BY cnt DESC
	`)
	if err == nil {
		defer formatRows.Close()
		for formatRows.Next() {
			var item FormatStatItem
			if formatRows.Scan(&item.Format, &item.Count, &item.TotalSize) == nil {
				// 转大写
				switch item.Format {
				case "cbz":
					item.Format = "CBZ"
				case "zip":
					item.Format = "ZIP"
				case "cbr":
					item.Format = "CBR"
				case "rar":
					item.Format = "RAR"
				case "cb7":
					item.Format = "CB7"
				case "7z":
					item.Format = "7Z"
				case "pdf":
					item.Format = "PDF"
				case "epub":
					item.Format = "EPUB"
				case "mobi":
					item.Format = "MOBI"
				case "azw3":
					item.Format = "AZW3"
				case "txt":
					item.Format = "TXT"
				case "html":
					item.Format = "HTML"
				case "other":
					item.Format = "OTHER"
				}
				stats.FormatStats = append(stats.FormatStats, item)
			}
		}
	}

	// 3. 大小分布
	sizeRanges := []struct {
		label string
		min   int64
		max   int64
	}{
		{"< 10 MB", 0, 10 * 1024 * 1024},
		{"10 - 50 MB", 10 * 1024 * 1024, 50 * 1024 * 1024},
		{"50 - 200 MB", 50 * 1024 * 1024, 200 * 1024 * 1024},
		{"200 - 500 MB", 200 * 1024 * 1024, 500 * 1024 * 1024},
		{"> 500 MB", 500 * 1024 * 1024, 1 << 62},
	}
	for _, r := range sizeRanges {
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "fileSize" >= ? AND "fileSize" < ?`, r.min, r.max).Scan(&count)
		stats.SizeDistribution = append(stats.SizeDistribution, SizeDistItem{Range: r.label, Count: count})
	}

	// 4. 页数分布（仅漫画）
	pageRanges := []struct {
		label string
		min   int
		max   int
	}{
		{"1 - 20 页", 1, 21},
		{"21 - 50 页", 21, 51},
		{"51 - 100 页", 51, 101},
		{"101 - 300 页", 101, 301},
		{"> 300 页", 301, 999999},
	}
	for _, r := range pageRanges {
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "pageCount" >= ? AND "pageCount" < ? AND "type" = 'comic'`, r.min, r.max).Scan(&count)
		stats.PageDistribution = append(stats.PageDistribution, PageDistItem{Range: r.label, Count: count})
	}

	// 5. 语言分布
	langRows, err := db.Query(`
		SELECT CASE WHEN "language" = '' THEN '未知' ELSE "language" END as lang,
		       COUNT(*) as cnt
		FROM "Comic"
		GROUP BY lang
		ORDER BY cnt DESC
		LIMIT 15
	`)
	if err == nil {
		defer langRows.Close()
		for langRows.Next() {
			var item LanguageStatItem
			if langRows.Scan(&item.Language, &item.Count) == nil {
				stats.LanguageStats = append(stats.LanguageStats, item)
			}
		}
	}

	// 6. 入库时间线（按月，最近24个月）
	twentyFourMonthsAgo := time.Now().AddDate(-2, 0, 0).UTC().Format(time.RFC3339)
	timelineRows, err := db.Query(`
		SELECT strftime('%Y-%m', "addedAt") as m, COUNT(*) as cnt
		FROM "Comic"
		WHERE "addedAt" >= ?
		GROUP BY m
		ORDER BY m ASC
	`, twentyFourMonthsAgo)
	if err == nil {
		defer timelineRows.Close()
		for timelineRows.Next() {
			var item AddedTimelineItem
			if timelineRows.Scan(&item.Month, &item.Count) == nil {
				stats.AddedTimeline = append(stats.AddedTimeline, item)
			}
		}
	}

	// 7. Top 10 最大文件
	largestRows, err := db.Query(`
		SELECT "id", "title", "filename", "fileSize", "pageCount", "type"
		FROM "Comic"
		ORDER BY "fileSize" DESC
		LIMIT 10
	`)
	if err == nil {
		defer largestRows.Close()
		for largestRows.Next() {
			var item LargestFileItem
			if largestRows.Scan(&item.ID, &item.Title, &item.Filename, &item.FileSize, &item.PageCount, &item.Type) == nil {
				stats.LargestFiles = append(stats.LargestFiles, item)
			}
		}
	}

	// 8. Top 10 页数最多
	mostPagesRows, err := db.Query(`
		SELECT "id", "title", "filename", "fileSize", "pageCount", "type"
		FROM "Comic"
		WHERE "type" = 'comic'
		ORDER BY "pageCount" DESC
		LIMIT 10
	`)
	if err == nil {
		defer mostPagesRows.Close()
		for mostPagesRows.Next() {
			var item LargestFileItem
			if mostPagesRows.Scan(&item.ID, &item.Title, &item.Filename, &item.FileSize, &item.PageCount, &item.Type) == nil {
				stats.MostPages = append(stats.MostPages, item)
			}
		}
	}

	// 9. 作者分布 Top 10
	authorRows, err := db.Query(`
		SELECT "author", COUNT(*) as cnt
		FROM "Comic"
		WHERE "author" != ''
		GROUP BY "author"
		ORDER BY cnt DESC
		LIMIT 10
	`)
	if err == nil {
		defer authorRows.Close()
		for authorRows.Next() {
			var item AuthorStatItem
			if authorRows.Scan(&item.Author, &item.Count) == nil {
				stats.AuthorStats = append(stats.AuthorStats, item)
			}
		}
	}

	return stats, nil
}

// ============================================================
// 文件夹树形统计
// ============================================================

// FolderTreeNode 表示文件夹树中的一个节点。
type FolderTreeNode struct {
	Name       string            `json:"name"`
	Path       string            `json:"path"`
	FileCount  int               `json:"fileCount"`
	TotalSize  int64             `json:"totalSize"`
	TotalPages int               `json:"totalPages"`
	ComicCount int               `json:"comicCount"`
	NovelCount int               `json:"novelCount"`
	ReadCount  int               `json:"readCount"` // 已读完的文件数
	Children   []*FolderTreeNode `json:"children"`
	Files      []FolderFileItem  `json:"files,omitempty"` // 叶子节点包含的文件列表
}

// FolderFileItem 文件夹中的单个文件信息。
type FolderFileItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Filename  string `json:"filename"`
	FileSize  int64  `json:"fileSize"`
	PageCount int    `json:"pageCount"`
	Type      string `json:"type"`
	LastRead  int    `json:"lastRead"` // 最后阅读页
}

// GetFolderTreeStats 按文件夹层级结构返回统计数据。
// filename 字段存储的是相对于扫描根目录的路径（如 "乌龙院/乌龙院前篇/卷1.cbz"）。
func GetFolderTreeStats() ([]*FolderTreeNode, error) {
	rows, err := db.Query(`
		SELECT "id", "title", "filename", "fileSize", "pageCount", "type", "lastReadPage"
		FROM "Comic"
		ORDER BY "filename" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// 构建虚拟根节点
	root := &FolderTreeNode{
		Name:     "root",
		Path:     "",
		Children: []*FolderTreeNode{},
	}

	for rows.Next() {
		var id, title, filename, comicType string
		var fileSize int64
		var pageCount, lastReadPage int
		if err := rows.Scan(&id, &title, &filename, &fileSize, &pageCount, &comicType, &lastReadPage); err != nil {
			continue
		}

		// 解析文件路径中的目录层级
		parts := splitPath(filename)
		if len(parts) == 0 {
			continue
		}

		// 判断是否已读完
		isRead := lastReadPage > 0 && pageCount > 0 && lastReadPage >= pageCount-1

		// 构建文件信息
		fileItem := FolderFileItem{
			ID:        id,
			Title:     title,
			Filename:  parts[len(parts)-1], // 只取文件名部分
			FileSize:  fileSize,
			PageCount: pageCount,
			Type:      comicType,
			LastRead:  lastReadPage,
		}

		// 遍历路径层级，创建或查找节点
		current := root
		pathSoFar := ""
		for i := 0; i < len(parts)-1; i++ { // 最后一个是文件名，不创建节点
			dirName := parts[i]
			if pathSoFar == "" {
				pathSoFar = dirName
			} else {
				pathSoFar = pathSoFar + "/" + dirName
			}

			// 查找已有子节点
			var found *FolderTreeNode
			for _, child := range current.Children {
				if child.Name == dirName {
					found = child
					break
				}
			}
			if found == nil {
				found = &FolderTreeNode{
					Name:     dirName,
					Path:     pathSoFar,
					Children: []*FolderTreeNode{},
				}
				current.Children = append(current.Children, found)
			}
			current = found
		}

		// 将文件添加到最深层目录节点
		current.Files = append(current.Files, fileItem)

		// 累加统计到当前节点及所有祖先节点
		// 从叶子节点向上累加
		current2 := root
		current2.FileCount++
		current2.TotalSize += fileSize
		current2.TotalPages += pageCount
		if comicType == "comic" {
			current2.ComicCount++
		} else {
			current2.NovelCount++
		}
		if isRead {
			current2.ReadCount++
		}

		pathSoFar2 := ""
		for i := 0; i < len(parts)-1; i++ {
			dirName := parts[i]
			if pathSoFar2 == "" {
				pathSoFar2 = dirName
			} else {
				pathSoFar2 = pathSoFar2 + "/" + dirName
			}
			for _, child := range current2.Children {
				if child.Name == dirName {
					child.FileCount++
					child.TotalSize += fileSize
					child.TotalPages += pageCount
					if comicType == "comic" {
						child.ComicCount++
					} else {
						child.NovelCount++
					}
					if isRead {
						child.ReadCount++
					}
					current2 = child
					break
				}
			}
		}
	}

	// 如果所有文件都在根目录（没有子目录），返回空
	if len(root.Children) == 0 {
		return []*FolderTreeNode{}, nil
	}

	return root.Children, nil
}

// splitPath 将文件路径按 "/" 分割为各层级。
func splitPath(filename string) []string {
	// 统一使用正斜杠
	filename = strings.ReplaceAll(filename, "\\", "/")
	parts := strings.Split(filename, "/")
	// 过滤空字符串
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// MetadataFolderNode 元数据刮削页面的文件夹树节点。
type MetadataFolderNode struct {
	Name        string                `json:"name"`
	Path        string                `json:"path"`
	FileCount   int                   `json:"fileCount"`
	WithMeta    int                   `json:"withMeta"`
	MissingMeta int                   `json:"missingMeta"`
	ComicCount  int                   `json:"comicCount"`
	NovelCount  int                   `json:"novelCount"`
	TotalSize   int64                 `json:"totalSize"`
	Children    []*MetadataFolderNode `json:"children"`
	Files       []MetadataFolderFile  `json:"files,omitempty"`
}

// MetadataFolderFile 文件夹中的单个文件（带元数据状态）。
type MetadataFolderFile struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	Filename       string `json:"filename"`
	FileSize       int64  `json:"fileSize"`
	Type           string `json:"type"`
	HasMetadata    bool   `json:"hasMetadata"`
	MetadataSource string `json:"metadataSource"`
	Author         string `json:"author"`
}

// GetMetadataFolderTree 返回带有元数据状态的文件夹树形结构。
func GetMetadataFolderTree() ([]*MetadataFolderNode, error) {
	rows, err := db.Query(`
		SELECT "id", "title", "filename", "fileSize", "type", "metadataSource", "author"
		FROM "Comic"
		ORDER BY "filename" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	root := &MetadataFolderNode{
		Name:     "root",
		Path:     "",
		Children: []*MetadataFolderNode{},
	}

	for rows.Next() {
		var id, title, filename, comicType, metadataSource, author string
		var fileSize int64
		if err := rows.Scan(&id, &title, &filename, &fileSize, &comicType, &metadataSource, &author); err != nil {
			continue
		}

		parts := splitPath(filename)
		if len(parts) == 0 {
			continue
		}

		hasMeta := metadataSource != ""

		fileItem := MetadataFolderFile{
			ID:             id,
			Title:          title,
			Filename:       parts[len(parts)-1],
			FileSize:       fileSize,
			Type:           comicType,
			HasMetadata:    hasMeta,
			MetadataSource: metadataSource,
			Author:         author,
		}

		// 遍历路径层级，创建或查找节点
		current := root
		pathSoFar := ""
		for i := 0; i < len(parts)-1; i++ {
			dirName := parts[i]
			if pathSoFar == "" {
				pathSoFar = dirName
			} else {
				pathSoFar = pathSoFar + "/" + dirName
			}

			var found *MetadataFolderNode
			for _, child := range current.Children {
				if child.Name == dirName {
					found = child
					break
				}
			}
			if found == nil {
				found = &MetadataFolderNode{
					Name:     dirName,
					Path:     pathSoFar,
					Children: []*MetadataFolderNode{},
				}
				current.Children = append(current.Children, found)
			}
			current = found
		}

		// 将文件添加到最深层目录节点
		current.Files = append(current.Files, fileItem)

		// 累加统计到所有祖先节点
		current2 := root
		current2.FileCount++
		current2.TotalSize += fileSize
		if comicType == "comic" {
			current2.ComicCount++
		} else {
			current2.NovelCount++
		}
		if hasMeta {
			current2.WithMeta++
		} else {
			current2.MissingMeta++
		}

		pathSoFar2 := ""
		for i := 0; i < len(parts)-1; i++ {
			dirName := parts[i]
			if pathSoFar2 == "" {
				pathSoFar2 = dirName
			} else {
				pathSoFar2 = pathSoFar2 + "/" + dirName
			}
			for _, child := range current2.Children {
				if child.Name == dirName {
					child.FileCount++
					child.TotalSize += fileSize
					if comicType == "comic" {
						child.ComicCount++
					} else {
						child.NovelCount++
					}
					if hasMeta {
						child.WithMeta++
					} else {
						child.MissingMeta++
					}
					current2 = child
					break
				}
			}
		}
	}

	if len(root.Children) == 0 {
		return []*MetadataFolderNode{}, nil
	}

	return root.Children, nil
}
