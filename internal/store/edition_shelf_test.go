package store

import (
	"fmt"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func seedEditionBook(t testing.TB, id, libraryID, relPath, title, comicType, author string, fileSize int64) {
	t.Helper()
	sourceDir := "comics"
	if comicType == "novel" {
		sourceDir = "novels"
	}
	err := BulkCreateComicsWithSource([]struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{ID: id, Filename: relPath, Title: title, FileSize: fileSize},
	}, map[string]string{
		id: sourceDir,
	}, map[string]string{
		id: libraryID,
	})
	if err != nil {
		t.Fatalf("seedEditionBook(%s): %v", id, err)
	}
	if author != "" {
		if _, err := db.Exec(`UPDATE "Comic" SET "author" = ? WHERE "id" = ?`, author, id); err != nil {
			t.Fatalf("set author(%s): %v", id, err)
		}
	}
}

func TestEditionMergeScopes_DirectoryLibraryGlobal(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	for _, lib := range []model.Library{
		{ID: "lib-n1", Name: "Novel 1", Type: "novel", EditionMergeScope: "directory", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"},
		{ID: "lib-n2", Name: "Novel 2", Type: "novel", EditionMergeScope: "directory", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"},
		{ID: "lib-c1", Name: "Comic 1", Type: "comic", EditionMergeScope: "global", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"},
	} {
		if err := CreateLibrary(&lib); err != nil {
			t.Fatal(err)
		}
	}

	// Lib 1: two formats in dirA, one in dirB
	seedEditionBook(t, "n1-epub", "lib-n1", "SciFi/三体.epub", "三体", "novel", "刘慈欣", 2000)
	seedEditionBook(t, "n1-mobi", "lib-n1", "SciFi/三体.mobi", "三体", "novel", "刘慈欣", 1500)
	seedEditionBook(t, "n1-azw3", "lib-n1", "Backup/三体.azw3", "三体", "novel", "刘慈欣", 1800)
	// Lib 2: another format of 三体
	seedEditionBook(t, "n2-txt", "lib-n2", "三体.txt", "三体", "novel", "刘慈欣", 900)
	// Comic lib: same title "三体" but type='comic' (must never merge with novels even in global)
	seedEditionBook(t, "c1-cbz", "lib-c1", "三体.cbz", "三体", "comic", "刘慈欣", 50000)

	// 1. Directory scope (default): dirA merges (2->1), dirB separate, lib2 separate => 3 novels total
	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatalf("RebuildBookEditionGroups(directory): %v", err)
	}
	res, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, ContentType: "novel", PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 3 {
		t.Fatalf("directory scope shelf total = %d, want 3 (comics=%v)", res.Total, res.Comics)
	}
	counts, err := GetAllLibraryCounts()
	if err != nil {
		t.Fatal(err)
	}
	if counts["lib-n1"].ComicCount != 3 || counts["lib-n1"].ShelfCount != 2 {
		t.Fatalf("lib-n1 counts (directory) = %+v, want physical=3 shelf=2", counts["lib-n1"])
	}

	setMergeScope := func(libID, scope string) {
		t.Helper()
		lib, gErr := GetLibraryByID(libID)
		if gErr != nil || lib == nil {
			t.Fatalf("GetLibraryByID(%s): %v", libID, gErr)
		}
		lib.EditionMergeScope = scope
		if uErr := UpdateLibrary(lib); uErr != nil {
			t.Fatalf("UpdateLibrary(%s, %s): %v", libID, scope, uErr)
		}
	}

	// 2. Switch lib-n1 to library scope: dirA + dirB in lib-n1 merge into 1 (3 editions), lib-n2 stays separate => 2 novels on shelf
	setMergeScope("lib-n1", "library")
	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatalf("RebuildBookEditionGroups(library): %v", err)
	}
	res, err = GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, ContentType: "novel", PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 2 {
		t.Fatalf("library scope shelf total = %d, want 2", res.Total)
	}
	counts, err = GetAllLibraryCounts()
	if err != nil {
		t.Fatal(err)
	}
	if counts["lib-n1"].ShelfCount != 1 {
		t.Fatalf("lib-n1 shelf count (library) = %d, want 1", counts["lib-n1"].ShelfCount)
	}

	// 3. Switch both lib-n1 and lib-n2 to global scope: all 4 novels merge into 1 card across libraries
	setMergeScope("lib-n1", "global")
	setMergeScope("lib-n2", "global")
	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatalf("RebuildBookEditionGroups(global): %v", err)
	}
	res, err = GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	// Expect 2 shelf entries total: 1 merged novel ("三体" EPUB+AZW3+MOBI+TXT) + 1 comic ("三体" CBZ)
	if res.Total != 2 {
		t.Fatalf("global scope mixed shelf total = %d, want 2 (1 novel + 1 comic)", res.Total)
	}
	var novelItem *ComicListItem
	for i := range res.Comics {
		if res.Comics[i].ComicType == "novel" {
			novelItem = &res.Comics[i]
		}
	}
	if novelItem == nil || novelItem.EditionCount != 4 || len(novelItem.Formats) != 4 {
		t.Fatalf("expected 4 merged novel editions, got %+v", novelItem)
	}
}

