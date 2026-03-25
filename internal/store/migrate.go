package store

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

// ============================================================
// Schema Migration System
// ============================================================

// Migration represents a database schema migration.
type Migration struct {
	Version     int
	Description string
	SQL         string
}

// Migrations is the ordered list of all schema migrations.
// New migrations should be appended to the end with incrementing version numbers.
var Migrations = []Migration{
	{
		Version:     1,
		Description: "Initial schema (v0.1.0)",
		SQL:         "", // Base schema created by createTables()
	},
	{
		Version:     2,
		Description: "Add coverImageUrl field to Comic",
		SQL:         `ALTER TABLE "Comic" ADD COLUMN "coverImageUrl" TEXT NOT NULL DEFAULT '' ;`,
	},
	{
		Version:     3,
		Description: "Add composite index for duplicate detection",
		SQL:         `CREATE INDEX IF NOT EXISTS "Comic_fileSize_pageCount_idx" ON "Comic"("fileSize", "pageCount");`,
	},
	{
		Version:     4,
		Description: "Add reading stats aggregation indexes",
		SQL: strings.Join([]string{
			`CREATE INDEX IF NOT EXISTS "ReadingSession_duration_idx" ON "ReadingSession"("duration");`,
			`CREATE INDEX IF NOT EXISTS "Comic_totalReadTime_idx" ON "Comic"("totalReadTime");`,
		}, "\n"),
	},
	{
		Version:     5,
		Description: "Add type field to Comic for efficient content type filtering",
		SQL: strings.Join([]string{
			`ALTER TABLE "Comic" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'comic';`,
			`UPDATE "Comic" SET "type" = 'novel' WHERE "filename" LIKE '%.txt' OR "filename" LIKE '%.epub' OR "filename" LIKE '%.mobi' OR "filename" LIKE '%.azw3';`,
			`CREATE INDEX IF NOT EXISTS "Comic_type_idx" ON "Comic"("type");`,
		}, "\n"),
	},
	{
		Version:     6,
		Description: "Add readingStatus field for reading list (want/reading/finished/shelved)",
		SQL: strings.Join([]string{
			`ALTER TABLE "Comic" ADD COLUMN "readingStatus" TEXT NOT NULL DEFAULT '';`,
			`UPDATE "Comic" SET "readingStatus" = 'reading' WHERE "lastReadPage" > 0 AND "lastReadPage" < "pageCount";`,
			`UPDATE "Comic" SET "readingStatus" = 'finished' WHERE "pageCount" > 0 AND "lastReadPage" >= "pageCount";`,
			`CREATE INDEX IF NOT EXISTS "Comic_readingStatus_idx" ON "Comic"("readingStatus");`,
		}, "\n"),
	},
	{
		Version:     7,
		Description: "Add composite indexes for common query patterns",
		SQL: strings.Join([]string{
			// 常用列表查询：按标题排序 + 收藏筛选
			`CREATE INDEX IF NOT EXISTS "Comic_fav_title_idx" ON "Comic"("isFavorite", "title");`,
			// 常用列表查询：按添加时间倒序 + 类型筛选
			`CREATE INDEX IF NOT EXISTS "Comic_type_addedAt_idx" ON "Comic"("type", "addedAt" DESC);`,
			// 阅读状态 + 类型复合查询
			`CREATE INDEX IF NOT EXISTS "Comic_status_type_idx" ON "Comic"("readingStatus", "type");`,
			// 系列查询优化
			`CREATE INDEX IF NOT EXISTS "Comic_seriesName_idx" ON "Comic"("seriesName");`,
			// ReadingSession 查询优化
			`CREATE INDEX IF NOT EXISTS "ReadingSession_startedAt_idx" ON "ReadingSession"("startedAt" DESC);`,
		}, "\n"),
	},
	{
		Version:     8,
		Description: "Add FTS5 full-text search for comics (replace LIKE with FTS5)",
		SQL: strings.Join([]string{
			// 创建 FTS5 虚拟表（content-sync 模式，与 Comic 表联动）
			`CREATE VIRTUAL TABLE IF NOT EXISTS "ComicFTS" USING fts5(title, author, filename, description, seriesName, genre, content="Comic", content_rowid="rowid");`,
			// 触发器：插入时同步
			`CREATE TRIGGER IF NOT EXISTS "Comic_ai_fts" AFTER INSERT ON "Comic" BEGIN INSERT INTO "ComicFTS"(rowid, title, author, filename, description, seriesName, genre) VALUES (new.rowid, new.title, new.author, new.filename, new.description, new.seriesName, new.genre); END`,
			// 触发器：删除时同步
			`CREATE TRIGGER IF NOT EXISTS "Comic_ad_fts" AFTER DELETE ON "Comic" BEGIN INSERT INTO "ComicFTS"("ComicFTS", rowid, title, author, filename, description, seriesName, genre) VALUES ('delete', old.rowid, old.title, old.author, old.filename, old.description, old.seriesName, old.genre); END`,
			// 触发器：更新时同步
			`CREATE TRIGGER IF NOT EXISTS "Comic_au_fts" AFTER UPDATE ON "Comic" BEGIN INSERT INTO "ComicFTS"("ComicFTS", rowid, title, author, filename, description, seriesName, genre) VALUES ('delete', old.rowid, old.title, old.author, old.filename, old.description, old.seriesName, old.genre); INSERT INTO "ComicFTS"(rowid, title, author, filename, description, seriesName, genre) VALUES (new.rowid, new.title, new.author, new.filename, new.description, new.seriesName, new.genre); END`,
		}, "\n"),
	},
	{
		Version:     9,
		Description: "Add ComicGroup and ComicGroupItem tables for custom comic merging",
		SQL: strings.Join([]string{
			`CREATE TABLE IF NOT EXISTS "ComicGroup" (
				"id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				"name"      TEXT NOT NULL,
				"coverUrl"  TEXT NOT NULL DEFAULT '',
				"sortOrder" INTEGER NOT NULL DEFAULT 0,
				"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			);`,
			`CREATE INDEX IF NOT EXISTS "ComicGroup_name_idx" ON "ComicGroup"("name");`,
			`CREATE TABLE IF NOT EXISTS "ComicGroupItem" (
				"groupId" INTEGER NOT NULL,
				"comicId" TEXT NOT NULL,
				"sortIndex" INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY ("groupId", "comicId"),
				CONSTRAINT "ComicGroupItem_groupId_fkey" FOREIGN KEY ("groupId")
					REFERENCES "ComicGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
				CONSTRAINT "ComicGroupItem_comicId_fkey" FOREIGN KEY ("comicId")
					REFERENCES "Comic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE INDEX IF NOT EXISTS "ComicGroupItem_comicId_idx" ON "ComicGroupItem"("comicId");`,
		}, "\n"),
	},
	{
		Version:     10,
		Description: "Cleanup orphaned ComicGroupItem records where ComicGroup was deleted but CASCADE did not fire",
		SQL:         `DELETE FROM "ComicGroupItem" WHERE "groupId" NOT IN (SELECT "id" FROM "ComicGroup")`,
	},
	{
		Version:     11,
		Description: "Add md5Hash field to Comic for fast duplicate detection",
		SQL: strings.Join([]string{
			`ALTER TABLE "Comic" ADD COLUMN "md5Hash" TEXT NOT NULL DEFAULT '';`,
			`CREATE INDEX IF NOT EXISTS "Comic_md5Hash_idx" ON "Comic"("md5Hash");`,
		}, "\n"),
	},
	{
		Version:     12,
		Description: "Add multi-user data isolation: UserComicState table + userId columns",
		SQL: strings.Join([]string{
			// 创建用户漫画状态表
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
			);`,
			`CREATE INDEX IF NOT EXISTS "UCS_comicId_idx" ON "UserComicState"("comicId");`,
			`CREATE INDEX IF NOT EXISTS "UCS_userId_fav_idx" ON "UserComicState"("userId", "isFavorite");`,
			`CREATE INDEX IF NOT EXISTS "UCS_userId_status_idx" ON "UserComicState"("userId", "readingStatus");`,
			`CREATE INDEX IF NOT EXISTS "UCS_userId_lastReadAt_idx" ON "UserComicState"("userId", "lastReadAt" DESC);`,

			// 为 ReadingSession 添加 userId 列
			`ALTER TABLE "ReadingSession" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';`,
			`CREATE INDEX IF NOT EXISTS "ReadingSession_userId_idx" ON "ReadingSession"("userId");`,

			// 为 ReadingGoal 添加 userId 列
			`ALTER TABLE "ReadingGoal" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';`,

			// 为 ComicGroup 添加 userId 列
			`ALTER TABLE "ComicGroup" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';`,
			`CREATE INDEX IF NOT EXISTS "ComicGroup_userId_idx" ON "ComicGroup"("userId");`,

			// 数据迁移：将现有数据归属到第一个管理员用户
			// 1. 将 Comic 表中的个人状态迁移到 UserComicState
			`INSERT OR IGNORE INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt", "isFavorite", "rating", "totalReadTime", "readingStatus")
			 SELECT u."id", c."id", c."lastReadPage", c."lastReadAt", c."isFavorite", c."rating", c."totalReadTime", COALESCE(c."readingStatus", '')
			 FROM "Comic" c, (SELECT "id" FROM "User" WHERE "role" = 'admin' ORDER BY "createdAt" ASC LIMIT 1) u
			 WHERE c."lastReadPage" > 0 OR c."isFavorite" = 1 OR c."rating" IS NOT NULL OR c."totalReadTime" > 0;`,

			// 2. 将 ReadingSession 的 userId 更新为第一个管理员
			`UPDATE "ReadingSession" SET "userId" = (SELECT "id" FROM "User" WHERE "role" = 'admin' ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" = '';`,

			// 3. 将 ReadingGoal 的 userId 更新为第一个管理员
			`UPDATE "ReadingGoal" SET "userId" = (SELECT "id" FROM "User" WHERE "role" = 'admin' ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" = '';`,

			// 4. 将 ComicGroup 的 userId 更新为第一个管理员
			`UPDATE "ComicGroup" SET "userId" = (SELECT "id" FROM "User" WHERE "role" = 'admin' ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" = '';`,

			// 更新 ReadingGoal 的唯一约束（加上 userId 维度）
			// SQLite 不支持 DROP INDEX + 重建唯一约束，所以用新索引
			`CREATE UNIQUE INDEX IF NOT EXISTS "ReadingGoal_userId_goalType_key" ON "ReadingGoal"("userId", "goalType");`,
		}, "\n"),
	},
	{
		Version:     13,
		Description: "Add aiEnabled field to User for per-user AI access control",
		SQL: strings.Join([]string{
			// 为 User 表添加 aiEnabled 字段，默认禁用
			`ALTER TABLE "User" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT 0;`,
			// 管理员默认启用 AI
			`UPDATE "User" SET "aiEnabled" = 1 WHERE "role" = 'admin';`,
		}, "\n"),
	},
	{
		Version:     14,
		Description: "Fix novel type backfill: mark .html/.htm files as novel type",
		SQL:         `UPDATE "Comic" SET "type" = 'novel' WHERE ("filename" LIKE '%.html' OR "filename" LIKE '%.htm') AND "type" = 'comic';`,
	},
}

