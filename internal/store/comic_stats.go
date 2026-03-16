package store

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// ============================================================
// 阅读会话
// ============================================================

// StartReadingSession 创建一个新的阅读会话。
func StartReadingSession(comicID string, startPage int) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO "ReadingSession" ("comicId", "startPage", "startedAt")
		VALUES (?, ?, ?)
	`, comicID, startPage, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// EndReadingSession 完成一个阅读会话并更新漫画的总阅读时间。
func EndReadingSession(sessionID int, endPage int, duration int) error {
	// Get the comicId from the session
	var comicID string
	err := db.QueryRow(`SELECT "comicId" FROM "ReadingSession" WHERE "id" = ?`, sessionID).Scan(&comicID)
	if err != nil {
		return err
	}

	// Update session
	_, err = db.Exec(`
		UPDATE "ReadingSession" SET "endedAt" = ?, "endPage" = ?, "duration" = ?
		WHERE "id" = ?
	`, time.Now().UTC(), endPage, duration, sessionID)
	if err != nil {
		return err
	}

	// Increment comic's total read time
	_, err = db.Exec(`
		UPDATE "Comic" SET "totalReadTime" = "totalReadTime" + ? WHERE "id" = ?
	`, duration, comicID)
	return err
}

// ============================================================
// 阅读统计
// ============================================================

// ReadingStatsResult 保存聚合的阅读统计数据。
type ReadingStatsResult struct {
	TotalReadTime   int                 `json:"totalReadTime"`
	TotalSessions   int                 `json:"totalSessions"`
	TotalComicsRead int                 `json:"totalComicsRead"`
	RecentSessions  []RecentSessionItem `json:"recentSessions"`
	DailyStats      []DailyStatItem     `json:"dailyStats"`
}

type RecentSessionItem struct {
	ID         int     `json:"id"`
	ComicID    string  `json:"comicId"`
	ComicTitle string  `json:"comicTitle"`
	StartedAt  string  `json:"startedAt"`
	EndedAt    *string `json:"endedAt"`
	Duration   int     `json:"duration"`
	StartPage  int     `json:"startPage"`
	EndPage    int     `json:"endPage"`
}

type DailyStatItem struct {
	Date     string `json:"date"`
	Duration int    `json:"duration"`
	Sessions int    `json:"sessions"`
}

// GetReadingStats 返回聚合的阅读统计数据。
func GetReadingStats() (*ReadingStatsResult, error) {
	result := &ReadingStatsResult{
		RecentSessions: []RecentSessionItem{},
		DailyStats:     []DailyStatItem{},
	}

	// Recent 50 sessions
	rows, err := db.Query(`
		SELECT rs."id", rs."comicId", c."title", rs."startedAt", rs."endedAt",
		       rs."duration", rs."startPage", rs."endPage"
		FROM "ReadingSession" rs
		JOIN "Comic" c ON rs."comicId" = c."id"
		ORDER BY rs."startedAt" DESC
		LIMIT 50
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var s RecentSessionItem
		var startedAt time.Time
		var endedAt sql.NullTime
		if err := rows.Scan(&s.ID, &s.ComicID, &s.ComicTitle, &startedAt, &endedAt, &s.Duration, &s.StartPage, &s.EndPage); err != nil {
			continue
		}
		s.StartedAt = startedAt.UTC().Format(time.RFC3339Nano)
		if endedAt.Valid {
			e := endedAt.Time.UTC().Format(time.RFC3339Nano)
			s.EndedAt = &e
		}
		result.RecentSessions = append(result.RecentSessions, s)
	}

	// Aggregates
	db.QueryRow(`SELECT COALESCE(SUM("duration"), 0), COUNT(*) FROM "ReadingSession"`).
		Scan(&result.TotalReadTime, &result.TotalSessions)

	db.QueryRow(`SELECT COUNT(DISTINCT "comicId") FROM "ReadingSession"`).
		Scan(&result.TotalComicsRead)

	// Daily stats (last 30 days)
	thirtyDaysAgo := time.Now().AddDate(0, 0, -30).UTC().Format(time.RFC3339)
	dailyRows, err := db.Query(`
		SELECT DATE(rs."startedAt") as d, SUM(rs."duration"), COUNT(*)
		FROM "ReadingSession" rs
		WHERE rs."startedAt" >= ?
		GROUP BY d
		ORDER BY d ASC
	`, thirtyDaysAgo)
	if err == nil {
		defer dailyRows.Close()
		for dailyRows.Next() {
			var ds DailyStatItem
			if dailyRows.Scan(&ds.Date, &ds.Duration, &ds.Sessions) == nil {
				result.DailyStats = append(result.DailyStats, ds)
			}
		}
	}

	return result, nil
}

