package store

func init() {
	Migrations = append(Migrations, Migration{
		Version:     44,
		Description: "Add categories to directory works",
		SQL: `CREATE TABLE IF NOT EXISTS "ComicSeriesCategory" (
			"seriesId" TEXT NOT NULL,
			"categoryId" INTEGER NOT NULL,
			PRIMARY KEY ("seriesId", "categoryId"),
			FOREIGN KEY ("seriesId") REFERENCES "ComicSeries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		);
		CREATE INDEX IF NOT EXISTS "ComicSeriesCategory_categoryId_idx" ON "ComicSeriesCategory"("categoryId");`,
	})
}
