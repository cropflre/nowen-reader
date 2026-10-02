package service

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestScanExclusionMatcher(t *testing.T) {
	matcher, err := CompileScanExclusion(`(?i)(^|/)(\.[^/]*|thumbs?|thumbnails?)(/|$)`)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		`.hidden.cbz`, `books/.cache/a.cbz`, `Thumbs/a.cbz`, `books/Thumbnails/`,
	} {
		if !matcher.Matches(path) {
			t.Errorf("%q should be excluded", path)
		}
	}
	for _, path := range []string{`book.cbz`, `books/thumbnail-cover.cbz`, `books/readme.epub`} {
		if matcher.Matches(path) {
			t.Errorf("%q should remain visible", path)
		}
	}
	anchored, err := CompileScanExclusion(`^ignored$`)
	if err != nil {
		t.Fatal(err)
	}
	if !anchored.Matches(`ignored/chapter.cbz`) {
		t.Fatal("anchored directory pattern must exclude descendants")
	}
	if _, err := CompileScanExclusion(`[`); err == nil {
		t.Fatal("invalid regular expression accepted")
	}
}

func TestScanExclusionsPreserveExistingUntilConfirmedCleanup(t *testing.T) {
	setupScannerTestDB(t)
	t.Setenv("DATA_DIR", t.TempDir())
	if err := config.SaveSiteConfig(&config.SiteConfig{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = config.SaveSiteConfig(&config.SiteConfig{}) })

	root := t.TempDir()
	write := func(relative string) {
		t.Helper()
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(relative), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("book.cbz")
	write(".hidden.cbz")
	write("Thumbs/old.cbz")
	write("Thumbnails/1.jpg")
	write("Thumbnails/2.jpg")
	lib := &model.Library{ID: "exclude-test", Name: "Exclude Test", Type: "comic", RootPath: root, Enabled: true, ScanEnabled: true}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 4 || removed != 0 {
		t.Fatalf("initial scan added=%d removed=%d err=%v", added, removed, err)
	}
	pattern := `(?i)(^|/)(\.[^/]*|thumbs?|thumbnails?)(/|$)`
	cfg := config.GetSiteConfig()
	cfg.ScannerConfig = &config.ScannerConfig{ExcludePathRegex: pattern}
	if err := config.SaveSiteConfig(&cfg); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewScanExclusions(pattern)
	if err != nil {
		t.Fatal(err)
	}
	if preview.ExistingCount != 3 || preview.DiskMatchCount != 3 {
		t.Fatalf("preview existing=%d disk=%d, want 3 each", preview.ExistingCount, preview.DiskMatchCount)
	}
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 0 || removed != 0 {
		t.Fatalf("excluded existing books were removed: added=%d removed=%d err=%v", added, removed, err)
	}
	write(".new.cbz")
	write("Thumbs/new.cbz")
	write("new.cbz")
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 1 || removed != 0 {
		t.Fatalf("new scan added=%d removed=%d err=%v", added, removed, err)
	}
	if added, removed := quickSync(); added != 0 || removed != 0 {
		t.Fatalf("periodic scan added=%d removed=%d", added, removed)
	}
	if _, err := CleanupScanExclusions("wrong-hash"); !errors.Is(err, ErrScanExclusionChanged) {
		t.Fatalf("cleanup without matching preview: %v", err)
	}
	removed, err := CleanupScanExclusions(preview.MatchHash)
	if err != nil || removed != 3 {
		t.Fatalf("cleanup removed=%d err=%v", removed, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".hidden.cbz")); err != nil {
		t.Fatalf("cleanup removed disk file: %v", err)
	}
	var remaining int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, lib.ID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 2 {
		t.Fatalf("remaining records=%d, want 2", remaining)
	}
	if added, removed, err := SyncLibraryByID(lib.ID); err != nil || added != 0 || removed != 0 {
		t.Fatalf("excluded books were reimported: added=%d removed=%d err=%v", added, removed, err)
	}
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, lib.ID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 2 {
		t.Fatalf("records after rescan=%d, want 2", remaining)
	}
}