// ensureMigrationsTable creates the migrations tracking table.
func ensureMigrationsTable() error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS "_migrations" (
		"version" INTEGER NOT NULL PRIMARY KEY,
		"description" TEXT NOT NULL DEFAULT '',
		"applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`)
	return err
}

// getAppliedMigrations returns the set of already-applied migration versions.
func getAppliedMigrations() (map[int]bool, error) {
	rows, err := db.Query(`SELECT "version" FROM "_migrations"`)
	if err != nil {
		// Table might not exist yet
		return make(map[int]bool), nil
	}
	defer rows.Close()

	applied := make(map[int]bool)
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		applied[v] = true
	}
	return applied, rows.Err()
}

// RunMigrations applies all pending migrations in order.
func RunMigrations() error {
	if err := ensureMigrationsTable(); err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	applied, err := getAppliedMigrations()
	if err != nil {
		return fmt.Errorf("failed to get applied migrations: %w", err)
	}

	for _, m := range Migrations {
		if applied[m.Version] {
			continue
		}

		if m.SQL == "" {
			// Mark base schema as applied without executing SQL
			if _, err := db.Exec(
				`INSERT INTO "_migrations" ("version", "description", "applied_at") VALUES (?, ?, ?)`,
				m.Version, m.Description, time.Now(),
			); err != nil {
				log.Printf("[Migrate] Warning: failed to record migration %d: %v", m.Version, err)
			}
			continue
		}

		log.Printf("[Migrate] Applying migration %d: %s", m.Version, m.Description)

		// Split multi-statement SQL and execute each
		statements := splitSQL(m.SQL)
		for _, stmt := range statements {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := db.Exec(stmt); err != nil {
				// Some migrations may fail if column/index already exists
				// This is expected for upgrades from development versions
				if isIgnorableError(err) {
					log.Printf("[Migrate] Skipping (already applied): %v", err)
				} else {
					return fmt.Errorf("migration %d failed: %w\n  SQL: %s", m.Version, err, stmt)
				}
			}
		}

		// Record migration as applied
		if _, err := db.Exec(
			`INSERT INTO "_migrations" ("version", "description", "applied_at") VALUES (?, ?, ?)`,
			m.Version, m.Description, time.Now(),
		); err != nil {
			return fmt.Errorf("failed to record migration %d: %w", m.Version, err)
		}

		log.Printf("[Migrate] Applied migration %d successfully", m.Version)
	}

	return nil
}

