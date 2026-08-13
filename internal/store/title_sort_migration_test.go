package store

import "testing"

func TestTitleSortKeyMigrationRepairsExistingData(t *testing.T) {
	setupTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO "Library" ("id", "name", "rootPath")
		VALUES ('sort-migration-lib', 'Sort Migration', '/tmp/sort-migration')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "libraryId", "relativePath")
		VALUES ('sort-migration-comic', 'comic.cbz', '西游记', 'legacy-comic-key', 'sort-migration-lib', 'comic.cbz')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle")
		VALUES ('sort-migration-series', 'sort-migration-lib', 'series', '龙珠漫画', '龙珠漫画')
	`); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(`DELETE FROM "_migrations" WHERE "version" = 40`); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}

	var comicKey, seriesKey string
	if err := db.QueryRow(`SELECT "titleSortKey" FROM "Comic" WHERE "id" = 'sort-migration-comic'`).Scan(&comicKey); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT "sortTitle" FROM "ComicSeries" WHERE "id" = 'sort-migration-series'`).Scan(&seriesKey); err != nil {
		t.Fatal(err)
	}
	if want := BuildTitleSortKey("西游记"); comicKey != want {
		t.Fatalf("comic titleSortKey = %q, want %q", comicKey, want)
	}
	if want := BuildTitleSortKey("龙珠漫画"); seriesKey != want {
		t.Fatalf("series sortTitle = %q, want %q", seriesKey, want)
	}

	if _, err := db.Exec(`UPDATE "ComicSeries" SET "title" = '镖人' WHERE "id" = 'sort-migration-series'`); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT "sortTitle" FROM "ComicSeries" WHERE "id" = 'sort-migration-series'`).Scan(&seriesKey); err != nil {
		t.Fatal(err)
	}
	if want := BuildTitleSortKey("镖人"); seriesKey != want {
		t.Fatalf("series trigger sortTitle = %q, want %q", seriesKey, want)
	}
}

func TestUpdateSeriesUsesNaturalChineseSortKey(t *testing.T) {
	setupTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO "Library" ("id", "name", "rootPath")
		VALUES ('update-series-lib', 'Update Series', '/tmp/update-series')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle")
		VALUES ('update-series', 'update-series-lib', 'series', '旧名称', '旧名称')
	`); err != nil {
		t.Fatal(err)
	}

	if err := UpdateSeries("update-series", "  西游记漫画全套  ", "", nil); err != nil {
		t.Fatal(err)
	}
	var title, sortTitle string
	if err := db.QueryRow(`SELECT "title", "sortTitle" FROM "ComicSeries" WHERE "id" = 'update-series'`).Scan(&title, &sortTitle); err != nil {
		t.Fatal(err)
	}
	if title != "西游记漫画全套" {
		t.Fatalf("title = %q", title)
	}
	if want := BuildTitleSortKey(title); sortTitle != want {
		t.Fatalf("sortTitle = %q, want %q", sortTitle, want)
	}
}
