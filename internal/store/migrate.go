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
		SQL: `ALTER TABLE "Comic" ADD COLUMN "coverImageUrl" TEXT NOT NULL DEFAULT '' ;`,
	},
	{
		Version:     3,
		Description: "Add composite index for duplicate detection",
		SQL: `CREATE INDEX IF NOT EXISTS "Comic_fileSize_pageCount_idx" ON "Comic"("fileSize", "pageCount");`,
	},
	{
		Version:     4,
		Description: "Add reading stats aggregation indexes",
		SQL: strings.Join([]string{
			`CREATE INDEX IF NOT EXISTS "ReadingSession_duration_idx" ON "ReadingSession"("duration");`,
			`CREATE INDEX IF NOT EXISTS "Comic_totalReadTime_idx" ON "Comic"("totalReadTime");`,
		}, "\n"),
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

// splitSQL splits a multi-statement SQL string by semicolons.
func splitSQL(sql string) []string {
	parts := strings.Split(sql, ";")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
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
