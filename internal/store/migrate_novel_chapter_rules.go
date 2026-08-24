package store

func init() {
	Migrations = append(Migrations, Migration{
		Version:     43,
		Description: "Add configurable TXT novel chapter rules and per-book selection",
		SQL: `CREATE TABLE IF NOT EXISTS "NovelChapterRule" (
		        "id" TEXT NOT NULL PRIMARY KEY,
		        "name" TEXT NOT NULL,
		        "pattern" TEXT NOT NULL,
		        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		      );
		      CREATE TABLE IF NOT EXISTS "ComicChapterRule" (
		        "comicId" TEXT NOT NULL PRIMARY KEY,
		        "ruleId" TEXT NOT NULL DEFAULT 'auto',
		        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		        CONSTRAINT "ComicChapterRule_comicId_fkey" FOREIGN KEY ("comicId")
		          REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		      );
		      CREATE INDEX IF NOT EXISTS "ComicChapterRule_ruleId_idx" ON "ComicChapterRule"("ruleId");`,
	})
}
