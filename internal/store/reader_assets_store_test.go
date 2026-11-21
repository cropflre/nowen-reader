package store

import (
	"fmt"
	"math"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func seedAssetUsersAndComics(t *testing.T) {
	t.Helper()
	for _, u := range []struct{ id, name string }{
		{"u1", "alice"},
		{"u2", "bob"},
	} {
		if err := CreateUser(&model.User{
			ID:       u.id,
			Username: u.name,
			Password: "hashedpassword",
			Nickname: u.name,
			Role:     "user",
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []string{"book-1", "book-2"} {
		if _, err := DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, 50, 'novel', 'default', ?)
		`, c, c+".epub", "Title "+c, c+".epub"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPositionRatioPersistenceAndBackwardCompatibility(t *testing.T) {
	setupTestDB(t)
	seedAssetUsersAndComics(t)

	// 1. Update with explicit positionRatio
	ratio := 0.625
	if err := UpdateReadingProgressWithPosition("book-1", 10, 50, &ratio, "u1"); err != nil {
		t.Fatal(err)
	}
	item, err := GetComicByIDForUser("book-1", "u1")
	if err != nil || item == nil {
		t.Fatalf("GetComicByIDForUser failed: %v", err)
	}
	if item.LastReadPage != 10 || math.Abs(item.LastReadPositionRatio-0.625) > 1e-6 {
		t.Fatalf("unexpected u1 progress: page=%d ratio=%v", item.LastReadPage, item.LastReadPositionRatio)
	}

	// 2. Old client sends same page WITHOUT positionRatio -> should preserve 0.625!
	if err := UpdateReadingProgress("book-1", 10, 50, "u1"); err != nil {
		t.Fatal(err)
	}
	item, _ = GetComicByIDForUser("book-1", "u1")
	if math.Abs(item.LastReadPositionRatio-0.625) > 1e-6 {
		t.Fatalf("same-page legacy heartbeat should preserve ratio 0.625, got %v", item.LastReadPositionRatio)
	}

	// 3. Old client advances page WITHOUT positionRatio -> should reset ratio to 0!
	if err := UpdateReadingProgress("book-1", 11, 50, "u1"); err != nil {
		t.Fatal(err)
	}
	item, _ = GetComicByIDForUser("book-1", "u1")
	if item.LastReadPage != 11 || item.LastReadPositionRatio != 0 {
		t.Fatalf("expected page=11 ratio=0 after page change without ratio, got page=%d ratio=%v", item.LastReadPage, item.LastReadPositionRatio)
	}

	// 4. Activity heartbeat carries clamped positionRatio and stays isolated per user
	high := 1.4
	if err := RecordReadingActivityWithPosition("book-1", "u2", "sess-u2", 3, 50, &high, 15, 1, false, true); err != nil {
		t.Fatal(err)
	}
	u2Item, _ := GetComicByIDForUser("book-1", "u2")
	if u2Item.LastReadPage != 3 || u2Item.LastReadPositionRatio != 1.0 {
		t.Fatalf("expected u2 clamped ratio=1.0 page=3, got page=%d ratio=%v", u2Item.LastReadPage, u2Item.LastReadPositionRatio)
	}
	u1Item, _ := GetComicByIDForUser("book-1", "u1")
	if u1Item.LastReadPage != 11 {
		t.Fatalf("u1 progress leaked or overwritten by u2: %d", u1Item.LastReadPage)
	}
}

func TestUserBookmarksHighlightsAndIdempotentImport(t *testing.T) {
	setupTestDB(t)
	seedAssetUsersAndComics(t)

	// Shared bookmark ID across two users must NOT collide
	bm1, err := UpsertUserBookmark("u1", "book-1", model.UserBookmark{
		ID:            "shared-id",
		PageIndex:     2,
		PositionRatio: 0.4,
		ChapterTitle:  "Chapter 3",
		Name:          "Alice mark",
	})
	if err != nil {
		t.Fatal(err)
	}
	bm2, err := UpsertUserBookmark("u2", "book-1", model.UserBookmark{
		ID:            "shared-id",
		PageIndex:     9,
		PositionRatio: 0.8,
		ChapterTitle:  "Chapter 10",
		Name:          "Bob mark",
	})
	if err != nil {
		t.Fatal(err)
	}
	if bm1.Name != "Alice mark" || bm2.Name != "Bob mark" {
		t.Fatalf("unexpected bookmark isolation results: %+v / %+v", bm1, bm2)
	}

	u1List, err := ListUserBookmarks("u1", "book-1")
	if err != nil || len(u1List) != 1 || u1List[0].Name != "Alice mark" {
		t.Fatalf("u1 bookmarks corrupted: %+v (err=%v)", u1List, err)
	}

	// Idempotent import (duplicate by ID + duplicate by pageIndex/positionRatio + one genuinely new)
	imported, err := ImportUserBookmarks("u1", "book-1", []model.UserBookmark{
		{ID: "shared-id", PageIndex: 2, PositionRatio: 0.4, Name: "Alice mark"},
		{ID: "different-id-same-spot", PageIndex: 2, PositionRatio: 0.4002, Name: "Dup"},
		{ID: "new-bm", PageIndex: 5, PositionRatio: 0.2, Name: "Chapter 6", Note: "Important"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(imported) != 2 {
		t.Fatalf("expected 2 bookmarks after idempotent import, got %d (%+v)", len(imported), imported)
	}

	// Highlights CRUD + import + deletion
	if _, err := UpsertUserHighlight("u1", "book-1", model.UserHighlight{
		ID:           "hl-1",
		ChapterIndex: 1,
		ChapterTitle: "Ch2",
		Text:         "Sword of Dawn",
		Note:         "Key item",
	}); err != nil {
		t.Fatal(err)
	}
	hls, err := ImportUserHighlights("u1", "book-1", []model.UserHighlight{
		{ID: "hl-dup", ChapterIndex: 1, Text: "Sword of Dawn"},
		{ID: "hl-2", ChapterIndex: 4, Text: "Starlight", Note: "Quote"},
	})
	if err != nil || len(hls) != 2 {
		t.Fatalf("expected 2 highlights after dedup import, got %+v (err=%v)", hls, err)
	}

	// Deleting comic cascades bookmarks & highlights
	if _, err := BatchDeleteComics([]string{"book-1"}); err != nil {
		t.Fatal(err)
	}
	afterDeleteBMs, _ := ListUserBookmarks("u1", "book-1")
	afterDeleteHLs, _ := ListUserHighlights("u1", "book-1")
	if len(afterDeleteBMs) != 0 || len(afterDeleteHLs) != 0 {
		t.Fatalf("expected cascade cleanup after delete, got bms=%d hls=%d", len(afterDeleteBMs), len(afterDeleteHLs))
	}
}

func TestUserReaderPreferencesHierarchyAndCleanup(t *testing.T) {
	setupTestDB(t)
	seedAssetUsersAndComics(t)

	if ValidateReaderPreferenceScope("invalid") || ValidateReaderPreferenceScope("comic:") {
		t.Fatal("invalid preference scope accepted")
	}

	if err := SetUserReaderPreference("u1", "global_comic", map[string]interface{}{
		"mode":            "single",
		"direction":       "ltr",
		"imageBrightness": 95,
		"preloadCount":    3,
	}); err != nil {
		t.Fatal(err)
	}
	if err := SetUserReaderPreference("u1", "series:series-1", map[string]interface{}{
		"direction":       "rtl",
		"mode":            "double",
		"imageBrightness": 50, // non-layout key should be stripped from series override
	}); err != nil {
		t.Fatal(err)
	}
	if err := SetUserReaderPreference("u1", "comic:book-1", map[string]interface{}{
		"mode": "webtoon",
	}); err != nil {
		t.Fatal(err)
	}

	prefs, err := GetUserReaderPreferences("u1", "book-1", "series-1")
	if err != nil {
		t.Fatal(err)
	}
	// Comic overrides series (mode=webtoon), series overrides global (direction=rtl), global provides imageBrightness=95
	if prefs.ResolvedComic["mode"] != "webtoon" {
		t.Fatalf("expected resolved mode=webtoon, got %v", prefs.ResolvedComic["mode"])
	}
	if prefs.ResolvedComic["direction"] != "rtl" {
		t.Fatalf("expected resolved direction=rtl, got %v", prefs.ResolvedComic["direction"])
	}
	if prefs.ResolvedComic["imageBrightness"] != float64(95) {
		t.Fatalf("expected resolved imageBrightness=95 from global, got %v", prefs.ResolvedComic["imageBrightness"])
	}

	// Delete comic override -> falls back to series (mode=double)
	if err := DeleteUserReaderPreference("u1", "comic:book-1"); err != nil {
		t.Fatal(err)
	}
	prefs, _ = GetUserReaderPreferences("u1", "book-1", "series-1")
	if prefs.ResolvedComic["mode"] != "double" || prefs.ComicOverride != nil {
		t.Fatalf("expected fallback to series mode=double, got %+v", prefs)
	}

	// ReconcileComicOwnership moves comic:book-1 prefs & bookmarks to book-2
	if err := SetUserReaderPreference("u1", "comic:book-1", map[string]interface{}{"fitMode": "width"}); err != nil {
		t.Fatal(err)
	}
	if _, err := UpsertUserBookmark("u1", "book-1", model.UserBookmark{ID: "bm-move", PageIndex: 1}); err != nil {
		t.Fatal(err)
	}
	tx, err := DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := mergeComicRows(tx, "book-1", "book-2"); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	movedBMs, _ := ListUserBookmarks("u1", "book-2")
	if len(movedBMs) != 1 || movedBMs[0].ID != "bm-move" {
		t.Fatalf("expected bookmark migrated to book-2, got %+v", movedBMs)
	}
	movedPrefs, _ := GetUserReaderPreferences("u1", "book-2", "")
	if movedPrefs.ComicOverride == nil || movedPrefs.ComicOverride["fitMode"] != "width" {
		t.Fatalf("expected comic preference migrated to book-2, got %+v", movedPrefs)
	}
}

func TestDeleteGroupCleansSeriesReaderPreferences(t *testing.T) {
	setupTestDB(t)
	seedAssetUsersAndComics(t)

	gid, err := CreateGroup("Test Series", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if err := AddComicsToGroup(int(gid), []string{"book-1"}); err != nil {
		t.Fatal(err)
	}
	seriesID := fmt.Sprintf("%d", gid)
	if err := SetUserReaderPreference("u1", "series:"+seriesID, map[string]interface{}{
		"direction": "rtl",
		"mode":      "double",
	}); err != nil {
		t.Fatal(err)
	}
	// Also test an independent string-keyed series preference isn't disturbed.
	if err := SetUserReaderPreference("u1", "series:other-series", map[string]interface{}{
		"mode": "single",
	}); err != nil {
		t.Fatal(err)
	}

	if err := DeleteGroup(int(gid)); err != nil {
		t.Fatal(err)
	}

	afterDelete, err := GetUserReaderPreferences("u1", "", seriesID)
	if err != nil {
		t.Fatal(err)
	}
	if afterDelete.SeriesOverride != nil {
		t.Fatalf("expected deleted group's series preference to be removed, got %+v", afterDelete.SeriesOverride)
	}

	untouched, err := GetUserReaderPreferences("u1", "", "other-series")
	if err != nil {
		t.Fatal(err)
	}
	if untouched.SeriesOverride == nil || untouched.SeriesOverride["mode"] != "single" {
		t.Fatalf("expected unrelated series preference to remain intact, got %+v", untouched.SeriesOverride)
	}

	// Verify auto-deletion via RemoveComicFromGroup also cleans up series:<id>.
	gid2, err := CreateGroup("Auto-Delete Series", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if err := AddComicsToGroup(int(gid2), []string{"book-2"}); err != nil {
		t.Fatal(err)
	}
	seriesID2 := fmt.Sprintf("%d", gid2)
	if err := SetUserReaderPreference("u1", "series:"+seriesID2, map[string]interface{}{
		"fitMode": "height",
	}); err != nil {
		t.Fatal(err)
	}
	if err := RemoveComicFromGroup(int(gid2), "book-2"); err != nil {
		t.Fatal(err)
	}
	afterAutoDelete, err := GetUserReaderPreferences("u1", "", seriesID2)
	if err != nil {
		t.Fatal(err)
	}
	if afterAutoDelete.SeriesOverride != nil {
		t.Fatalf("expected empty group's auto-deletion to clear series preference, got %+v", afterAutoDelete.SeriesOverride)
	}
}
