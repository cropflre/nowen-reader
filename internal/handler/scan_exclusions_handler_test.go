package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

func TestScanExclusionsAPIRequiresAdminAndValidatesPattern(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	if err := config.SaveSiteConfig(&config.SiteConfig{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = config.SaveSiteConfig(&config.SiteConfig{}) })
	router := setupTestRouter(t)
	if response := performRequest(router, "GET", "/api/scan-exclusions", nil); response.Code == http.StatusOK {
		t.Fatal("exclusion configuration must require admin")
	}
	cookie := registerAndLogin(t, router)
	if response := performAuthedRequest(router, "PUT", "/api/scan-exclusions", map[string]string{"excludePathRegex": "["}, cookie); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid regex status=%d body=%s", response.Code, response.Body.String())
	}
	pattern := `(?i)(^|/)thumbs?(/|$)`
	response := performAuthedRequest(router, "PUT", "/api/scan-exclusions", map[string]string{"excludePathRegex": pattern}, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", response.Code, response.Body.String())
	}
	response = performAuthedRequest(router, "GET", "/api/scan-exclusions", nil, cookie)
	var configResponse struct {
		ExcludePathRegex string `json:"excludePathRegex"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &configResponse); err != nil || configResponse.ExcludePathRegex != pattern {
		t.Fatalf("saved rule response=%s err=%v", response.Body.String(), err)
	}
	response = performAuthedRequest(router, "POST", "/api/scan-exclusions/preview", map[string]string{"excludePathRegex": pattern}, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", response.Code, response.Body.String())
	}
	response = performAuthedRequest(router, "POST", "/api/scan-exclusions/cleanup", map[string]interface{}{"matchHash": "invalid", "confirm": true}, cookie)
	if response.Code != http.StatusConflict {
		t.Fatalf("stale cleanup status=%d body=%s", response.Code, response.Body.String())
	}
	response = performAuthedRequest(router, "POST", "/api/scan-exclusions/cleanup", map[string]interface{}{"matchHash": "invalid", "confirm": false}, cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unconfirmed cleanup status=%d body=%s", response.Code, response.Body.String())
	}
}
