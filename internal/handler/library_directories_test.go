package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestLibraryDirectoriesHandlerPermissionsAndComicListFiltering(t *testing.T) {
	r := setupTestRouter(t)
	adminCookie := registerAndLogin(t, r)

	// Create a private depth=2 comic library and a disabled comic library.
	w := performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":          "Private Categorized",
		"type":          "comic",
		"seriesDepth":   2,
		"rootPath":      t.TempDir(),
		"defaultAccess": "private",
	}, adminCookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("create private library: %d %s", w.Code, w.Body.String())
	}
	var createdPrivate struct {
		Library model.Library `json:"library"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createdPrivate); err != nil {
		t.Fatal(err)
	}
	privLibID := createdPrivate.Library.ID

	disabledFalse := false
	w = performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":          "Disabled Categorized",
		"type":          "comic",
		"seriesDepth":   2,
		"rootPath":      t.TempDir(),
		"defaultAccess": "public",
		"enabled":       disabledFalse,
	}, adminCookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("create disabled library: %d %s", w.Code, w.Body.String())
	}
	var createdDisabled struct {
		Library model.Library `json:"library"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createdDisabled); err != nil {
		t.Fatal(err)
	}
	disabledLibID := createdDisabled.Library.ID

	insertComic := func(libID, id, relPath, title string) {
		t.Helper()
		if _, err := store.DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, 18, 1024, 'comic', ?, ?)
		`, id, relPath, title, libID, relPath); err != nil {
			t.Fatalf("insert comic %s: %v", id, err)
		}
	}

	insertComic(privLibID, "kr-a1", "韩漫/书A/01.cbz", "01")
	insertComic(privLibID, "kr-a2", "韩漫/书A/02.cbz", "02")
	insertComic(privLibID, "kr-single", "韩漫/单章书/01.cbz", "01")
	insertComic(privLibID, "kr-shallow", "韩漫/散本.cbz", "散本")
	insertComic(privLibID, "kr-bak", "韩漫备份/书X/01.cbz", "01")
	insertComic(privLibID, "wild-1", "100%_特辑/书W/01.cbz", "01")
	insertComic(disabledLibID, "dis-1", "韩漫/隐藏书/01.cbz", "01")

	if err := service.RebuildAllComicSeries(); err != nil {
		t.Fatal(err)
	}

	// Create regular user WITHOUT access to privLibID initially.
	reader := &model.User{ID: "reader-1", Username: "reader-1", Password: "hash", Role: "user"}
	if err := store.CreateUser(reader); err != nil {
		t.Fatal(err)
	}
	readerCookie := "reader-1-session"
	if err := store.CreateSession(&model.UserSession{
		ID: readerCookie, UserID: reader.ID, ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	// 1. Unauthorized user gets 403 on private library directories AND on /api/comics?directoryPath=...
	w = performAuthedRequest(r, "GET", "/api/libraries/"+privLibID+"/directories", nil, readerCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized user on directories, got %d %s", w.Code, w.Body.String())
	}
	w = performAuthedRequest(r, "GET", "/api/comics?seriesView=true&libraryIds="+privLibID+"&directoryPath="+url.QueryEscape("韩漫"), nil, readerCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized user on comics directoryPath, got %d %s", w.Code, w.Body.String())
	}

	// 2. Disabled library returns 403 even for admin!
	w = performAuthedRequest(r, "GET", "/api/libraries/"+disabledLibID+"/directories", nil, adminCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for disabled library directories, got %d %s", w.Code, w.Body.String())
	}
	w = performAuthedRequest(r, "GET", "/api/comics?seriesView=true&libraryIds="+disabledLibID+"&directoryPath="+url.QueryEscape("韩漫"), nil, adminCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for disabled library comics directoryPath, got %d %s", w.Code, w.Body.String())
	}

	// 3. Grant view access to reader, verify 200 OK and accurate directory nodes.
	if err := store.SetUserLibraryAccess(reader.ID, []store.LibraryAccessReq{{
		LibraryID: privLibID,
		CanView:   true,
	}}); err != nil {
		t.Fatal(err)
	}

	w = performAuthedRequest(r, "GET", "/api/libraries/"+privLibID+"/directories", nil, readerCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for authorized reader, got %d %s", w.Code, w.Body.String())
	}
	var dirResp store.LibraryDirectoryListResult
	if err := json.Unmarshal(w.Body.Bytes(), &dirResp); err != nil {
		t.Fatal(err)
	}
	if dirResp.SeriesDepth != 2 || dirResp.MaxDirectoryDepth != 1 || dirResp.Total != 3 {
		t.Fatalf("unexpected directory response: %#v", dirResp)
	}

	// 4. Reject path traversal, absolute paths, exceeding depth, and missing/multi libraryIds.
	for _, badParent := range []string{"/韩漫", "../secret", "韩漫/..", "韩漫/", "韩漫/书A"} {
		w = performAuthedRequest(r, "GET", "/api/libraries/"+privLibID+"/directories?parent="+url.QueryEscape(badParent), nil, readerCookie)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for parent=%q, got %d %s", badParent, w.Code, w.Body.String())
		}
	}

	// Missing libraryIds or multiple libraryIds when directoryPath is set -> 400 Bad Request across all sort modes!
	for _, badURL := range []string{
		"/api/comics?seriesView=true&directoryPath=" + url.QueryEscape("韩漫"),
		"/api/comics?seriesView=true&libraryIds=" + privLibID + ",other&directoryPath=" + url.QueryEscape("韩漫"),
		"/api/comics?seriesView=false&directoryPath=" + url.QueryEscape("韩漫"),
		"/api/comics?seriesView=true&sortBy=pageCount&directoryPath=" + url.QueryEscape("韩漫"),
		"/api/comics?seriesView=true&libraryIds=" + privLibID + "&directoryPath=" + url.QueryEscape("../secret"),
	} {
		w = performAuthedRequest(r, "GET", badURL, nil, readerCookie)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %s, got %d %s", badURL, w.Code, w.Body.String())
		}
	}

	// 5. Querying "韩漫" returns 3 logical works (书A, 单章书, 散本.cbz) and excludes "韩漫备份"!
	for _, sortBy := range []string{"title", "pageCount"} {
		w = performAuthedRequest(r, "GET", "/api/comics?seriesView=true&sortBy="+sortBy+"&libraryIds="+privLibID+"&directoryPath="+url.QueryEscape("韩漫"), nil, readerCookie)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 on sortBy=%s, got %d %s", sortBy, w.Code, w.Body.String())
		}
		var listResp store.ComicListResult
		if err := json.Unmarshal(w.Body.Bytes(), &listResp); err != nil {
			t.Fatal(err)
		}
		if listResp.Total != 3 {
			t.Fatalf("sortBy=%s expected Total=3 under 韩漫, got %d (%#v)", sortBy, listResp.Total, listResp.Comics)
		}
	}

	// Querying wildcard directory "100%_特辑" returns 1 logical work!
	w = performAuthedRequest(r, "GET", "/api/comics?seriesView=true&libraryIds="+privLibID+"&directoryPath="+url.QueryEscape("100%_特辑"), nil, readerCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("wildcard directory query failed: %d %s", w.Code, w.Body.String())
	}
	var wildList store.ComicListResult
	if err := json.Unmarshal(w.Body.Bytes(), &wildList); err != nil {
		t.Fatal(err)
	}
	if wildList.Total != 1 || wildList.Comics[0].Title != "书W" {
		t.Fatalf("unexpected wildcard directory result: %#v", wildList)
	}
}
