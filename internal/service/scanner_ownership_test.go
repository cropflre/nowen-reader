package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func setupScannerTestDB(t *testing.T) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "scanner.db")
	if err := store.InitDB(dbPath); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.CloseDB() })
}

func TestQuickSyncIndexesNestedFileOnce(t *testing.T) {
	setupScannerTestDB(t)
	root := t.TempDir()
	novelRoot := filepath.Join(root, "novels")
	if err := os.MkdirAll(novelRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(novelRoot, "book.epub"), []byte("epub"), 0644); err != nil {
		t.Fatal(err)
	}

	for _, lib := range []*model.Library{
		{ID: "parent", Name: "Parent", Type: "mixed", RootPath: root, Enabled: true, ScanEnabled: true},
		{ID: "novels", Name: "Novels", Type: "novel", RootPath: novelRoot, Enabled: true, ScanEnabled: true},
	} {
		if err := store.CreateLibrary(lib); err != nil {
			t.Fatal(err)
		}
	}

	added, removed := quickSync()
	if added != 1 || removed != 0 {
		t.Fatalf("quickSync added=%d removed=%d", added, removed)
	}
	var count int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic"`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one indexed row, got %d", count)
	}
	var libraryID, comicType string
	if err := store.DB().QueryRow(`SELECT "libraryId", "type" FROM "Comic"`).Scan(&libraryID, &comicType); err != nil {
		t.Fatal(err)
	}
	if libraryID != "novels" || comicType != "novel" {
		t.Fatalf("book indexed as library=%s type=%s", libraryID, comicType)
	}
}

func TestQuickSyncSkipsExactRootConflict(t *testing.T) {
	setupScannerTestDB(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "book.epub"), []byte("epub"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, lib := range []*model.Library{
		{ID: "one", Name: "One", Type: "novel", RootPath: root, Enabled: true, ScanEnabled: true},
		{ID: "two", Name: "Two", Type: "novel", RootPath: root, Enabled: true, ScanEnabled: true},
	} {
		if err := store.CreateLibrary(lib); err != nil {
			t.Fatal(err)
		}
	}

	added, removed := quickSync()
	if added != 0 || removed != 0 {
		t.Fatalf("conflicting roots must not scan: added=%d removed=%d", added, removed)
	}
}

func TestSyncLibraryByIDRemovesStaleRecordsAfterCompleteScan(t *testing.T) {
	setupScannerTestDB(t)
	root := t.TempDir()
	bookPath := filepath.Join(root, "book.cbz")
	if err := os.WriteFile(bookPath, []byte("comic"), 0644); err != nil {
		t.Fatal(err)
	}
	lib := &model.Library{
		ID:          "manual-cleanup",
		Name:        "Manual Cleanup",
		Type:        "comic",
		RootPath:    root,
		Enabled:     true,
		ScanEnabled: true,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 1 || removed != 0 {
		t.Fatalf("initial scan added=%d removed=%d err=%v", added, removed, err)
	}
	if err := os.Remove(bookPath); err != nil {
		t.Fatal(err)
	}
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 0 || removed != 1 {
		t.Fatalf("cleanup scan added=%d removed=%d err=%v", added, removed, err)
	}

	var count int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, lib.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("stale records = %d, want 0", count)
	}
}

func TestSyncLibraryByIDKeepsRecordsWhenRootIsUnavailable(t *testing.T) {
	setupScannerTestDB(t)
	parent := t.TempDir()
	root := filepath.Join(parent, "library")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "book.cbz"), []byte("comic"), 0644); err != nil {
		t.Fatal(err)
	}
	lib := &model.Library{
		ID:          "manual-offline",
		Name:        "Manual Offline",
		Type:        "comic",
		RootPath:    root,
		Enabled:     true,
		ScanEnabled: true,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 1 || removed != 0 {
		t.Fatalf("initial scan added=%d removed=%d err=%v", added, removed, err)
	}
	if err := os.Rename(root, root+".offline"); err != nil {
		t.Fatal(err)
	}
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 0 || removed != 0 {
		t.Fatalf("offline scan added=%d removed=%d err=%v", added, removed, err)
	}

	var count int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, lib.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("offline root removed %d records, want 1 preserved", 1-count)
	}
}

func TestSyncLibraryByIDDoesNotLeaveSourceCacheAfterFolderMove(t *testing.T) {
	setupScannerTestDB(t)
	rootA := t.TempDir()
	rootB := t.TempDir()
	sourceDir := filepath.Join(rootA, "灵魂印记")
	if err := os.MkdirAll(sourceDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"第1话.zip", "第2话.zip"} {
		if err := os.WriteFile(filepath.Join(sourceDir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	libA := &model.Library{
		ID:          "move-source",
		Name:        "Move Source",
		Type:        "comic",
		RootPath:    rootA,
		Enabled:     true,
		ScanEnabled: true,
	}
	if err := store.CreateLibrary(libA); err != nil {
		t.Fatal(err)
	}
	if added, removed, err := SyncLibraryByID(libA.ID); err != nil || added != 2 || removed != 0 {
		t.Fatalf("source scan added=%d removed=%d err=%v", added, removed, err)
	}

	targetDir := filepath.Join(rootB, "灵魂印记")
	if err := os.Rename(sourceDir, targetDir); err != nil {
		t.Fatal(err)
	}
	libB := &model.Library{
		ID:          "move-target",
		Name:        "Move Target",
		Type:        "comic",
		RootPath:    rootB,
		Enabled:     true,
		ScanEnabled: true,
	}
	if err := store.CreateLibrary(libB); err != nil {
		t.Fatal(err)
	}
	if added, removed, err := SyncLibraryByID(libA.ID); err != nil || added != 0 || removed != 2 {
		t.Fatalf("source cleanup scan added=%d removed=%d err=%v", added, removed, err)
	}
	if added, removed, err := SyncLibraryByID(libB.ID); err != nil || added != 2 || removed != 0 {
		t.Fatalf("target scan added=%d removed=%d err=%v", added, removed, err)
	}

	var sourceCount, targetCount, total int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, libA.ID).Scan(&sourceCount); err != nil {
		t.Fatal(err)
	}
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, libB.ID).Scan(&targetCount); err != nil {
		t.Fatal(err)
	}
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic"`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if sourceCount != 0 || targetCount != 2 || total != 2 {
		t.Fatalf("unexpected records after move: source=%d target=%d total=%d", sourceCount, targetCount, total)
	}
}

