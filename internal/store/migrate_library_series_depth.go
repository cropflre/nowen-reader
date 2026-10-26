package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     46,
		Description: "Add Library.seriesDepth configuration, snapshot archive table, and revision trigger",
		SQL: strings.Join([]string{
			`ALTER TABLE "Library" ADD COLUMN "seriesDepth" INTEGER NOT NULL DEFAULT 1;`,
			`UPDATE "Library" SET "seriesDepth" = 1 WHERE "seriesDepth" IS NULL OR "seriesDepth" < 1 OR "seriesDepth" > 8 OR "type" = 'novel';`,
			`CREATE TRIGGER IF NOT EXISTS "Library_seriesDepth_insert_check" BEFORE INSERT ON "Library" WHEN TYPEOF(NEW."seriesDepth") != 'integer' OR NEW."seriesDepth" < 1 OR NEW."seriesDepth" > 8 OR (NEW."type" = 'novel' AND NEW."seriesDepth" != 1) BEGIN SELECT RAISE(ABORT, 'invalid library seriesDepth'); END;`,
			`CREATE TRIGGER IF NOT EXISTS "Library_seriesDepth_update_check" BEFORE UPDATE OF "type", "seriesDepth" ON "Library" WHEN TYPEOF(NEW."seriesDepth") != 'integer' OR NEW."seriesDepth" < 1 OR NEW."seriesDepth" > 8 OR (NEW."type" = 'novel' AND NEW."seriesDepth" != 1) BEGIN SELECT RAISE(ABORT, 'invalid library seriesDepth'); END;`,
			`DROP TRIGGER IF EXISTS series_source_library_update;`,
			`CREATE TRIGGER series_source_library_update AFTER UPDATE OF "id", "type", "enabled", "seriesDepth" ON "Library" WHEN OLD."id" IS NOT NEW."id" OR OLD."type" IS NOT NEW."type" OR OLD."enabled" IS NOT NEW."enabled" OR OLD."seriesDepth" IS NOT NEW."seriesDepth" BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;`,
			`CREATE TABLE IF NOT EXISTS "LibrarySeriesRebuildSnapshot" (
				"id"                     TEXT NOT NULL PRIMARY KEY,
				"libraryId"              TEXT NOT NULL,
				"schemaVersion"          INTEGER NOT NULL DEFAULT 1,
				"reason"                 TEXT NOT NULL DEFAULT 'depth_change',
				"previousSeriesDepth"    INTEGER NOT NULL,
				"nextSeriesDepth"        INTEGER NOT NULL,
				"sourceRevisionBefore"   INTEGER NOT NULL,
				"sourceRevisionAfter"    INTEGER NOT NULL,
				"postStateDigest"        TEXT NOT NULL DEFAULT '',
				"seriesCountBefore"      INTEGER NOT NULL DEFAULT 0,
				"seriesCountAfter"       INTEGER NOT NULL DEFAULT 0,
				"archivedSeriesCount"    INTEGER NOT NULL DEFAULT 0,
				"matchedSeriesCount"     INTEGER NOT NULL DEFAULT 0,
				"createdByUserId"        TEXT NOT NULL DEFAULT '',
				"restoredFromSnapshotId" TEXT NOT NULL DEFAULT '',
				"restoredAt"             DATETIME,
				"payloadJson"            TEXT NOT NULL,
				"createdAt"              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				CONSTRAINT "LSRS_libraryId_fkey" FOREIGN KEY ("libraryId")
					REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS "LibrarySeriesRebuildSnapshot_lib_created_idx" ON "LibrarySeriesRebuildSnapshot"("libraryId", "createdAt" DESC, "id" DESC);`,
		}, "\n"),
	})
}
