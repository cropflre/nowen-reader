package service

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// DataQAIssue 表示一个数据一致性问题。
type DataQAIssue struct {
	ID          string `json:"id"`
	IssueType   string `json:"issueType"`
	Severity    string `json:"severity"`
	EntityType  string `json:"entityType"`
	EntityID    string `json:"entityId"`
	Title       string `json:"title,omitempty"`
	Message     string `json:"message"`
	CurrentVal  string `json:"currentVal,omitempty"`
	ExpectedVal string `json:"expectedVal,omitempty"`
	AutoFixable bool   `json:"autoFixable"`
}

// DataQASummary 返回巡检摘要。
type DataQASummary struct {
	TotalIssues int            `json:"totalIssues"`
	P1          int            `json:"p1"`
	P2          int            `json:"p2"`
	P3          int            `json:"p3"`
	AutoFixable int            `json:"autoFixable"`
	ByType      map[string]int `json:"byType"`
}

// ScanDataIssues 执行只读数据一致性巡检，返回发现的问题列表。
func ScanDataIssues() ([]DataQAIssue, error) {
	db := store.DB()
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	var issues []DataQAIssue
	id := 0

	// Issue 1: PAGE_COUNT_ZERO
	// Comic.pageCount <= 0 且 missingSince IS NULL
	rows1, err := db.Query(`
		SELECT "id", "title", "pageCount"
		FROM "Comic"
		WHERE "pageCount" <= 0 AND ("missingSince" IS NULL OR "missingSince" = '')
		LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("PAGE_COUNT_ZERO query failed: %w", err)
	}
	defer rows1.Close()
	for rows1.Next() {
		var comicID, title string
		var pageCount int
		if err := rows1.Scan(&comicID, &title, &pageCount); err != nil {
			continue
		}
		id++
		issues = append(issues, DataQAIssue{
			ID:          fmt.Sprintf("PCZ-%d", id),
			IssueType:   "PAGE_COUNT_ZERO",
			Severity:    "p2",
			EntityType:  "Comic",
			EntityID:    comicID,
			Title:       title,
			Message:     fmt.Sprintf("Comic pageCount is %d, expected > 0", pageCount),
			CurrentVal:  fmt.Sprintf("%d", pageCount),
			ExpectedVal: "> 0",
			AutoFixable: true,
		})
	}

	// Issue 2: PAGE_COUNT_NEGATIVE
	rows2, err := db.Query(`
		SELECT "id", "title", "pageCount"
		FROM "Comic"
		WHERE "pageCount" = -1
		LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("PAGE_COUNT_NEGATIVE query failed: %w", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var comicID, title string
		var pageCount int
		if err := rows2.Scan(&comicID, &title, &pageCount); err != nil {
			continue
		}
		id++
		issues = append(issues, DataQAIssue{
			ID:          fmt.Sprintf("PCN-%d", id),
			IssueType:   "PAGE_COUNT_NEGATIVE",
			Severity:    "p2",
			EntityType:  "Comic",
			EntityID:    comicID,
			Title:       title,
			Message:     "Comic pageCount is -1 (scan failure marker)",
			CurrentVal:  "-1",
			ExpectedVal: "> 0",
			AutoFixable: true,
		})
	}

	// Issue 3: SESSION_ORPHAN
	// ReadingSession.endedAt IS NULL 且 startedAt 早于 1 小时前
	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	rows3, err := db.Query(`
		SELECT "id", "comicId", "userId", "startedAt"
		FROM "ReadingSession"
		WHERE "endedAt" IS NULL AND "startedAt" < ?
		LIMIT 200
	`, oneHourAgo)
	if err != nil {
		return nil, fmt.Errorf("SESSION_ORPHAN query failed: %w", err)
	}
	defer rows3.Close()
	for rows3.Next() {
		var sessID int
		var comicID, userID, startedAt string
		if err := rows3.Scan(&sessID, &comicID, &userID, &startedAt); err != nil {
			continue
		}
		id++
		issues = append(issues, DataQAIssue{
			ID:          fmt.Sprintf("SO-%d", id),
			IssueType:   "SESSION_ORPHAN",
			Severity:    "p2",
			EntityType:  "ReadingSession",
			EntityID:    fmt.Sprintf("%d", sessID),
			Message:     fmt.Sprintf("Session started at %s but never ended", startedAt),
			CurrentVal:  "NULL endedAt",
			ExpectedVal: "endedAt set",
			AutoFixable: true,
		})
	}

	// Issue 4: SESSION_ZERO_DURATION
	rows4, err := db.Query(`
		SELECT "id", "comicId", "userId", "duration"
		FROM "ReadingSession"
		WHERE "endedAt" IS NOT NULL AND "duration" <= 0
		LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("SESSION_ZERO_DURATION query failed: %w", err)
	}
	defer rows4.Close()
	for rows4.Next() {
		var sessID, duration int
		var comicID, userID string
		if err := rows4.Scan(&sessID, &comicID, &userID, &duration); err != nil {
			continue
		}
		id++
		issues = append(issues, DataQAIssue{
			ID:          fmt.Sprintf("SZD-%d", id),
			IssueType:   "SESSION_ZERO_DURATION",
			Severity:    "p3",
			EntityType:  "ReadingSession",
			EntityID:    fmt.Sprintf("%d", sessID),
			Message:     fmt.Sprintf("Session ended but duration is %d", duration),
			CurrentVal:  fmt.Sprintf("%d", duration),
			ExpectedVal: "> 0",
			AutoFixable: true,
		})
	}

	// Issue 5: TOTAL_TIME_ZERO
	// Comic.totalReadTime = 0 但存在 ReadingSession.duration > 0
	rows5, err := db.Query(`
		SELECT c."id", c."title", c."totalReadTime", COUNT(rs."id") AS sessionCount
		FROM "Comic" c
		INNER JOIN "ReadingSession" rs ON rs."comicId" = c."id" AND rs."duration" > 0
		WHERE c."totalReadTime" <= 0
		GROUP BY c."id"
		LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("TOTAL_TIME_ZERO query failed: %w", err)
	}
	defer rows5.Close()
	for rows5.Next() {
		var comicID, title string
		var totalTime, sessionCount int
		if err := rows5.Scan(&comicID, &title, &totalTime, &sessionCount); err != nil {
			continue
		}
		id++
		issues = append(issues, DataQAIssue{
			ID:          fmt.Sprintf("TTZ-%d", id),
			IssueType:   "TOTAL_TIME_ZERO",
			Severity:    "p2",
			EntityType:  "Comic",
			EntityID:    comicID,
			Title:       title,
			Message:     fmt.Sprintf("Comic totalReadTime is %d but has %d sessions with duration > 0", totalTime, sessionCount),
			CurrentVal:  fmt.Sprintf("%d", totalTime),
			ExpectedVal: fmt.Sprintf("> 0 (%d sessions)", sessionCount),
			AutoFixable: true,
		})
	}

	// Issue 6: UCS_TOTAL_TIME_ZERO
	rows6, err := db.Query(`
		SELECT ucs."userId", ucs."comicId", ucs."totalReadTime", COUNT(rs."id") AS sessionCount
		FROM "UserComicState" ucs
		INNER JOIN "ReadingSession" rs ON rs."userId" = ucs."userId" AND rs."comicId" = ucs."comicId" AND rs."duration" > 0
		WHERE ucs."totalReadTime" <= 0
		GROUP BY ucs."userId", ucs."comicId"
		LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("UCS_TOTAL_TIME_ZERO query failed: %w", err)
	}
	defer rows6.Close()
	for rows6.Next() {
		var userID, comicID string
		var totalTime, sessionCount int
		if err := rows6.Scan(&userID, &comicID, &totalTime, &sessionCount); err != nil {
			continue
		}
		id++
		issues = append(issues, DataQAIssue{
			ID:          fmt.Sprintf("UTZ-%d", id),
			IssueType:   "UCS_TOTAL_TIME_ZERO",
			Severity:    "p2",
			EntityType:  "UserComicState",
			EntityID:    fmt.Sprintf("%s/%s", userID, comicID),
			Message:     fmt.Sprintf("UserComicState totalReadTime is %d but has %d sessions with duration > 0", totalTime, sessionCount),
			CurrentVal:  fmt.Sprintf("%d", totalTime),
			ExpectedVal: fmt.Sprintf("> 0 (%d sessions)", sessionCount),
			AutoFixable: true,
		})
	}

	// Issue 7: ORPHAN_TAG
	rows7, err := db.Query(`
		SELECT ct."comicId", ct."tagId"
		FROM "ComicTag" ct
		LEFT JOIN "Comic" c ON c."id" = ct."comicId"
		LEFT JOIN "Tag" t ON t."id" = ct."tagId"
		WHERE c."id" IS NULL OR t."id" IS NULL
		LIMIT 200
	`)
	if err != nil {
		// foreign keys may prevent orphans; silently skip
		_ = sql.ErrNoRows
	} else {
		defer rows7.Close()
		for rows7.Next() {
			var comicID string
			var tagID int
			if err := rows7.Scan(&comicID, &tagID); err != nil {
				continue
			}
			id++
			issues = append(issues, DataQAIssue{
				ID:          fmt.Sprintf("OT-%d", id),
				IssueType:   "ORPHAN_TAG",
				Severity:    "p3",
				EntityType:  "ComicTag",
				EntityID:    fmt.Sprintf("%s/%d", comicID, tagID),
				Message:     fmt.Sprintf("ComicTag references comic=%s tag=%d but parent not found", comicID, tagID),
				AutoFixable: true,
			})
		}
	}

	// Issue 8: ORPHAN_CATEGORY
	rows8, err := db.Query(`
		SELECT cc."comicId", cc."categoryId"
		FROM "ComicCategory" cc
		LEFT JOIN "Comic" c ON c."id" = cc."comicId"
		LEFT JOIN "Category" cat ON cat."id" = cc."categoryId"
		WHERE c."id" IS NULL OR cat."id" IS NULL
		LIMIT 200
	`)
	if err != nil {
		_ = sql.ErrNoRows
	} else {
		defer rows8.Close()
		for rows8.Next() {
			var comicID string
			var catID int
			if err := rows8.Scan(&comicID, &catID); err != nil {
				continue
			}
			id++
			issues = append(issues, DataQAIssue{
				ID:          fmt.Sprintf("OC-%d", id),
				IssueType:   "ORPHAN_CATEGORY",
				Severity:    "p3",
				EntityType:  "ComicCategory",
				EntityID:    fmt.Sprintf("%s/%d", comicID, catID),
				Message:     fmt.Sprintf("ComicCategory references comic=%s category=%d but parent not found", comicID, catID),
				AutoFixable: true,
			})
		}
	}

	return issues, nil
}

// BuildSummary 从 issue 列表构建摘要。
func BuildSummary(issues []DataQAIssue) DataQASummary {
	summary := DataQASummary{
		ByType: make(map[string]int),
	}
	for _, iss := range issues {
		summary.TotalIssues++
		switch iss.Severity {
		case "p1":
			summary.P1++
		case "p2":
			summary.P2++
		case "p3":
			summary.P3++
		}
		if iss.AutoFixable {
			summary.AutoFixable++
		}
		summary.ByType[iss.IssueType]++
	}
	return summary
}
