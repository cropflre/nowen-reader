package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

func performRawAuthedJSON(r *gin.Engine, method, path, rawJSON, cookie string) *httptest.ResponseRecorder {
	req, _ := http.NewRequest(method, path, bytes.NewBufferString(rawJSON))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookie, Value: cookie})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestLibrarySeriesDepthValidationAndDefaults(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	rootDefault := t.TempDir()
	// 1. Omitted seriesDepth defaults to 1 on create.
	w := performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":     "Default Comic Lib",
		"type":     "comic",
		"rootPath": rootDefault,
	}, cookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("create default lib failed: %d %s", w.Code, w.Body.String())
	}
	var createdResp struct {
		Library struct {
			ID          string `json:"id"`
			SeriesDepth int    `json:"seriesDepth"`
		} `json:"library"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createdResp); err != nil {
		t.Fatal(err)
	}
	if createdResp.Library.SeriesDepth != 1 {
		t.Fatalf("expected omitted seriesDepth=1, got %d", createdResp.Library.SeriesDepth)
	}

	// 2. Explicit depth=2 on create, and omitted seriesDepth on update preserves 2.
	rootDeep := t.TempDir()
	w = performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":        "Deep Comic Lib",
		"type":        "comic",
		"seriesDepth": 2,
		"rootPath":    rootDeep,
	}, cookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("create depth=2 lib failed: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createdResp); err != nil {
		t.Fatal(err)
	}
	if createdResp.Library.SeriesDepth != 2 {
		t.Fatalf("expected seriesDepth=2, got %d", createdResp.Library.SeriesDepth)
	}
	deepID := createdResp.Library.ID

	w = performRawAuthedJSON(r, "PUT", "/api/admin/libraries/"+deepID, `{"name":"Deep Comic Lib Renamed"}`, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("update omitted seriesDepth failed: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createdResp); err != nil {
		t.Fatal(err)
	}
	if createdResp.Library.SeriesDepth != 2 {
		t.Fatalf("omitted seriesDepth on update reset value to %d, want 2", createdResp.Library.SeriesDepth)
	}

	// 3. Reject null, 0, negative, decimal, >8, string, boolean on create and update.
	invalidPayloads := []string{
		`{"seriesDepth":null}`,
		`{"seriesDepth":0}`,
		`{"seriesDepth":-1}`,
		`{"seriesDepth":9}`,
		`{"seriesDepth":1.5}`,
		`{"seriesDepth":2.0}`,
		`{"seriesDepth":"2"}`,
		`{"seriesDepth":true}`,
	}
	for _, payload := range invalidPayloads {
		resp := performRawAuthedJSON(r, "PUT", "/api/admin/libraries/"+deepID, payload, cookie)
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("payload %s should fail with 400, got %d: %s", payload, resp.Code, resp.Body.String())
		}
	}

	// 4. Novel libraries only accept seriesDepth = 1.
	novelRoot := t.TempDir()
	w = performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":        "Novel Depth 2",
		"type":        "novel",
		"seriesDepth": 2,
		"rootPath":    novelRoot,
	}, cookie)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("novel seriesDepth=2 should return 400, got %d: %s", w.Code, w.Body.String())
	}

	w = performAuthedRequest(r, "POST", "/api/admin/libraries", map[string]interface{}{
		"name":     "Novel Default",
		"type":     "novel",
		"rootPath": novelRoot,
	}, cookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("novel default seriesDepth=1 should succeed, got %d: %s", w.Code, w.Body.String())
	}
}
