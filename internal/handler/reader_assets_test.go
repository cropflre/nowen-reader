package handler

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestReaderAssetsBookmarksHighlightsExportAndProgressRatio(t *testing.T) {
	r := setupTestRouter(t)
	_ = registerAndLogin(t, r)
	_, aliceCookie := registerUserAndGetCookie(t, r, "alice", "password123", "Alice")
	_, bobCookie := registerUserAndGetCookie(t, r, "bob", "password123", "Bob")

	if err := store.CreateLibrary(&model.Library{
		ID:            "assets-public-lib",
		Name:          "Public Novels",
		Type:          "novel",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateLibrary(&model.Library{
		ID:            "assets-private-lib",
		Name:          "Private Novels",
		Type:          "novel",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "private",
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "author", "pageCount", "type", "libraryId", "relativePath") VALUES
			('pub-novel', 'pub.epub', 'Public Novel', 'Author A', 30, 'novel', 'assets-public-lib', 'pub.epub'),
			('priv-novel', 'priv.epub', 'Private Novel', 'Author B', 20, 'novel', 'assets-private-lib', 'priv.epub')
	`); err != nil {
		t.Fatal(err)
	}

	// Private library access denied -> 403
	w := performAuthedRequest(r, http.MethodGet, "/api/comics/priv-novel/bookmarks", nil, aliceCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on private novel bookmarks, got %d", w.Code)
	}

	// Progress with positionRatio via PUT /progress and GET /comics/:id
	w = performAuthedRequest(r, http.MethodPut, "/api/comics/pub-novel/progress", map[string]any{
		"page":          4,
		"totalPages":    30,
		"positionRatio": 0.45,
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT progress failed: %d %s", w.Code, w.Body.String())
	}

	// Activity heartbeat updates positionRatio
	w = performAuthedRequest(r, http.MethodPost, "/api/reading/pub-novel/activity", map[string]any{
		"clientSessionId": "alice-sess-1",
		"page":            4,
		"totalPages":      30,
		"positionRatio":   0.78,
		"activeSeconds":   20,
		"sequence":        1,
		"finalize":        false,
		"trackProgress":   true,
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("POST reading activity failed: %d %s", w.Code, w.Body.String())
	}

	// Verify GET /comics/:id returns Alice's positionRatio while Bob still sees 0
	wAliceDetail := performAuthedRequest(r, http.MethodGet, "/api/comics/pub-novel", nil, aliceCookie)
	if wAliceDetail.Code != http.StatusOK {
		t.Fatalf("GET comic alice failed: %d", wAliceDetail.Code)
	}
	var aliceComic struct {
		LastReadPage          int     `json:"lastReadPage"`
		LastReadPositionRatio float64 `json:"lastReadPositionRatio"`
	}
	if err := json.Unmarshal(wAliceDetail.Body.Bytes(), &aliceComic); err != nil {
		t.Fatal(err)
	}
	if aliceComic.LastReadPage != 4 || math.Abs(aliceComic.LastReadPositionRatio-0.78) > 1e-6 {
		t.Fatalf("unexpected alice detail progress: %+v", aliceComic)
	}

	wBobDetail := performAuthedRequest(r, http.MethodGet, "/api/comics/pub-novel", nil, bobCookie)
	var bobComic struct {
		LastReadPage          int     `json:"lastReadPage"`
		LastReadPositionRatio float64 `json:"lastReadPositionRatio"`
	}
	_ = json.Unmarshal(wBobDetail.Body.Bytes(), &bobComic)
	if bobComic.LastReadPage != 0 || bobComic.LastReadPositionRatio != 0 {
		t.Fatalf("expected bob progress isolated at 0, got %+v", bobComic)
	}

	// Alice creates & updates bookmark
	w = performAuthedRequest(r, http.MethodPost, "/api/comics/pub-novel/bookmarks", map[string]any{
		"id":            "bm-alice-1",
		"chapterIndex":  4,
		"positionRatio": 0.78,
		"chapterTitle":  "Chapter 5",
		"name":          "Climax",
		"note":          "Great scene",
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("POST bookmark failed: %d %s", w.Code, w.Body.String())
	}

	w = performAuthedRequest(r, http.MethodPut, "/api/comics/pub-novel/bookmarks/bm-alice-1", map[string]any{
		"name": "Climax Edited",
		"note": "Updated note",
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT bookmark failed: %d %s", w.Code, w.Body.String())
	}

	// Bob cannot see or edit Alice's bookmark
	w = performAuthedRequest(r, http.MethodGet, "/api/comics/pub-novel/bookmarks", nil, bobCookie)
	if !strings.Contains(w.Body.String(), `"bookmarks":[]`) {
		t.Fatalf("bob should not see alice bookmarks: %s", w.Body.String())
	}
	w = performAuthedRequest(r, http.MethodPut, "/api/comics/pub-novel/bookmarks/bm-alice-1", map[string]any{
		"name": "Hijack",
	}, bobCookie)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when bob edits alice bookmark, got %d", w.Code)
	}

	// Import bookmarks idempotently
	w = performAuthedRequest(r, http.MethodPost, "/api/comics/pub-novel/bookmarks/import", map[string]any{
		"bookmarks": []map[string]any{
			{"id": "bm-alice-1", "chapterIndex": 4, "positionRatio": 0.78, "name": "Old"},
			{"id": "bm-alice-2", "pageIndex": 10, "positionRatio": 0.1, "chapterTitle": "Chapter 11"},
		},
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("import bookmarks failed: %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "bm-alice-2") {
		t.Fatalf("expected imported bookmark bm-alice-2 in response: %s", w.Body.String())
	}

	// Highlights CRUD + Export Markdown
	w = performAuthedRequest(r, http.MethodPost, "/api/comics/pub-novel/highlights", map[string]any{
		"id":           "hl-alice-1",
		"chapterIndex": 4,
		"chapterTitle": "Chapter 5",
		"text":         "The dawn breaks over the ancient city.",
		"note":         "Opening line",
		"color":        "#fbbf24",
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("POST highlight failed: %d %s", w.Code, w.Body.String())
	}

	w = performAuthedRequest(r, http.MethodGet, "/api/comics/pub-novel/highlights/export?format=markdown", nil, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("export highlights failed: %d %s", w.Code, w.Body.String())
	}
	md := w.Body.String()
	if !strings.Contains(md, "# Public Novel") ||
		!strings.Contains(md, "Climax Edited") ||
		!strings.Contains(md, "The dawn breaks over the ancient city.") ||
		!strings.Contains(md, "Opening line") {
		t.Fatalf("markdown export missing expected content:\n%s", md)
	}

	// Delete highlight & bookmark
	w = performAuthedRequest(r, http.MethodDelete, "/api/comics/pub-novel/highlights/hl-alice-1", nil, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE highlight failed: %d", w.Code)
	}
	w = performAuthedRequest(r, http.MethodDelete, "/api/comics/pub-novel/bookmarks/bm-alice-1", nil, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE bookmark failed: %d", w.Code)
	}
}

func TestReaderPreferencesEndpoints(t *testing.T) {
	r := setupTestRouter(t)
	_ = registerAndLogin(t, r)
	_, aliceCookie := registerUserAndGetCookie(t, r, "alice", "password123", "Alice")
	_, bobCookie := registerUserAndGetCookie(t, r, "bob", "password123", "Bob")

	// Reject invalid scope
	w := performAuthedRequest(r, http.MethodPut, "/api/user/reader-preferences", map[string]any{
		"scope": "bad_scope",
		"prefs": map[string]any{"mode": "single"},
	}, aliceCookie)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid scope, got %d", w.Code)
	}

	// Alice sets global_comic + series override + comic override
	w = performAuthedRequest(r, http.MethodPut, "/api/user/reader-preferences", map[string]any{
		"scope": "global_comic",
		"prefs": map[string]any{"mode": "single", "direction": "ltr", "preloadCount": 4},
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT global_comic failed: %d %s", w.Code, w.Body.String())
	}
	w = performAuthedRequest(r, http.MethodPut, "/api/user/reader-preferences", map[string]any{
		"scope": "series:s1",
		"prefs": map[string]any{"direction": "rtl", "doubleCoverAlone": true},
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT series override failed: %d", w.Code)
	}
	w = performAuthedRequest(r, http.MethodPut, "/api/user/reader-preferences", map[string]any{
		"scope": "comic:c1",
		"prefs": map[string]any{"mode": "webtoon"},
	}, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT comic override failed: %d", w.Code)
	}

	// GET resolves comic > series > global
	w = performAuthedRequest(r, http.MethodGet, "/api/user/reader-preferences?comicId=c1&seriesId=s1", nil, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("GET reader preferences failed: %d", w.Code)
	}
	var prefsResp struct {
		ResolvedComic map[string]any `json:"resolvedComic"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &prefsResp); err != nil {
		t.Fatal(err)
	}
	if prefsResp.ResolvedComic["mode"] != "webtoon" || prefsResp.ResolvedComic["direction"] != "rtl" {
		t.Fatalf("unexpected resolvedComic: %+v", prefsResp.ResolvedComic)
	}

	// Bob remains completely isolated
	wBob := performAuthedRequest(r, http.MethodGet, "/api/user/reader-preferences?comicId=c1&seriesId=s1", nil, bobCookie)
	if !strings.Contains(wBob.Body.String(), `"resolvedComic":{}`) {
		t.Fatalf("expected empty preferences for bob, got %s", wBob.Body.String())
	}

	// Delete comic override restores series mode? (series had no mode, falls back to global mode=single)
	w = performAuthedRequest(r, http.MethodDelete, "/api/user/reader-preferences?scope=comic:c1", nil, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE reader preferences failed: %d", w.Code)
	}
	w = performAuthedRequest(r, http.MethodGet, "/api/user/reader-preferences?comicId=c1&seriesId=s1", nil, aliceCookie)
	_ = json.Unmarshal(w.Body.Bytes(), &prefsResp)
	if prefsResp.ResolvedComic["mode"] != "single" {
		t.Fatalf("expected fallback to global mode=single, got %+v", prefsResp.ResolvedComic)
	}
}
