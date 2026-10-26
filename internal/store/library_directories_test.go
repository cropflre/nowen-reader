package store

import (
	"errors"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestValidateDirectoryRelativePath(t *testing.T) {
	valid := []string{
		"",
		"韩漫",
		"韩漫/连载中",
		"100%_特辑/子_类%[A]",
		"日漫/第2分类/第10子分类",
	}
	for _, input := range valid {
		got, err := ValidateDirectoryRelativePath(input)
		if err != nil || got != input {
			t.Fatalf("ValidateDirectoryRelativePath(%q) = (%q, %v), want (%q, nil)", input, got, err, input)
		}
	}

	invalid := []string{
		"/",
		"/韩漫",
		"韩漫/",
		`\韩漫`,
		`韩漫\连载`,
		".",
		"..",
		"../secret",
		"韩漫/../日漫",
		"./韩漫",
		"韩漫/.",
		"韩漫//连载",
		"C:/comics",
		"D:",
		"   ",
		"韩漫/   /子目录",
		"韩漫/\x00bad",
	}
	for _, input := range invalid {
		if got, err := ValidateDirectoryRelativePath(input); !errors.Is(err, ErrInvalidDirectoryPath) {
			t.Fatalf("ValidateDirectoryRelativePath(%q) = (%q, %v), want ErrInvalidDirectoryPath", input, got, err)
		}
	}
}

func TestListLibraryDirectoriesAndPrefixFilterBoundary(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	depth1Lib := &model.Library{
		ID:            "lib-d1",
		Name:          "Depth 1",
		Type:          "comic",
		SeriesDepth:   1,
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	novelLib := &model.Library{
		ID:            "lib-novel",
		Name:          "Novels",
		Type:          "novel",
		SeriesDepth:   1,
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	depth3Lib := &model.Library{
		ID:            "lib-d3",
		Name:          "Depth 3 Categorized",
		Type:          "comic",
		SeriesDepth:   3,
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	for _, lib := range []*model.Library{depth1Lib, novelLib, depth3Lib} {
		if err := CreateLibrary(lib); err != nil {
			t.Fatalf("CreateLibrary(%s) failed: %v", lib.ID, err)
		}
	}

	// Depth=1 and novel libraries have maxDirectoryDepth=0; non-empty parent is rejected.
	d1Root, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{LibraryID: depth1Lib.ID})
	if err != nil || d1Root.MaxDirectoryDepth != 0 || len(d1Root.Directories) != 0 {
		t.Fatalf("depth=1 root directories unexpected: %#v err=%v", d1Root, err)
	}
	if _, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{LibraryID: depth1Lib.ID, Parent: "韩漫"}); !errors.Is(err, ErrInvalidDirectoryDepth) {
		t.Fatalf("expected ErrInvalidDirectoryDepth for depth=1 non-empty parent, got %v", err)
	}
	novelRoot, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{LibraryID: novelLib.ID})
	if err != nil || novelRoot.MaxDirectoryDepth != 0 || len(novelRoot.Directories) != 0 {
		t.Fatalf("novel root directories unexpected: %#v err=%v", novelRoot, err)
	}

	insertComic := func(id, relPath, title string) {
		t.Helper()
		if _, err := DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "pageCount", "fileSize", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, ?, 20, 1024, 'comic', ?, ?)
		`, id, relPath, title, BuildTitleSortKey(title), depth3Lib.ID, relPath); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}

	// Root-level image-folder comic named "韩漫/" must NOT collide with directory "韩漫"!
	insertComic("root-img-folder", "韩漫/", "韩漫根目录画集")
	// Shallow image-folder comic inside "韩漫" (depth 2 < 3) must NOT create a fake subcategory "整本图片漫画"!
	insertComic("kr-shallow-img", "韩漫/整本图片漫画/", "整本图片漫画")
	// Multi-chapter work with section under "韩漫/连载/同名书"
	insertComic("kr-s-a1", "韩漫/连载/同名书/第1季/01.cbz", "01")
	insertComic("kr-s-a2", "韩漫/连载/同名书/第1季/02.cbz", "02")
	// Single-chapter work at depth 3 under "韩漫/连载/单章书"
	insertComic("kr-s-b1", "韩漫/连载/单章书/01.cbz", "01")
	// Shallow archive file at depth 2 under "韩漫/连载"
	insertComic("kr-s-shallow", "韩漫/连载/散本.cbz", "散本")
	// Same-title work in different category "韩漫/完结/同名书"
	insertComic("kr-f-a1", "韩漫/完结/同名书/01.cbz", "01")
	// Sibling prefix collision check: "韩漫备份" must NEVER match "韩漫"
	insertComic("kr-bak-1", "韩漫备份/归档/备份书/01.cbz", "01")
	// SQLite LIKE wildcard characters "%" and "_" in category names
	insertComic("wild-1", "100%_特辑/子_类%/奇幻书/01.cbz", "01")

	detected := []DetectedSeries{
		{
			ID:               "ser-kr-ongoing-same",
			LibraryID:        depth3Lib.ID,
			RootRelativePath: "韩漫/连载/同名书",
			Title:            "同名书",
			SortTitle:        BuildTitleSortKey("同名书"),
			CoverComicID:     "kr-s-a1",
			Sections: []DetectedSeriesSection{
				{ID: "sec-1", Title: "第 1 季", RelativePath: "韩漫/连载/同名书/第1季", Kind: "season", SortIndex: 0, DetectionSource: "directory"},
			},
			Items: []DetectedSeriesItem{
				{ComicID: "kr-s-a1", SectionID: "sec-1", SortIndex: 0, DisplayLabel: "01"},
				{ComicID: "kr-s-a2", SectionID: "sec-1", SortIndex: 1, DisplayLabel: "02"},
			},
		},
		{
			ID:               "ser-kr-ongoing-single",
			LibraryID:        depth3Lib.ID,
			RootRelativePath: "韩漫/连载/单章书",
			Title:            "单章书",
			SortTitle:        BuildTitleSortKey("单章书"),
			CoverComicID:     "kr-s-b1",
			Items: []DetectedSeriesItem{
				{ComicID: "kr-s-b1", SortIndex: 0, DisplayLabel: "01"},
			},
		},
		{
			ID:               "ser-kr-done-same",
			LibraryID:        depth3Lib.ID,
			RootRelativePath: "韩漫/完结/同名书",
			Title:            "同名书",
			SortTitle:        BuildTitleSortKey("同名书"),
			CoverComicID:     "kr-f-a1",
			Items: []DetectedSeriesItem{
				{ComicID: "kr-f-a1", SortIndex: 0, DisplayLabel: "01"},
			},
		},
		{
			ID:               "ser-kr-bak",
			LibraryID:        depth3Lib.ID,
			RootRelativePath: "韩漫备份/归档/备份书",
			Title:            "备份书",
			SortTitle:        BuildTitleSortKey("备份书"),
			CoverComicID:     "kr-bak-1",
			Items: []DetectedSeriesItem{
				{ComicID: "kr-bak-1", SortIndex: 0, DisplayLabel: "01"},
			},
		},
		{
			ID:               "ser-wild",
			LibraryID:        depth3Lib.ID,
			RootRelativePath: "100%_特辑/子_类%/奇幻书",
			Title:            "奇幻书",
			SortTitle:        BuildTitleSortKey("奇幻书"),
			CoverComicID:     "wild-1",
			Items: []DetectedSeriesItem{
				{ComicID: "wild-1", SortIndex: 0, DisplayLabel: "01"},
			},
		},
	}
	if err := ReplaceDetectedSeries(depth3Lib.ID, detected); err != nil {
		t.Fatalf("ReplaceDetectedSeries failed: %v", err)
	}

	// Level 1 categories at root (""): "100%_特辑" (1), "韩漫" (5), "韩漫备份" (1)
	lvl1, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{
		LibraryID: depth3Lib.ID,
		Parent:    "",
		Page:      1,
		PageSize:  50,
	})
	if err != nil {
		t.Fatalf("ListLibraryDirectories root failed: %v", err)
	}
	if lvl1.MaxDirectoryDepth != 2 || lvl1.Total != 3 || len(lvl1.Directories) != 3 {
		t.Fatalf("expected 3 top-level directories with maxDepth=2, got %#v", lvl1)
	}

	expectedLvl1 := map[string]int{
		"100%_特辑": 1,
		"韩漫":      5, // 同名书(连载) + 单章书 + 散本.cbz + 整本图片漫画/ + 同名书(完结); NOT root "韩漫/" and NOT "韩漫备份"!
		"韩漫备份":    1,
	}
	for _, node := range lvl1.Directories {
		wantCount, ok := expectedLvl1[node.Path]
		if !ok {
			t.Fatalf("unexpected level-1 directory node: %#v", node)
		}
		if node.WorkCount != wantCount || !node.HasChildren || node.CoverURL == "" {
			t.Fatalf("node %s mismatch: got count=%d hasChildren=%v cover=%q, want count=%d", node.Path, node.WorkCount, node.HasChildren, node.CoverURL, wantCount)
		}
		// Verify logical shelf total under DirectoryPath matches node.WorkCount 1-for-1!
		shelfRes, err := GetAllComicsShelfSafe(ComicListOptions{
			FilterLibraryIDs: true,
			LibraryIDs:       []string{depth3Lib.ID},
			DirectoryPath:    node.Path,
			SeriesView:       true,
			Page:             1,
			PageSize:         20,
		})
		if err != nil {
			t.Fatalf("GetAllComicsShelfSafe(%s) failed: %v", node.Path, err)
		}
		if shelfRes.Total != node.WorkCount {
			t.Fatalf("directory %q workCount=%d != shelf Total=%d (items=%#v)", node.Path, node.WorkCount, shelfRes.Total, shelfRes.Comics)
		}
	}

	// Pagination on level 1
	p1, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{LibraryID: depth3Lib.ID, Page: 1, PageSize: 2})
	if err != nil || len(p1.Directories) != 2 || p1.Total != 3 || p1.TotalPages != 2 {
		t.Fatalf("page 1 directories unexpected: %#v err=%v", p1, err)
	}
	p2, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{LibraryID: depth3Lib.ID, Page: 2, PageSize: 2})
	if err != nil || len(p2.Directories) != 1 || p2.Directories[0].Path == p1.Directories[0].Path {
		t.Fatalf("page 2 directories unexpected: %#v err=%v", p2, err)
	}

	// Level 2 categories under "韩漫": only "完结" (1) and "连载" (3); "整本图片漫画/" must NOT appear as a folder!
	lvl2, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{
		LibraryID: depth3Lib.ID,
		Parent:    "韩漫",
		Page:      1,
		PageSize:  50,
	})
	if err != nil {
		t.Fatalf("ListLibraryDirectories(韩漫) failed: %v", err)
	}
	if len(lvl2.Breadcrumbs) != 1 || lvl2.Breadcrumbs[0].Path != "韩漫" {
		t.Fatalf("unexpected breadcrumbs: %#v", lvl2.Breadcrumbs)
	}
	if lvl2.Total != 2 {
		t.Fatalf("expected 2 subdirectories under 韩漫, got %#v", lvl2.Directories)
	}
	for _, node := range lvl2.Directories {
		if node.HasChildren {
			t.Fatalf("leaf category %q at maxDirectoryDepth must have hasChildren=false", node.Path)
		}
		shelfRes, err := GetAllComicsShelfSafe(ComicListOptions{
			FilterLibraryIDs: true,
			LibraryIDs:       []string{depth3Lib.ID},
			DirectoryPath:    node.Path,
			SeriesView:       true,
			Page:             1,
			PageSize:         20,
		})
		if err != nil || shelfRes.Total != node.WorkCount {
			t.Fatalf("leaf category %q workCount=%d != shelf Total=%d (err=%v)", node.Path, node.WorkCount, shelfRes.Total, err)
		}
	}

	// Querying leaf category ("韩漫/连载", depth == maxDirectoryDepth == 2) returns empty directories + 2 breadcrumbs.
	leafRes, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{
		LibraryID: depth3Lib.ID,
		Parent:    "韩漫/连载",
	})
	if err != nil || len(leafRes.Directories) != 0 || len(leafRes.Breadcrumbs) != 2 {
		t.Fatalf("leaf category query unexpected: %#v err=%v", leafRes, err)
	}

	// Querying a work root ("韩漫/连载/同名书", depth 3 > maxDirectoryDepth 2) is rejected!
	if _, err := ListLibraryDirectories(LibraryDirectoryQueryOptions{
		LibraryID: depth3Lib.ID,
		Parent:    "韩漫/连载/同名书",
	}); !errors.Is(err, ErrInvalidDirectoryDepth) {
		t.Fatalf("expected ErrInvalidDirectoryDepth for work root, got %v", err)
	}

	// Wildcard directory "100%_特辑/子_类%" matches ONLY its own work!
	wildShelf, err := GetAllComicsShelfSafe(ComicListOptions{
		FilterLibraryIDs: true,
		LibraryIDs:       []string{depth3Lib.ID},
		DirectoryPath:    "100%_特辑/子_类%",
		SeriesView:       true,
	})
	if err != nil || wildShelf.Total != 1 || wildShelf.Comics[0].ID != SeriesShelfIDPrefix+"ser-wild" {
		t.Fatalf("wildcard directory shelf unexpected: %#v err=%v", wildShelf, err)
	}

	// Non-series ("文件" mode) also respects DirectoryPath!
	rawFiles, err := GetAllComics(ComicListOptions{
		FilterLibraryIDs: true,
		LibraryIDs:       []string{depth3Lib.ID},
		DirectoryPath:    "韩漫/连载",
		SeriesView:       false,
	})
	if err != nil || rawFiles.Total != 4 {
		t.Fatalf("expected 4 raw files under 韩漫/连载, got %#v err=%v", rawFiles, err)
	}
}
