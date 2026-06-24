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
	// 在 DSN 中通过 _pragma 参数设置 foreign_keys=ON，确保连接池中的每个连接都启用外键约束
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)", dbPath)
	db, err = sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Connection pool settings for SQLite (WAL mode supports concurrent reads)
	db.SetMaxOpenConns(8) // 万级数据量下允许更多并发读操作
	db.SetMaxIdleConns(4)

	// Verify connection
	if err := db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Apply performance PRAGMAs (matching Node.js version)
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 5000", // 等待锁最多5秒，避免并发写入时查询立即失败
		"PRAGMA synchronous = NORMAL",
		"PRAGMA mmap_size = 268435456", // 256MB
		"PRAGMA cache_size = -64000",   // 64MB
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

	// 自动完整性检查与索引修复
	if os.Getenv("SKIP_INTEGRITY_CHECK") == "" {
		if err := autoRepairIndexes(); err != nil {
			log.Printf("[DB] Warning: auto-repair failed: %v", err)
		}
	}

	return nil
}

// autoRepairIndexes 检查数据库索引完整性，发现损坏时自动执行 REINDEX 修复。
func autoRepairIndexes() error {
	rows, err := db.Query("PRAGMA integrity_check(1)")
	if err != nil {
		return fmt.Errorf("integrity_check failed: %w", err)
	}
	defer rows.Close()

	var result string
	if rows.Next() {
		rows.Scan(&result)
	}

	if result == "ok" {
		return nil
	}

	log.Printf("[DB] ⚠️ 检测到数据库完整性问题: %s", result)
	log.Println("[DB] 正在自动修复索引 (REINDEX)...")

	if _, err := db.Exec("REINDEX"); err != nil {
		return fmt.Errorf("REINDEX failed: %w", err)
	}

	log.Println("[DB] ✅ 索引修复完成")
	return nil
}

// DBStats 数据库状态信息
type DBStats struct {
	Path string `json:"path"`
}

// GetDBStats 返回数据库状态信息。
func GetDBStats() *DBStats {
	if db == nil { return nil }
	var path string
	if err := db.QueryRow(`PRAGMA database_list`).Scan(new(int), new(string), &path); err != nil {
		return nil
	}
	return &DBStats{Path: path}
}

