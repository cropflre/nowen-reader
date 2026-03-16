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
