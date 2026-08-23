package store

import (
	"fmt"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestFixComicLibraryAssignmentsUsesBoundedWriterBatches(t *testing.T) {
	setupTestDB(t)

	library := &model.Library{
		ID:            "reassign-library",
		Name:          "Reassign Library",
		Type:          "novel",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}

	const total = 1205
	fileLibraryMap := make(map[string]string, total)
	fileSourceMap := make(map[string]string, total)
	fileRelPathMap := make(map[string]string, total)

	tx, err := DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	stmt, err := tx.Prepare(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath")
		VALUES (?, ?, ?, 'novel', '', ?)
	`)
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	for i := 0; i < total; i++ {
		id := fmt.Sprintf("reassign-%04d", i)
		rel := fmt.Sprintf("books/%04d.txt", i)
		if _, err := stmt.Exec(id, rel, id, rel); err != nil {
			stmt.Close()
			tx.Rollback()
			t.Fatalf("insert %s: %v", id, err)
		}
		fileLibraryMap[id] = library.ID
		fileSourceMap[id] = "novels"
		fileRelPathMap[id] = rel
	}
	stmt.Close()
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	before := GetDBWriteCoordinatorStats().Executed
	moved, typeFixed := FixComicLibraryAssignments(fileLibraryMap, fileSourceMap, fileRelPathMap)
	if moved != total {
		t.Fatalf("moved = %d, want %d", moved, total)
	}
	if typeFixed != 0 {
		t.Fatalf("typeFixed = %d, want 0", typeFixed)
	}
	if delta := GetDBWriteCoordinatorStats().Executed - before; delta < 3 {
		t.Fatalf("writer batches = %d, want at least 3 for %d rows", delta, total)
	}

	var assigned int
	if err := DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, library.ID).Scan(&assigned); err != nil {
		t.Fatal(err)
	}
	if assigned != total {
		t.Fatalf("assigned rows = %d, want %d", assigned, total)
	}
}
