package handler

import (
	"archive/zip"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestNovelSearchEndpointPermissionsAndValidation(t *testing.T) {
	r := setupTestRouter(t)
	adminCookie := registerAndLogin(t, r)
	_, normalCookie := registerUserAndGetCookie(t, r, "reader", "password123", "Reader")

	t.Cleanup(service.InvalidateAllCaches)

	privateDir := t.TempDir()
	publicDir := t.TempDir()

	if err := store.CreateLibrary(&model.Library{
		ID:            "private-novel-lib",
		Name:          "Private Novels",
		Type:          "novel",
		RootPath:      privateDir,
		Enabled:       true,
		DefaultAccess: "private",
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateLibrary(&model.Library{
		ID:            "public-comic-lib",
		Name:          "Public Comics",
		Type:          "comic",
		RootPath:      publicDir,
		Enabled:       true,
		DefaultAccess: "public",
	}); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(privateDir, "secret.txt"), []byte("第一章 秘密\n这里藏着绝密线索。"), 0644); err != nil {
		t.Fatal(err)
	}
	cbzFile, err := os.Create(filepath.Join(publicDir, "sample.cbz"))
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(cbzFile)
	wEntry, _ := zw.Create("01.jpg")
	_, _ = wEntry.Write([]byte("img"))
	_ = zw.Close()
	_ = cbzFile.Close()

	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES
			('secret-novel', 'secret.txt', 'Secret Novel', 'novel', 'private-novel-lib', 'secret.txt'),
			('public-comic', 'sample.cbz', 'Public Comic', 'comic', 'public-comic-lib', 'sample.cbz')
	`); err != nil {
		t.Fatal(err)
	}

	// Normal user lacks access to private novel -> 403
	w := performAuthedRequest(r, http.MethodGet, "/api/comics/secret-novel/search?q=%E7%BA%BF%E7%B4%A2", nil, normalCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized private novel search, got %d %s", w.Code, w.Body.String())
	}

	// Admin searches private novel -> 200
	w = performAuthedRequest(r, http.MethodGet, "/api/comics/secret-novel/search?q=%E7%BA%BF%E7%B4%A2", nil, adminCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("admin novel search failed: %d %s", w.Code, w.Body.String())
	}
	var resp service.NovelSearchResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode search response: %v", err)
	}
	if resp.MatchedChapters != 1 || len(resp.Results) != 1 || resp.Results[0].MatchCount != 1 {
		t.Fatalf("unexpected search response: %+v", resp)
	}

	// Empty query -> 400
	w = performAuthedRequest(r, http.MethodGet, "/api/comics/secret-novel/search?q=%20%20", nil, adminCookie)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty query, got %d", w.Code)
	}

	// Non-novel -> 400
	w = performAuthedRequest(r, http.MethodGet, "/api/comics/public-comic/search?q=img", nil, normalCookie)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-novel comic search, got %d %s", w.Code, w.Body.String())
	}
}
