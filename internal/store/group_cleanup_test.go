package store

import "testing"

func TestCleanupEmptyGroupsPreservesSeriesMembership(t *testing.T) {
	setupTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO "Library" ("id", "name", "rootPath")
		VALUES ('cleanup-lib', 'Cleanup Library', '/tmp/cleanup')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "libraryId", "relativePath")
		VALUES
			('cleanup-direct', 'direct.cbz', 'Direct', 'cleanup-lib', 'direct.cbz'),
			('cleanup-series-item', 'series/item.cbz', 'Series Item', 'cleanup-lib', 'series/item.cbz'),
			('cleanup-unrelated', 'unrelated.cbz', 'Unrelated', 'cleanup-lib', 'unrelated.cbz')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title")
		VALUES ('cleanup-series', 'cleanup-lib', 'series', 'Series')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex")
		VALUES ('cleanup-series', 'cleanup-series-item', 0)
	`); err != nil {
		t.Fatal(err)
	}

	emptyGroupID, err := CreateGroup("Empty")
	if err != nil {
		t.Fatal(err)
	}
	directGroupID, err := CreateGroupWithItems("Direct", "", []string{"cleanup-direct"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	seriesGroupID, err := CreateGroupWithItems("Series", "", nil, []string{"cleanup-series"})
	if err != nil {
		t.Fatal(err)
	}
	mixedGroupID, err := CreateGroupWithItems(
		"Mixed",
		"",
		[]string{"cleanup-direct"},
		[]string{"cleanup-series"},
	)
	if err != nil {
		t.Fatal(err)
	}

	deleted, err := CleanupEmptyGroups()
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("CleanupEmptyGroups deleted %d groups, want 1", deleted)
	}

	assertGroupExists(t, int(emptyGroupID), false)
	assertGroupExists(t, int(directGroupID), true)
	assertGroupExists(t, int(seriesGroupID), true)
	assertGroupExists(t, int(mixedGroupID), true)

	if err := BulkDeleteComicsByIDs([]string{"cleanup-unrelated"}); err != nil {
		t.Fatal(err)
	}
	assertGroupExists(t, int(seriesGroupID), true)
}

func TestDetectGroupDirtyDataRecognizesSeriesMembership(t *testing.T) {
	setupTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO "Library" ("id", "name", "rootPath")
		VALUES ('dirty-series-lib', 'Dirty Series Library', '/tmp/dirty-series')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title")
		VALUES ('dirty-series', 'dirty-series-lib', 'series', 'Series')
	`); err != nil {
		t.Fatal(err)
	}
	groupID, err := CreateGroupWithItems("Series Only", "", nil, []string{"dirty-series"})
	if err != nil {
		t.Fatal(err)
	}

	issues, err := DetectGroupDirtyData()
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range issues {
		if issue.GroupID == int(groupID) && issue.Type == "empty_group" {
			t.Fatalf("series-only group was incorrectly reported as empty: %#v", issue)
		}
	}
}

func assertGroupExists(t *testing.T, groupID int, want bool) {
	t.Helper()

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "ComicGroup" WHERE "id" = ?`, groupID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if got := count == 1; got != want {
		t.Fatalf("group %d exists = %v, want %v", groupID, got, want)
	}
}
