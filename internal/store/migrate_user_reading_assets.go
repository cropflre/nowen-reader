package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     49,
		Description: "Add UserComicState.lastReadPositionRatio and UserBookmark, UserHighlight, UserReaderPreference tables",
		SQL: strings.Join([]string{
			`ALTER TABLE "UserComicState" ADD COLUMN "lastReadPositionRatio" REAL NOT NULL DEFAULT 0;`,
			`CREATE TABLE IF NOT EXISTS "UserBookmark" (
				"id"            TEXT NOT NULL,
				"userId"        TEXT NOT NULL,
				"comicId"       TEXT NOT NULL,
				"pageIndex"     INTEGER NOT NULL DEFAULT 0,
				"positionRatio" REAL NOT NULL DEFAULT 0,
				"chapterTitle"  TEXT NOT NULL DEFAULT '',
				"name"          TEXT NOT NULL DEFAULT '',
				"note"          TEXT NOT NULL DEFAULT '',
				"createdAt"     INTEGER NOT NULL,
				"updatedAt"     INTEGER NOT NULL,
				PRIMARY KEY ("userId", "id"),
				CONSTRAINT "UB_userId_fkey" FOREIGN KEY ("userId")
					REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "UB_comicId_fkey" FOREIGN KEY ("comicId")
					REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS "UserBookmark_user_comic_idx"
				ON "UserBookmark"("userId", "comicId", "pageIndex", "positionRatio");`,
			`CREATE INDEX IF NOT EXISTS "UserBookmark_user_updated_idx"
				ON "UserBookmark"("userId", "updatedAt" DESC);`,
			`CREATE TABLE IF NOT EXISTS "UserHighlight" (
				"id"           TEXT NOT NULL,
				"userId"       TEXT NOT NULL,
				"comicId"      TEXT NOT NULL,
				"chapterIndex" INTEGER NOT NULL DEFAULT 0,
				"chapterTitle" TEXT NOT NULL DEFAULT '',
				"text"         TEXT NOT NULL,
				"note"         TEXT NOT NULL DEFAULT '',
				"color"        TEXT NOT NULL DEFAULT 'amber',
				"startOffset"  INTEGER NOT NULL DEFAULT -1,
				"createdAt"    INTEGER NOT NULL,
				"updatedAt"    INTEGER NOT NULL,
				PRIMARY KEY ("userId", "id"),
				CONSTRAINT "UH_userId_fkey" FOREIGN KEY ("userId")
					REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "UH_comicId_fkey" FOREIGN KEY ("comicId")
					REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS "UserHighlight_user_comic_idx"
				ON "UserHighlight"("userId", "comicId", "chapterIndex");`,
			`CREATE INDEX IF NOT EXISTS "UserHighlight_user_updated_idx"
				ON "UserHighlight"("userId", "updatedAt" DESC);`,
			`CREATE TABLE IF NOT EXISTS "UserReaderPreference" (
				"userId"    TEXT NOT NULL,
				"scope"     TEXT NOT NULL,
				"prefsJson" TEXT NOT NULL DEFAULT '{}',
				"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY ("userId", "scope"),
				CONSTRAINT "URP_userId_fkey" FOREIGN KEY ("userId")
					REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
		}, "\n"),
	})
}