// GetComicReadingHistory 返回单个漫画的最近 20 条阅读会话。
func GetComicReadingHistory(comicID string) ([]RecentSessionItem, error) {
	rows, err := db.Query(`
		SELECT rs."id", rs."comicId", '' as title, rs."startedAt", rs."endedAt",
		       rs."duration", rs."startPage", rs."endPage"
		FROM "ReadingSession" rs
		WHERE rs."comicId" = ?
		ORDER BY rs."startedAt" DESC
		LIMIT 20
	`, comicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []RecentSessionItem
	for rows.Next() {
		var s RecentSessionItem
		var startedAt time.Time
		var endedAt sql.NullTime
		if err := rows.Scan(&s.ID, &s.ComicID, &s.ComicTitle, &startedAt, &endedAt, &s.Duration, &s.StartPage, &s.EndPage); err != nil {
			continue
		}
		s.StartedAt = startedAt.UTC().Format(time.RFC3339Nano)
		if endedAt.Valid {
			e := endedAt.Time.UTC().Format(time.RFC3339Nano)
			s.EndedAt = &e
		}
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []RecentSessionItem{}
	}
	return sessions, nil
}

// ============================================================
// 重复检测
// ============================================================

// DuplicateGroup 表示一组重复的漫画。
type DuplicateGroup struct {
	Reason string               `json:"reason"`
	Comics []DuplicateComicInfo `json:"comics"`
}

type DuplicateComicInfo struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	Title     string `json:"title"`
	FileSize  int64  `json:"fileSize"`
	PageCount int    `json:"pageCount"`
	AddedAt   string `json:"addedAt"`
	CoverURL  string `json:"coverUrl"`
}

