package store

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// ============================================================
// 阅读会话
// ============================================================

// StartReadingSession 创建一个新的阅读会话。
func StartReadingSession(comicID string, startPage int, userID ...string) (int64, error) {
	uid := ""
	if len(userID) > 0 {
		uid = userID[0]
	}
	res, err := db.Exec(`
		INSERT INTO "ReadingSession" ("comicId", "userId", "startPage", "startedAt")
		VALUES (?, ?, ?, ?)
	`, comicID, uid, startPage, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// EndReadingSession 完成一个阅读会话并更新漫画的总阅读时间。
func EndReadingSession(sessionID int, endPage int, duration int, userID ...string) error {
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
	if err != nil {
		return err
	}

	// 更新 UserComicState 的总阅读时间
	if len(userID) > 0 && userID[0] != "" {
		_, err = db.Exec(`
			INSERT INTO "UserComicState" ("userId", "comicId", "totalReadTime")
			VALUES (?, ?, ?)
			ON CONFLICT("userId", "comicId") DO UPDATE SET "totalReadTime" = "totalReadTime" + ?
		`, userID[0], comicID, duration, duration)
	}
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

// GetReadingStats 返回聚合的阅读统计数据（可按 userId 过滤）。
func GetReadingStats(userID ...string) (*ReadingStatsResult, error) {
	result := &ReadingStatsResult{
		RecentSessions: []RecentSessionItem{},
		DailyStats:     []DailyStatItem{},
	}

	uidFilter := ""
	var args []interface{}
	if len(userID) > 0 && userID[0] != "" {
		uidFilter = ` AND rs."userId" = ?`
		args = append(args, userID[0])
	}

	// Recent 50 sessions
	rows, err := db.Query(`
		SELECT rs."id", rs."comicId", c."title", rs."startedAt", rs."endedAt",
		       rs."duration", rs."startPage", rs."endPage"
		FROM "ReadingSession" rs
		JOIN "Comic" c ON rs."comicId" = c."id"
		WHERE 1=1`+uidFilter+`
		ORDER BY rs."startedAt" DESC
		LIMIT 50
	`, args...)
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
	aggArgs := []interface{}{}
	aggFilter := ""
	if len(userID) > 0 && userID[0] != "" {
		aggFilter = ` WHERE "userId" = ?`
		aggArgs = append(aggArgs, userID[0])
	}
	db.QueryRow(`SELECT COALESCE(SUM("duration"), 0), COUNT(*) FROM "ReadingSession"`+aggFilter, aggArgs...).
		Scan(&result.TotalReadTime, &result.TotalSessions)

	db.QueryRow(`SELECT COUNT(DISTINCT "comicId") FROM "ReadingSession"`+aggFilter, aggArgs...).
		Scan(&result.TotalComicsRead)

	// Daily stats (last 30 days)
	thirtyDaysAgo := time.Now().AddDate(0, 0, -30).UTC().Format(time.RFC3339)
	dailyArgs := []interface{}{thirtyDaysAgo}
	dailyFilter := ""
	if len(userID) > 0 && userID[0] != "" {
		dailyFilter = ` AND rs."userId" = ?`
		dailyArgs = append(dailyArgs, userID[0])
	}
	dailyRows, err := db.Query(`
		SELECT DATE(rs."startedAt") as d, SUM(rs."duration"), COUNT(*)
		FROM "ReadingSession" rs
		WHERE rs."startedAt" >= ?`+dailyFilter+`
		GROUP BY d
		ORDER BY d ASC
	`, dailyArgs...)
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
	Reason     string               `json:"reason"`
	Confidence int                  `json:"confidence"` // 置信度 0-100
	Details    string               `json:"details"`    // 详细说明
	Comics     []DuplicateComicInfo `json:"comics"`
}

type DuplicateComicInfo struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	Title     string `json:"title"`
	FileSize  int64  `json:"fileSize"`
	PageCount int    `json:"pageCount"`
	AddedAt   string `json:"addedAt"`
	CoverURL  string `json:"coverUrl"`
	Author    string `json:"author,omitempty"`
	Genre     string `json:"genre,omitempty"`
	Format    string `json:"format,omitempty"` // cbz, cbr, pdf, zip 等
}

// DetectDuplicates 通过多种策略查找重复漫画。
// 4 pass 检测：MD5 哈希（数据库预计算）→ 大小+页数 → 标准化标题 → 模糊标题匹配。
func DetectDuplicates(comicsDir string) ([]DuplicateGroup, error) {
	rows, err := db.Query(`
		SELECT "id", "filename", "title", "fileSize", "pageCount", "addedAt",
		       COALESCE("author", ''), COALESCE("genre", ''), COALESCE("md5Hash", '')
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
		Author    string
		Genre     string
		MD5Hash   string
	}

	var comics []comicInfo
	for rows.Next() {
		var c comicInfo
		if rows.Scan(&c.ID, &c.Filename, &c.Title, &c.FileSize, &c.PageCount, &c.AddedAt, &c.Author, &c.Genre, &c.MD5Hash) == nil {
			comics = append(comics, c)
		}
	}

	// 提取文件扩展名作为格式
	fileFormat := func(filename string) string {
		ext := strings.ToLower(filepath.Ext(filename))
		if ext != "" {
			ext = ext[1:] // 去掉点
		}
		return ext
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
			Author:    c.Author,
			Genre:     c.Genre,
			Format:    fileFormat(c.Filename),
		}
	}

	var groups []DuplicateGroup
	usedIDs := make(map[string]bool)

	// ─── Pass 1: MD5 哈希匹配（数据库预计算）───
	// 置信度 100%: 文件 MD5 完全相同，内容一定相同
	hashMap := make(map[string][]comicInfo)
	var unhashed int
	for _, c := range comics {
		if c.MD5Hash == "" {
			unhashed++
			continue // MD5 尚未计算，跳过
		}
		hashMap[c.MD5Hash] = append(hashMap[c.MD5Hash], c)
	}
	for _, arr := range hashMap {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			for _, c := range arr {
				usedIDs[c.ID] = true
				infos = append(infos, toInfo(c))
			}
			groups = append(groups, DuplicateGroup{
				Reason:     "sameFile",
				Confidence: 100,
				Details:    fmt.Sprintf("MD5 hash identical (%s)", arr[0].MD5Hash),
				Comics:     infos,
			})
		}
	}

	// ─── Pass 2: Same fileSize + pageCount ───
	// 置信度 80%: 大小和页数完全一致
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
			groups = append(groups, DuplicateGroup{
				Reason:     "sameSize",
				Confidence: 80,
				Details:    fmt.Sprintf("File size: %d bytes, Pages: %d", arr[0].FileSize, arr[0].PageCount),
				Comics:     infos,
			})
		}
	}

	// ─── Pass 3: Normalized title ───
	// 置信度 70%: 去除标点/空格/卷号后标题相同
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
				usedIDs[c.ID] = true
				infos = append(infos, toInfo(c))
			}
			// 如果同组漫画有相同作者，提高置信度
			confidence := 70
			var authors []string
			for _, c := range arr {
				authors = append(authors, c.Author)
			}
			if hasDuplicateAuthor(authors) {
				confidence = 85
			}
			groups = append(groups, DuplicateGroup{
				Reason:     "sameName",
				Confidence: confidence,
				Details:    fmt.Sprintf("Normalized title: %s", normalizeTitle(arr[0].Title)),
				Comics:     infos,
			})
		}
	}

	// ─── Pass 4: Fuzzy title matching (编辑距离/相似度) ───
	// 置信度 40-65%: 标题高度相似但不完全相同
	type fuzzyCandidate struct {
		comic      comicInfo
		normalized string
	}
	var fuzzyCandidates []fuzzyCandidate
	for _, c := range comics {
		if usedIDs[c.ID] {
			continue
		}
		norm := normalizeTitle(c.Title)
		if norm == "" || utf8.RuneCountInString(norm) < 3 {
			continue
		}
		fuzzyCandidates = append(fuzzyCandidates, fuzzyCandidate{comic: c, normalized: norm})
	}

	// 两两比较模糊候选项
	fuzzyUsed := make(map[string]bool)
	fuzzyGroups := make(map[int][]fuzzyCandidate) // groupID -> candidates
	groupCounter := 0
	candidateGroup := make(map[string]int) // comicID -> groupID

	for i := 0; i < len(fuzzyCandidates); i++ {
		if fuzzyUsed[fuzzyCandidates[i].comic.ID] {
			continue
		}
		for j := i + 1; j < len(fuzzyCandidates); j++ {
			if fuzzyUsed[fuzzyCandidates[j].comic.ID] {
				continue
			}
			sim := titleSimilarity(fuzzyCandidates[i].normalized, fuzzyCandidates[j].normalized)
			if sim >= 0.80 {
				// 查找或创建组
				gid, ok := candidateGroup[fuzzyCandidates[i].comic.ID]
				if !ok {
					gid = groupCounter
					groupCounter++
					candidateGroup[fuzzyCandidates[i].comic.ID] = gid
					fuzzyGroups[gid] = append(fuzzyGroups[gid], fuzzyCandidates[i])
					fuzzyUsed[fuzzyCandidates[i].comic.ID] = true
				}
				if _, already := candidateGroup[fuzzyCandidates[j].comic.ID]; !already {
					candidateGroup[fuzzyCandidates[j].comic.ID] = gid
					fuzzyGroups[gid] = append(fuzzyGroups[gid], fuzzyCandidates[j])
					fuzzyUsed[fuzzyCandidates[j].comic.ID] = true
				}
			}
		}
	}

	for _, arr := range fuzzyGroups {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			var titles []string
			for _, fc := range arr {
				infos = append(infos, toInfo(fc.comic))
				titles = append(titles, fc.comic.Title)
			}
			// 计算组内最低相似度作为置信度参考
			minSim := 1.0
			for a := 0; a < len(arr); a++ {
				for b := a + 1; b < len(arr); b++ {
					s := titleSimilarity(arr[a].normalized, arr[b].normalized)
					if s < minSim {
						minSim = s
					}
				}
			}
			confidence := int(minSim * 65) // 0.80 → 52, 1.0 → 65
			if confidence < 40 {
				confidence = 40
			}
			// 如果有相同作者，提高置信度
			var authors []string
			for _, fc := range arr {
				authors = append(authors, fc.comic.Author)
			}
			if hasDuplicateAuthor(authors) {
				confidence += 15
				if confidence > 75 {
					confidence = 75
				}
			}
			groups = append(groups, DuplicateGroup{
				Reason:     "fuzzyName",
				Confidence: confidence,
				Details:    fmt.Sprintf("Titles: %s (similarity: %.0f%%)", strings.Join(titles, " ↔ "), minSim*100),
				Comics:     infos,
			})
		}
	}

	// 按置信度降序排序
	sort.Slice(groups, func(i, j int) bool {
		return groups[i].Confidence > groups[j].Confidence
	})

	if groups == nil {
		groups = []DuplicateGroup{}
	}
	return groups, nil
}

// hasDuplicateAuthor 检查作者列表中是否有相同的非空作者
func hasDuplicateAuthor(authors []string) bool {
	counts := make(map[string]int)
	for _, a := range authors {
		a = strings.TrimSpace(strings.ToLower(a))
		if a != "" {
			counts[a]++
		}
	}
	for _, cnt := range counts {
		if cnt >= 2 {
			return true
		}
	}
	return false
}

// titleSimilarity 计算两个标题的相似度 (0.0 ~ 1.0)，使用编辑距离。
func titleSimilarity(a, b string) float64 {
	if a == b {
		return 1.0
	}
	ra := []rune(a)
	rb := []rune(b)
	lenA := len(ra)
	lenB := len(rb)

	// 长度差异过大直接返回低相似度
	if lenA == 0 || lenB == 0 {
		return 0.0
	}
	lenDiff := lenA - lenB
	if lenDiff < 0 {
		lenDiff = -lenDiff
	}
	maxLen := lenA
	if lenB > maxLen {
		maxLen = lenB
	}
	if float64(lenDiff)/float64(maxLen) > 0.5 {
		return 0.0
	}

	// Levenshtein 距离（优化：只保留两行）
	prev := make([]int, lenB+1)
	curr := make([]int, lenB+1)
	for j := 0; j <= lenB; j++ {
		prev[j] = j
	}
	for i := 1; i <= lenA; i++ {
		curr[0] = i
		for j := 1; j <= lenB; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			curr[j] = min3(prev[j]+1, curr[j-1]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	dist := prev[lenB]
	return 1.0 - float64(dist)/float64(maxLen)
}

func min3(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
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
