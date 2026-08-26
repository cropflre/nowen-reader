package store

import (
	"fmt"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestLogicalShelfSQLPagesLargeMixedLibrary(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	novelLib := &model.Library{ID: "novels", Name: "Novels", Type: "novel", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public", ScanEnabled: true}
	comicLib := &model.Library{ID: "comics", Name: "Comics", Type: "comic", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public", ScanEnabled: true}
	if err := CreateLibrary(novelLib); err != nil {
		t.Fatal(err)
	}
	if err := CreateLibrary(comicLib); err != nil {
		t.Fatal(err)
	}

	tx, err := DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	stmt, err := tx.Prepare(`INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "fileSize", "type", "libraryId", "relativePath") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < largeShelfMaterializeLimit+501; i++ {
		id := fmt.Sprintf("novel-%05d", i)
		title := fmt.Sprintf("Novel %05d", i)
		if _, err := stmt.Exec(id, id+".txt", title, BuildTitleSortKey(title), 10, "novel", novelLib.ID, id+".txt"); err != nil {
			stmt.Close()
			tx.Rollback()
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		id := fmt.Sprintf("comic-%d", i)
		title := fmt.Sprintf("Series Book %d", i+1)
		if _, err := stmt.Exec(id, id+".cbz", title, BuildTitleSortKey(title), 20, "comic", comicLib.ID, "Series/"+id+".cbz"); err != nil {
			stmt.Close()
			tx.Rollback()
			t.Fatal(err)
		}
	}
	stmt.Close()
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	if err := ReplaceDetectedSeries(comicLib.ID, []DetectedSeries{{
		ID:               "ser-test",
		LibraryID:        comicLib.ID,
		RootRelativePath: "Series",
		Title:            "Series",
		CoverComicID:     "comic-0",
		Items: []DetectedSeriesItem{
			{ComicID: "comic-0", SortIndex: 0, DisplayLabel: "1"},
			{ComicID: "comic-1", SortIndex: 1, DisplayLabel: "2"},
		},
	}}); err != nil {
		t.Fatal(err)
	}

	result, err := GetAllComicsShelfSafe(ComicListOptions{
		SeriesView: true,
		SortBy:     "title",
		SortOrder:  "asc",
		Page:       1,
		PageSize:   24,
	})
	if err != nil {
		t.Fatalf("GetAllComicsShelfSafe failed: %v", err)
	}
	wantTotal := largeShelfMaterializeLimit + 501 + 1 // two comic members collapse to one Series
	if result.Total != wantTotal {
		t.Fatalf("total=%d, want %d", result.Total, wantTotal)
	}
	if len(result.Comics) != 24 {
		t.Fatalf("page items=%d, want 24", len(result.Comics))
	}
	if result.PageSize != 24 {
		t.Fatalf("pageSize=%d, want 24", result.PageSize)
	}
}

func TestLogicalShelfSQLCapsUnboundedLargePage(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	lib := &model.Library{ID: "comic-lib", Name: "Comics", Type: "comic", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public", ScanEnabled: true}
	if err := CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}

	tx, err := DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	stmt, err := tx.Prepare(`INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "fileSize", "type", "libraryId", "relativePath") VALUES (?, ?, ?, ?, 1, 'comic', ?, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 700; i++ {
		id := fmt.Sprintf("c-%04d", i)
		title := fmt.Sprintf("Book %04d", i)
		if _, err := stmt.Exec(id, id+".cbz", title, BuildTitleSortKey(title), lib.ID, id+".cbz"); err != nil {
			stmt.Close()
			tx.Rollback()
			t.Fatal(err)
		}
	}
	// Make SeriesView participate so the SQL logical path is exercised.
	for i := 0; i < 2; i++ {
		id := fmt.Sprintf("series-member-%d", i)
		title := fmt.Sprintf("ZZ Series %d", i)
		if _, err := stmt.Exec(id, id+".cbz", title, BuildTitleSortKey(title), lib.ID, "ZZ/"+id+".cbz"); err != nil {
			stmt.Close()
			tx.Rollback()
			t.Fatal(err)
		}
	}
	stmt.Close()
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := ReplaceDetectedSeries(lib.ID, []DetectedSeries{{
		ID: "ser-cap", LibraryID: lib.ID, RootRelativePath: "ZZ", Title: "ZZ", CoverComicID: "series-member-0",
		Items: []DetectedSeriesItem{{ComicID: "series-member-0"}, {ComicID: "series-member-1", SortIndex: 1}},
	}}); err != nil {
		t.Fatal(err)
	}

	result, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, SortBy: "title", Page: 1, PageSize: 5000})
	if err != nil {
		t.Fatal(err)
	}
	if result.PageSize != largeShelfMaxPageSize {
		t.Fatalf("pageSize=%d, want cap=%d", result.PageSize, largeShelfMaxPageSize)
	}
	if len(result.Comics) != largeShelfMaxPageSize {
		t.Fatalf("items=%d, want %d", len(result.Comics), largeShelfMaxPageSize)
	}
}
