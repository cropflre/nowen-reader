package store

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestGetAllComicsSortedByPageCountPaginatesAfterSorting(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	library := &model.Library{
		ID:            "pagecount-library",
		Name:          "Page Count",
		Type:          "comic",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}

	insert := func(id, title string, pages int) {
		t.Helper()
		if _, err := DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "pageCount", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, ?, ?, 'comic', ?, ?)
		`, id, id+".cbz", title, title, pages, library.ID, id+".cbz"); err != nil {
			t.Fatalf("insert comic %s: %v", id, err)
		}
	}
	insert("short", "Short", 10)
	insert("medium", "Medium", 50)
	insert("long", "Long", 100)

	first, err := GetAllComicsSortedByPageCount(ComicListOptions{
		LibraryIDs:  []string{library.ID},
		SortOrder:   "desc",
		Page:        1,
		PageSize:    2,
		ContentType: "comic",
	})
	if err != nil {
		t.Fatalf("page 1 failed: %v", err)
	}
	if first.Total != 3 || first.TotalPages != 2 || len(first.Comics) != 2 {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if first.Comics[0].ID != "long" || first.Comics[1].ID != "medium" {
		t.Fatalf("first page order = %q, %q", first.Comics[0].ID, first.Comics[1].ID)
	}

	second, err := GetAllComicsSortedByPageCount(ComicListOptions{
		LibraryIDs:  []string{library.ID},
		SortOrder:   "desc",
		Page:        2,
		PageSize:    2,
		ContentType: "comic",
	})
	if err != nil {
		t.Fatalf("page 2 failed: %v", err)
	}
	if len(second.Comics) != 1 || second.Comics[0].ID != "short" {
		t.Fatalf("unexpected second page: %#v", second.Comics)
	}
}
