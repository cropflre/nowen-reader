package store

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestRunMigrations(t *testing.T) {
	setupTestDB(t)

	// Run migrations should succeed on fresh database
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	// Running again should be idempotent (no error)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations (idempotent) failed: %v", err)
	}

	// Verify migrations table exists and has entries
	var count int
	err := DB().QueryRow(`SELECT COUNT(*) FROM "_migrations"`).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to query migrations table: %v", err)
	}
	if count != len(Migrations) {
		t.Errorf("Expected %d migrations recorded, got %d", len(Migrations), count)
	}
}

func TestReadingActivityMigrationUpgradesLegacyDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	legacyDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacyDB.Exec(`CREATE TABLE "ReadingSession" (
		"id" INTEGER PRIMARY KEY AUTOINCREMENT,
		"comicId" TEXT NOT NULL,
		"userId" TEXT NOT NULL DEFAULT '',
		"startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		"endedAt" DATETIME,
		"duration" INTEGER NOT NULL DEFAULT 0,
		"startPage" INTEGER NOT NULL DEFAULT 0,
		"endPage" INTEGER NOT NULL DEFAULT 0
	)`); err != nil {
		t.Fatal(err)
	}
	if err := legacyDB.Close(); err != nil {
		t.Fatal(err)
	}

	if err := InitDB(dbPath); err != nil {
		t.Fatalf("InitDB legacy database failed: %v", err)
	}
	t.Cleanup(CloseDB)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations legacy database failed: %v", err)
	}

	for _, column := range []string{"clientSessionId", "lastActiveAt", "lastSequence"} {
		var count int
		if err := DB().QueryRow(`SELECT COUNT(*) FROM pragma_table_info('ReadingSession') WHERE name = ?`, column).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("missing migrated ReadingSession column %s", column)
		}
	}
	var indexCount int
	if err := DB().QueryRow(`SELECT COUNT(*) FROM pragma_index_list('ReadingSession') WHERE name = 'ReadingSession_user_client_key'`).Scan(&indexCount); err != nil {
		t.Fatal(err)
	}
	if indexCount != 1 {
		t.Fatal("missing migrated reading activity unique index")
	}
}

func TestSplitSQL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{"single statement", "SELECT 1;", 1},
		{"two statements on separate lines", "SELECT 1;\nSELECT 2;", 2},
		{"empty string", "", 0},
		{"only whitespace and semicolons", "  ;  ;  ", 0},
		{"alter and create index on separate lines", "ALTER TABLE x ADD COLUMN y;\nCREATE INDEX idx ON x(y);", 2},
		{"trigger with internal semicolons", "CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES (1); END", 1},
		{"virtual table then trigger", "CREATE VIRTUAL TABLE ft USING fts5(a);\nCREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES (1); END", 2},
		{"multiple triggers", "CREATE TRIGGER t1 AFTER INSERT ON x BEGIN INSERT INTO y VALUES (1); END\nCREATE TRIGGER t2 AFTER DELETE ON x BEGIN INSERT INTO y VALUES (2); END", 2},
		{"trigger with multiple internal statements", "CREATE TRIGGER t AFTER UPDATE ON x BEGIN DELETE FROM y WHERE id=old.id; INSERT INTO y VALUES (new.id); END", 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := splitSQL(tt.input)
			if len(result) != tt.expected {
				t.Errorf("splitSQL(%q) = %d parts %v, expected %d", tt.input, len(result), result, tt.expected)
			}
		})
	}
}

func TestIsIgnorableError(t *testing.T) {
	tests := []struct {
		msg       string
		ignorable bool
	}{
		{"duplicate column name: coverImageUrl", true},
		{"table User already exists", true},
		{"index already exists", true},
		{"UNIQUE constraint failed", false},
		{"syntax error", false},
	}

	for _, tt := range tests {
		err := &testError{msg: tt.msg}
		result := isIgnorableError(err)
		if result != tt.ignorable {
			t.Errorf("isIgnorableError(%q) = %v, expected %v", tt.msg, result, tt.ignorable)
		}
	}
}

type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}

func TestMigrateFromPrismaDBNotFound(t *testing.T) {
	setupTestDB(t)

	err := MigrateFromPrismaDB("/nonexistent/path/db.sqlite")
	if err == nil {
		t.Error("Expected error for nonexistent Prisma database")
	}
}
