package store

func init() {
	Migrations = append(Migrations, Migration{
		Version:     45,
		Description: "Track structural series changes independently of reading progress",
		SQL: `CREATE TABLE IF NOT EXISTS "ComicSeriesSourceRevision" (
            "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
            "revision" INTEGER NOT NULL DEFAULT 0,
            "builtRevision" INTEGER NOT NULL DEFAULT -1
        );
        INSERT OR IGNORE INTO "ComicSeriesSourceRevision" ("id") VALUES (1);
        CREATE TRIGGER IF NOT EXISTS series_source_comic_insert AFTER INSERT ON "Comic"
        BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;
        CREATE TRIGGER IF NOT EXISTS series_source_comic_delete AFTER DELETE ON "Comic"
        BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;
        CREATE TRIGGER IF NOT EXISTS series_source_comic_update
        AFTER UPDATE OF "id", "libraryId", "relativePath", "filename", "title", "type" ON "Comic"
        WHEN OLD."id" IS NOT NEW."id" OR OLD."libraryId" IS NOT NEW."libraryId"
          OR OLD."relativePath" IS NOT NEW."relativePath" OR OLD."filename" IS NOT NEW."filename"
          OR OLD."title" IS NOT NEW."title" OR OLD."type" IS NOT NEW."type"
        BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;
        CREATE TRIGGER IF NOT EXISTS series_source_library_insert AFTER INSERT ON "Library"
        BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;
        CREATE TRIGGER IF NOT EXISTS series_source_library_delete AFTER DELETE ON "Library"
        BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;
        CREATE TRIGGER IF NOT EXISTS series_source_library_update
        AFTER UPDATE OF "id", "type", "enabled" ON "Library"
        WHEN OLD."id" IS NOT NEW."id" OR OLD."type" IS NOT NEW."type" OR OLD."enabled" IS NOT NEW."enabled"
        BEGIN UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1; END;`,
	})
}