func TestOwnershipReconcileMergesSamePhysicalFile(t *testing.T) {
	setupScannerTestDB(t)
	root := t.TempDir()
	novelRoot := filepath.Join(root, "novels")
	if err := os.MkdirAll(novelRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(novelRoot, "book.epub"), []byte("epub"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, lib := range []*model.Library{
		{ID: "parent", Name: "Parent", Type: "mixed", RootPath: root, Enabled: true, ScanEnabled: true},
		{ID: "novels", Name: "Novels", Type: "novel", RootPath: novelRoot, Enabled: true, ScanEnabled: true},
	} {
		if err := store.CreateLibrary(lib); err != nil {
			t.Fatal(err)
		}
	}

	parentID := store.PathToID("parent", "novels/book.epub")
	childID := store.PathToID("novels", "book.epub")
	now := time.Now().UTC()
	for _, row := range []struct {
		id, filename, libraryID string
	}{
		{parentID, "novels/book.epub", "parent"},
		{childID, "book.epub", "novels"},
	} {
		if _, err := store.DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath", "addedAt", "updatedAt")
			VALUES (?, ?, 'Book', 1, 4, 'novel', ?, ?, ?, ?)
		`, row.id, row.filename, row.libraryID, row.filename, now, now); err != nil {
			t.Fatal(err)
		}
	}

	preview, err := PreviewLibraryOwnership()
	if err != nil {
		t.Fatal(err)
	}
	if preview.IssueCount != 1 || preview.DuplicateRows != 1 || !preview.CanReconcile {
		t.Fatalf("unexpected preview: %#v", preview)
	}
	result, err := ReconcileLibraryOwnership()
	if err != nil {
		t.Fatal(err)
	}
	if result.Reconciled != 1 || result.MergedRows != 1 {
		t.Fatalf("unexpected reconcile result: %#v", result)
	}

	var count int
	var gotID, gotLibrary, gotPath string
	if err := store.DB().QueryRow(`SELECT COUNT(*), "id", "libraryId", "relativePath" FROM "Comic"`).Scan(&count, &gotID, &gotLibrary, &gotPath); err != nil {
		t.Fatal(err)
	}
	if count != 1 || gotID != childID || gotLibrary != "novels" || gotPath != "book.epub" {
		t.Fatalf("unexpected canonical row: count=%d id=%s library=%s path=%s", count, gotID, gotLibrary, gotPath)
	}
}

func TestOwnershipReconcileRequiresExplicitExactRootOwner(t *testing.T) {
	setupScannerTestDB(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "book.epub"), []byte("epub"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, lib := range []*model.Library{
		{ID: "one", Name: "One", Type: "novel", RootPath: root, Enabled: true, ScanEnabled: true},
		{ID: "two", Name: "Two", Type: "novel", RootPath: root, Enabled: true, ScanEnabled: true},
	} {
		if err := store.CreateLibrary(lib); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	for _, libraryID := range []string{"one", "two"} {
		id := store.PathToID(libraryID, "book.epub")
		if _, err := store.DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath", "addedAt", "updatedAt")
			VALUES (?, 'book.epub', 'Book', 1, 4, 'novel', ?, 'book.epub', ?, ?)
		`, id, libraryID, now, now); err != nil {
			t.Fatal(err)
		}
	}

	preview, err := PreviewLibraryOwnership()
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.RootConflicts) != 1 || preview.CanReconcile {
		t.Fatalf("unexpected unresolved preview: %#v", preview)
	}
	if result, err := ReconcileLibraryOwnership(); err == nil || result == nil || result.Blocked != 1 {
		t.Fatalf("reconcile without owner should be blocked: result=%#v err=%v", result, err)
	}

	result, err := ReconcileLibraryOwnership(map[string]string{root: "two"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Reconciled != 1 || result.MergedRows != 1 {
		t.Fatalf("unexpected reconcile result: %#v", result)
	}
	var count int
	var libraryID string
	if err := store.DB().QueryRow(`SELECT COUNT(*), "libraryId" FROM "Comic"`).Scan(&count, &libraryID); err != nil {
		t.Fatal(err)
	}
	if count != 1 || libraryID != "two" {
		t.Fatalf("unexpected exact-root owner: count=%d library=%s", count, libraryID)
	}
}
