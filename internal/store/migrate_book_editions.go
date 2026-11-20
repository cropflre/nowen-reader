package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     47,
		Description: "Add multi-format edition grouping tables, comic edition keys, and library editionMergeScope",
		SQL: strings.Join([]string{
			`ALTER TABLE "Library" ADD COLUMN "editionMergeScope" TEXT NOT NULL DEFAULT 'directory';`,
			`UPDATE "Library" SET "editionMergeScope" = 'directory' WHERE "editionMergeScope" IS NULL OR "editionMergeScope" NOT IN ('directory', 'library', 'global');`,
			`CREATE TRIGGER IF NOT EXISTS "Library_editionMergeScope_insert_check" BEFORE INSERT ON "Library" WHEN NEW."editionMergeScope" NOT IN ('directory', 'library', 'global') BEGIN SELECT RAISE(ABORT, 'invalid library editionMergeScope'); END;`,
			`CREATE TRIGGER IF NOT EXISTS "Library_editionMergeScope_update_check" BEFORE UPDATE OF "editionMergeScope" ON "Library" WHEN NEW."editionMergeScope" NOT IN ('directory', 'library', 'global') BEGIN SELECT RAISE(ABORT, 'invalid library editionMergeScope'); END;`,
			`ALTER TABLE "Comic" ADD COLUMN "format" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "Comic" ADD COLUMN "editionStemKey" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "Comic" ADD COLUMN "editionMatchKey" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "Comic" ADD COLUMN "editionLabel" TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE "Comic" ADD COLUMN "editionSplitLocked" BOOLEAN NOT NULL DEFAULT 0;`,
			`CREATE INDEX IF NOT EXISTS "Comic_library_editionStem_idx" ON "Comic"("libraryId", "editionStemKey");`,
			`CREATE INDEX IF NOT EXISTS "Comic_type_editionMatch_idx" ON "Comic"("type", "editionMatchKey");`,
			`CREATE INDEX IF NOT EXISTS "Comic_format_idx" ON "Comic"("format");`,
			`CREATE TABLE IF NOT EXISTS "BookEditionGroup" (
				"id"             TEXT NOT NULL PRIMARY KEY,
				"contentType"    TEXT NOT NULL,
				"mergeScope"     TEXT NOT NULL,
				"matchKey"       TEXT NOT NULL,
				"title"          TEXT NOT NULL,
				"sortTitle"      TEXT NOT NULL DEFAULT '',
				"defaultComicId" TEXT NOT NULL DEFAULT '',
				"formatsJson"    TEXT NOT NULL DEFAULT '[]',
				"editionCount"   INTEGER NOT NULL DEFAULT 0,
				"manualLocked"   BOOLEAN NOT NULL DEFAULT 0,
				"createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			);`,
			`CREATE INDEX IF NOT EXISTS "BookEditionGroup_type_sort_idx" ON "BookEditionGroup"("contentType", "sortTitle");`,
			`CREATE TABLE IF NOT EXISTS "BookEditionItem" (
				"groupId"         TEXT NOT NULL,
				"comicId"         TEXT NOT NULL,
				"libraryId"       TEXT NOT NULL,
				"format"          TEXT NOT NULL,
				"editionLabel"    TEXT NOT NULL DEFAULT '',
				"formatPriority"  INTEGER NOT NULL DEFAULT 99,
				"isFormatPrimary" BOOLEAN NOT NULL DEFAULT 0,
				"sortIndex"       INTEGER NOT NULL DEFAULT 0,
				"detectionSource" TEXT NOT NULL DEFAULT 'auto',
				PRIMARY KEY ("groupId", "comicId"),
				CONSTRAINT "BEI_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BookEditionGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "BEI_comicId_fkey" FOREIGN KEY ("comicId") REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE UNIQUE INDEX IF NOT EXISTS "BookEditionItem_comicId_key" ON "BookEditionItem"("comicId");`,
			`CREATE INDEX IF NOT EXISTS "BookEditionItem_group_priority_idx" ON "BookEditionItem"("groupId", "formatPriority", "sortIndex");`,
			`CREATE INDEX IF NOT EXISTS "BookEditionItem_libraryId_idx" ON "BookEditionItem"("libraryId");`,
			`DROP TRIGGER IF EXISTS series_source_library_update;`,
			`CREATE TRIGGER series_source_library_update AFTER UPDATE OF "id", "type", "enabled", "seriesDepth", "editionMergeScope" ON "Library" WHEN OLD."id" IS NOT NEW."id" OR OLD."type" IS NOT NEW."type" OR OLD."enabled" IS NOT NEW."enabled" OR OLD."seriesDepth" IS NOT NEW."seriesDepth" OR OLD."editionMergeScope" IS NOT NEW."editionMergeScope" BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;`,
			`DROP TRIGGER IF EXISTS series_source_comic_update;`,
			`CREATE TRIGGER series_source_comic_update AFTER UPDATE OF "id", "libraryId", "relativePath", "filename", "title", "type", "author", "editionSplitLocked" ON "Comic" WHEN OLD."id" IS NOT NEW."id" OR OLD."libraryId" IS NOT NEW."libraryId" OR OLD."relativePath" IS NOT NEW."relativePath" OR OLD."filename" IS NOT NEW."filename" OR OLD."title" IS NOT NEW."title" OR OLD."type" IS NOT NEW."type" OR OLD."author" IS NOT NEW."author" OR OLD."editionSplitLocked" IS NOT NEW."editionSplitLocked" BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;`,
		}, "\n"),
	})
}
