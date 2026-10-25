package service

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestSeriesRefreshIgnoresReadingAndReusesPersistedProjection(t *testing.T) {
	setupTestDB(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateLibrary(&model.Library{ID: "lib", Name: "Library", Type: "comic", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"}); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := store.DB().Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO "Comic" ("id","filename","title","libraryId","relativePath","pageCount") VALUES ('one','one.cbz','One','lib','Work/one.cbz',10),('two','two.cbz','Two','lib','Work/two.cbz',10)`)
	if err := EnsureComicSeriesFresh(); err != nil {
		t.Fatal(err)
	}
	before, err := store.GetComicSeriesSourceFingerprint()
	if err != nil {
		t.Fatal(err)
	}
	built, err := store.GetBuiltComicSeriesFingerprint()
	if err != nil || built != before {
		t.Fatalf("not built: %s %s %v", before, built, err)
	}
	// If a rebuild occurs this sentinel is replaced by the directory title.
	exec(`UPDATE "ComicSeries" SET "title"='Keep projection'`)
	if err := store.UpdateReadingProgress("one", 9, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ToggleFavorite("one"); err != nil {
		t.Fatal(err)
	}
	if err := EnsureComicSeriesFresh(); err != nil {
		t.Fatal(err)
	}
	after, err := store.GetComicSeriesSourceFingerprint()
	if err != nil || after != before {
		t.Fatalf("reading dirtied structure: %s %s %v", before, after, err)
	}
	var title string
	if err := store.DB().QueryRow(`SELECT "title" FROM "ComicSeries"`).Scan(&title); err != nil || title != "Keep projection" {
		t.Fatalf("unexpected rebuild: %q %v", title, err)
	}
	exec(`UPDATE "Comic" SET "relativePath"='Renamed/one.cbz' WHERE "id"='one'`)
	after, err = store.GetComicSeriesSourceFingerprint()
	if err != nil || after == before {
		t.Fatal("path change did not dirty projection", err)
	}
	if err := EnsureComicSeriesFresh(); err != nil {
		t.Fatal(err)
	}
	built, err = store.GetBuiltComicSeriesFingerprint()
	if err != nil || built != after {
		t.Fatal("changed structure not acknowledged", err)
	}
	// A source changed after a build snapshot must remain dirty.
	exec(`UPDATE "Comic" SET "title"='New title' WHERE "id"='two'`)
	if err := store.MarkComicSeriesBuilt(after); err != nil {
		t.Fatal(err)
	}
	revision, _ := store.GetComicSeriesSourceFingerprint()
	built, _ = store.GetBuiltComicSeriesFingerprint()
	if revision == built {
		t.Fatal("concurrent source change was incorrectly acknowledged")
	}
}

func TestSeriesRefreshDoesNotWaitForBackgroundRebuild(t *testing.T) {
	seriesRefreshMu.Lock()
	defer seriesRefreshMu.Unlock()
	// No database is needed: the request can keep reading the existing shelf
	// while the scanner owns the rebuild lock.
	if err := EnsureComicSeriesFresh(); err != nil {
		t.Fatal(err)
	}
}
