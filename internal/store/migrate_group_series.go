package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     37,
		Description: "Add ComicGroupSeries relationship table for linking comic series to groups",
		SQL: strings.Join([]string{
			`CREATE TABLE IF NOT EXISTS "ComicGroupSeries" (
				"groupId" INTEGER NOT NULL,
				"seriesId" TEXT NOT NULL,
				"sortIndex" INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY ("groupId", "seriesId"),
				CONSTRAINT "ComicGroupSeries_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ComicGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "ComicGroupSeries_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ComicSeries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS "ComicGroupSeries_groupId_idx" ON "ComicGroupSeries"("groupId", "sortIndex");`,
		}, "\n"),
	})
}
