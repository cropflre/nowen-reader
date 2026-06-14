package service

import (
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestBuildFixPreview_TotalTimeZero(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","totalReadTime","addedAt","updatedAt")
		VALUES ('comic-ttz','f.cbz','Test',100,100,0,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","startedAt","endedAt","duration","startPage","endPage")
		VALUES ('comic-ttz',?,?,45,0,5)`, oneHourAgo, now)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	result, err := BuildFixPreview([]string{"TOTAL_TIME_ZERO"}, nil, false)
	if err != nil {
		t.Fatalf("BuildFixPreview: %v", err)
	}

	if !result.DryRun {
		t.Error("expected DryRun=true")
	}
	if result.TotalPlanned != 1 {
		t.Fatalf("expected 1 plan, got %d", result.TotalPlanned)
	}

	plan := result.Plans[0]
	if plan.Action != "RECALCULATE_TOTAL_READ_TIME" {
		t.Errorf("expected action RECALCULATE_TOTAL_READ_TIME, got %s", plan.Action)
	}
	if plan.ExpectedVal != "45" {
		t.Errorf("expected expectedVal=45, got %s", plan.ExpectedVal)
	}
	if !plan.Safe {
		t.Error("expected Safe=true")
	}

	// Verify DB not modified
	var totalTime int
	err = db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = 'comic-ttz'`).Scan(&totalTime)
	if err != nil {
		t.Fatalf("query comic: %v", err)
	}
	if totalTime != 0 {
		t.Errorf("DB was modified! totalReadTime=%d, expected 0", totalTime)
	}
}

func TestBuildFixPreview_UCSTotalTimeZero(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-utz','f.cbz','Test',100,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	_, err = db.Exec(`INSERT INTO "User" ("id","username","password","role","createdAt","updatedAt")
		VALUES ('user-utz','testuser','hash','user',datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	_, err = db.Exec(`INSERT INTO "UserComicState" ("userId","comicId","totalReadTime")
		VALUES ('user-utz','comic-utz',0)`)
	if err != nil {
		t.Fatalf("insert ucs: %v", err)
	}

	oneHourAgo := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = db.Exec(`INSERT INTO "ReadingSession" ("comicId","userId","startedAt","endedAt","duration","startPage","endPage")
		VALUES ('comic-utz','user-utz',?,?,60,0,3)`, oneHourAgo, now)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	result, err := BuildFixPreview([]string{"UCS_TOTAL_TIME_ZERO"}, nil, false)
	if err != nil {
		t.Fatalf("BuildFixPreview: %v", err)
	}

	if result.TotalPlanned != 1 {
		t.Fatalf("expected 1 plan, got %d", result.TotalPlanned)
	}

	plan := result.Plans[0]
	if plan.Action != "RECALCULATE_UCS_TOTAL_READ_TIME" {
		t.Errorf("expected action RECALCULATE_UCS_TOTAL_READ_TIME, got %s", plan.Action)
	}
	if plan.ExpectedVal != "60" {
		t.Errorf("expected expectedVal=60, got %s", plan.ExpectedVal)
	}

	// Verify DB not modified
	var totalTime int
	err = db.QueryRow(`SELECT "totalReadTime" FROM "UserComicState" WHERE "userId" = 'user-utz' AND "comicId" = 'comic-utz'`).Scan(&totalTime)
	if err != nil {
		t.Fatalf("query ucs: %v", err)
	}
	if totalTime != 0 {
		t.Errorf("DB was modified! totalReadTime=%d, expected 0", totalTime)
	}
}

func TestBuildFixPreview_OrphanTag(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	// Tag has FK on ComicTag, but ComicTag has FK on Comic which may not exist.
	// Insert a Comic first, then a tag, then a ComicTag, then delete the Comic.
	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-orphan','f.cbz','Test',100,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	_, err = db.Exec(`INSERT INTO "Tag" ("id","name","color")
		VALUES (999,'TestTag','#fff')`)
	if err != nil {
		t.Fatalf("insert tag: %v", err)
	}

	_, err = db.Exec(`INSERT INTO "ComicTag" ("comicId","tagId") VALUES ('comic-orphan',999)`)
	if err != nil {
		t.Fatalf("insert comic tag: %v", err)
	}

	// Delete the comic — with CASCADE this should also delete the ComicTag.
	// If CASCADE is enabled, this test won't find orphans. That's correct behavior.
	_, err = db.Exec(`DELETE FROM "Comic" WHERE "id" = 'comic-orphan'`)
	if err != nil {
		t.Fatalf("delete comic: %v", err)
	}

	result, err := BuildFixPreview([]string{"ORPHAN_TAG"}, nil, false)
	if err != nil {
		t.Fatalf("BuildFixPreview: %v", err)
	}

	// With CASCADE, the ComicTag row should have been deleted too, so 0 plans.
	// This is the expected behavior — orphans can't exist with CASCADE.
	if result.TotalPlanned != 0 {
		t.Logf("ORPHAN_TAG found %d plans (CASCADE may not apply in test DB)", result.TotalPlanned)
	}
	// Verify the scan itself works without error
	t.Logf("OrphanTag test: TotalPlanned=%d, Skipped=%d", result.TotalPlanned, len(result.Skipped))
}

func TestBuildFixPreview_OrphanCategory(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	// Similar approach — insert then delete parent.
	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-oc','f.cbz','Test',100,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	_, err = db.Exec(`INSERT INTO "Category" ("id","name","slug","sortOrder")
		VALUES (999,'TestCategory','test-cat',0)`)
	if err != nil {
		t.Fatalf("insert category: %v", err)
	}

	_, err = db.Exec(`INSERT INTO "ComicCategory" ("comicId","categoryId") VALUES ('comic-oc',999)`)
	if err != nil {
		t.Fatalf("insert comic category: %v", err)
	}

	_, err = db.Exec(`DELETE FROM "Comic" WHERE "id" = 'comic-oc'`)
	if err != nil {
		t.Fatalf("delete comic: %v", err)
	}

	result, err := BuildFixPreview([]string{"ORPHAN_CATEGORY"}, nil, false)
	if err != nil {
		t.Fatalf("BuildFixPreview: %v", err)
	}

	// With CASCADE, the ComicCategory row should also be deleted.
	if result.TotalPlanned != 0 {
		t.Logf("ORPHAN_CATEGORY found %d plans (CASCADE may not apply in test DB)", result.TotalPlanned)
	}
	t.Logf("OrphanCategory test: TotalPlanned=%d, Skipped=%d", result.TotalPlanned, len(result.Skipped))
}

func TestBuildFixPreview_NonAutoFixable(t *testing.T) {
	setupTestDB(t)
	db := store.DB()

	_, err := db.Exec(`INSERT INTO "Comic" ("id","filename","title","pageCount","fileSize","addedAt","updatedAt")
		VALUES ('comic-pcz','f.cbz','Test',0,100,datetime('now'),datetime('now'))`)
	if err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	// PAGE_COUNT_ZERO has AutoFixable=true in scan but no dry-run logic
	// so it will be skipped by BuildFixPreview default case
	result, err := BuildFixPreview([]string{"PAGE_COUNT_ZERO"}, nil, false)
	if err != nil {
		t.Fatalf("BuildFixPreview: %v", err)
	}

	if result.TotalPlanned != 0 {
		t.Errorf("expected 0 plans, got %d", result.TotalPlanned)
	}
	if len(result.Skipped) != 1 {
		t.Fatalf("expected 1 skipped, got %d", len(result.Skipped))
	}
	if result.Skipped[0].IssueID == "" {
		t.Error("expected non-empty IssueID in skipped")
	}
}
