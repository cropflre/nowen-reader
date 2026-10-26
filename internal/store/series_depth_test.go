package store

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestLibrarySeriesDepthMigrationAndRoundTrip(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	// Default depth is 1 when omitted (0 in struct).
	defaultLib := &model.Library{
		ID:            "lib-default",
		Name:          "Default Comic",
		Type:          "comic",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(defaultLib); err != nil {
		t.Fatalf("CreateLibrary default failed: %v", err)
	}
	gotDefault, err := GetLibraryByID(defaultLib.ID)
	if err != nil || gotDefault == nil || gotDefault.SeriesDepth != 1 {
		t.Fatalf("expected default SeriesDepth=1, got %#v (err=%v)", gotDefault, err)
	}

	// Explicit depth 2..8 round-trips across all store read paths.
	deepRoot := t.TempDir()
	deepLib := &model.Library{
		ID:            "lib-deep",
		Name:          "Deep Comic",
		Type:          "comic",
		SeriesDepth:   3,
		RootPath:      deepRoot,
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(deepLib); err != nil {
		t.Fatalf("CreateLibrary deep failed: %v", err)
	}

	revBefore, err := GetComicSeriesSourceFingerprint()
	if err != nil {
		t.Fatal(err)
	}
	deepLib.SeriesDepth = 2
	if err := UpdateLibrary(deepLib); err != nil {
		t.Fatalf("UpdateLibrary deep failed: %v", err)
	}
	revAfter, err := GetComicSeriesSourceFingerprint()
	if err != nil || revAfter == revBefore {
		t.Fatalf("seriesDepth update must bump ComicSeriesSourceRevision: before=%s after=%s err=%v", revBefore, revAfter, err)
	}

	allLibs, err := GetAllLibraries()
	if err != nil {
		t.Fatal(err)
	}
	scannableLibs, err := GetScannableLibraries()
	if err != nil {
		t.Fatal(err)
	}
	foundInAll, foundInScannable := false, false
	for _, lib := range allLibs {
		if lib.ID == deepLib.ID && lib.SeriesDepth == 2 {
			foundInAll = true
		}
	}
	for _, lib := range scannableLibs {
		if lib.ID == deepLib.ID && lib.SeriesDepth == 2 {
			foundInScannable = true
		}
	}
	if !foundInAll || !foundInScannable {
		t.Fatalf("expected SeriesDepth=2 in GetAllLibraries (%v) and GetScannableLibraries (%v)", foundInAll, foundInScannable)
	}

	foundLib, err := FindOrCreateLibrary(deepRoot, "comic")
	if err != nil || foundLib == nil || foundLib.SeriesDepth != 2 {
		t.Fatalf("FindOrCreateLibrary lost SeriesDepth: %#v (err=%v)", foundLib, err)
	}

	// Database triggers reject out-of-range depths and novel depth != 1.
	if _, err := DB().Exec(`INSERT INTO "Library" ("id","name","type","seriesDepth","rootPath") VALUES ('bad-high','Bad','comic',9,'/tmp/bad-high')`); err == nil {
		t.Fatal("expected trigger to reject seriesDepth=9")
	}
	if _, err := DB().Exec(`INSERT INTO "Library" ("id","name","type","seriesDepth","rootPath") VALUES ('bad-zero','Bad','comic',0,'/tmp/bad-zero')`); err == nil {
		t.Fatal("expected trigger to reject seriesDepth=0")
	}
	if _, err := DB().Exec(`INSERT INTO "Library" ("id","name","type","seriesDepth","rootPath") VALUES ('bad-novel','Bad','novel',2,'/tmp/bad-novel')`); err == nil {
		t.Fatal("expected trigger to reject novel seriesDepth=2")
	}
}

func TestSingleChapterWorkConsistencyAcrossAllQueryPaths(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	if _, err := DB().Exec(`INSERT INTO "User" ("id", "username", "password", "nickname", "role") VALUES ('admin-u', 'admin', 'pw', 'Admin', 'admin')`); err != nil {
		t.Fatal(err)
	}

	lib := &model.Library{
		ID:            "lib-depth2",
		Name:          "Categorized Comics",
		Type:          "comic",
		SeriesDepth:   2,
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}

	insertComic := func(id, relPath, title string) {
		t.Helper()
		if _, err := DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, 24, 2048, 'comic', ?, ?)
		`, id, relPath, title, lib.ID, relPath); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}

	// 2-chapter work, 1-chapter work, and 1 shallow standalone comic -> 3 logical shelf works!
	insertComic("a-1", "韩漫/书A/01.cbz", "01")
	insertComic("a-2", "韩漫/书A/02.cbz", "02")
	insertComic("b-1", "韩漫/书B/01.cbz", "01")
	insertComic("shallow-1", "韩漫/散本.cbz", "散本")

	detected := []DetectedSeries{
		{
			ID:               "ser-book-a",
			LibraryID:        lib.ID,
			RootRelativePath: "韩漫/书A",
			Title:            "书A",
			SortTitle:        BuildTitleSortKey("书A"),
			CoverComicID:     "a-1",
			Items: []DetectedSeriesItem{
				{ComicID: "a-1", SortIndex: 0, DisplayLabel: "01"},
				{ComicID: "a-2", SortIndex: 1, DisplayLabel: "02"},
			},
		},
		{
			ID:               "ser-book-b",
			LibraryID:        lib.ID,
			RootRelativePath: "韩漫/书B",
			Title:            "书B",
			SortTitle:        BuildTitleSortKey("书B"),
			CoverComicID:     "b-1",
			Items: []DetectedSeriesItem{
				{ComicID: "b-1", SortIndex: 0, DisplayLabel: "01"},
			},
		},
	}
	if err := ReplaceDetectedSeries(lib.ID, detected); err != nil {
		t.Fatalf("ReplaceDetectedSeries failed: %v", err)
	}

	// 1. SQL logical shelf page
	shelfPage, err := GetAllComics(ComicListOptions{
		LibraryIDs: []string{lib.ID},
		SeriesView: true,
		SortBy:     "title",
		SortOrder:  "asc",
		Page:       1,
		PageSize:   20,
	})
	if err != nil {
		t.Fatalf("GetAllComics seriesView failed: %v", err)
	}
	if shelfPage.Total != 3 || len(shelfPage.Comics) != 3 {
		t.Fatalf("shelfPage total=%d len=%d, want 3: %#v", shelfPage.Total, len(shelfPage.Comics), shelfPage.Comics)
	}

	// 2. CollapseComicListIntoSeries fallback
	flat, err := GetAllComics(ComicListOptions{LibraryIDs: []string{lib.ID}})
	if err != nil {
		t.Fatal(err)
	}
	collapsed, err := CollapseComicListIntoSeries(flat.Comics, "admin-u")
	if err != nil {
		t.Fatal(err)
	}
	if len(collapsed) != 3 {
		t.Fatalf("collapsed len=%d, want 3: %#v", len(collapsed), collapsed)
	}

	// 3. ListSeriesSummaries
	summaries, err := ListSeriesSummaries([]string{lib.ID}, "admin-u", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 2 {
		t.Fatalf("summaries len=%d, want 2 (including 1-chapter work): %#v", len(summaries), summaries)
	}

	// 4. AccessibleLibraries & GetAllLibraryCounts shelfCount
	accessible, err := GetAccessibleLibrariesWithCount("admin-u")
	if err != nil {
		t.Fatal(err)
	}
	var gotAccessible *AccessibleLibrary
	for i := range accessible {
		if accessible[i].ID == lib.ID {
			gotAccessible = &accessible[i]
			break
		}
	}
	if gotAccessible == nil || gotAccessible.ComicCount != 4 || gotAccessible.ShelfCount != 3 || gotAccessible.SeriesDepth != 2 {
		t.Fatalf("unexpected accessible library stats: %#v (all=%#v)", gotAccessible, accessible)
	}
	allCounts, err := GetAllLibraryCounts()
	if err != nil {
		t.Fatal(err)
	}
	if allCounts[lib.ID].ComicCount != 4 || allCounts[lib.ID].ShelfCount != 3 {
		t.Fatalf("unexpected GetAllLibraryCounts: %#v", allCounts[lib.ID])
	}

	// 5. Catalog items
	catalog, err := GetCatalogItems(CatalogItemQueryOptions{
		ContentType:      "comic",
		LibraryIDs:       []string{lib.ID},
		FilterLibraryIDs: true,
		Page:             1,
		PageSize:         20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Total != 3 || len(catalog.Items) != 3 {
		t.Fatalf("catalog total=%d len=%d, want 3: %#v", catalog.Total, len(catalog.Items), catalog.Items)
	}

	// 6. OPDS series & comics
	opdsSeries, opdsTotal, err := GetOPDSSeries(OPDSSeriesQueryOptions{LibraryIDs: []string{lib.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if opdsTotal != 2 || len(opdsSeries) != 2 {
		t.Fatalf("OPDS series total=%d len=%d, want 2: %#v", opdsTotal, len(opdsSeries), opdsSeries)
	}
	opdsComics, _, err := GetOPDSComics(OPDSQueryOptions{
		LibraryIDs: []string{lib.ID},
		UserID:     "admin-u",
		SeriesID:   "ser-book-b",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(opdsComics) != 1 || opdsComics[0].SeriesID != "ser-book-b" || opdsComics[0].SeriesTitle != "书B" {
		t.Fatalf("OPDS single-chapter series comics unexpected: %#v", opdsComics)
	}
}