// DetectDuplicates 通过哈希、大小+页数、标准化标题查找重复漫画。
func DetectDuplicates(comicsDir string) ([]DuplicateGroup, error) {
	rows, err := db.Query(`
		SELECT "id", "filename", "title", "fileSize", "pageCount", "addedAt"
		FROM "Comic" ORDER BY "title" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type comicInfo struct {
		ID        string
		Filename  string
		Title     string
		FileSize  int64
		PageCount int
		AddedAt   time.Time
	}

	var comics []comicInfo
	for rows.Next() {
		var c comicInfo
		if rows.Scan(&c.ID, &c.Filename, &c.Title, &c.FileSize, &c.PageCount, &c.AddedAt) == nil {
			comics = append(comics, c)
		}
	}

	toInfo := func(c comicInfo) DuplicateComicInfo {
		return DuplicateComicInfo{
			ID:        c.ID,
			Filename:  c.Filename,
			Title:     c.Title,
			FileSize:  c.FileSize,
			PageCount: c.PageCount,
			AddedAt:   c.AddedAt.UTC().Format(time.RFC3339Nano),
			CoverURL:  fmt.Sprintf("/api/comics/%s/thumbnail", c.ID),
		}
	}

	var groups []DuplicateGroup
	usedIDs := make(map[string]bool)

	// Pass 1: Exact content hash (SHA-256)
	hashMap := make(map[string][]comicInfo)
	for _, c := range comics {
		fp := filepath.Join(comicsDir, c.Filename)
		f, err := os.Open(fp)
		if err != nil {
			continue
		}
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			f.Close()
			continue
		}
		f.Close()
		hash := fmt.Sprintf("%x", h.Sum(nil))
		hashMap[hash] = append(hashMap[hash], c)
	}
	for _, arr := range hashMap {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			for _, c := range arr {
				usedIDs[c.ID] = true
				infos = append(infos, toInfo(c))
			}
			groups = append(groups, DuplicateGroup{Reason: "sameFile", Comics: infos})
		}
	}

	// Pass 2: Same fileSize + pageCount
	sizePageMap := make(map[string][]comicInfo)
	for _, c := range comics {
		if usedIDs[c.ID] {
			continue
		}
		key := fmt.Sprintf("%d_%d", c.FileSize, c.PageCount)
		sizePageMap[key] = append(sizePageMap[key], c)
	}
	for _, arr := range sizePageMap {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			for _, c := range arr {
				usedIDs[c.ID] = true
				infos = append(infos, toInfo(c))
			}
			groups = append(groups, DuplicateGroup{Reason: "sameSize", Comics: infos})
		}
	}

	// Pass 3: Normalized title
	titleMap := make(map[string][]comicInfo)
	for _, c := range comics {
		if usedIDs[c.ID] {
			continue
		}
		normalized := normalizeTitle(c.Title)
		if normalized == "" {
			continue
		}
		titleMap[normalized] = append(titleMap[normalized], c)
	}
	for _, arr := range titleMap {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			for _, c := range arr {
				infos = append(infos, toInfo(c))
			}
			groups = append(groups, DuplicateGroup{Reason: "sameName", Comics: infos})
		}
	}

	if groups == nil {
		groups = []DuplicateGroup{}
	}
	return groups, nil
}

// ============================================================
// 年度阅读报告
// ============================================================

// YearlyReadingReport 年度阅读报告数据。
type YearlyReadingReport struct {
	Year              int                     `json:"year"`
	TotalReadTime     int                     `json:"totalReadTime"`     // 总阅读时长(秒)
	TotalSessions     int                     `json:"totalSessions"`     // 总阅读次数
	TotalComicsRead   int                     `json:"totalComicsRead"`   // 阅读过的作品数
	TotalPagesRead    int                     `json:"totalPagesRead"`    // 翻阅总页数
	MonthlyStats      []MonthlyReadingStat    `json:"monthlyStats"`      // 月度统计
	TopComics         []TopReadComic          `json:"topComics"`         // 阅读时长Top10
	GenreDistribution []GenreDistributionItem `json:"genreDistribution"` // 类型分布
}

type MonthlyReadingStat struct {
	Month    int `json:"month"`
	Duration int `json:"duration"` // 秒
	Sessions int `json:"sessions"`
	Comics   int `json:"comics"`
}

type TopReadComic struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ReadTime int    `json:"readTime"` // 秒
	Sessions int    `json:"sessions"`
}

type GenreDistributionItem struct {
	Genre    string `json:"genre"`
	Count    int    `json:"count"`
	ReadTime int    `json:"readTime"`
}

// GetYearlyReadingReport 查询指定年份的阅读统计。
func GetYearlyReadingReport(year int) (*YearlyReadingReport, error) {
	startDate := fmt.Sprintf("%d-01-01", year)
	endDate := fmt.Sprintf("%d-01-01", year+1)

	report := &YearlyReadingReport{Year: year}

	// 1. 年度汇总
	err := db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0),
		       COUNT(*),
		       COUNT(DISTINCT "comicId"),
		       COALESCE(SUM("endPage" - "startPage"), 0)
		FROM "ReadingSession"
		WHERE "startedAt" >= ? AND "startedAt" < ? AND "duration" > 0
	`, startDate, endDate).Scan(
		&report.TotalReadTime,
		&report.TotalSessions,
		&report.TotalComicsRead,
		&report.TotalPagesRead,
	)
	if err != nil {
		return nil, err
	}

	// 2. 月度统计
	rows, err := db.Query(`
		SELECT CAST(strftime('%m', "startedAt") AS INTEGER) as month,
		       COALESCE(SUM("duration"), 0),
		       COUNT(*),
		       COUNT(DISTINCT "comicId")
		FROM "ReadingSession"
		WHERE "startedAt" >= ? AND "startedAt" < ? AND "duration" > 0
		GROUP BY month ORDER BY month
	`, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	monthMap := make(map[int]MonthlyReadingStat)
	for rows.Next() {
		var s MonthlyReadingStat
		if err := rows.Scan(&s.Month, &s.Duration, &s.Sessions, &s.Comics); err == nil {
			monthMap[s.Month] = s
		}
	}
	// 填充12个月
	for m := 1; m <= 12; m++ {
		if s, ok := monthMap[m]; ok {
			report.MonthlyStats = append(report.MonthlyStats, s)
		} else {
			report.MonthlyStats = append(report.MonthlyStats, MonthlyReadingStat{Month: m})
		}
	}

	// 3. Top 10 最多阅读的作品
	topRows, err := db.Query(`
		SELECT rs."comicId", COALESCE(c."title", rs."comicId"),
		       SUM(rs."duration"), COUNT(*)
		FROM "ReadingSession" rs
		LEFT JOIN "Comic" c ON c."id" = rs."comicId"
		WHERE rs."startedAt" >= ? AND rs."startedAt" < ? AND rs."duration" > 0
		GROUP BY rs."comicId"
		ORDER BY SUM(rs."duration") DESC
		LIMIT 10
	`, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer topRows.Close()

	for topRows.Next() {
		var tc TopReadComic
		if err := topRows.Scan(&tc.ID, &tc.Title, &tc.ReadTime, &tc.Sessions); err == nil {
			report.TopComics = append(report.TopComics, tc)
		}
	}
	if report.TopComics == nil {
		report.TopComics = []TopReadComic{}
	}

	// 4. 类型分布
	genreRows, err := db.Query(`
		SELECT COALESCE(c."genre", '未分类'),
		       COUNT(DISTINCT c."id"),
		       COALESCE(SUM(rs."duration"), 0)
		FROM "ReadingSession" rs
		LEFT JOIN "Comic" c ON c."id" = rs."comicId"
		WHERE rs."startedAt" >= ? AND rs."startedAt" < ? AND rs."duration" > 0
		GROUP BY c."genre"
		ORDER BY SUM(rs."duration") DESC
	`, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer genreRows.Close()

	for genreRows.Next() {
		var g GenreDistributionItem
		if err := genreRows.Scan(&g.Genre, &g.Count, &g.ReadTime); err == nil {
			report.GenreDistribution = append(report.GenreDistribution, g)
		}
	}
	if report.GenreDistribution == nil {
		report.GenreDistribution = []GenreDistributionItem{}
	}

	return report, nil
}