func TestEditionCrossLibraryPermissionIsolation(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	createTestUser(t, "u-only-a", "onlya", "user")
	createTestUser(t, "u-both", "both", "user")
	if err := CreateLibrary(&model.Library{ID: "lib-a", Name: "A", Type: "novel", EditionMergeScope: "global", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "private"}); err != nil {
		t.Fatal(err)
	}
	if err := CreateLibrary(&model.Library{ID: "lib-b", Name: "B", Type: "novel", EditionMergeScope: "global", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "private"}); err != nil {
		t.Fatal(err)
	}
	_ = SetUserLibraryAccess("u-only-a", []LibraryAccessReq{{LibraryID: "lib-a", CanView: true}})
	_ = SetUserLibraryAccess("u-both", []LibraryAccessReq{{LibraryID: "lib-a", CanView: true}, {LibraryID: "lib-b", CanView: true}})

	seedEditionBook(t, "a-epub", "lib-a", "三体.epub", "三体", "novel", "刘慈欣", 2000)
	seedEditionBook(t, "a-mobi", "lib-a", "三体.mobi", "三体", "novel", "刘慈欣", 1500)
	seedEditionBook(t, "b-azw3", "lib-b", "三体.azw3", "三体", "novel", "刘慈欣", 1800)

	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatal(err)
	}

	// User A only accesses lib-a -> must see only 2 editions, never lib-b's AZW3
	resA, err := GetAllComicsShelfSafe(ComicListOptions{
		SeriesView: true, UserID: "u-only-a", FilterLibraryIDs: true, LibraryIDs: []string{"lib-a"}, PageSize: 24,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resA.Total != 1 || resA.Comics[0].EditionCount != 2 || len(resA.Comics[0].Formats) != 2 {
		t.Fatalf("User A saw %+v, want EditionCount=2 Formats=[EPUB MOBI]", resA.Comics)
	}
	_, fmtsA, _, rowsA, err := GetComicEditionsForUser("a-epub", "u-only-a", []string{"lib-a"}, true)
	if err != nil || len(rowsA) != 2 || len(fmtsA) != 2 {
		t.Fatalf("User A detail editions leaked or incomplete: fmts=%v rows=%d err=%v", fmtsA, len(rowsA), err)
	}

	// User B accesses both -> sees all 3 editions
	resB, err := GetAllComicsShelfSafe(ComicListOptions{
		SeriesView: true, UserID: "u-both", FilterLibraryIDs: true, LibraryIDs: []string{"lib-a", "lib-b"}, PageSize: 24,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resB.Total != 1 || resB.Comics[0].EditionCount != 3 || len(resB.Comics[0].Formats) != 3 {
		t.Fatalf("User B saw %+v, want EditionCount=3 Formats=3", resB.Comics)
	}
}

func TestEditionPreferredByRecentReading(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	createTestUser(t, "reader-1", "reader1", "user")
	if err := CreateLibrary(&model.Library{ID: "lib-r", Name: "R", Type: "novel", EditionMergeScope: "directory", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"}); err != nil {
		t.Fatal(err)
	}
	seedEditionBook(t, "ed-epub", "lib-r", "沙丘.epub", "沙丘", "novel", "赫伯特", 3000)
	seedEditionBook(t, "ed-mobi", "lib-r", "沙丘.mobi", "沙丘", "novel", "赫伯特", 2500)
	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatal(err)
	}

	// Unread -> EPUB wins (higher format priority for novels)
	resUnread, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, UserID: "reader-1", PageSize: 24})
	if err != nil || len(resUnread.Comics) != 1 || resUnread.Comics[0].ID != "ed-epub" {
		t.Fatalf("unread preferred edition = %+v (err=%v), want ed-epub", resUnread.Comics, err)
	}

	// User reads MOBI -> MOBI becomes representative card & PreferredComicID
	now := time.Now().UTC()
	if _, err := db.Exec(`
		INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt", "readingStatus")
		VALUES ('reader-1', 'ed-mobi', 12, ?, 'reading')
	`, now); err != nil {
		t.Fatal(err)
	}
	resRead, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, UserID: "reader-1", PageSize: 24})
	if err != nil || len(resRead.Comics) != 1 || resRead.Comics[0].ID != "ed-mobi" {
		t.Fatalf("read preferred edition = %+v (err=%v), want ed-mobi", resRead.Comics, err)
	}
	_, _, prefID, rows, err := GetComicEditionsForUser("ed-epub", "reader-1", nil, false)
	if err != nil || prefID != "ed-mobi" || len(rows) != 2 {
		t.Fatalf("GetComicEditionsForUser preferred = %q, want ed-mobi (err=%v)", prefID, err)
	}
}

