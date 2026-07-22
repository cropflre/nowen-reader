package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     38,
		Description: "Add index for comicId and seriesId on ComicSeriesItem for efficient series view queries",
		SQL: strings.Join([]string{
			`CREATE INDEX IF NOT EXISTS "ComicSeriesItem_comicId_idx" ON "ComicSeriesItem"("comicId");`,
			`CREATE INDEX IF NOT EXISTS "ComicSeriesItem_seriesId_idx" ON "ComicSeriesItem"("seriesId");`,
		}, "\n"),
	})
}
