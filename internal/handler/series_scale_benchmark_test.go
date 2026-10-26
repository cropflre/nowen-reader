package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// seedScale21441Library populates libraryID with 21,441 comic files:
//   - 420 multi-chapter works * 50 chapters = 21,000 files (across 6 top-level categories, with season subfolders)
//   - 400 single-chapter works * 1 chapter  =    400 files
//   -  41 shallow standalone files          =     41 files
//
// Total = 21,441 files; at seriesDepth=2 there are 820 works + 41 shallow items = 861 shelf items.
func seedScale21441Library(tb testing.TB, libraryID string) {
	tb.Helper()
	categories := []string{"韩漫", "日漫", "国漫", "欧美", "短篇集", "韩漫备份"}

	tx, err := store.DB().Begin()
	if err != nil {
		tb.Fatalf("begin seed tx: %v", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "pageCount", "fileSize", "type", "libraryId", "relativePath")
		VALUES (?, ?, ?, ?, 24, 4096, 'comic', ?, ?)
	`)
	if err != nil {
		tb.Fatalf("prepare comic insert: %v", err)
	}
	defer stmt.Close()

	totalInserted := 0
	for workIdx := 0; workIdx < 420; workIdx++ {
		cat := categories[workIdx%len(categories)]
		workTitle := fmt.Sprintf("长篇作品_%03d", workIdx+1)
		for ch := 1; ch <= 50; ch++ {
			seasonSeg := "第1季"
			if ch > 25 {
				seasonSeg = "第2季"
			}
			relPath := fmt.Sprintf("%s/%s/%s/第%03d话.cbz", cat, workTitle, seasonSeg, ch)
			id := fmt.Sprintf("mc-%03d-%02d", workIdx+1, ch)
			chTitle := fmt.Sprintf("第%03d话", ch)
			if _, err := stmt.Exec(id, relPath, chTitle, chTitle, libraryID, relPath); err != nil {
				tb.Fatalf("insert multi-chapter %s: %v", id, err)
			}
			totalInserted++
		}
	}

	for singleIdx := 0; singleIdx < 400; singleIdx++ {
		cat := categories[singleIdx%len(categories)]
		workTitle := fmt.Sprintf("单话作品_%03d", singleIdx+1)
		relPath := fmt.Sprintf("%s/%s/全一话.cbz", cat, workTitle)
		id := fmt.Sprintf("sc-%03d", singleIdx+1)
		if _, err := stmt.Exec(id, relPath, "全一话", "全一话", libraryID, relPath); err != nil {
			tb.Fatalf("insert single-chapter %s: %v", id, err)
		}
		totalInserted++
	}

	for shallowIdx := 0; shallowIdx < 41; shallowIdx++ {
		cat := categories[shallowIdx%len(categories)]
		title := fmt.Sprintf("独立散本_%02d", shallowIdx+1)
		relPath := fmt.Sprintf("%s/%s.cbz", cat, title)
		id := fmt.Sprintf("sh-%02d", shallowIdx+1)
		if _, err := stmt.Exec(id, relPath, title, title, libraryID, relPath); err != nil {
			tb.Fatalf("insert shallow %s: %v", id, err)
		}
		totalInserted++
	}

	if totalInserted != 21441 {
		tb.Fatalf("seeded %d files, want 21441", totalInserted)
	}
	if err := tx.Commit(); err != nil {
		tb.Fatalf("commit seed tx: %v", err)
	}
}

func TestIssue43Scale21441FilesEndToEnd(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":          "Scale 21441 Comics",
		"type":          "comic",
		"seriesDepth":   1,
		"rootPath":      t.TempDir(),
		"defaultAccess": "public",
	}, cookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("create library: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Library model.Library `json:"library"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	libID := created.Library.ID

	seedScale21441Library(t, libID)

	buildStart := time.Now()
	if err := service.RebuildAllComicSeries(); err != nil {
		t.Fatalf("initial RebuildAllComicSeries: %v", err)
	}
	initialBuildElapsed := time.Since(buildStart)

	// 1. Preview 1 -> 2
	previewStart := time.Now()
	w = performAuthedRequest(r, "POST", "/api/admin/libraries/"+libID+"/series-layout-preview", map[string]interface{}{
		"seriesDepth": 2,
	}, cookie)
	previewHTTP := time.Since(previewStart)
	if w.Code != http.StatusOK {
		t.Fatalf("preview 1->2 failed: %d %s", w.Code, w.Body.String())
	}
	previewBytes := w.Body.Len()
	if previewBytes > 32*1024 {
		t.Fatalf("preview payload too large (%d bytes); must return bounded samples only", previewBytes)
	}
	var preview service.SeriesLayoutPreview
	if err := json.Unmarshal(w.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.TotalComicFiles != 21441 || preview.OldSeriesCount != 6 || preview.NewSeriesCount != 820 ||
		preview.SingleChapterSeriesCount != 400 || preview.ShallowStandaloneCount != 41 || preview.NewShelfCount != 861 {
		t.Fatalf("unexpected 21,441 preview counts: %+v", preview)
	}

	// 2. Apply 1 -> 2 atomically and measure transaction time & snapshot size
	apply1To2Start := time.Now()
	w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
		"seriesDepth":            2,
		"expectedSourceRevision": preview.SourceRevision,
	}, cookie)
	apply1To2Elapsed := time.Since(apply1To2Start)
	if w.Code != http.StatusOK {
		t.Fatalf("apply 1->2 failed: %d %s", w.Code, w.Body.String())
	}

	// Annotate one depth-2 work with custom metadata to verify round-trip 2 -> 1 -> 2 preservation.
	var sampleSeriesID string
	if err := store.DB().QueryRow(`SELECT "id" FROM "ComicSeries" WHERE "libraryId" = ? AND "rootRelativePath" = '韩漫/长篇作品_001'`, libID).Scan(&sampleSeriesID); err != nil {
		t.Fatalf("lookup sample work: %v", err)
	}
	author := "金作者"
	locked := true
	if err := store.UpdateSeriesMetadata(sampleSeriesID, store.SeriesMetadataUpdate{
		Author:         &author,
		MetadataLocked: &locked,
	}); err != nil {
		t.Fatalf("UpdateSeriesMetadata: %v", err)
	}

	// 3. Repeated switches: 2 -> 1 -> 2 -> 1 -> 2
	switchDurations := make([]time.Duration, 0, 4)
	for _, nextDepth := range []int{1, 2, 1, 2} {
		t0 := time.Now()
		w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
			"seriesDepth": nextDepth,
		}, cookie)
		switchDurations = append(switchDurations, time.Since(t0))
		if w.Code != http.StatusOK {
			t.Fatalf("switch to depth %d failed: %d %s", nextDepth, w.Code, w.Body.String())
		}
	}

	// Verify sample work retained its original ID and metadata after round-trips!
	detail, err := store.GetSeriesDetail(sampleSeriesID, "")
	if err != nil || detail == nil || detail.Series.Author != author || !detail.Series.MetadataLocked {
		t.Fatalf("historical work identity/metadata lost after round-trip switches: %#v err=%v", detail, err)
	}

	// Measure snapshot count, individual export size, and total stored JSON bytes.
	snapshots, err := store.ListLibrarySeriesSnapshots(libID, 20)
	if err != nil || len(snapshots) != 5 {
		t.Fatalf("expected 5 snapshots (1->2, 2->1, 1->2, 2->1, 1->2), got %d err=%v", len(snapshots), err)
	}
	w = performAuthedRequest(r, "GET", "/api/admin/libraries/"+libID+"/series-layout-snapshots/"+snapshots[0].ID+"/export", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("export snapshot failed: %d %s", w.Code, w.Body.String())
	}
	latestExportBytes := w.Body.Len()
	var totalSnapshotBytes int64
	if err := store.DB().QueryRow(`SELECT COALESCE(SUM(LENGTH("payloadJson")), 0) FROM "LibrarySeriesRebuildSnapshot" WHERE "libraryId" = ?`, libID).Scan(&totalSnapshotBytes); err != nil {
		t.Fatal(err)
	}

	// 4. Measure HTTP first-screen shelf, directory listing, directory switch, and reader-return refresh
	shelfRootStart := time.Now()
	w = performAuthedRequest(r, "GET", "/api/comics?seriesView=true&libraryIds="+libID+"&page=1&pageSize=24&sortBy=title&sortOrder=asc", nil, cookie)
	shelfRootHTTP := time.Since(shelfRootStart)
	shelfRootTiming := w.Header().Get("Server-Timing")
	shelfRootBytes := w.Body.Len()
	if w.Code != http.StatusOK {
		t.Fatalf("shelf root failed: %d %s", w.Code, w.Body.String())
	}

	dirListStart := time.Now()
	w = performAuthedRequest(r, "GET", "/api/libraries/"+libID+"/directories", nil, cookie)
	dirListHTTP := time.Since(dirListStart)
	dirListTiming := w.Header().Get("Server-Timing")
	dirListBytes := w.Body.Len()
	if w.Code != http.StatusOK {
		t.Fatalf("directories list failed: %d %s", w.Code, w.Body.String())
	}
	var dirResp store.LibraryDirectoryListResult
	if err := json.Unmarshal(w.Body.Bytes(), &dirResp); err != nil {
		t.Fatal(err)
	}
	sumWorkCount := 0
	for _, d := range dirResp.Directories {
		sumWorkCount += d.WorkCount
	}
	if dirResp.Total != 6 || sumWorkCount != 861 {
		t.Fatalf("directory workCount sum=%d (dirs=%d), want 861 across 6 categories", sumWorkCount, dirResp.Total)
	}

	dirSwitchStart := time.Now()
	w = performAuthedRequest(r, "GET", "/api/comics?seriesView=true&libraryIds="+libID+"&directoryPath="+url.QueryEscape("韩漫")+"&page=1&pageSize=24&sortBy=title&sortOrder=asc", nil, cookie)
	dirSwitchHTTP := time.Since(dirSwitchStart)
	dirSwitchTiming := w.Header().Get("Server-Timing")
	dirSwitchBytes := w.Body.Len()
	if w.Code != http.StatusOK {
		t.Fatalf("directory switch shelf failed: %d %s", w.Code, w.Body.String())
	}

	returnRefreshStart := time.Now()
	w = performAuthedRequest(r, "GET", "/api/comics?seriesView=true&libraryIds="+libID+"&directoryPath="+url.QueryEscape("韩漫")+"&page=1&pageSize=48&sortBy=title&sortOrder=asc", nil, cookie)
	returnRefreshHTTP := time.Since(returnRefreshStart)
	returnRefreshTiming := w.Header().Get("Server-Timing")
	returnRefreshBytes := w.Body.Len()
	if w.Code != http.StatusOK {
		t.Fatalf("reader return refresh failed: %d %s", w.Code, w.Body.String())
	}

	t.Logf("[Scale 21,441 Files] initialBuild=%s previewHTTP=%s(%dB) apply1->2=%s switches(2->1,1->2,2->1,1->2)=%v",
		initialBuildElapsed, previewHTTP, previewBytes, apply1To2Elapsed, switchDurations)
	t.Logf("[Scale 21,441 Snapshots] count=%d latestExport=%dB total5Snapshots=%dB",
		len(snapshots), latestExportBytes, totalSnapshotBytes)
	t.Logf("[Scale 21,441 Queries] shelfRoot=%s(%dB, %s) dirList=%s(%dB, %s) dirSwitch(韩漫)=%s(%dB, %s) readerReturn48=%s(%dB, %s)",
		shelfRootHTTP, shelfRootBytes, shelfRootTiming,
		dirListHTTP, dirListBytes, dirListTiming,
		dirSwitchHTTP, dirSwitchBytes, dirSwitchTiming,
		returnRefreshHTTP, returnRefreshBytes, returnRefreshTiming)
}

