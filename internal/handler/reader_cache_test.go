package handler

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestReaderPageCacheHTTPAndSessions(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	router := setupTestRouter(t)
	cookie := registerAndLogin(t, router)
	service.InvalidateAllCaches()
	t.Cleanup(service.InvalidateAllCaches)
	root := t.TempDir()
	lib := &model.Library{ID: "reader-cache-library", Name: "Cache", Type: "comic", RootPath: root, Enabled: true, DefaultAccess: "private"}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`INSERT INTO "Comic" ("id","filename","title","type","libraryId","relativePath") VALUES ('reader-cache-book','pages.cbz','Pages','comic',?,'pages.cbz')`, lib.ID); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "pages.cbz")
	writeBook := func(data []byte) {
		t.Helper()
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		entry, err := zw.Create("001.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write(data); err != nil {
			t.Fatal(err)
		}
		if err = zw.Close(); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(source, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}
	}
	original := []byte("original image bytes")
	writeBook(original)
	request := func(headers map[string]string, authed bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/comics/reader-cache-book/page/0", nil)
		if authed {
			req.AddCookie(&http.Cookie{Name: middleware.SessionCookie, Value: cookie})
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	// A cold concurrent open must publish a complete file for every waiter.
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := request(nil, true)
			if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), original) {
				t.Errorf("cold page: %d %s", w.Code, w.Body.String())
			}
		}()
	}
	wg.Wait()
	w := request(nil, true)
	etag := w.Header().Get("ETag")
	if etag == "" || w.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("cache headers: %v", w.Header())
	}
	w = request(map[string]string{"If-None-Match": etag}, true)
	if w.Code != http.StatusNotModified || w.Body.Len() != 0 {
		t.Fatalf("conditional request: %d %s", w.Code, w.Body.String())
	}
	w = request(map[string]string{"Range": "bytes=0-7"}, true)
	if w.Code != http.StatusPartialContent || string(w.Body.Bytes()) != string(original[:8]) {
		t.Fatalf("range: %d %s", w.Code, w.Body.String())
	}
	w = request(map[string]string{"If-None-Match": etag}, false)
	if w.Code == 200 || w.Code == 304 {
		t.Fatal("cache bypassed authentication")
	}
	before, _ := os.Stat(source)
	replacement := []byte("replaced image bytes")
	writeBook(replacement)
	changed := before.ModTime().Add(time.Second)
	if err := os.Chtimes(source, changed, changed); err != nil {
		t.Fatal(err)
	}
	w = request(map[string]string{"If-None-Match": etag}, true)
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), replacement) || w.Header().Get("ETag") == etag {
		t.Fatalf("replacement served stale page: %d %s", w.Code, w.Body.String())
	}
	for i := 0; i < 3; i++ {
		w = performAuthedRequest(router, "POST", "/api/comics/reader-cache-book/warmup", map[string]any{"sessionId": "test-reader", "count": -1}, cookie)
		if w.Code != 200 {
			t.Fatalf("heartbeat: %s", w.Body.String())
		}
	}
	w = performAuthedRequest(router, "POST", "/api/comics/reader-cache-book/warmup-done", map[string]any{"sessionId": "test-reader"}, cookie)
	if w.Code != 200 {
		t.Fatalf("close session: %s", w.Body.String())
	}
	w = performAuthedRequest(router, "POST", "/api/comics/reader-cache-book/warmup", map[string]any{"sessionId": "test-reader", "count": -1}, cookie)
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["sessionActive"] != false || result["sessionTtlSeconds"] != float64(120) {
		t.Fatalf("late heartbeat reopened closed session: %v", result)
	}
}
