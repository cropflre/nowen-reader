package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func newSPATestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	files := fstest.MapFS{
		"index.html": {
			Data: []byte("<!doctype html><html><body>spa-index</body></html>"),
		},
		"assets/pdf.worker.min.mjs": {
			Data: []byte("export const WorkerMessageHandler = {};"),
		},
		"assets/index-12345678.js": {
			Data: []byte("console.log('app')"),
		},
	}

	router := gin.New()
	handler := NewSPAHandler(files)
	if handler == nil {
		t.Fatal("NewSPAHandler returned nil")
	}
	handler.RegisterRoutes(router)
	return router
}

func TestSPAHandlerServesPDFWorkerAsJavaScriptWithoutCache(t *testing.T) {
	router := newSPATestRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/assets/pdf.worker.min.mjs", nil)

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	contentType := recorder.Header().Get("Content-Type")
	if !strings.HasPrefix(contentType, "text/javascript") {
		t.Fatalf("Content-Type = %q, want JavaScript", contentType)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-cache, no-store, must-revalidate" {
		t.Fatalf("Cache-Control = %q, want worker revalidation policy", got)
	}
	if !strings.Contains(recorder.Body.String(), "WorkerMessageHandler") {
		t.Fatalf("unexpected worker body: %q", recorder.Body.String())
	}
}

func TestSPAHandlerDoesNotFallbackMissingStaticAssetToIndex(t *testing.T) {
	router := newSPATestRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/assets/pdf.worker.old-hash.mjs", nil)

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "spa-index") {
		t.Fatal("missing static asset incorrectly received SPA index.html")
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}

func TestSPAHandlerStillFallsBackForClientSideRoute(t *testing.T) {
	router := newSPATestRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/reader/comic-id", nil)

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "spa-index") {
		t.Fatalf("client-side route did not receive index.html: %q", recorder.Body.String())
	}
}
