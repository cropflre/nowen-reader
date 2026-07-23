package store

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestGetExpandedGroupedComicIDsIncludesDirectorySeries(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	library := &model.Library{
		ID:            "membership-library",
		Name:          "Membership",
		Type:          "comic",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}

	insertComic := func(id, filename, title string) {
		t.Helper()
		if _, err := DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, 'comic', ?, ?)
		`, id, filename, title, library.ID, filename); err != nil {
			t.Fatalf("insert comic %s: %v", id, err)
		}
	}
	insertComic("direct", "direct.cbz", "Direct")
	insertComic("series-1", "work/01.cbz", "Work 01")
	insertComic("series-2", "work/02.cbz", "Work 02")

	if _, err := DB().Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle", "coverComicId")
		VALUES ('series-a', ?, 'work', 'Work', 'Work', 'series-1')
	`, library.ID); err != nil {
		t.Fatalf("insert series: %v", err)
	}
	if _, err := DB().Exec(`
		INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex")
		VALUES ('series-a', 'series-1', 0), ('series-a', 'series-2', 1)
	`); err != nil {
		t.Fatalf("insert series items: %v", err)
	}

	groupID, err := CreateGroupWithItems(
		"Collection",
		"",
		[]string{"direct", "series-1"},
		[]string{"series-a"},
	)
	if err != nil {
		t.Fatalf("CreateGroupWithItems failed: %v", err)
	}

	membership, err := GetExpandedGroupedComicIDs()
	if err != nil {
		t.Fatalf("GetExpandedGroupedComicIDs failed: %v", err)
	}
	wantGroupID := int(groupID)
	for _, comicID := range []string{"direct", "series-1", "series-2"} {
		groupIDs := membership[comicID]
		if len(groupIDs) != 1 || groupIDs[0] != wantGroupID {
			t.Fatalf("membership[%q] = %#v, want [%d]", comicID, groupIDs, wantGroupID)
		}
	}
}