// RebuildFTSIndex 重建 FTS5 全文搜索索引。
// 在 migration 8 首次应用后调用，或在数据迁移后手动调用。
func RebuildFTSIndex() error {
	// 检查 FTS 表是否存在
	var name string
	err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name='ComicFTS'`).Scan(&name)
	if err != nil {
		return nil // FTS 表不存在，跳过
	}

	// 清空并重建 FTS 索引
	_, err = db.Exec(`INSERT INTO "ComicFTS"("ComicFTS") VALUES('rebuild')`)
	if err != nil {
		log.Printf("[FTS] Warning: failed to rebuild FTS index: %v", err)
		return err
	}
	log.Println("[FTS] Full-text search index rebuilt ✅")
	return nil
}

// splitSQL splits a multi-statement SQL string by semicolons,
// correctly handling BEGIN...END blocks (e.g. triggers) that contain internal semicolons.
func splitSQL(sql string) []string {
	var result []string
	var current strings.Builder
	inBlock := false // 是否在 BEGIN...END 块内

	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimSpace(line)
		upper := strings.ToUpper(trimmed)

		// 检测 BEGIN 关键字（触发器等块语句的开始）
		if !inBlock && strings.Contains(upper, " BEGIN") {
			inBlock = true
		}

		current.WriteString(line)
		current.WriteString("\n")

		// 检测 END 关键字（块语句结束）
		if inBlock && (upper == "END" || strings.HasSuffix(upper, " END") ||
			upper == "END;" || strings.HasSuffix(upper, " END;")) {
			inBlock = false
			stmt := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(current.String()), ";"))
			if stmt != "" {
				result = append(result, stmt)
			}
			current.Reset()
			continue
		}

		// 不在块内时，按行尾分号分割
		if !inBlock && strings.HasSuffix(trimmed, ";") {
			stmt := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(current.String()), ";"))
			if stmt != "" {
				result = append(result, stmt)
			}
			current.Reset()
		}
	}

	// 处理末尾没有分号的剩余内容
	remaining := strings.TrimSpace(current.String())
	remaining = strings.TrimRight(remaining, ";")
	remaining = strings.TrimSpace(remaining)
	if remaining != "" {
		result = append(result, remaining)
	}

	return result
}

// isIgnorableError checks if a migration error can be safely ignored.
func isIgnorableError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate column") ||
		strings.Contains(msg, "already exists") ||
		strings.Contains(msg, "table already exists")
}

// ============================================================
// Data Migration: Import from Prisma/Next.js SQLite
// ============================================================

// MigrateFromPrismaDB imports data from a Prisma-managed SQLite database.
// This handles the migration from the Next.js version to the Go version.
func MigrateFromPrismaDB(prismaDBPath string) error {
	if _, err := os.Stat(prismaDBPath); os.IsNotExist(err) {
		return fmt.Errorf("prisma database not found: %s", prismaDBPath)
	}

	sourceDB, err := sql.Open("sqlite", prismaDBPath)
	if err != nil {
		return fmt.Errorf("failed to open prisma database: %w", err)
	}
	defer sourceDB.Close()

	log.Println("[Migrate] Starting data migration from Prisma database...")

	// Migrate Users
	userCount, err := migrateTable(sourceDB, "User",
		`SELECT "id", "username", "password", "nickname", "role", "createdAt", "updatedAt" FROM "User"`,
		`INSERT OR IGNORE INTO "User" ("id", "username", "password", "nickname", "role", "createdAt", "updatedAt")
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		log.Printf("[Migrate] Warning: Users migration failed: %v", err)
	} else {
		log.Printf("[Migrate] Migrated %d users", userCount)
	}

	// Migrate Comics
	comicCount, err := migrateTable(sourceDB, "Comic",
		`SELECT "id", "filename", "title", "pageCount", "fileSize", "addedAt", "updatedAt",
		        "lastReadPage", "lastReadAt", "isFavorite", "rating", "sortOrder", "totalReadTime",
		        "author", "publisher", "year", "description", "language",
		        "seriesName", "seriesIndex", "genre", "metadataSource",
		        COALESCE("coverImageUrl", '')
		 FROM "Comic"`,
		`INSERT OR IGNORE INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "addedAt", "updatedAt",
		        "lastReadPage", "lastReadAt", "isFavorite", "rating", "sortOrder", "totalReadTime",
		        "author", "publisher", "year", "description", "language",
		        "seriesName", "seriesIndex", "genre", "metadataSource", "coverImageUrl")
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		log.Printf("[Migrate] Warning: Comics migration failed: %v", err)
	} else {
		log.Printf("[Migrate] Migrated %d comics", comicCount)
	}

	// Migrate Tags
	tagCount, err := migrateTable(sourceDB, "Tag",
		`SELECT "id", "name", "color" FROM "Tag"`,
		`INSERT OR IGNORE INTO "Tag" ("id", "name", "color") VALUES (?, ?, ?)`,
	)
	if err != nil {
		log.Printf("[Migrate] Warning: Tags migration failed: %v", err)
	} else {
		log.Printf("[Migrate] Migrated %d tags", tagCount)
	}

	// Migrate ComicTag
	ctCount, err := migrateTable(sourceDB, "ComicTag",
		`SELECT "comicId", "tagId" FROM "ComicTag"`,
		`INSERT OR IGNORE INTO "ComicTag" ("comicId", "tagId") VALUES (?, ?)`,
	)
	if err != nil {
		log.Printf("[Migrate] Warning: ComicTag migration failed: %v", err)
	} else {
		log.Printf("[Migrate] Migrated %d comic-tag associations", ctCount)
	}

	// Migrate Category
	catCount, err := migrateTable(sourceDB, "Category",
		`SELECT "id", "name", "slug", "icon", "sortOrder", "createdAt" FROM "Category"`,
		`INSERT OR IGNORE INTO "Category" ("id", "name", "slug", "icon", "sortOrder", "createdAt")
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		log.Printf("[Migrate] Warning: Category migration failed: %v", err)
	} else {
		log.Printf("[Migrate] Migrated %d categories", catCount)
	}

	// Migrate ComicCategory
	ccCount, err := migrateTable(sourceDB, "ComicCategory",
		`SELECT "comicId", "categoryId" FROM "ComicCategory"`,
		`INSERT OR IGNORE INTO "ComicCategory" ("comicId", "categoryId") VALUES (?, ?)`,
	)
	if err != nil {
		log.Printf("[Migrate] Warning: ComicCategory migration failed: %v", err)
	} else {
		log.Printf("[Migrate] Migrated %d comic-category associations", ccCount)
	}

	// Migrate ReadingSession
	rsCount, err := migrateTable(sourceDB, "ReadingSession",
		`SELECT "id", "comicId", "startedAt", "endedAt", "duration", "startPage", "endPage"
		 FROM "ReadingSession"`,
		`INSERT OR IGNORE INTO "ReadingSession" ("id", "comicId", "startedAt", "endedAt", "duration", "startPage", "endPage")
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		log.Printf("[Migrate] Warning: ReadingSession migration failed: %v", err)
	} else {
		log.Printf("[Migrate] Migrated %d reading sessions", rsCount)
	}

	log.Printf("[Migrate] Data migration complete: %d users, %d comics, %d tags, %d categories, %d sessions",
		userCount, comicCount, tagCount, catCount, rsCount)

	return nil
}

// migrateTable copies data from source to destination using the provided queries.
func migrateTable(sourceDB *sql.DB, tableName, selectSQL, insertSQL string) (int, error) {
	rows, err := sourceDB.Query(selectSQL)
	if err != nil {
		return 0, fmt.Errorf("failed to query %s: %w", tableName, err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return 0, fmt.Errorf("failed to get columns for %s: %w", tableName, err)
	}

	count := 0
	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			log.Printf("[Migrate] Warning: failed to scan row in %s: %v", tableName, err)
			continue
		}

		if _, err := db.Exec(insertSQL, values...); err != nil {
			// Skip duplicate key errors
			if !isIgnorableError(err) {
				log.Printf("[Migrate] Warning: failed to insert into %s: %v", tableName, err)
			}
			continue
		}
		count++
	}

	return count, rows.Err()
}
