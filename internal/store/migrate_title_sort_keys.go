package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     40,
		Description: "Rebuild natural Chinese title sort keys for comics and directory series",
		SQL: strings.Join([]string{
			`UPDATE "Comic" SET "titleSortKey" = title_sort_key("title");`,
			`UPDATE "ComicSeries" SET "sortTitle" = title_sort_key("title");`,
			`CREATE TRIGGER IF NOT EXISTS "ComicSeries_sortTitle_ai" AFTER INSERT ON "ComicSeries" WHEN new."sortTitle" = '' BEGIN UPDATE "ComicSeries" SET "sortTitle" = title_sort_key(new."title") WHERE "id" = new."id"; END;`,
			`CREATE TRIGGER IF NOT EXISTS "ComicSeries_sortTitle_au" AFTER UPDATE OF "title" ON "ComicSeries" BEGIN UPDATE "ComicSeries" SET "sortTitle" = title_sort_key(new."title") WHERE "id" = new."id"; END;`,
		}, "\n"),
	})
}