func TestMultiVolumeAndAuthorNonCollision(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	if err := CreateLibrary(&model.Library{ID: "lib-nc", Name: "NC", Type: "novel", EditionMergeScope: "library", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"}); err != nil {
		t.Fatal(err)
	}
	// Multi-volume series must stay distinct
	seedEditionBook(t, "tb-1", "lib-nc", "三体/三体1.epub", "三体1", "novel", "刘慈欣", 1000)
	seedEditionBook(t, "tb-2", "lib-nc", "三体/三体2.epub", "三体2", "novel", "刘慈欣", 1000)
	seedEditionBook(t, "tb-3", "lib-nc", "三体/三体3.epub", "三体3", "novel", "刘慈欣", 1000)
	// Same title, different authors must stay distinct
	seedEditionBook(t, "alive-yh", "lib-nc", "活着.epub", "活着", "novel", "余华", 1000)
	seedEditionBook(t, "alive-oy", "lib-nc", "活着.mobi", "活着", "novel", "乙一", 1000)

	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatal(err)
	}
	res, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, ContentType: "novel", PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 5 {
		t.Fatalf("non-collision shelf total = %d, want 5 (vols 1/2/3 + 2 authors); got %d", res.Total, len(res.Comics))
	}
}

func TestManualBindAndSplitBookEdition(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	if err := CreateLibrary(&model.Library{ID: "lib-m", Name: "M", Type: "novel", EditionMergeScope: "directory", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"}); err != nil {
		t.Fatal(err)
	}
	seedEditionBook(t, "m-1", "lib-m", "dir1/沙丘.epub", "沙丘", "novel", "", 2000)
	seedEditionBook(t, "m-2", "lib-m", "dir2/Dune.mobi", "Dune", "novel", "", 1500)
	seedEditionBook(t, "m-3", "lib-m", "dir3/AutoA.epub", "AutoA", "novel", "", 1000)
	seedEditionBook(t, "m-4", "lib-m", "dir3/AutoA.mobi", "AutoA", "novel", "", 900)

	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatal(err)
	}

	// Manually bind cross-name books
	gid, err := BindBookEditions([]string{"m-1", "m-2"})
	if err != nil || gid == "" {
		t.Fatalf("BindBookEditions failed: %v", err)
	}
	// Split auto group
	if err := SplitBookEdition([]string{"m-3"}); err != nil {
		t.Fatalf("SplitBookEdition failed: %v", err)
	}

	// Rebuild again -> manual bind must survive, split book must NOT re-merge
	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatal(err)
	}
	res, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	// m-1+m-2 collapsed (1) + m-3 standalone (1) + m-4 standalone (1) = 3
	if res.Total != 3 {
		t.Fatalf("after bind+split+rebuild shelf total = %d, want 3", res.Total)
	}
}

