package store

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestBulkCreateComicsWithSourceRequiresLibraryAssignment(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	items := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{{ID: "novel-1", Filename: "book.txt", Title: "book", FileSize: 12}}

	if err := BulkCreateComicsWithSource(items, map[string]string{"novel-1": "novels"}, map[string]string{}); err == nil {
		t.Fatal("missing library assignment was silently accepted")
	}

	var count int
	if err := DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "id" = 'novel-1'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("orphan comic was inserted: count=%d", count)
	}
}

func TestBulkCreateComicsWithSourceStoresRealLibrary(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	library := &model.Library{
		ID:            "novel-library",
		Name:          "Novels",
		Type:          "novel",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatal(err)
	}

	items := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{{ID: "novel-2", Filename: "folder/book.txt", Title: "book", FileSize: 24}}
	if err := BulkCreateComicsWithSource(
		items,
		map[string]string{"novel-2": "novels"},
		map[string]string{"novel-2": library.ID},
	); err != nil {
		t.Fatalf("BulkCreateComicsWithSource failed: %v", err)
	}

	var libraryID, contentType string
	if err := DB().QueryRow(`SELECT "libraryId", "type" FROM "Comic" WHERE "id" = 'novel-2'`).Scan(&libraryID, &contentType); err != nil {
		t.Fatal(err)
	}
	if libraryID != library.ID || contentType != "novel" {
		t.Fatalf("stored library/type = %q/%q, want %q/novel", libraryID, contentType, library.ID)
	}
}
