package store

import (
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

func TestSplitSQL(t *testing.T) {
	tests := []struct {
		input    string
		expected int
	}{
		{"SELECT 1;", 1},
		{"SELECT 1; SELECT 2;", 2},
		{"SELECT 1;\nSELECT 2;", 2},
		{"", 0},
		{"  ;  ;  ", 0},
		{"ALTER TABLE x ADD COLUMN y; CREATE INDEX idx ON x(y);", 2},
	}

	for _, tt := range tests {
		result := splitSQL(tt.input)
		if len(result) != tt.expected {
			t.Errorf("splitSQL(%q) = %d parts, expected %d", tt.input, len(result), tt.expected)
		}
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
