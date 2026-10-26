package handler

import (
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func snapshotRegressionLibrary(t *testing.T) *model.Library {
	t.Helper()
	setupTestRouter(t)
	lib := &model.Library{
		ID: "snapshot-regression", Name: "Snapshot regression", Type: "comic",
		RootPath: t.TempDir(), Enabled: true, SeriesDepth: 1,
		DefaultAccess: "public", ScanEnabled: true,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		rel := fmt.Sprintf("分类/作品/%02d.cbz", i)
		if _, err := store.DB().Exec(`INSERT INTO "Comic"
			("id", "filename", "title", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, 'comic', ?, ?)`, fmt.Sprintf("snapshot-comic-%d", i), rel, rel, lib.ID, rel); err != nil {
			t.Fatal(err)
		}
	}
	if err := service.RebuildAllComicSeries(); err != nil {
		t.Fatal(err)
	}
	return lib
}

func switchSnapshotDepth(t *testing.T, libraryID string, depth int) *store.SeriesLayoutTxResult {
	t.Helper()
	lib, err := store.GetLibraryByID(libraryID)
	if err != nil {
		t.Fatal(err)
	}
	lib.SeriesDepth = depth
	result, err := service.ApplyLibrarySeriesDepthUpdate(lib, "", "")
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestSnapshotRestoreRejectsRatingMetadataEdits(t *testing.T) {
	updatedAt := time.Date(2026, 10, 26, 8, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name   string
		update store.SeriesMetadataUpdate
	}{
		{"scale", store.SeriesMetadataUpdate{ExternalRatingMax: floatPointer(5)}},
		{"source", store.SeriesMetadataUpdate{ExternalRatingSource: stringPointer("manual")}},
		{"timestamp", store.SeriesMetadataUpdate{ExternalRatingUpdatedAt: &updatedAt}},
		{"precision", store.SeriesMetadataUpdate{ExternalRating: floatPointer(8.00001)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lib := snapshotRegressionLibrary(t)
			records, err := store.LoadLibrarySeriesRecords(lib.ID)
			if err != nil || len(records) != 1 {
				t.Fatalf("load original series: %v, records=%d", err, len(records))
			}
			seriesID := records[0].ID
			if err := store.UpdateSeriesMetadata(seriesID, store.SeriesMetadataUpdate{
				ExternalRating: floatPointer(8), ExternalRatingMax: floatPointer(10),
			}); err != nil {
				t.Fatal(err)
			}
			changed := switchSnapshotDepth(t, lib.ID, 2)
			if err := store.UpdateSeriesMetadata(seriesID, tc.update); err != nil {
				t.Fatal(err)
			}
			before, err := store.LoadLibrarySeriesRecords(lib.ID)
			if err != nil {
				t.Fatal(err)
			}
			_, err = service.RestoreLibrarySeriesSnapshot(lib.ID, changed.Snapshot.ID, "")
			var conflict *store.SeriesLayoutConflictError
			if !errors.As(err, &conflict) || conflict.Kind != "snapshot" {
				t.Fatalf("expected a state conflict, got %v", err)
			}
			after, err := store.LoadLibrarySeriesRecords(lib.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected restore modified the current metadata or structure")
			}
			if len(after) != 1 || after[0].RootRelativePath != "分类/作品" {
				t.Fatal("rejected restore changed the work structure")
			}
			if tc.update.ExternalRatingMax != nil && *after[0].ExternalRatingMax != *tc.update.ExternalRatingMax {
				t.Fatal("rejected restore overwrote the newer rating scale")
			}
		})
	}
}

func TestSnapshotRestoreIgnoresOtherLibraryChanges(t *testing.T) {
	lib := snapshotRegressionLibrary(t)
	other := &model.Library{
		ID: "other-snapshot-library", Name: "Other", Type: "comic", RootPath: t.TempDir(),
		Enabled: true, SeriesDepth: 1, DefaultAccess: "public", ScanEnabled: true,
	}
	if err := store.CreateLibrary(other); err != nil {
		t.Fatal(err)
	}
	changed := switchSnapshotDepth(t, lib.ID, 2)
	if _, err := store.DB().Exec(`INSERT INTO "Comic"
		("id", "filename", "title", "type", "libraryId", "relativePath")
		VALUES ('other-snapshot-comic', 'new.cbz', 'new', 'comic', ?, 'new.cbz')`, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RestoreLibrarySeriesSnapshot(lib.ID, changed.Snapshot.ID, ""); err != nil {
		t.Fatalf("unrelated library must not block restore: %v", err)
	}
	revision, err := store.GetComicSeriesSourceFingerprint()
	if err != nil {
		t.Fatal(err)
	}
	built, err := store.GetBuiltComicSeriesFingerprint()
	if err != nil {
		t.Fatal(err)
	}
	if revision == built {
		t.Fatal("restore acknowledged the unrelated library's dirty projection")
	}
}

func TestSnapshotRestoreAllowsUnchangedProjectionRefresh(t *testing.T) {
	lib := snapshotRegressionLibrary(t)
	changed := switchSnapshotDepth(t, lib.ID, 2)
	if err := service.RebuildAllComicSeries(); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RestoreLibrarySeriesSnapshot(lib.ID, changed.Snapshot.ID, ""); err != nil {
		t.Fatalf("projection refresh without business changes must not block restore: %v", err)
	}
}

func TestSnapshotRestoreChecksTargetSourceAndAllowsReading(t *testing.T) {
	for _, editSource := range []bool{false, true} {
		t.Run(fmt.Sprintf("source_edit_%t", editSource), func(t *testing.T) {
			lib := snapshotRegressionLibrary(t)
			changed := switchSnapshotDepth(t, lib.ID, 2)
			query := `UPDATE "Comic" SET "lastReadPage" = 7 WHERE "id" = 'snapshot-comic-1'`
			if editSource {
				query = `UPDATE "Comic" SET "title" = 'new chapter title' WHERE "id" = 'snapshot-comic-1'`
			}
			if _, err := store.DB().Exec(query); err != nil {
				t.Fatal(err)
			}
			_, err := service.RestoreLibrarySeriesSnapshot(lib.ID, changed.Snapshot.ID, "")
			if editSource {
				var conflict *store.SeriesLayoutConflictError
				if !errors.As(err, &conflict) {
					t.Fatalf("target source edit must prevent restore, got %v", err)
				}
			} else {
				if err != nil {
					t.Fatalf("reading must not prevent restore: %v", err)
				}
				var progress int
				if err := store.DB().QueryRow(`SELECT "lastReadPage" FROM "Comic" WHERE "id" = 'snapshot-comic-1'`).Scan(&progress); err != nil || progress != 7 {
					t.Fatalf("reading state changed: %d, %v", progress, err)
				}
			}
		})
	}
}

func TestSnapshotRetentionIncludesRestoresAndRollsBack(t *testing.T) {
	lib := snapshotRegressionLibrary(t)
	var firstID, latestID string
	for i := 0; i < 12; i++ {
		depth := 2 - i%2
		changed := switchSnapshotDepth(t, lib.ID, depth)
		latestID = changed.Snapshot.ID
		if i == 0 {
			firstID = latestID
		}
	}
	checkCount := func() {
		t.Helper()
		var count int
		if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "LibrarySeriesRebuildSnapshot" WHERE "libraryId" = ?`, lib.ID).Scan(&count); err != nil || count != 10 {
			t.Fatalf("snapshot count=%d, want 10, err=%v", count, err)
		}
	}
	checkCount()
	if _, err := store.GetLibrarySeriesSnapshotExport(lib.ID, firstID); !errors.Is(err, store.ErrSeriesLayoutSnapshotNotFound) {
		t.Fatalf("oldest snapshot should have expired, got %v", err)
	}
	before, err := store.ListLibrarySeriesSnapshots(lib.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.SetSeriesLayoutBeforeCommitHookForTest(nil) })
	store.SetSeriesLayoutBeforeCommitHookForTest(func(*sql.Tx) error { return errors.New("rollback retention") })
	_, err = service.RestoreLibrarySeriesSnapshot(lib.ID, latestID, "")
	store.SetSeriesLayoutBeforeCommitHookForTest(nil)
	if err == nil {
		t.Fatal("expected injected failure")
	}
	after, err := store.ListLibrarySeriesSnapshots(lib.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("failed restore pruned or modified existing snapshots")
	}
	if _, err = service.RestoreLibrarySeriesSnapshot(lib.ID, latestID, ""); err != nil {
		t.Fatal(err)
	}
	checkCount()
	if _, err := store.GetLibrarySeriesSnapshotExport(lib.ID, before[len(before)-1].ID); !errors.Is(err, store.ErrSeriesLayoutSnapshotNotFound) {
		t.Fatalf("restore should also prune the oldest snapshot, got %v", err)
	}
}

func floatPointer(value float64) *float64 { return &value }
func stringPointer(value string) *string  { return &value }
