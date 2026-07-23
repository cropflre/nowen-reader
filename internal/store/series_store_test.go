package store

import (
	"os"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestReplaceDetectedSeriesAndCollapseShelf(t *testing.T) {
	originalBasePath := os.Getenv("BASE_PATH")
	t.Cleanup(func() { _ = os.Setenv("BASE_PATH", originalBasePath) })
	if err := os.Setenv("BASE_PATH", "/reader"); err != nil {
		t.Fatal(err)
	}

	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	library := &model.Library{
		ID:            "series-library",
		Name:          "Comic Library",
		Type:          "comic",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}

	insert := func(id, relativePath, title string) {
		t.Helper()
		if _, err := DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, 20, 1024, 'comic', ?, ?)
		`, id, relativePath, title, library.ID, relativePath); err != nil {
			t.Fatalf("insert comic %s: %v", id, err)
		}
	}
	insert("volume-1", "作品/作品 01.pdf", "作品 01")
	insert("volume-2", "作品/作品 02.pdf", "作品 02")
	insert("standalone", "单本.pdf", "单本")

	detected := []DetectedSeries{{
		ID:               "ser-test",
		LibraryID:        library.ID,
		RootRelativePath: "作品",
		Title:            "作品",
		SortTitle:        "作品",
		CoverComicID:     "volume-1",
		Items: []DetectedSeriesItem{
			{ComicID: "volume-1", SortIndex: 0, DisplayLabel: "01"},
			{ComicID: "volume-2", SortIndex: 1, DisplayLabel: "02"},
		},
	}}
	if err := ReplaceDetectedSeries(library.ID, detected); err != nil {
		t.Fatalf("ReplaceDetectedSeries failed: %v", err)
	}

	flat, err := GetAllComics(ComicListOptions{LibraryIDs: []string{library.ID}})
	if err != nil {
		t.Fatalf("GetAllComics failed: %v", err)
	}
	collapsed, err := CollapseComicListIntoSeries(flat.Comics, "")
	if err != nil {
		t.Fatalf("CollapseComicListIntoSeries failed: %v", err)
	}
	if len(collapsed) != 2 {
		t.Fatalf("collapsed count = %d, want series + standalone", len(collapsed))
	}
	foundSeries, foundStandalone := false, false
	for _, item := range collapsed {
		switch item.ID {
		case SeriesShelfIDPrefix + "ser-test":
			foundSeries = item.PageCount == 2 && item.Title == "作品"
		case "standalone":
			foundStandalone = true
		}
	}
	if !foundSeries || !foundStandalone {
		t.Fatalf("unexpected collapsed shelf: %#v", collapsed)
	}

	seen := make(map[string]bool)
	for page := 1; page <= 2; page++ {
		mixed, err := GetAllComics(ComicListOptions{
			LibraryIDs: []string{library.ID},
			SeriesView: true,
			SortBy:     "title",
			SortOrder:  "asc",
			Page:       page,
			PageSize:   1,
		})
		if err != nil {
			t.Fatalf("GetAllComics series view page %d failed: %v", page, err)
		}
		if mixed.Total != 2 || mixed.TotalPages != 2 || len(mixed.Comics) != 1 {
			t.Fatalf("series view page %d = %#v", page, mixed)
		}
		seen[mixed.Comics[0].ID] = true
	}
	if !seen[SeriesShelfIDPrefix+"ser-test"] || !seen["standalone"] || seen["volume-1"] || seen["volume-2"] {
		t.Fatalf("series view ids = %#v", seen)
	}

	detail, err := GetSeriesDetail("ser-test", "")
	if err != nil {
		t.Fatalf("GetSeriesDetail failed: %v", err)
	}
	if detail == nil || len(detail.Unsectioned) != 2 || detail.Series.ItemCount != 2 {
		t.Fatalf("unexpected series detail: %#v", detail)
	}
	if detail.Series.CoverURL != "/reader/api/comics/volume-1/thumbnail" {
		t.Fatalf("series cover URL = %q, want Base Path prefixed URL", detail.Series.CoverURL)
	}
}

func TestSetSeriesItemStructureRejectsForeignSection(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	library := &model.Library{ID: "structure-library", Name: "Structure", Type: "comic", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public", ScanEnabled: true}
	if err := CreateLibrary(library); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec(`INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES ('item', 'work/01.pdf', '01', 'comic', ?, 'work/01.pdf')`, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec(`INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle") VALUES ('series-a', ?, 'work', 'work', 'work'), ('series-b', ?, 'other', 'other', 'other')`, library.ID, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec(`INSERT INTO "ComicSeriesSection" ("id", "seriesId", "title", "relativePath") VALUES ('foreign-section', 'series-b', '第一季', 'other/第一季')`); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec(`INSERT INTO "ComicSeriesItem" ("seriesId", "comicId") VALUES ('series-a', 'item')`); err != nil {
		t.Fatal(err)
	}

	if err := SetSeriesItemStructure("series-a", "item", "foreign-section", 0); err == nil {
		t.Fatal("foreign section assignment succeeded, want rejection")
	}
}
