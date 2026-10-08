package store

import (
	"errors"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestWorkCategoriesFilterCountAndIsolation(t *testing.T) {
	setupTestDB(t)
	for _, statement := range []string{
		`INSERT INTO "Library" ("id", "name", "rootPath", "type", "enabled", "defaultAccess") VALUES
		 ('category-visible', 'Visible', '/visible', 'comic', 1, 'private'), ('category-hidden', 'Hidden', '/hidden', 'comic', 1, 'private')`,
		`INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId") VALUES
		 ('category-v1', '01.cbz', '01', 'comic', 'category-visible'), ('category-v2', '02.cbz', '02', 'comic', 'category-visible'),
		 ('category-hidden', 'hidden.cbz', 'Hidden', 'comic', 'category-hidden')`,
		`INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle") VALUES
		 ('category-series', 'category-visible', 'work', 'Work', 'work')`,
		`INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
		 ('category-series', 'category-v1', 0), ('category-series', 'category-v2', 1)`,
		`INSERT INTO "Category" ("name", "slug", "icon") VALUES
		 ('目录分类', 'directory-category', '📚'), ('合集分类', 'collection-category', '📁'), ('散本分类', 'unit-category', '📖'), ('隐藏分类', 'hidden-category', '')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	group, err := CreateGroupWithItems("Collection", "", nil, []string{"category-series"})
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := CreateGroupWithItems("Hidden", "", []string{"category-hidden"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, save := range []func() error{
		func() error {
			return SetSeriesCategories("category-series", []string{" directory-category ", "directory-category"})
		},
		func() error { return SetGroupCategories(int(group), []string{"collection-category"}) },
		func() error { return SetGroupCategories(int(hidden), []string{"hidden-category"}) },
		func() error { return AddCategoriesToComic("category-v1", []string{"unit-category"}) },
	} {
		if err := save(); err != nil {
			t.Fatal(err)
		}
	}
	for _, query := range []func(ComicListOptions) (*ComicListResult, error){GetAllComicsShelfSafe, GetAllComics} {
		result, err := query(ComicListOptions{SeriesView: true, Category: "directory-category", ContentType: "comic",
			FilterLibraryIDs: true, LibraryIDs: []string{"category-visible"}, Page: 1, PageSize: 24})
		if err != nil || result.Total != 1 || len(result.Comics) != 1 || result.Comics[0].ID != SeriesShelfIDPrefix+"category-series" {
			t.Fatalf("directory category shelf = %#v, err = %v", result, err)
		}
		if len(result.Comics[0].Categories) != 1 || result.Comics[0].Categories[0].Slug != "directory-category" {
			t.Fatalf("missing own categories: %#v", result.Comics[0].Categories)
		}
		for _, opts := range []ComicListOptions{{Category: "uncategorized"}, {Uncategorized: true}} {
			opts.SeriesView = true
			opts.FilterLibraryIDs = true
			opts.LibraryIDs = []string{"category-visible"}
			result, err := query(opts)
			if err != nil || result.Total != 0 {
				t.Fatalf("categorized series appeared as uncategorized: %#v, err = %v", result, err)
			}
		}
	}
	flat, err := GetAllComics(ComicListOptions{Category: "directory-category"})
	if err != nil || flat.Total != 0 {
		t.Fatalf("work categories leaked onto units: %#v, err = %v", flat, err)
	}
	for _, category := range []string{"collection-category", "directory-category", "unit-category", "hidden-category", "uncategorized"} {
		groups, err := GetAllGroupsWithOptions(GroupListOptions{Category: category, FilterLibraryIDs: true, LibraryIDs: []string{"category-visible"}})
		if err != nil {
			t.Fatal(err)
		}
		if category == "hidden-category" || category == "uncategorized" {
			if len(groups) != 0 {
				t.Fatalf("unexpected groups for %s: %#v", category, groups)
			}
		} else if len(groups) != 1 || groups[0].ID != int(group) {
			t.Fatalf("category filter %s = %#v", category, groups)
		}
	}
	if err := CreateUser(&model.User{ID: "category-viewer", Username: "category-viewer", Password: "hash", Role: "user"}); err != nil {
		t.Fatal(err)
	}
	if err := SetUserLibraryAccess("category-viewer", []LibraryAccessReq{{LibraryID: "category-visible", CanView: true}}); err != nil {
		t.Fatal(err)
	}
	stats, err := GetGroupCategoryStats("comic", "category-viewer")
	if err != nil {
		t.Fatal(err)
	}
	for _, cat := range stats {
		want := 1
		if cat.Slug == "hidden-category" {
			want = 0
		}
		if cat.Count != want {
			t.Errorf("visible group count for %s = %d, want %d", cat.Slug, cat.Count, want)
		}
	}
	stats, err = GetAllCategories()
	if err != nil {
		t.Fatal(err)
	}
	for _, cat := range stats {
		if cat.Count != 1 {
			t.Errorf("association count for %s = %d", cat.Slug, cat.Count)
		}
	}
	// Unknown categories must roll back replacement, including rows inserted earlier in the request.
	for _, save := range []func() error{
		func() error { return SetSeriesCategories("category-series", []string{"unit-category", "missing"}) },
		func() error { return SetGroupCategories(int(group), []string{"unit-category", "missing"}) },
	} {
		if err := save(); !errors.Is(err, ErrCategoryNotFound) {
			t.Fatalf("invalid category error = %v", err)
		}
	}
	seriesCats, err := GetSeriesCategories("category-series")
	if err != nil || len(seriesCats) != 1 || seriesCats[0].Slug != "directory-category" {
		t.Fatalf("series category rollback = %#v, err = %v", seriesCats, err)
	}
	groupCats, err := GetGroupCategories(int(group))
	if err != nil || len(groupCats) != 1 || groupCats[0].Slug != "collection-category" {
		t.Fatalf("group category rollback = %#v, err = %v", groupCats, err)
	}
	if err := SetGroupCategories(int(group), []string{"collection-category", "directory-category"}); err != nil {
		t.Fatal(err)
	}
	if err := AddCategoriesToComic("category-v1", []string{"directory-category"}); err != nil {
		t.Fatal(err)
	}
	stats, err = GetAllCategories()
	if err != nil {
		t.Fatal(err)
	}
	for _, category := range stats {
		if category.Slug == "directory-category" && category.Count != 3 {
			t.Errorf("combined category count = %d, want unit + directory + collection", category.Count)
		}
	}
	if err := DeleteCategory("directory-category"); err != nil {
		t.Fatal(err)
	}
	seriesCats, err = GetSeriesCategories("category-series")
	if err != nil || len(seriesCats) != 0 {
		t.Fatalf("category deletion left directory associations: %#v, err = %v", seriesCats, err)
	}
}

func TestDirectoryCategoryMigrationPreservesExistingCategories(t *testing.T) {
	setupTestDB(t)
	group, err := CreateGroup("Existing")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CreateCategory("已有分类", "existing", "📁"); err != nil {
		t.Fatal(err)
	}
	if err := SetGroupCategories(int(group), []string{"existing"}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DROP TABLE "ComicSeriesCategory"; DELETE FROM "_migrations" WHERE "version" = 44`); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}
	categories, err := GetGroupCategories(int(group))
	if err != nil || len(categories) != 1 || categories[0].Slug != "existing" {
		t.Fatalf("existing categories changed: %#v, err = %v", categories, err)
	}
	if _, err := db.Exec(`SELECT * FROM "ComicSeriesCategory"`); err != nil {
		t.Fatal(err)
	}
}
