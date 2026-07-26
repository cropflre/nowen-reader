package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     39,
		Description: "Add metadata scraping fields and tags to directory series",
		SQL: strings.Join([]string{
			`ALTER TABLE "ComicSeries" ADD COLUMN "coverUrl" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "author" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "tags" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "year" INTEGER;`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "publisher" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "language" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "genre" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "status" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "externalRating" REAL;`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "externalRatingMax" REAL;`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "externalRatingSource" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "externalRatingUpdatedAt" DATETIME;`,
			`ALTER TABLE "ComicSeries" ADD COLUMN "metadataLocked" BOOLEAN NOT NULL DEFAULT 0;`,
			`CREATE TABLE IF NOT EXISTS "ComicSeriesTag" (
				"seriesId" TEXT NOT NULL,
				"tagId" INTEGER NOT NULL,
				PRIMARY KEY ("seriesId", "tagId"),
				CONSTRAINT "ComicSeriesTag_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ComicSeries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "ComicSeriesTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS "ComicSeriesTag_tagId_idx" ON "ComicSeriesTag"("tagId");`,
		}, "\n"),
	})
}