// CountComics 返回漫画总数。
func CountComics() (int, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM "Comic"`).Scan(&count)
	return count, err
}

// CloseDB
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
			"aiEnabled" BOOLEAN NOT NULL DEFAULT 0,
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
			"genre"          TEXT NOT NULL DEFAULT '',
			"seriesName"     TEXT NOT NULL DEFAULT '',
			"seriesIndex"    REAL NOT NULL DEFAULT 0,
			"metadataSource" TEXT NOT NULL DEFAULT '',
			"coverImageUrl"  TEXT NOT NULL DEFAULT '',
			"coverAspectRatio" REAL NOT NULL DEFAULT 0,
			"type"           TEXT NOT NULL DEFAULT 'comic',
			"readingStatus"  TEXT NOT NULL DEFAULT '',
			"missingSince"   DATETIME
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "Comic_filename_key" ON "Comic"("filename")`,
		`CREATE INDEX IF NOT EXISTS "Comic_title_idx" ON "Comic"("title")`,
		`CREATE INDEX IF NOT EXISTS "Comic_isFavorite_idx" ON "Comic"("isFavorite")`,
		`CREATE INDEX IF NOT EXISTS "Comic_lastReadAt_idx" ON "Comic"("lastReadAt")`,
		`CREATE INDEX IF NOT EXISTS "Comic_sortOrder_idx" ON "Comic"("sortOrder")`,
		`CREATE INDEX IF NOT EXISTS "Comic_seriesName_idx" ON "Comic"("seriesName")`,
		`CREATE INDEX IF NOT EXISTS "Comic_author_idx" ON "Comic"("author")`,
		`CREATE INDEX IF NOT EXISTS "Comic_rating_idx" ON "Comic"("rating")`,
		`CREATE INDEX IF NOT EXISTS "Comic_addedAt_idx" ON "Comic"("addedAt")`,
		`CREATE INDEX IF NOT EXISTS "Comic_fileSize_pageCount_idx" ON "Comic"("fileSize", "pageCount")`,
		`CREATE INDEX IF NOT EXISTS "Comic_type_idx" ON "Comic"("type")`,

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
			"userId"    TEXT NOT NULL DEFAULT '',
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
		`CREATE INDEX IF NOT EXISTS "ReadingSession_userId_idx" ON "ReadingSession"("userId")`,

		// ============================================================
		// ReadingGoal (阅读目标)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "ReadingGoal" (
			"id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			"goalType"    TEXT NOT NULL,
			"userId"      TEXT NOT NULL DEFAULT '',
			"targetMins"  INTEGER NOT NULL DEFAULT 0,
			"targetBooks" INTEGER NOT NULL DEFAULT 0,
			"createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS "ReadingGoal_userId_goalType_key" ON "ReadingGoal"("userId", "goalType")`,

		// ============================================================
		// ComicGroup (自定义合并分组)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "ComicGroup" (
			"id"          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			"name"        TEXT NOT NULL,
			"userId"      TEXT NOT NULL DEFAULT '',
			"coverUrl"    TEXT NOT NULL DEFAULT '',
			"sortOrder"   INTEGER NOT NULL DEFAULT 0,
			"author"      TEXT NOT NULL DEFAULT '',
			"description" TEXT NOT NULL DEFAULT '',
			"tags"        TEXT NOT NULL DEFAULT '',
			"year"        INTEGER,
			"publisher"   TEXT NOT NULL DEFAULT '',
			"language"    TEXT NOT NULL DEFAULT '',
			"genre"       TEXT NOT NULL DEFAULT '',
			"status"      TEXT NOT NULL DEFAULT '',
			"createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS "ComicGroup_name_idx" ON "ComicGroup"("name")`,
		`CREATE INDEX IF NOT EXISTS "ComicGroup_userId_idx" ON "ComicGroup"("userId")`,

		// ============================================================
		// ComicGroupItem (分组内漫画关联)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "ComicGroupItem" (
			"groupId" INTEGER NOT NULL,
			"comicId" TEXT NOT NULL,
			"sortIndex" INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY ("groupId", "comicId"),
			CONSTRAINT "ComicGroupItem_groupId_fkey" FOREIGN KEY ("groupId")
				REFERENCES "ComicGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "ComicGroupItem_comicId_fkey" FOREIGN KEY ("comicId")
				REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "ComicGroupItem_comicId_idx" ON "ComicGroupItem"("comicId")`,

		// ============================================================
		// GroupCategory (系列-分类多对多关联)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "GroupCategory" (
			"groupId"    INTEGER NOT NULL,
			"categoryId" INTEGER NOT NULL,
			PRIMARY KEY ("groupId", "categoryId"),
			CONSTRAINT "GroupCategory_groupId_fkey" FOREIGN KEY ("groupId")
				REFERENCES "ComicGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "GroupCategory_categoryId_fkey" FOREIGN KEY ("categoryId")
				REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "GroupCategory_categoryId_idx" ON "GroupCategory"("categoryId")`,

		// ============================================================
		// UserComicState (用户个人漫画状态)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "UserComicState" (
			"userId"        TEXT NOT NULL,
			"comicId"       TEXT NOT NULL,
			"lastReadPage"  INTEGER NOT NULL DEFAULT 0,
			"lastReadAt"    DATETIME,
			"isFavorite"    BOOLEAN NOT NULL DEFAULT 0,
			"rating"        INTEGER,
			"totalReadTime" INTEGER NOT NULL DEFAULT 0,
			"readingStatus" TEXT NOT NULL DEFAULT '',
			PRIMARY KEY ("userId", "comicId"),
			CONSTRAINT "UCS_userId_fkey" FOREIGN KEY ("userId")
				REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "UCS_comicId_fkey" FOREIGN KEY ("comicId")
				REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "UCS_comicId_idx" ON "UserComicState"("comicId")`,
		`CREATE INDEX IF NOT EXISTS "UCS_userId_fav_idx" ON "UserComicState"("userId", "isFavorite")`,
		`CREATE INDEX IF NOT EXISTS "UCS_userId_status_idx" ON "UserComicState"("userId", "readingStatus")`,
		`CREATE INDEX IF NOT EXISTS "UCS_userId_lastReadAt_idx" ON "UserComicState"("userId", "lastReadAt" DESC)`,

		// ============================================================
		// FTS5 全文搜索虚拟表
		// ============================================================
		`CREATE VIRTUAL TABLE IF NOT EXISTS "ComicFTS" USING fts5(
			title, author, filename, description, genre,
			content="Comic", content_rowid="rowid"
		)`,

		// 触发器：插入时同步到 FTS
		`CREATE TRIGGER IF NOT EXISTS "Comic_ai_fts" AFTER INSERT ON "Comic" BEGIN
			INSERT INTO "ComicFTS"(rowid, title, author, filename, description, genre)
			VALUES (new.rowid, new.title, new.author, new.filename, new.description, new.genre);
		END`,

		// 触发器：删除时同步到 FTS
		`CREATE TRIGGER IF NOT EXISTS "Comic_ad_fts" AFTER DELETE ON "Comic" BEGIN
			INSERT INTO "ComicFTS"("ComicFTS", rowid, title, author, filename, description, genre)
			VALUES ('delete', old.rowid, old.title, old.author, old.filename, old.description, old.genre);
		END`,

		// 触发器：更新时同步到 FTS
		`CREATE TRIGGER IF NOT EXISTS "Comic_au_fts" AFTER UPDATE ON "Comic" BEGIN
			INSERT INTO "ComicFTS"("ComicFTS", rowid, title, author, filename, description, genre)
			VALUES ('delete', old.rowid, old.title, old.author, old.filename, old.description, old.genre);
			INSERT INTO "ComicFTS"(rowid, title, author, filename, description, genre)
			VALUES (new.rowid, new.title, new.author, new.filename, new.description, new.genre);
		END`,

		// ============================================================
		// Library (书库)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "Library" (
			"id"            TEXT NOT NULL PRIMARY KEY,
			"name"          TEXT NOT NULL,
			"type"          TEXT NOT NULL DEFAULT "comic",
			"rootPath"      TEXT NOT NULL,
			"enabled"       BOOLEAN NOT NULL DEFAULT 1,
			"sortOrder"     INTEGER NOT NULL DEFAULT 0,
			"defaultAccess" TEXT NOT NULL DEFAULT "private",
			"lastScanAt"    DATETIME,
			"lastScanAdded" INTEGER NOT NULL DEFAULT 0,
			"lastScanTotal" INTEGER NOT NULL DEFAULT 0,
			"scanEnabled"   BOOLEAN NOT NULL DEFAULT 1,
			"createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS "Library_name_idx" ON "Library"("name")`,
		`CREATE INDEX IF NOT EXISTS "Library_type_idx" ON "Library"("type")`,
		`CREATE INDEX IF NOT EXISTS "Library_enabled_idx" ON "Library"("enabled")`,

		// ============================================================
		// library_root_paths (书库多目录支持)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "library_root_paths" (
			"id" INTEGER PRIMARY KEY AUTOINCREMENT,
			"libraryId" TEXT NOT NULL,
			"rootPath" TEXT NOT NULL,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE,
			UNIQUE("libraryId", "rootPath")
		)`,
		`CREATE INDEX IF NOT EXISTS "idx_library_root_paths_libraryId" ON "library_root_paths"("libraryId")`,

		// ============================================================
		// UserLibraryAccess (用户书库权限)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "UserLibraryAccess" (
			"userId"    TEXT NOT NULL,
			"libraryId" TEXT NOT NULL,
			"canView"   BOOLEAN NOT NULL DEFAULT 1,
			"canDownload" BOOLEAN NOT NULL DEFAULT 0,
			"canManage" BOOLEAN NOT NULL DEFAULT 0,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY ("userId", "libraryId"),
			CONSTRAINT "ULA_userId_fkey" FOREIGN KEY ("userId")
				REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "ULA_libraryId_fkey" FOREIGN KEY ("libraryId")
				REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "ULA_userId_idx" ON "UserLibraryAccess"("userId")`,
		`CREATE INDEX IF NOT EXISTS "ULA_libraryId_idx" ON "UserLibraryAccess"("libraryId")`,

		// ============================================================
		// UserGroup (用户组)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "UserGroup" (
			"id"          TEXT NOT NULL PRIMARY KEY,
			"name"        TEXT NOT NULL,
			"description" TEXT NOT NULL DEFAULT "",
			"createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,

		// ============================================================
		// UserGroupMember (用户组成员)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "UserGroupMember" (
			"groupId"   TEXT NOT NULL,
			"userId"    TEXT NOT NULL,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY ("groupId", "userId"),
			CONSTRAINT "UGM_groupId_fkey" FOREIGN KEY ("groupId")
				REFERENCES "UserGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "UGM_userId_fkey" FOREIGN KEY ("userId")
				REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "UGM_groupId_idx" ON "UserGroupMember"("groupId")`,
		`CREATE INDEX IF NOT EXISTS "UGM_userId_idx" ON "UserGroupMember"("userId")`,

		// ============================================================
		// GroupLibraryAccess (用户组书库权限)
		// ============================================================
		`CREATE TABLE IF NOT EXISTS "GroupLibraryAccess" (
			"groupId"   TEXT NOT NULL,
			"libraryId" TEXT NOT NULL,
			"canView"   BOOLEAN NOT NULL DEFAULT 1,
			"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY ("groupId", "libraryId"),
			CONSTRAINT "GLA_groupId_fkey" FOREIGN KEY ("groupId")
				REFERENCES "UserGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
			CONSTRAINT "GLA_libraryId_fkey" FOREIGN KEY ("libraryId")
				REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS "GLA_groupId_idx" ON "GroupLibraryAccess"("groupId")`,
		`CREATE INDEX IF NOT EXISTS "GLA_libraryId_idx" ON "GroupLibraryAccess"("libraryId")`,
	}

	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("[DB] Warning executing schema: %v (stmt truncated: %.100s)", err, stmt)
			// Continue - table may already exist with slightly different schema
		}
	}

	return nil
}