func TestSeriesDetailEditionCollapse(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	if err := CreateLibrary(&model.Library{ID: "lib-s", Name: "Manga", Type: "comic", EditionMergeScope: "directory", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"}); err != nil {
		t.Fatal(err)
	}
	seedEditionBook(t, "op-1-cbz", "lib-s", "海贼王/第01卷.cbz", "第01卷", "comic", "尾田", 5000)
	seedEditionBook(t, "op-1-pdf", "lib-s", "海贼王/第01卷.pdf", "第01卷", "comic", "尾田", 7000)
	seedEditionBook(t, "op-2-cbz", "lib-s", "海贼王/第02卷.cbz", "第02卷", "comic", "尾田", 5200)

	if err := ReplaceDetectedSeries("lib-s", []DetectedSeries{{
		ID:               "ser-op",
		LibraryID:        "lib-s",
		RootRelativePath: "海贼王",
		Title:            "海贼王",
		SortTitle:        BuildTitleSortKey("海贼王"),
		CoverComicID:     "op-1-cbz",
		Items: []DetectedSeriesItem{
			{ComicID: "op-1-cbz", SortIndex: 0, DisplayLabel: "第01卷"},
			{ComicID: "op-1-pdf", SortIndex: 1, DisplayLabel: "第01卷"},
			{ComicID: "op-2-cbz", SortIndex: 2, DisplayLabel: "第02卷"},
		},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := RebuildBookEditionGroups(); err != nil {
		t.Fatal(err)
	}

	detail, err := GetSeriesDetail("ser-op", "")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Series.ItemCount != 2 || len(detail.Unsectioned) != 2 {
		t.Fatalf("collapsed series items = %d (ItemCount=%d), want 2 logical volumes", len(detail.Unsectioned), detail.Series.ItemCount)
	}
	vol1 := detail.Unsectioned[0]
	if vol1.EditionCount != 2 || len(vol1.Formats) != 2 || len(vol1.Editions) != 2 {
		t.Fatalf("vol1 editions = %+v, want 2 formats [CBZ PDF]", vol1)
	}
}

func BenchmarkEditionRebuild(b *testing.B) {
	if err := InitDB(b.TempDir() + "/edition-bench.db"); err != nil {
		b.Fatal(err)
	}
	defer CloseDB()
	if err := RunMigrations(); err != nil {
		b.Fatal(err)
	}
	if err := CreateLibrary(&model.Library{ID: "bench-n", Name: "Novels", Type: "novel", EditionMergeScope: "directory", RootPath: b.TempDir(), Enabled: true, DefaultAccess: "public"}); err != nil {
		b.Fatal(err)
	}

	tx, err := db.Begin()
	if err != nil {
		b.Fatal(err)
	}
	stmt, err := tx.Prepare(`INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "type", "libraryId", "relativePath", "format", "editionStemKey", "editionMatchKey", "editionLabel", "fileSize") VALUES (?, ?, ?, ?, 'novel', 'bench-n', ?, ?, ?, ?, ?, 1024)`)
	if err != nil {
		b.Fatal(err)
	}
	const total = 50000
	for i := 0; i < total; i++ {
		ext := "epub"
		bookIdx := i
		if i < 4000 {
			// 2000 multi-format pairs (4000 files -> 2000 groups)
			bookIdx = i / 2
			if i%2 == 1 {
				ext = "mobi"
			}
		}
		id := fmt.Sprintf("b-%05d", i)
		relPath := fmt.Sprintf("dir-%03d/Book-%05d.%s", bookIdx/100, bookIdx, ext)
		title := fmt.Sprintf("Book-%05d", bookIdx)
		if _, err := stmt.Exec(id, relPath, title, BuildTitleSortKey(title), relPath, ext, BuildEditionStemKey(relPath), BuildEditionMatchKey(relPath, title), ""); err != nil {
			b.Fatal(err)
		}
	}
	stmt.Close()
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := RebuildBookEditionGroups(); err != nil {
			b.Fatal(err)
		}
	}
}
