package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     41,
		Description: "Add shelf series sorting settings to comic groups",
		SQL: strings.Join([]string{
			`ALTER TABLE "ComicGroup" ADD COLUMN "shelfSeries" BOOLEAN NOT NULL DEFAULT 0;`,
			`ALTER TABLE "ComicGroup" ADD COLUMN "shelfSortMode" TEXT NOT NULL DEFAULT 'custom';`,
			`ALTER TABLE "ComicGroup" ADD COLUMN "shelfSortTitle" TEXT NOT NULL DEFAULT '';`,
			`UPDATE "ComicGroup" SET "shelfSortTitle" = title_sort_key("name");`,
			`CREATE INDEX IF NOT EXISTS "ComicGroup_shelfSeries_sort_idx" ON "ComicGroup"("shelfSeries", "shelfSortTitle", "id");`,
			`CREATE TRIGGER IF NOT EXISTS "ComicGroup_shelfSortTitle_ai" AFTER INSERT ON "ComicGroup" WHEN new."shelfSortTitle" = '' BEGIN UPDATE "ComicGroup" SET "shelfSortTitle" = title_sort_key(new."name") WHERE "id" = new."id"; END;`,
			`CREATE TRIGGER IF NOT EXISTS "ComicGroup_shelfSortTitle_au" AFTER UPDATE OF "name" ON "ComicGroup" BEGIN UPDATE "ComicGroup" SET "shelfSortTitle" = title_sort_key(new."name") WHERE "id" = new."id"; END;`,
		}, "\n"),
	})
}