func BenchmarkIssue43Scale21441(b *testing.B) {
	if err := store.InitDB(b.TempDir() + "/scale21441.db"); err != nil {
		b.Fatal(err)
	}
	defer store.CloseDB()
	if err := store.RunMigrations(); err != nil {
		b.Fatal(err)
	}

	lib := &model.Library{
		ID:            "bench-21441",
		Name:          "Bench 21441",
		Type:          "comic",
		SeriesDepth:   2,
		RootPath:      b.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(lib); err != nil {
		b.Fatal(err)
	}
	seedScale21441Library(b, lib.ID)
	if err := service.RebuildAllComicSeries(); err != nil {
		b.Fatal(err)
	}

	b.Run("ShelfRootPage1", func(b *testing.B) {
		opts := store.ComicListOptions{
			FilterLibraryIDs: true,
			LibraryIDs:       []string{lib.ID},
			SeriesView:       true,
			Page:             1,
			PageSize:         24,
			SortBy:           "title",
			SortOrder:        "asc",
		}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			res, err := store.GetAllComicsShelfSafe(opts)
			if err != nil || res.Total != 861 {
				b.Fatalf("res=%+v err=%v", res, err)
			}
		}
	})

	b.Run("DirectoryListRoot", func(b *testing.B) {
		opts := store.LibraryDirectoryQueryOptions{
			LibraryID: lib.ID,
			Parent:    "",
			Page:      1,
			PageSize:  100,
		}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			res, err := store.ListLibraryDirectories(opts)
			if err != nil || res.Total != 6 {
				b.Fatalf("res=%+v err=%v", res, err)
			}
		}
	})

	b.Run("DirectorySwitchShelfPage1", func(b *testing.B) {
		opts := store.ComicListOptions{
			FilterLibraryIDs: true,
			LibraryIDs:       []string{lib.ID},
			DirectoryPath:    "韩漫",
			SeriesView:       true,
			Page:             1,
			PageSize:         24,
			SortBy:           "title",
			SortOrder:        "asc",
		}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			res, err := store.GetAllComicsShelfSafe(opts)
			if err != nil || res.Total == 0 {
				b.Fatalf("res=%+v err=%v", res, err)
			}
		}
	})

	b.Run("ReaderReturnRefresh2Pages", func(b *testing.B) {
		opts := store.ComicListOptions{
			FilterLibraryIDs: true,
			LibraryIDs:       []string{lib.ID},
			DirectoryPath:    "韩漫",
			SeriesView:       true,
			Page:             1,
			PageSize:         48,
			SortBy:           "title",
			SortOrder:        "asc",
		}
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			res, err := store.GetAllComicsShelfSafe(opts)
			if err != nil || len(res.Comics) != 48 {
				b.Fatalf("res=%+v err=%v", res, err)
			}
		}
	})

	b.Run("AtomicSwitchDepth2To1AndBack", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		nextDepth := 1
		for i := 0; i < b.N; i++ {
			updated, _ := store.GetLibraryByID(lib.ID)
			updated.SeriesDepth = nextDepth
			if _, err := service.ApplyLibrarySeriesDepthUpdate(updated, "", ""); err != nil {
				b.Fatalf("switch to %d failed: %v", nextDepth, err)
			}
			if nextDepth == 1 {
				nextDepth = 2
			} else {
				nextDepth = 1
			}
		}
	})
}
