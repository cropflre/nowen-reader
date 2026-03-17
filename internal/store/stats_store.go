package store

import (
	"database/sql"
	"time"
)

// GetEnhancedReadingStats 返回增强版阅读统计数据。
func GetEnhancedReadingStats() (map[string]interface{}, error) {
	result := make(map[string]interface{})

	// 基础统计
	var totalReadTime, totalSessions, totalComicsRead int
	db.QueryRow(`SELECT COALESCE(SUM("duration"), 0), COUNT(*) FROM "ReadingSession"`).
		Scan(&totalReadTime, &totalSessions)
	db.QueryRow(`SELECT COUNT(DISTINCT "comicId") FROM "ReadingSession"`).
		Scan(&totalComicsRead)

	result["totalReadTime"] = totalReadTime
	result["totalSessions"] = totalSessions
	result["totalComicsRead"] = totalComicsRead

	// 最近 50 条会话
	recentSessions := []map[string]interface{}{}
	rows, err := db.Query(`
		SELECT rs."id", rs."comicId", c."title", rs."startedAt", rs."endedAt",
		       rs."duration", rs."startPage", rs."endPage"
		FROM "ReadingSession" rs
		JOIN "Comic" c ON rs."comicId" = c."id"
		ORDER BY rs."startedAt" DESC
		LIMIT 50
	`)
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
	dailyRows, err := db.Query(`
		SELECT DATE(rs."startedAt") as d, SUM(rs."duration"), COUNT(*)
		FROM "ReadingSession" rs
		WHERE rs."startedAt" >= ?
		GROUP BY d
		ORDER BY d ASC
	`, ninetyDaysAgo)
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
	monthlyRows, err := db.Query(`
		SELECT strftime('%Y-%m', rs."startedAt") as m,
		       SUM(rs."duration"), COUNT(*), COUNT(DISTINCT rs."comicId")
		FROM "ReadingSession" rs
		WHERE rs."startedAt" >= ?
		GROUP BY m
		ORDER BY m ASC
	`, twelveMonthsAgo)
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
		WHERE c."genre" != ''
		GROUP BY c."genre"
		ORDER BY totalTime DESC
		LIMIT 10
	`)
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
		ORDER BY d DESC
	`)
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
		WHERE rs."duration" > 0 AND rs."endPage" > rs."startPage"
	`).Scan(&totalPages, &totalDuration)

	if totalDuration > 0 {
		result["avgPagesPerHour"] = float64(totalPages) / (float64(totalDuration) / 3600.0)
	} else {
		result["avgPagesPerHour"] = 0
	}

	// 今日阅读时长
	todayStart := time.Now().UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
	var todayReadTime int
	db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0) FROM "ReadingSession"
		WHERE "startedAt" >= ?
	`, todayStart).Scan(&todayReadTime)
	result["todayReadTime"] = todayReadTime

	// 本周阅读时长
	now := time.Now().UTC()
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	weekStart := now.AddDate(0, 0, -(weekday - 1)).Truncate(24 * time.Hour).Format(time.RFC3339)
	var weekReadTime int
	db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0) FROM "ReadingSession"
		WHERE "startedAt" >= ?
	`, weekStart).Scan(&weekReadTime)
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
