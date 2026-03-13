package store

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var db *sql.DB

// DB returns the global database connection.
func DB() *sql.DB {
	return db
}

// InitDB opens the SQLite database and creates tables if needed.
func InitDB(dbPath string) error {
	// Ensure parent directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create db directory %s: %w", dir, err)
	}

	var err error
	// modernc.org/sqlite uses "sqlite" as driver name
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Connection pool settings for SQLite
	db.SetMaxOpenConns(1) // SQLite only supports one writer at a time
	db.SetMaxIdleConns(1)

	// Verify connection
	if err := db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Apply performance PRAGMAs (matching Node.js version)
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA mmap_size = 268435456",  // 256MB
		"PRAGMA cache_size = -64000",     // 64MB
		"PRAGMA temp_store = MEMORY",
		"PRAGMA foreign_keys = ON",
	}
	for _, pragma := range pragmas {
		if _, err := db.Exec(pragma); err != nil {
			log.Printf("[DB] Warning: failed to set %s: %v", pragma, err)
		}
	}
	log.Println("[DB] SQLite 内存加速引擎已启动 🚀")

	// Create tables
	if err := createTables(); err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}

	log.Println("[DB] Database schema ready.")
	return nil
}

// CloseDB closes the database connection.
func CloseDB() {
	if db != nil {
		_ = db.Close()
	}
}

// createTables creates all tables and indexes if they don't exist.
// This mirrors db-init.mjs + the complete Prisma schema indexes.
func createTables() error {
	statements := []string{
		// ============================================================
		// User
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "User" (
			"id"        TEXT NOT NULL PRIMARY KEY,
			"username"  TEXT NOT NULL,
			"password"  TEXT NOT NULL,
			"nickname"  TEXT NOT NULL DEFAULT '',
			"role"      TEXT NOT NULL DEFAULT 'user',
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username")`,
		`CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username")`,

		// ============================================================
		// UserSession
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "UserSession" (
			"id"        TEXT NOT NULL PRIMARY KEY,
			"userId"    TEXT NOT NULL,
			"expiresAt" DATETIME NOT NULL,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId")
				REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "UserSession_userId_idx" ON "UserSession"("userId")`,
		`CREATE INDEX IF NOT EXISTS "UserSession_expiresAt_idx" ON "UserSession"("expiresAt")`,

		// ============================================================
		// Comic
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "Comic" (
			"id"             TEXT NOT NULL PRIMARY KEY,
			"filename"       TEXT NOT NULL,
			"title"          TEXT NOT NULL,
			"pageCount"      INTEGER NOT NULL DEFAULT 0,
			"fileSize"       INTEGER NOT NULL DEFAULT 0,
			"addedAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"lastReadPage"   INTEGER NOT NULL DEFAULT 0,
			"lastReadAt"     DATETIME,
			"isFavorite"     BOOLEAN NOT NULL DEFAULT 0,
			"rating"         INTEGER,
			"sortOrder"      INTEGER NOT NULL DEFAULT 0,
			"totalReadTime"  INTEGER NOT NULL DEFAULT 0,
			"author"         TEXT NOT NULL DEFAULT '',
			"publisher"      TEXT NOT NULL DEFAULT '',
			"year"           INTEGER,
			"description"    TEXT NOT NULL DEFAULT '',
			"language"       TEXT NOT NULL DEFAULT '',
			"seriesName"     TEXT NOT NULL DEFAULT '',
			"seriesIndex"    INTEGER,
			"genre"          TEXT NOT NULL DEFAULT '',
			"metadataSource" TEXT NOT NULL DEFAULT '',
			"coverImageUrl"  TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "Comic_filename_key" ON "Comic"("filename")`,
		`CREATE INDEX IF NOT EXISTS "Comic_title_idx" ON "Comic"("title")`,
		`CREATE INDEX IF NOT EXISTS "Comic_isFavorite_idx" ON "Comic"("isFavorite")`,
		`CREATE INDEX IF NOT EXISTS "Comic_lastReadAt_idx" ON "Comic"("lastReadAt")`,
		`CREATE INDEX IF NOT EXISTS "Comic_sortOrder_idx" ON "Comic"("sortOrder")`,
		`CREATE INDEX IF NOT EXISTS "Comic_author_idx" ON "Comic"("author")`,
		`CREATE INDEX IF NOT EXISTS "Comic_seriesName_idx" ON "Comic"("seriesName")`,
		`CREATE INDEX IF NOT EXISTS "Comic_rating_idx" ON "Comic"("rating")`,
		`CREATE INDEX IF NOT EXISTS "Comic_addedAt_idx" ON "Comic"("addedAt")`,
		`CREATE INDEX IF NOT EXISTS "Comic_fileSize_pageCount_idx" ON "Comic"("fileSize", "pageCount")`,

		// ============================================================
		// Tag
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "Tag" (
			"id"    INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			"name"  TEXT NOT NULL,
			"color" TEXT NOT NULL DEFAULT 'default'
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "Tag_name_key" ON "Tag"("name")`,
		`CREATE INDEX IF NOT EXISTS "Tag_name_idx" ON "Tag"("name")`,

		// ============================================================
		// ComicTag
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "ComicTag" (
			"comicId" TEXT NOT NULL,
			"tagId"   INTEGER NOT NULL,
			PRIMARY KEY ("comicId", "tagId"),
			CONSTRAINT "ComicTag_comicId_fkey" FOREIGN KEY ("comicId")
				REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "ComicTag_tagId_fkey" FOREIGN KEY ("tagId")
				REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "ComicTag_tagId_idx" ON "ComicTag"("tagId")`,

		// ============================================================
		// Category
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "Category" (
			"id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			"name"      TEXT NOT NULL,
			"slug"      TEXT NOT NULL,
			"icon"      TEXT NOT NULL DEFAULT '📚',
			"sortOrder" INTEGER NOT NULL DEFAULT 0,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name")`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "Category_slug_key" ON "Category"("slug")`,
		`CREATE INDEX IF NOT EXISTS "Category_slug_idx" ON "Category"("slug")`,
		`CREATE INDEX IF NOT EXISTS "Category_sortOrder_idx" ON "Category"("sortOrder")`,

		// ============================================================
		// ComicCategory
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "ComicCategory" (
			"comicId"    TEXT NOT NULL,
			"categoryId" INTEGER NOT NULL,
			PRIMARY KEY ("comicId", "categoryId"),
			CONSTRAINT "ComicCategory_comicId_fkey" FOREIGN KEY ("comicId")
				REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "ComicCategory_categoryId_fkey" FOREIGN KEY ("categoryId")
				REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "ComicCategory_categoryId_idx" ON "ComicCategory"("categoryId")`,

		// ============================================================
		// ReadingSession
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "ReadingSession" (
			"id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			"comicId"   TEXT NOT NULL,
			"startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"endedAt"   DATETIME,
			"duration"  INTEGER NOT NULL DEFAULT 0,
			"startPage" INTEGER NOT NULL DEFAULT 0,
			"endPage"   INTEGER NOT NULL DEFAULT 0,
			CONSTRAINT "ReadingSession_comicId_fkey" FOREIGN KEY ("comicId")
				REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "ReadingSession_comicId_idx" ON "ReadingSession"("comicId")`,
		`CREATE INDEX IF NOT EXISTS "ReadingSession_startedAt_idx" ON "ReadingSession"("startedAt")`,
	}

	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("[DB] Warning executing schema: %v (stmt truncated: %.100s)", err, stmt)
			// Continue - table may already exist with slightly different schema
		}
	}

	return nil
}
