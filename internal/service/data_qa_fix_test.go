package service

import (
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestExecuteFix_TotalTimeZero(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","totalReadTime","addedAt","updatedAt")
		VALUES ('comic-fix-ttz','f.cbz','Test',100,100,0,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","startedAt","endedAt","duration","startPage","endPage")
		VALUES ('comic-fix-ttz',?,?,45,0,5)`, oneHourAgo, now)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	result, err := ExecuteFix([]string{"TOTAL_TIME_ZERO"}, nil, false)
	if err != nil {
		t.Fatalf("ExecuteFix: %v", err)
	}

	if result.DryRun {
		t.Error("expected DryRun=false")
	}
	if result.TotalExecuted != 1 {
		t.Fatalf("expected 1 executed, got %d", result.TotalExecuted)
	}

	exec := result.Executed[0]
	if exec.Action != "RECALCULATE_TOTAL_READ_TIME" {
		t.Errorf("expected action RECALCULATE_TOTAL_READ_TIME, got %s", exec.Action)
	}
	if exec.After != "45" {
		t.Errorf("expected after=45, got %s", exec.After)
	}
	if !exec.Success {
		t.Error("expected Success=true")
	}

	// Verify DB was updated
	var totalTime int
	err = db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = 'comic-fix-ttz'`).Scan(&totalTime)
	if err != nil {
		t.Fatalf("query comic: %v", err)
	}
	if totalTime != 45 {
		t.Errorf("expected totalReadTime=45, got %d", totalTime)
	}
}

func TestExecuteFix_TotalTimeZero_Idempotent(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","totalReadTime","addedAt","updatedAt")
		VALUES ('comic-idem','f.cbz','Test',100,100,45,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","startedAt","endedAt","duration","startPage","endPage")
		VALUES ('comic-idem',?,?,45,0,5)`, oneHourAgo, now)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	// totalReadTime is already 45 (> 0), so ScanDataIssues won't find it as TOTAL_TIME_ZERO.
	// ExecuteFix should find 0 issues and execute 0 fixes.
	result, err := ExecuteFix([]string{"TOTAL_TIME_ZERO"}, nil, false)
	if err != nil {
		t.Fatalf("ExecuteFix: %v", err)
	}
	if result.TotalExecuted != 0 {
		t.Errorf("expected 0 executed (already fixed), got %d", result.TotalExecuted)
	}
}

func TestExecuteFix_UCSTotalTimeZero(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-fix-utz','f.cbz','Test',100,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}
	_, err = db.Exec(`INSERT INTO "User" ("id","username","password","role","createdAt","updatedAt")
		VALUES ('user-fix-utz','testuser','hash','user',datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	_, err = db.Exec(`INSERT INTO "UserComicState" ("userId","comicId","totalReadTime")
		VALUES ('user-fix-utz','comic-fix-utz',0)`)
	if err != nil {
		t.Fatalf("insert ucs: %v", err)
	}

	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","userId","startedAt","endedAt","duration","startPage","endPage")
		VALUES ('comic-fix-utz','user-fix-utz',?,?,60,0,3)`, oneHourAgo, now)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	result, err := ExecuteFix([]string{"UCS_TOTAL_TIME_ZERO"}, nil, false)
	if err != nil {
		t.Fatalf("ExecuteFix: %v", err)
	}

	if result.TotalExecuted != 1 {
		t.Fatalf("expected 1 executed, got %d", result.TotalExecuted)
	}
	if result.Executed[0].After != "60" {
		t.Errorf("expected after=60, got %s", result.Executed[0].After)
	}

	// Verify DB
	var totalTime int
	err = db.QueryRow(`SELECT "totalReadTime" FROM "UserComicState" WHERE "userId" = 'user-fix-utz' AND "comicId" = 'comic-fix-utz'`).Scan(&totalTime)
	if err != nil {
		t.Fatalf("query ucs: %v", err)
	}
	if totalTime != 60 {
		t.Errorf("expected totalReadTime=60, got %d", totalTime)
	}
}

func TestExecuteFix_NonAutoFixable(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-fix-pcz','f.cbz','Test',0,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	// PAGE_COUNT_ZERO has AutoFixable=true in scan, but no fix logic in ExecuteFix
	// So it will hit the default case → skipped.
	result, err := ExecuteFix([]string{"PAGE_COUNT_ZERO"}, nil, false)
	if err != nil {
		t.Fatalf("ExecuteFix: %v", err)
	}

	if result.TotalExecuted != 0 {
		t.Errorf("expected 0 executed, got %d", result.TotalExecuted)
	}
	if len(result.Skipped) != 1 {
		t.Fatalf("expected 1 skipped, got %d", len(result.Skipped))
	}
}

func TestExecuteFix_OrphanSession(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-os','f.cbz','Test',100,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	twoHoursAgo := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","startedAt","duration","startPage","endPage")
		VALUES ('comic-os',?,?,0,0)`, twoHoursAgo, 0)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	result, err := ExecuteFix([]string{"SESSION_ORPHAN"}, nil, false)
	if err != nil {
		t.Fatalf("ExecuteFix: %v", err)
	}

	if result.TotalExecuted != 1 {
		t.Fatalf("expected 1 executed, got %d", result.TotalExecuted)
	}

	exec := result.Executed[0]
	if exec.Action != "CLOSE_ORPHAN_SESSION" {
		t.Errorf("expected action CLOSE_ORPHAN_SESSION, got %s", exec.Action)
	}

	// Verify: session now has endedAt and duration=0
	var duration int
	var endedAt string
	err = db.QueryRow(`SELECT "endedAt", "duration" FROM "ReadingSession" WHERE "comicId" = 'comic-os'`).Scan(&endedAt, &duration)
	if err != nil {
		t.Fatalf("query session: %v", err)
	}
	if endedAt == "" {
		t.Error("expected endedAt to be set")
	}
	if duration != 0 {
		t.Errorf("expected duration=0, got %d", duration)
	}

	// Verify: Comic.totalReadTime NOT changed (should still be 0)
	var totalTime int
	err = db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = 'comic-os'`).Scan(&totalTime)
	if err != nil {
		t.Fatalf("query comic: %v", err)
	}
	if totalTime != 0 {
		t.Errorf("totalReadTime should be 0 (no accumulation), got %d", totalTime)
	}
}

func TestExecuteFix_OrphanSession_Idempotent(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-osi','f.cbz','Test',100,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	// Already ended session (not orphan)
	twoHoursAgo := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","startedAt","endedAt","duration","startPage","endPage")
		VALUES ('comic-osi',?,?,30,0,5)`, twoHoursAgo, oneHourAgo)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	// This session has endedAt, so it won't be found as SESSION_ORPHAN
	result, err := ExecuteFix([]string{"SESSION_ORPHAN"}, nil, false)
	if err != nil {
		t.Fatalf("ExecuteFix: %v", err)
	}
	if result.TotalExecuted != 0 {
		t.Errorf("expected 0 executed (session already ended), got %d", result.TotalExecuted)
	}
}

func TestExecuteFix_ZeroDurationSession(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-zds','f.cbz','Test',100,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	fiftyMinAgo := time.Now().UTC().Add(-50 * time.Minute).Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","startedAt","endedAt","duration","startPage","endPage")
		VALUES ('comic-zds',?,?,0,0,5)`, oneHourAgo, fiftyMinAgo)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	result, err := ExecuteFix([]string{"SESSION_ZERO_DURATION"}, nil, false)
	if err != nil {
		t.Fatalf("ExecuteFix: %v", err)
	}

	if result.TotalExecuted != 1 {
		t.Fatalf("expected 1 executed, got %d", result.TotalExecuted)
	}

	exec := result.Executed[0]
	if exec.Action != "RECALCULATE_ZERO_DURATION_SESSION" {
		t.Errorf("expected action RECALCULATE_ZERO_DURATION_SESSION, got %s", exec.Action)
	}

	// Verify: duration should now be ~600 seconds (10 min)
	var duration int
	err = db.QueryRow(`SELECT "duration" FROM "ReadingSession" WHERE "comicId" = 'comic-zds'`).Scan(&duration)
	if err != nil {
		t.Fatalf("query session: %v", err)
	}
	if duration < 500 || duration > 700 {
		t.Errorf("expected duration around 600 (10 min), got %d", duration)
	}

	// Verify: Comic.totalReadTime was recalculated via SUM
	var totalTime int
	err = db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = 'comic-zds'`).Scan(&totalTime)
	if err != nil {
		t.Fatalf("query comic: %v", err)
	}
	if totalTime != duration {
		t.Errorf("expected totalReadTime=%d, got %d", duration, totalTime)
	}
}
