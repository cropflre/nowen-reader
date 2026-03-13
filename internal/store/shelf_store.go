package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ============================================================
// 书架（Shelf）数据模型
// ============================================================

// Shelf 表示用户自定义书架。
type Shelf struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sortOrder"`
	Count     int    `json:"count"`
	CreatedAt string `json:"createdAt"`
}

// ShelfWithComics 表示书架及其包含的漫画ID。
type ShelfWithComics struct {
	Shelf
	ComicIDs []string `json:"comicIds"`
}

// ============================================================
// 预定义书架
// ============================================================

var PredefinedShelves = []struct {
	Name   string
	NameEN string
	Icon   string
}{
	{Name: "在读", NameEN: "Reading", Icon: "📖"},
	{Name: "想读", NameEN: "Want to Read", Icon: "📋"},
	{Name: "已读完", NameEN: "Finished", Icon: "✅"},
	{Name: "暂停", NameEN: "On Hold", Icon: "⏸️"},
	{Name: "弃读", NameEN: "Dropped", Icon: "🚫"},
}

// InitShelves 初始化预定义书架（仅在表为空时）。
func InitShelves(lang string) error {
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM "Shelf"`).Scan(&count)
	if count > 0 {
		return nil // 已初始化
	}

	isZH := strings.HasPrefix(lang, "zh")
	for i, s := range PredefinedShelves {
		name := s.NameEN
		if isZH {
			name = s.Name
		}
		_, err := db.Exec(`
			INSERT INTO "Shelf" ("name", "icon", "sortOrder") VALUES (?, ?, ?)
		`, name, s.Icon, i)
		if err != nil {
			return err
		}
	}
	return nil
}

// ============================================================
// CRUD 操作
// ============================================================

// GetAllShelves 返回所有书架（含漫画计数）。
func GetAllShelves() ([]Shelf, error) {
	rows, err := db.Query(`
		SELECT s."id", s."name", s."icon", s."sortOrder", s."createdAt",
		       COUNT(cs."comicId") as cnt
		FROM "Shelf" s
		LEFT JOIN "ComicShelf" cs ON cs."shelfId" = s."id"
		GROUP BY s."id"
		ORDER BY s."sortOrder" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shelves []Shelf
	for rows.Next() {
		var s Shelf
		var createdAt time.Time
		if err := rows.Scan(&s.ID, &s.Name, &s.Icon, &s.SortOrder, &createdAt, &s.Count); err != nil {
			continue
		}
		s.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		shelves = append(shelves, s)
	}
	if shelves == nil {
		shelves = []Shelf{}
	}
	return shelves, nil
}

// CreateShelf 创建一个新书架。
func CreateShelf(name, icon string) (*Shelf, error) {
	if icon == "" {
		icon = "📚"
	}

	// 获取最大 sortOrder
	var maxOrder int
	db.QueryRow(`SELECT COALESCE(MAX("sortOrder"), -1) FROM "Shelf"`).Scan(&maxOrder)

	res, err := db.Exec(`
		INSERT INTO "Shelf" ("name", "icon", "sortOrder") VALUES (?, ?, ?)
	`, name, icon, maxOrder+1)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()

	return &Shelf{
		ID:        int(id),
		Name:      name,
		Icon:      icon,
		SortOrder: maxOrder + 1,
		Count:     0,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// UpdateShelf 更新书架名称和图标。
func UpdateShelf(id int, name, icon string) error {
	_, err := db.Exec(`UPDATE "Shelf" SET "name" = ?, "icon" = ? WHERE "id" = ?`, name, icon, id)
	return err
}

// DeleteShelf 删除书架及其关联。
func DeleteShelf(id int) error {
	_, err := db.Exec(`DELETE FROM "Shelf" WHERE "id" = ?`, id)
	return err
}

// ============================================================
// 书架-漫画关联
// ============================================================

// AddComicToShelf 将漫画添加到书架。
func AddComicToShelf(comicID string, shelfID int) error {
	_, err := db.Exec(`
		INSERT INTO "ComicShelf" ("comicId", "shelfId") VALUES (?, ?)
		ON CONFLICT DO NOTHING
	`, comicID, shelfID)
	return err
}

// RemoveComicFromShelf 从书架移除漫画。
func RemoveComicFromShelf(comicID string, shelfID int) error {
	_, err := db.Exec(`DELETE FROM "ComicShelf" WHERE "comicId" = ? AND "shelfId" = ?`, comicID, shelfID)
	return err
}

// MoveComicToShelf 将漫画移动到指定书架（从所有书架移除后添加到目标书架）。
func MoveComicToShelf(comicID string, shelfID int) error {
	_, err := db.Exec(`DELETE FROM "ComicShelf" WHERE "comicId" = ?`, comicID)
	if err != nil {
		return err
	}
	return AddComicToShelf(comicID, shelfID)
}

// GetComicShelves 返回一本漫画所在的所有书架。
func GetComicShelves(comicID string) ([]Shelf, error) {
	rows, err := db.Query(`
		SELECT s."id", s."name", s."icon", s."sortOrder"
		FROM "Shelf" s
		JOIN "ComicShelf" cs ON cs."shelfId" = s."id"
		WHERE cs."comicId" = ?
		ORDER BY s."sortOrder" ASC
	`, comicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shelves []Shelf
	for rows.Next() {
		var s Shelf
		if err := rows.Scan(&s.ID, &s.Name, &s.Icon, &s.SortOrder); err != nil {
			continue
		}
		shelves = append(shelves, s)
	}
	if shelves == nil {
		shelves = []Shelf{}
	}
	return shelves, nil
}

// GetShelfComicIDs 返回书架中的所有漫画ID。
func GetShelfComicIDs(shelfID int) ([]string, error) {
	rows, err := db.Query(`
		SELECT "comicId" FROM "ComicShelf" WHERE "shelfId" = ?
	`, shelfID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, nil
}

// BatchAddToShelf 批量将漫画添加到书架。
func BatchAddToShelf(comicIDs []string, shelfID int) error {
	if len(comicIDs) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO "ComicShelf" ("comicId", "shelfId") VALUES (?, ?)
		ON CONFLICT DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, id := range comicIDs {
		if _, err := stmt.Exec(id, shelfID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// BatchMoveToShelf 批量移动漫画到指定书架。
func BatchMoveToShelf(comicIDs []string, shelfID int) error {
	if len(comicIDs) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 先从所有书架移除
	placeholders := make([]string, len(comicIDs))
	args := make([]interface{}, len(comicIDs))
	for i, id := range comicIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	in := strings.Join(placeholders, ",")
	if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM "ComicShelf" WHERE "comicId" IN (%s)`, in), args...); err != nil {
		return err
	}

	// 添加到目标书架
	stmt, err := tx.Prepare(`
		INSERT INTO "ComicShelf" ("comicId", "shelfId") VALUES (?, ?)
		ON CONFLICT DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, id := range comicIDs {
		if _, err := stmt.Exec(id, shelfID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

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

	// 每日统计（最近 90 天，原来是 30 天）
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
