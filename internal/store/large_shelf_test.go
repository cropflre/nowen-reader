package store

import (
	"fmt"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestGetAllComicsShelfSafePaginatesNovelLibrary(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	library := &model.Library{
		ID:            "large-novel-library",
		Name:          "Large Novels",
		Type:          "novel",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatal(err)
	}

	tx, err := DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	stmt, err := tx.Prepare(`INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES (?, ?, ?, 'novel', ?, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 1205; i++ {
		id := fmt.Sprintf("novel-%04d", i)
		filename := fmt.Sprintf("book-%04d.txt", i)
		if _, err := stmt.Exec(id, filename, filename, library.ID, filename); err != nil {
			stmt.Close()
			tx.Rollback()
			t.Fatal(err)
		}
	}
	stmt.Close()
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	result, err := GetAllComicsShelfSafe(ComicListOptions{
		FilterLibraryIDs: true,
		LibraryIDs:       []string{library.ID},
		SeriesView:       true,
		SortBy:           "title",
		SortOrder:        "asc",
		Page:             2,
		PageSize:         24,
	})
	if err != nil {
		t.Fatalf("GetAllComicsShelfSafe failed: %v", err)
	}
	if result.Total != 1205 || result.TotalPages != 51 || len(result.Comics) != 24 {
		t.Fatalf("unexpected pagination: total=%d pages=%d len=%d", result.Total, result.TotalPages, len(result.Comics))
	}
	if result.Page != 2 {
		t.Fatalf("page=%d, want 2", result.Page)
	}
}

func TestGetAllComicsShelfSafeBatchesSeriesMemberships(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	library := &model.Library{
		ID:            "large-comic-library",
		Name:          "Large Comics",
		Type:          "comic",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatal(err)
	}

	tx, err := DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	stmt, err := tx.Prepare(`INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES (?, ?, ?, 'comic', ?, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < seriesMembershipBatchSize*2+25; i++ {
		id := fmt.Sprintf("comic-%04d", i)
		filename := fmt.Sprintf("work-%04d.cbz", i)
		if _, err := stmt.Exec(id, filename, filename, library.ID, filename); err != nil {
			stmt.Close()
			tx.Rollback()
			t.Fatal(err)
		}
	}
	stmt.Close()
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	detected := []DetectedSeries{{
		ID:               "large-series",
		LibraryID:        library.ID,
		RootRelativePath: "series",
		Title:            "Series",
		SortTitle:        "Series",
		CoverComicID:     "comic-0000",
		Items: []DetectedSeriesItem{
			{ComicID: "comic-0000", SortIndex: 0},
			{ComicID: fmt.Sprintf("comic-%04d", seriesMembershipBatchSize+1), SortIndex: 1},
		},
	}}
	if err := ReplaceDetectedSeries(library.ID, detected); err != nil {
		t.Fatal(err)
	}

	result, err := GetAllComicsShelfSafe(ComicListOptions{
		FilterLibraryIDs: true,
		LibraryIDs:       []string{library.ID},
		SeriesView:       true,
		SortBy:           "title",
		SortOrder:        "asc",
		Page:             1,
		PageSize:         48,
	})
	if err != nil {
		t.Fatalf("GetAllComicsShelfSafe failed: %v", err)
	}
	wantTotal := seriesMembershipBatchSize*2 + 24
	if result.Total != wantTotal {
		t.Fatalf("total=%d, want %d", result.Total, wantTotal)
	}

	seriesCount := 0
	for _, item := range result.Comics {
		if item.ID == SeriesShelfIDPrefix+"large-series" {
			seriesCount++
		}
	}
	if seriesCount > 1 {
		t.Fatalf("series appears %d times on one page", seriesCount)
	}
}
