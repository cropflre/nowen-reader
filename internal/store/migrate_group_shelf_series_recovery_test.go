package store

import (
	"strings"
	"testing"
)

func TestMigration41RepairsIndexesBeforeBackfill(t *testing.T) {
	var migration *Migration
	for i := range Migrations {
		if Migrations[i].Version == 41 {
			migration = &Migrations[i]
			break
		}
	}
	if migration == nil {
		t.Fatal("migration 41 not found")
	}

	statements := splitSQL(migration.SQL)
	if len(statements) < 5 {
		t.Fatalf("migration 41 has too few statements: %d", len(statements))
	}

	reindexAt := -1
	backfillAt := -1
	for i, stmt := range statements {
		upper := strings.ToUpper(strings.TrimSpace(stmt))
		if upper == "REINDEX" {
			reindexAt = i
		}
		if strings.Contains(upper, `UPDATE "COMICGROUP" SET "SHELFSORTTITLE"`) {
			backfillAt = i
		}
	}
	if reindexAt < 0 {
		t.Fatal("migration 41 must REINDEX before touching existing ComicGroup rows")
	}
	if backfillAt < 0 {
		t.Fatal("migration 41 backfill statement not found")
	}
	if reindexAt > backfillAt {
		t.Fatalf("REINDEX must run before shelfSortTitle backfill: reindex=%d backfill=%d", reindexAt, backfillAt)
	}
}
