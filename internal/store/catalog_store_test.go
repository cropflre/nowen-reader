package store

import "testing"

func TestCatalogItemsUseLogicalDatabasePagination(t *testing.T) {
	setupTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO "Library" ("id", "name", "rootPath", "type", "enabled") VALUES
			('catalog-visible', 'Visible', '/visible', 'comic', 1),
			('catalog-hidden', 'Hidden', '/hidden', 'comic', 1)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES
			('catalog-v1', 'work/01.cbz', 'Work Volume 1', 'comic', 'catalog-visible', 'work/01.cbz'),
			('catalog-v2', 'work/02.cbz', 'Work Volume 2', 'comic', 'catalog-visible', 'work/02.cbz'),
			('catalog-single', 'single.cbz', 'Single 100%', 'comic', 'catalog-visible', 'single.cbz'),
			('catalog-lonely', 'lonely/01.cbz', 'Lonely', 'comic', 'catalog-visible', 'lonely/01.cbz'),
			('catalog-novel', 'book.epub', 'Novel', 'novel', 'catalog-visible', 'book.epub'),
			('catalog-h1', 'private/01.cbz', 'Hidden 1', 'comic', 'catalog-hidden', 'private/01.cbz'),
			('catalog-h2', 'private/02.cbz', 'Hidden 2', 'comic', 'catalog-hidden', 'private/02.cbz')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle", "coverComicId") VALUES
			('catalog-series', 'catalog-visible', 'work', 'Work', 'work', 'catalog-v2'),
			('catalog-one-item-series', 'catalog-visible', 'lonely', 'Lonely', 'lonely', 'catalog-lonely'),
			('catalog-hidden-series', 'catalog-hidden', 'private', 'Hidden', 'hidden', 'catalog-h1')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
			('catalog-series', 'catalog-v1', 0),
			('catalog-series', 'catalog-v2', 1),
			('catalog-one-item-series', 'catalog-lonely', 0),
			('catalog-hidden-series', 'catalog-h1', 0),
			('catalog-hidden-series', 'catalog-h2', 1)
	`); err != nil {
		t.Fatal(err)
	}

	seen := make(map[string]CatalogItem)
	for page := 1; page <= 2; page++ {
		result, err := GetCatalogItems(CatalogItemQueryOptions{
			ContentType:      "comic",
			Page:             page,
			PageSize:         2,
			FilterLibraryIDs: true,
			LibraryIDs:       []string{"catalog-visible"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Total != 3 || result.TotalPages != 2 {
			t.Fatalf("page %d result = %#v", page, result)
		}
		for _, item := range result.Items {
			seen[item.Kind+":"+item.ID] = item
		}
	}
	if len(seen) != 3 {
		t.Fatalf("logical items = %#v", seen)
	}
	series, ok := seen[CatalogItemSeries+":catalog-series"]
	if !ok || series.ItemCount != 2 || series.CoverURL != BuildComicCoverURL("catalog-v2") {
		t.Fatalf("series item = %#v", series)
	}
	if _, ok := seen[CatalogItemComic+":catalog-v1"]; ok {
		t.Fatal("series member leaked as a standalone item")
	}
	if _, ok := seen[CatalogItemComic+":catalog-lonely"]; !ok {
		t.Fatal("one-member series should remain selectable as a standalone comic")
	}
	if _, ok := seen[CatalogItemSeries+":catalog-hidden-series"]; ok {
		t.Fatal("inaccessible series leaked into catalog")
	}

	search, err := GetCatalogItems(CatalogItemQueryOptions{
		Search:           "Volume 2",
		ContentType:      "comic",
		Page:             1,
		PageSize:         12,
		FilterLibraryIDs: true,
		LibraryIDs:       []string{"catalog-visible"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if search.Total != 1 || len(search.Items) != 1 || search.Items[0].Kind != CatalogItemSeries || search.Items[0].ID != "catalog-series" {
		t.Fatalf("member-title search = %#v", search)
	}

	literalWildcard, err := GetCatalogItems(CatalogItemQueryOptions{
		Search:           "%",
		ContentType:      "comic",
		Page:             1,
		PageSize:         12,
		FilterLibraryIDs: true,
		LibraryIDs:       []string{"catalog-visible"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if literalWildcard.Total != 1 || literalWildcard.Items[0].ID != "catalog-single" {
		t.Fatalf("escaped wildcard search = %#v", literalWildcard)
	}

	novels, err := GetCatalogItems(CatalogItemQueryOptions{
		ContentType:      "novel",
		Page:             1,
		PageSize:         12,
		FilterLibraryIDs: true,
		LibraryIDs:       []string{"catalog-visible"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if novels.Total != 1 || len(novels.Items) != 1 || novels.Items[0].Kind != CatalogItemComic || novels.Items[0].ID != "catalog-novel" {
		t.Fatalf("novel catalog = %#v", novels)
	}

	empty, err := GetCatalogItems(CatalogItemQueryOptions{
		ContentType:      "comic",
		Page:             1,
		PageSize:         12,
		FilterLibraryIDs: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if empty.Total != 0 || len(empty.Items) != 0 {
		t.Fatalf("empty library scope = %#v", empty)
	}
}
