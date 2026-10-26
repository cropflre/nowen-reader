package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestLibrarySeriesLayoutPreviewApplyRestoreAndRollback(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	root := t.TempDir()
	w := performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":          "Categorized Comics",
		"type":          "comic",
		"seriesDepth":   1,
		"rootPath":      root,
		"defaultAccess": "public",
	}, cookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("create library failed: %d %s", w.Code, w.Body.String())
	}
	var libCreated struct {
		Library struct {
			ID string `json:"id"`
		} `json:"library"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &libCreated); err != nil {
		t.Fatal(err)
	}
	libID := libCreated.Library.ID

	insertComic := func(id, relPath, title string) {
		t.Helper()
		if _, err := store.DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, 20, 1024, 'comic', ?, ?)
		`, id, relPath, title, libID, relPath); err != nil {
			t.Fatalf("insert comic %s: %v", id, err)
		}
	}

	// Category "韩漫": 2 books (1->N split at depth 2) + 1 shallow standalone comic
	insertComic("kr-a-1", "韩漫/书A/01.cbz", "01")
	insertComic("kr-a-2", "韩漫/书A/02.cbz", "02")
	insertComic("kr-b-1", "韩漫/书B/01.cbz", "01")
	insertComic("kr-shallow", "韩漫/散本.cbz", "散本")
	// Category "精选": 1 book with 2 chapters (unique 1-to-1 member set match at depth 2!)
	insertComic("pick-only-1", "精选/独苗作品/01.cbz", "01")
	insertComic("pick-only-2", "精选/独苗作品/02.cbz", "02")

	// Set user reading progress on underlying comic to verify it survives all regroupings & restores.
	var adminID string
	if err := store.DB().QueryRow(`SELECT "id" FROM "User" WHERE "username" = 'admin'`).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "isFavorite", "readingStatus")
		VALUES (?, 'kr-a-1', 15, 1, 'reading')
	`, adminID); err != nil {
		t.Fatal(err)
	}

	if err := service.RebuildAllComicSeries(); err != nil {
		t.Fatal(err)
	}

	// Inspect initial depth=1 series ("韩漫" and "精选")
	initialSeries, err := store.ListSeriesSummaries([]string{libID}, adminID, "")
	if err != nil || len(initialSeries) != 2 {
		t.Fatalf("expected 2 depth=1 series, got %#v (err=%v)", initialSeries, err)
	}
	var krDepth1ID, pickDepth1ID string
	for _, s := range initialSeries {
		switch s.RootRelativePath {
		case "韩漫":
			krDepth1ID = s.ID
		case "精选":
			pickDepth1ID = s.ID
		}
	}
	if krDepth1ID == "" || pickDepth1ID == "" {
		t.Fatalf("missing expected depth=1 series IDs: kr=%q pick=%q", krDepth1ID, pickDepth1ID)
	}

	// Attach rich manual metadata, tags, categories, and ComicGroupSeries to both depth=1 series!
	authorKR := "韩漫分类误标作者"
	descKR := "韩漫分类简介"
	lockedMeta := true
	if err := store.UpdateSeriesMetadata(krDepth1ID, store.SeriesMetadataUpdate{
		Author:         &authorKR,
		Description:    &descKR,
		MetadataLocked: &lockedMeta,
	}); err != nil {
		t.Fatal(err)
	}
	authorPick := "独苗作者"
	if err := store.UpdateSeriesMetadata(pickDepth1ID, store.SeriesMetadataUpdate{
		Author: &authorPick,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`INSERT INTO "Tag" ("id", "name", "color") VALUES (101, '连载中', 'blue')`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`INSERT INTO "ComicSeriesTag" ("seriesId", "tagId") VALUES (?, 101), (?, 101)`, krDepth1ID, pickDepth1ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`INSERT INTO "Category" ("id", "name", "slug", "icon", "sortOrder") VALUES (201, '人工收藏分类', 'manual-fav', '⭐', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`INSERT INTO "ComicSeriesCategory" ("seriesId", "categoryId") VALUES (?, 201)`, krDepth1ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`INSERT INTO "ComicGroup" ("id", "name", "userId", "shelfSeries") VALUES (301, '年度精选合集', ?, 1)`, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`INSERT INTO "ComicGroupSeries" ("groupId", "seriesId", "sortIndex") VALUES (301, ?, 0), (301, ?, 1)`, krDepth1ID, pickDepth1ID); err != nil {
		t.Fatal(err)
	}

	// 1. Preview depth 1 -> 2
	w = performAuthedRequest(r, "POST", "/api/admin/libraries/"+libID+"/series-layout-preview", map[string]interface{}{
		"seriesDepth": 2,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("preview failed: %d %s", w.Code, w.Body.String())
	}
	var preview service.SeriesLayoutPreview
	if err := json.Unmarshal(w.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.CurrentSeriesDepth != 1 || preview.TargetSeriesDepth != 2 {
		t.Fatalf("unexpected depths in preview: %#v", preview)
	}
	if preview.OldSeriesCount != 2 || preview.NewSeriesCount != 3 || preview.SingleChapterSeriesCount != 1 || preview.ShallowStandaloneCount != 1 {
		t.Fatalf("unexpected preview counts: %#v", preview)
	}
	if preview.MatchedSeriesCount != 1 || preview.CreatedSeriesCount != 2 || preview.ArchivedSeriesCount != 1 || preview.ArchivedWithMetadataCount != 1 {
		t.Fatalf("unexpected preview match/archive stats: %#v", preview)
	}
	if preview.HasLockConflicts {
		t.Fatalf("expected zero lock conflicts, got %#v", preview.LockConflicts)
	}

	// 2. Stale expectedSourceRevision returns 409 and does NOT change depth
	w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
		"seriesDepth":            2,
		"expectedSourceRevision": "999999",
	}, cookie)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for stale sourceRevision, got %d: %s", w.Code, w.Body.String())
	}

	// 3. Injected failure before commit rolls back Library, Snapshot, and ComicSeries atomically
	store.SetSeriesLayoutBeforeCommitHookForTest(func(tx *sql.Tx) error {
		return errors.New("simulated database failure before commit")
	})
	w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
		"seriesDepth":            2,
		"expectedSourceRevision": preview.SourceRevision,
	}, cookie)
	store.SetSeriesLayoutBeforeCommitHookForTest(nil)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on injected DB failure, got %d: %s", w.Code, w.Body.String())
	}
	afterRollbackLib, err := store.GetLibraryByID(libID)
	if err != nil || afterRollbackLib.SeriesDepth != 1 {
		t.Fatalf("rollback failed: library depth=%v err=%v", afterRollbackLib, err)
	}
	snapsAfterRollback, err := store.ListLibrarySeriesSnapshots(libID, 10)
	if err != nil || len(snapsAfterRollback) != 0 {
		t.Fatalf("rollback leaked snapshots: %#v (err=%v)", snapsAfterRollback, err)
	}

	// 4. Apply depth 1 -> 2 atomically
	w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
		"seriesDepth":            2,
		"expectedSourceRevision": preview.SourceRevision,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("apply depth=2 failed: %d %s", w.Code, w.Body.String())
	}
	var applyResp struct {
		Library struct {
			SeriesDepth int `json:"seriesDepth"`
		} `json:"library"`
		Snapshot store.SeriesLayoutSnapshotSummary `json:"snapshot"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &applyResp); err != nil {
		t.Fatal(err)
	}
	if applyResp.Library.SeriesDepth != 2 || applyResp.Snapshot.ID == "" {
		t.Fatalf("unexpected apply response: %#v", applyResp)
	}
	snap1to2ID := applyResp.Snapshot.ID

	// Verify 1-to-1 matched series preserved ID, author, tags & group link, while updating auto title to "独苗作品",
	// and 1-to-N split children ("书A", "书B") did NOT inherit category metadata ("韩漫分类误标作者")!
	depth2Series, err := store.ListSeriesSummaries([]string{libID}, adminID, "")
	if err != nil || len(depth2Series) != 3 {
		t.Fatalf("expected 3 depth=2 series, got %#v (err=%v)", depth2Series, err)
	}
	var bookAID string
	for _, s := range depth2Series {
		switch s.RootRelativePath {
		case "精选/独苗作品":
			if s.ID != pickDepth1ID || s.Title != "独苗作品" || s.Author != "独苗作者" || len(s.Tags) != 1 {
				t.Fatalf("1-to-1 matched series lost identity or metadata: %#v", s)
			}
		case "韩漫/书A":
			bookAID = s.ID
			if s.Author != "" || s.Description != "" || s.MetadataLocked {
				t.Fatalf("split child 韩漫/书A leaked category metadata: %#v", s)
			}
		case "韩漫/书B":
			if s.ItemCount != 1 || s.Author != "" {
				t.Fatalf("single-chapter work 韩漫/书B unexpected: %#v", s)
			}
		}
	}

	// Underlying Comic reading progress & favorite must be untouched
	comicProgress, err := store.GetComicByIDForUser("kr-a-1", adminID)
	if err != nil || comicProgress == nil || comicProgress.LastReadPage != 15 || !comicProgress.IsFavorite {
		t.Fatalf("comic user progress lost after depth change: %#v (err=%v)", comicProgress, err)
	}

	// 5. Manual structure lock conflict check (lock 韩漫/书A, preview & apply depth=1 -> 409!)
	manualTrue := true
	if err := store.UpdateSeries(bookAID, "", "", &manualTrue); err != nil {
		t.Fatal(err)
	}
	w = performAuthedRequest(r, "POST", "/api/admin/libraries/"+libID+"/series-layout-preview", map[string]interface{}{
		"seriesDepth": 1,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("preview with lock failed: %d %s", w.Code, w.Body.String())
	}
	var lockedPreview service.SeriesLayoutPreview
	if err := json.Unmarshal(w.Body.Bytes(), &lockedPreview); err != nil {
		t.Fatal(err)
	}
	if !lockedPreview.HasLockConflicts || len(lockedPreview.LockConflicts) != 1 || lockedPreview.LockConflicts[0].SeriesID != bookAID {
		t.Fatalf("expected manual lock conflict on %s, got %#v", bookAID, lockedPreview)
	}
	w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
		"seriesDepth": 1,
	}, cookie)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 on manual lock conflict, got %d: %s", w.Code, w.Body.String())
	}
	stillDepth2Lib, _ := store.GetLibraryByID(libID)
	if stillDepth2Lib.SeriesDepth != 2 {
		t.Fatalf("lock conflict mutated library depth to %d", stillDepth2Lib.SeriesDepth)
	}

	// Unlock manualLocked, set metadataLocked + Author on 书A to test round-trip recovery!
	manualFalse := false
	if err := store.UpdateSeries(bookAID, "", "", &manualFalse); err != nil {
		t.Fatal(err)
	}
	bookAAuthor := "书A专属作者"
	if err := store.UpdateSeriesMetadata(bookAID, store.SeriesMetadataUpdate{
		Author:         &bookAAuthor,
		MetadataLocked: &lockedMeta,
	}); err != nil {
		t.Fatal(err)
	}

	// 6. Round-trip 2 -> 1 recovers krDepth1ID + "韩漫分类误标作者" + Category + Group link automatically!
	w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
		"seriesDepth": 1,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("switch back 2 -> 1 failed: %d %s", w.Code, w.Body.String())
	}
	backToDepth1, err := store.ListSeriesSummaries([]string{libID}, adminID, "")
	if err != nil || len(backToDepth1) != 2 {
		t.Fatalf("expected 2 series after 2->1, got %#v", backToDepth1)
	}
	for _, s := range backToDepth1 {
		if s.RootRelativePath == "韩漫" {
			if s.ID != krDepth1ID || s.Author != authorKR || s.Description != descKR || !s.MetadataLocked || len(s.Categories) != 1 {
				t.Fatalf("historical identity recovery failed on 2->1: %#v", s)
			}
		}
	}

	// And switching 1 -> 2 again recovers bookAID + "书A专属作者"!
	w = performAuthedRequest(r, "PUT", "/api/admin/libraries/"+libID, map[string]interface{}{
		"seriesDepth": 2,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("switch 1 -> 2 again failed: %d %s", w.Code, w.Body.String())
	}
	var thirdApplyResp struct {
		Snapshot store.SeriesLayoutSnapshotSummary `json:"snapshot"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &thirdApplyResp)
	latestSnapID := thirdApplyResp.Snapshot.ID

	backToDepth2, err := store.ListSeriesSummaries([]string{libID}, adminID, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range backToDepth2 {
		if s.RootRelativePath == "韩漫/书A" {
			if s.ID != bookAID || s.Author != bookAAuthor || !s.MetadataLocked {
				t.Fatalf("historical identity recovery failed on 1->2: %#v", s)
			}
		}
	}

	// 7. Snapshot List (no payloadJson leaked) & Export & Restore
	w = performAuthedRequest(r, "GET", "/api/admin/libraries/"+libID+"/series-layout-snapshots", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("list snapshots failed: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "payloadJson") || strings.Contains(w.Body.String(), "groupUserId") {
		t.Fatalf("list snapshots response must not expose raw payloadJson: %s", w.Body.String())
	}

	w = performAuthedRequest(r, "GET", "/api/admin/libraries/"+libID+"/series-layout-snapshots/"+snap1to2ID+"/export", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("export snapshot failed: %d %s", w.Code, w.Body.String())
	}
	var exported store.SeriesLayoutSnapshotExport
	if err := json.Unmarshal(w.Body.Bytes(), &exported); err != nil {
		t.Fatal(err)
	}
	if exported.Payload.SchemaVersion != 1 || len(exported.Payload.Series) != 2 {
		t.Fatalf("unexpected exported snapshot payload: %#v", exported)
	}

	// Old snapshot snap1to2ID cannot overwrite later changes (409 SNAPSHOT_STATE_CONFLICT),
	// whereas latestSnapID restores cleanly!
	w = performAuthedRequest(r, "POST", "/api/admin/libraries/"+libID+"/series-layout-snapshots/"+snap1to2ID+"/restore", nil, cookie)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 restoring outdated snapshot, got %d: %s", w.Code, w.Body.String())
	}

	w = performAuthedRequest(r, "POST", "/api/admin/libraries/"+libID+"/series-layout-snapshots/"+latestSnapID+"/restore", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("restore latest snapshot failed: %d %s", w.Code, w.Body.String())
	}
	restoredLib, _ := store.GetLibraryByID(libID)
	if restoredLib.SeriesDepth != 1 {
		t.Fatalf("expected restored SeriesDepth=1, got %d", restoredLib.SeriesDepth)
	}

	// Verify ComicGroupSeries restored for krDepth1ID
	var groupLinkCount int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "ComicGroupSeries" WHERE "groupId" = 301 AND "seriesId" = ?`, krDepth1ID).Scan(&groupLinkCount); err != nil || groupLinkCount != 1 {
		t.Fatalf("expected ComicGroupSeries link restored for %s, count=%d err=%v", krDepth1ID, groupLinkCount, err)
	}
}

func TestDepthUpdatePreservesDirtyRevisionFromOtherLibrary(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w1 := performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":     "Lib 1",
		"type":     "comic",
		"rootPath": t.TempDir(),
	}, cookie)
	w2 := performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":     "Lib 2",
		"type":     "comic",
		"rootPath": t.TempDir(),
	}, cookie)
	var c1, c2 struct {
		Library struct {
			ID string `json:"id"`
		} `json:"library"`
	}
	_ = json.Unmarshal(w1.Body.Bytes(), &c1)
	_ = json.Unmarshal(w2.Body.Bytes(), &c2)

	// Build initial state
	if err := service.EnsureComicSeriesFresh(); err != nil {
		t.Fatal(err)
	}

	// Simulate a background scanner adding comics to Lib 2 right before Lib 1 updates seriesDepth:
	// ExecuteLibrarySeriesDepthChange directly when builtRevision < revision must NOT falsely mark Lib 2 built!
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath")
		VALUES ('l2-1', 'Work2/01.cbz', '01', 'comic', ?, 'Work2/01.cbz'),
		       ('l2-2', 'Work2/02.cbz', '02', 'comic', ?, 'Work2/02.cbz')
	`, c2.Library.ID, c2.Library.ID); err != nil {
		t.Fatal(err)
	}

	lib1, err := store.GetLibraryByID(c1.Library.ID)
	if err != nil {
		t.Fatal(err)
	}
	lib1.SeriesDepth = 2
	if _, err := store.ExecuteLibrarySeriesDepthChange(store.SeriesLayoutTxPlanInput{
		UpdatedLibrary:  lib1,
		CreatedByUserID: "admin",
		BuildPlan: func(currentDepth int, existing []store.ArchivedSeriesRecord, items []store.SeriesSourceItem, historical *store.SeriesLayoutSnapshotPayload) ([]store.ArchivedSeriesRecord, []store.SeriesLayoutLockConflict, int, int, error) {
			return []store.ArchivedSeriesRecord{}, nil, 0, 0, nil
		},
	}); err != nil {
		t.Fatal(err)
	}

	rev, _ := store.GetComicSeriesSourceFingerprint()
	built, _ := store.GetBuiltComicSeriesFingerprint()
	if rev == built {
		t.Fatalf("ExecuteLibrarySeriesDepthChange falsely marked concurrent unbuilt library changes as built (rev=%s built=%s)", rev, built)
	}

	// Subsequent EnsureComicSeriesFresh builds Lib 2's series!
	if err := service.EnsureComicSeriesFresh(); err != nil {
		t.Fatal(err)
	}
	lib2Series, err := store.ListSeriesSummaries([]string{c2.Library.ID}, "", "")
	if err != nil || len(lib2Series) != 1 {
		t.Fatalf("expected Lib 2 series to be built on next EnsureComicSeriesFresh, got %#v (err=%v)", lib2Series, err)
	}
}
