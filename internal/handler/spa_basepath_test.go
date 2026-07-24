package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func setupTestEngineWithSPA(fsys fstest.MapFS) (*gin.Engine, *SPAHandler) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	SetupRoutes(r)

	spa := NewSPAHandler(fsys)
	spa.RegisterRoutes(r)
	return r, spa
}

func TestBasepathRoutingDefault(t *testing.T) {
	orig := os.Getenv("BASE_PATH")
	defer os.Setenv("BASE_PATH", orig)
	os.Setenv("BASE_PATH", "")

	mockFS := fstest.MapFS{
		"index.html":       &fstest.MapFile{Data: []byte("<!DOCTYPE html><html><head></head><body>Home</body></html>")},
		"assets/style.css": &fstest.MapFile{Data: []byte("body { color: red; }")},
	}

	r, _ := setupTestEngineWithSPA(mockFS)

	// 1. /api/health -> 200
	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("GET /api/health code = %d, want 200", w.Code)
	}

	// 2. / -> 200 index.html with injected config
	req = httptest.NewRequest("GET", "/", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("GET / code = %d, want 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `<base href="/">`) || !strings.Contains(body, `<meta name="nowen-base-path" content="">`) {
		t.Errorf("GET / body missing injected base href and meta tag, got: %s", body)
	}

	// 3. /api/nonexistent -> 404 JSON
	req = httptest.NewRequest("GET", "/api/nonexistent", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET /api/nonexistent code = %d, want 404", w.Code)
	}
	var res map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil || res["error"] == "" {
		t.Errorf("GET /api/nonexistent expected JSON error response, got: %s", w.Body.String())
	}

	// 4. /assets/missing.js -> 404 asset
	req = httptest.NewRequest("GET", "/assets/missing.js", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET /assets/missing.js code = %d, want 404", w.Code)
	}
	if strings.Contains(w.Body.String(), "<html>") {
		t.Errorf("GET /assets/missing.js should not return index.html")
	}
}

func TestBasepathRoutingSubpath(t *testing.T) {
	orig := os.Getenv("BASE_PATH")
	defer os.Setenv("BASE_PATH", orig)
	os.Setenv("BASE_PATH", "/reader/")

	mockFS := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<!DOCTYPE html><html><head></head><body>Reader</body></html>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('app')")},
	}

	r, _ := setupTestEngineWithSPA(mockFS)

	// 1. /api/health -> 404 (outside subpath)
	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET /api/health under /reader code = %d, want 404", w.Code)
	}

	// 2. /reader -> 308 Redirect to /reader/
	req = httptest.NewRequest("GET", "/reader", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusPermanentRedirect {
		t.Errorf("GET /reader code = %d, want 308", w.Code)
	}
	if loc := w.Header().Get("Location"); loc != "/reader/" {
		t.Errorf("GET /reader Location header = %q, want /reader/", loc)
	}

	// 3. /reader/api/health -> 200
	req = httptest.NewRequest("GET", "/reader/api/health", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("GET /reader/api/health code = %d, want 200", w.Code)
	}

	req = httptest.NewRequest("HEAD", "/reader/api/health", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("HEAD /reader/api/health code = %d, want 200", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Errorf("HEAD /reader/api/health expected empty body, got %q", w.Body.String())
	}

	// 4. /reader/ -> 200 index.html with injected basePath
	req = httptest.NewRequest("GET", "/reader/", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("GET /reader/ code = %d, want 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `<base href="/reader/">`) || !strings.Contains(body, `<meta name="nowen-base-path" content="/reader">`) {
		t.Errorf("GET /reader/ body missing injected base href and meta tag, got: %s", body)
	}
	if baseIndex, scriptIndex := strings.Index(body, "<base "), strings.Index(body, `<script src="./assets/app.js">`); scriptIndex >= 0 && (baseIndex < 0 || baseIndex > scriptIndex) {
		t.Errorf("runtime base tag must appear before relative assets, got: %s", body)
	}

	// 5. /reader/books -> SPA fallback
	req = httptest.NewRequest("GET", "/reader/books", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("GET /reader/books code = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "Reader") {
		t.Errorf("GET /reader/books should serve SPA index.html fallback")
	}

	// 6. /reader/assets/app.js -> 200 static asset
	req = httptest.NewRequest("GET", "/reader/assets/app.js", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("GET /reader/assets/app.js code = %d, want 200", w.Code)
	}

	// 7. /reader/api/unknown -> 404 JSON
	req = httptest.NewRequest("GET", "/reader/api/unknown", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET /reader/api/unknown code = %d, want 404", w.Code)
	}
	var res map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil || res["error"] == "" {
		t.Errorf("GET /reader/api/unknown expected JSON error, got: %s", w.Body.String())
	}

	// 8. /outside -> 404 plain text (outside basepath)
	req = httptest.NewRequest("GET", "/outside", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET /outside code = %d, want 404", w.Code)
	}
	if strings.Contains(w.Body.String(), "Reader") {
		t.Errorf("GET /outside should not serve SPA index.html")
	}
}

func TestInjectRuntimeConfigBeforeRelativeAssets(t *testing.T) {
	input := []byte(`<!DOCTYPE html><html><head data-theme="dark"><script src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css"></head><body></body></html>`)
	output := string(injectRuntimeConfig(input, "/reader"))

	baseIndex := strings.Index(output, `<base href="/reader/">`)
	scriptIndex := strings.Index(output, `<script src="./assets/app.js">`)
	styleIndex := strings.Index(output, `<link rel="stylesheet" href="./assets/app.css">`)
	if baseIndex < 0 || baseIndex > scriptIndex || baseIndex > styleIndex {
		t.Fatalf("base tag must be injected before relative assets, got: %s", output)
	}
}

func TestDynamicManifestServing(t *testing.T) {
	orig := os.Getenv("BASE_PATH")
	defer os.Setenv("BASE_PATH", orig)
	os.Setenv("BASE_PATH", "/reader/")

	mockFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<!DOCTYPE html><html></html>")},
		"manifest.json": &fstest.MapFile{Data: []byte(`{
			"name": "NowenReader",
			"start_url": "/",
			"icons": [{"src": "/icons/icon-192.png", "sizes": "192x192"}]
		}`)},
	}

	r, _ := setupTestEngineWithSPA(mockFS)

	req := httptest.NewRequest("GET", "/reader/manifest.json", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /reader/manifest.json code = %d, want 200", w.Code)
	}

	var m map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("failed to parse returned manifest: %v", err)
	}

	if m["start_url"] != "/reader/" {
		t.Errorf("start_url = %v, want /reader/", m["start_url"])
	}
	if m["scope"] != "/reader/" {
		t.Errorf("scope = %v, want /reader/", m["scope"])
	}

	icons, ok := m["icons"].([]interface{})
	if !ok || len(icons) == 0 {
		t.Fatalf("icons missing or empty")
	}
	firstIcon := icons[0].(map[string]interface{})
	if firstIcon["src"] != "/reader/icons/icon-192.png" {
		t.Errorf("icon src = %v, want /reader/icons/icon-192.png", firstIcon["src"])
	}
}
