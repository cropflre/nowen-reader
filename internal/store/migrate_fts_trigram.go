package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     48,
		Description: "Upgrade ComicFTS to trigram tokenizer, narrow update trigger, and drop legacy ReadingGoal unique index",
		SQL: strings.Join([]string{
			`DROP INDEX IF EXISTS "ReadingGoal_goalType_key";`,
			`DROP TRIGGER IF EXISTS "Comic_ai_fts";`,
			`DROP TRIGGER IF EXISTS "Comic_ad_fts";`,
			`DROP TRIGGER IF EXISTS "Comic_au_fts";`,
			`DROP TABLE IF EXISTS "ComicFTS";`,
			`CREATE VIRTUAL TABLE "ComicFTS" USING fts5(title, author, filename, description, seriesName, genre, content="Comic", content_rowid="rowid", tokenize='trigram');`,
			`CREATE TRIGGER IF NOT EXISTS "Comic_ai_fts" AFTER INSERT ON "Comic" BEGIN INSERT INTO "ComicFTS"(rowid, title, author, filename, description, seriesName, genre) VALUES (new.rowid, new.title, new.author, new.filename, new.description, new.seriesName, new.genre); END;`,
			`CREATE TRIGGER IF NOT EXISTS "Comic_ad_fts" AFTER DELETE ON "Comic" BEGIN INSERT INTO "ComicFTS"("ComicFTS", rowid, title, author, filename, description, seriesName, genre) VALUES ('delete', old.rowid, old.title, old.author, old.filename, old.description, old.seriesName, old.genre); END;`,
			`CREATE TRIGGER IF NOT EXISTS "Comic_au_fts" AFTER UPDATE OF "title", "author", "filename", "description", "seriesName", "genre" ON "Comic" BEGIN INSERT INTO "ComicFTS"("ComicFTS", rowid, title, author, filename, description, seriesName, genre) VALUES ('delete', old.rowid, old.title, old.author, old.filename, old.description, old.seriesName, old.genre); INSERT INTO "ComicFTS"(rowid, title, author, filename, description, seriesName, genre) VALUES (new.rowid, new.title, new.author, new.filename, new.description, new.seriesName, new.genre); END;`,
			`INSERT INTO "ComicFTS"("ComicFTS") VALUES('rebuild');`,
		}, "\n"),
	})
}
