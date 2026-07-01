package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// setupTestRouter creates a test router with a temporary database.
func setupTestRouter(t *testing.T) *gin.Engine {
	t.Helper()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	if err := store.InitDB(dbPath); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	t.Cleanup(func() {
		store.CloseDB()
		os.Remove(dbPath)
	})

	r := gin.New()
	SetupRoutes(r)
	return r
}

// registerAndLogin registers an admin user and returns the session cookie.
func registerAndLogin(t *testing.T, r *gin.Engine) string {
	t.Helper()

	// Register
	regBody := map[string]string{
		"username": "admin",
		"password": "password123",
		"nickname": "Admin User",
	}
	w := performRequest(r, "POST", "/api/auth/register", regBody)
	if w.Code != http.StatusOK {
		t.Fatalf("Register failed: %d %s", w.Code, w.Body.String())
	}

	// Extract session cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == middleware.SessionCookie {
			return c.Value
		}
	}
	t.Fatal("No session cookie after registration")
	return ""
}

// performRequest executes an HTTP request against the test router.
func performRequest(r *gin.Engine, method, path string, body interface{}) *httptest.ResponseRecorder {
	var reqBody *bytes.Buffer
	if body != nil {
		b, _ := json.Marshal(body)
		reqBody = bytes.NewBuffer(b)
	} else {
		reqBody = bytes.NewBuffer(nil)
	}

	req, _ := http.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// performAuthedRequest executes an authenticated HTTP request.
func performAuthedRequest(r *gin.Engine, method, path string, body interface{}, cookie string) *httptest.ResponseRecorder {
	var reqBody *bytes.Buffer
	if body != nil {
		b, _ := json.Marshal(body)
		reqBody = bytes.NewBuffer(b)
	} else {
		reqBody = bytes.NewBuffer(nil)
	}

	req, _ := http.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		req.AddCookie(&http.Cookie{
			Name:  middleware.SessionCookie,
			Value: cookie,
		})
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestHealthEndpoint(t *testing.T) {
	r := setupTestRouter(t)

	w := performRequest(r, "GET", "/api/health", nil)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if resp["status"] != "ok" {
		t.Errorf("Expected status 'ok', got '%v'", resp["status"])
	}
	if _, ok := resp["uptime"]; !ok {
		t.Error("Expected 'uptime' field in response")
	}
	if _, ok := resp["runtime"]; !ok {
		t.Error("Expected 'runtime' field in response")
	}
}

func TestAuthRegisterAndLogin(t *testing.T) {
	r := setupTestRouter(t)

	// Check initial state (needsSetup = true)
	w := performRequest(r, "GET", "/api/auth/me", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
	var meResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &meResp)
	if meResp["needsSetup"] != true {
		t.Error("Expected needsSetup=true for empty database")
	}

	// Register first user (should become admin)
	cookie := registerAndLogin(t, r)

	// Check me with auth
	w = performAuthedRequest(r, "GET", "/api/auth/me", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("Me failed with status %d", w.Code)
	}
	json.Unmarshal(w.Body.Bytes(), &meResp)
	user := meResp["user"].(map[string]interface{})
	if user["role"] != "admin" {
		t.Errorf("First user should be admin, got '%v'", user["role"])
	}

	// Try registering with same username
	regBody := map[string]string{
		"username": "admin",
		"password": "password123",
	}
	w = performRequest(r, "POST", "/api/auth/register", regBody)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Duplicate registration should fail with 400, got %d", w.Code)
	}

	// Login with wrong password
	wrongLogin := map[string]string{
		"username": "admin",
		"password": "wrongpassword",
	}
	w = performRequest(r, "POST", "/api/auth/login", wrongLogin)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Wrong password should return 401, got %d", w.Code)
	}

	// Login with nonexistent user
	noUser := map[string]string{
		"username": "nonexistent",
		"password": "password123",
	}
	w = performRequest(r, "POST", "/api/auth/login", noUser)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Nonexistent user should return 401, got %d", w.Code)
	}
}

func TestAuthValidation(t *testing.T) {
	r := setupTestRouter(t)

	// Empty username
	w := performRequest(r, "POST", "/api/auth/register", map[string]string{
		"username": "",
		"password": "password123",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("Empty username should fail, got %d", w.Code)
	}

	// Short username
	w = performRequest(r, "POST", "/api/auth/register", map[string]string{
		"username": "ab",
		"password": "password123",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("Short username should fail, got %d", w.Code)
	}

	// Short password
	w = performRequest(r, "POST", "/api/auth/register", map[string]string{
		"username": "testuser",
		"password": "12345",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("Short password should fail, got %d", w.Code)
	}
}

func TestComicsEndpoints(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	// List comics (empty)
	w := performAuthedRequest(r, "GET", "/api/comics", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("List comics failed with status %d", w.Code)
	}

	var listResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &listResp)
	comics := listResp["comics"].([]interface{})
	if len(comics) != 0 {
		t.Errorf("Expected 0 comics, got %d", len(comics))
	}

	// Create a comic directly in DB for testing
	testComics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"test-comic-1", "test-comic.cbz", "Test Comic", 1000},
	}
	store.BulkCreateComics(testComics)

	// List comics (should have 1)
	w = performAuthedRequest(r, "GET", "/api/comics", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("List comics failed with status %d", w.Code)
	}
	json.Unmarshal(w.Body.Bytes(), &listResp)
	comics = listResp["comics"].([]interface{})
	if len(comics) != 1 {
		t.Errorf("Expected 1 comic, got %d", len(comics))
	}

	// Get single comic
	comicID := "test-comic-1"
	w = performAuthedRequest(r, "GET", "/api/comics/"+comicID, nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("Get comic failed with status %d", w.Code)
	}

	// Toggle favorite
	w = performAuthedRequest(r, "PUT", "/api/comics/"+comicID+"/favorite", nil, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Toggle favorite failed with status %d", w.Code)
	}

	// Update rating
	w = performAuthedRequest(r, "PUT", "/api/comics/"+comicID+"/rating", map[string]int{"rating": 5}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Update rating failed with status %d", w.Code)
	}

	// Invalid rating
	w = performAuthedRequest(r, "PUT", "/api/comics/"+comicID+"/rating", map[string]int{"rating": 10}, cookie)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Invalid rating should fail, got %d", w.Code)
	}

	// Update progress
	w = performAuthedRequest(r, "PUT", "/api/comics/"+comicID+"/progress", map[string]int{"page": 5}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Update progress failed with status %d", w.Code)
	}

	// Add tags
	w = performAuthedRequest(r, "POST", "/api/comics/"+comicID+"/tags", map[string]interface{}{
		"tags": []string{"action", "comedy"},
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Add tags failed with status %d: %s", w.Code, w.Body.String())
	}

	// Remove tag
	w = performAuthedRequest(r, "DELETE", "/api/comics/"+comicID+"/tags", map[string]string{
		"tag": "comedy",
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Remove tag failed with status %d: %s", w.Code, w.Body.String())
	}
}

func TestTagsEndpoint(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "GET", "/api/tags", nil, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("List tags failed with status %d", w.Code)
	}
}

func TestCategoriesEndpoint(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	// List categories (empty)
	w := performAuthedRequest(r, "GET", "/api/categories", nil, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("List categories failed with status %d", w.Code)
	}

	// Init categories (admin only)
	w = performAuthedRequest(r, "POST", "/api/categories", map[string]string{"lang": "zh"}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Init categories failed with status %d", w.Code)
	}

	var catResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &catResp)
	cats := catResp["categories"].([]interface{})
	if len(cats) == 0 {
		t.Error("Expected predefined categories after init")
	}
}

func TestStatsEndpoints(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	// Get stats (empty)
	w := performAuthedRequest(r, "GET", "/api/stats", nil, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Get stats failed with status %d", w.Code)
	}

	// Create a comic for session
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"stats-comic-1", "stats-test.cbz", "Stats Test", 1000},
	}
	store.BulkCreateComics(comics)

	// Start session
	w = performAuthedRequest(r, "POST", "/api/stats/session", map[string]interface{}{
		"comicId":   "stats-comic-1",
		"startPage": 0,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Start session failed with status %d: %s", w.Code, w.Body.String())
	}

	var sessionResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &sessionResp)
	sessionID := sessionResp["sessionId"]

	// End session
	w = performAuthedRequest(r, "PUT", "/api/stats/session", map[string]interface{}{
		"sessionId": sessionID,
		"endPage":   10,
		"duration":  300,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("End session failed with status %d: %s", w.Code, w.Body.String())
	}
}

func TestSiteSettingsEndpoints(t *testing.T) {
	r := setupTestRouter(t)

	// Get settings — public endpoint, no auth needed
	w := performRequest(r, "GET", "/api/site-settings", nil)
	if w.Code != http.StatusOK {
		t.Errorf("Get settings failed with status %d", w.Code)
	}

	var settings map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &settings)
	if settings["siteName"] == nil {
		t.Error("Expected siteName in settings")
	}
}

func TestBatchOperations(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	// Create test comics
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"batch-api-1", "batch-api1.cbz", "Batch API 1", 1000},
		{"batch-api-2", "batch-api2.cbz", "Batch API 2", 2000},
	}
	store.BulkCreateComics(comics)

	// Batch favorite
	w := performAuthedRequest(r, "POST", "/api/comics/batch", map[string]interface{}{
		"action":   "favorite",
		"comicIds": []string{"batch-api-1", "batch-api-2"},
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Batch favorite failed with status %d: %s", w.Code, w.Body.String())
	}

	// Unknown action
	w = performAuthedRequest(r, "POST", "/api/comics/batch", map[string]interface{}{
		"action":   "unknown",
		"comicIds": []string{"batch-api-1"},
	}, cookie)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Unknown batch action should fail, got %d", w.Code)
	}

	// Empty comicIds
	w = performAuthedRequest(r, "POST", "/api/comics/batch", map[string]interface{}{
		"action":   "favorite",
		"comicIds": []string{},
	}, cookie)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Empty comicIds should fail, got %d", w.Code)
	}
}

func TestDuplicatesEndpoint(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "GET", "/api/comics/duplicates", nil, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Duplicates endpoint failed with status %d", w.Code)
	}
}

// TestAuthRequired verifies that protected endpoints return 401 without auth.
func TestAuthRequired(t *testing.T) {
	r := setupTestRouter(t)

	endpoints := []struct {
		method string
		path   string	}{
		{"GET", "/api/comics"},
		{"GET", "/api/comics/test-id"},
		{"GET", "/api/tags"},
		{"GET", "/api/categories"},
		{"GET", "/api/stats"},
		{"GET", "/api/groups"},
		{"GET", "/api/goals"},
		{"GET", "/api/recommendations"},
		{"GET", "/api/site-settings"}, // public — should return 200
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			w := performRequest(r, ep.method, ep.path, nil)
			if ep.path == "/api/site-settings" {
				if w.Code != http.StatusOK {
					t.Errorf("Public endpoint %s should return 200, got %d", ep.path, w.Code)
				}
			} else {
				if w.Code != http.StatusUnauthorized {
					t.Errorf("Protected endpoint %s should return 401, got %d", ep.path, w.Code)
				}
			}
		})
	}
}

// TestAdminRequired verifies that admin endpoints return 403 for non-admin users.
func TestAdminRequired(t *testing.T) {
	r := setupTestRouter(t)

	// Register admin
	cookie := registerAndLogin(t, r)

	// Register a normal user
	regBody := map[string]string{
		"username": "normaluser",
		"password": "password123",
	}
	w := performRequest(r, "POST", "/api/auth/register", regBody)
	if w.Code != http.StatusOK {
		t.Fatalf("Register normal user failed: %d", w.Code)
	}
	var normalCookie string
	for _, c := range w.Result().Cookies() {
		if c.Name == middleware.SessionCookie {
			normalCookie = c.Value
		}
	}

	// Admin-only endpoints should return 403 for normal user
	adminEndpoints := []struct {
		method string
		path   string
	}{
		{"POST", "/api/cache"},
	}

	for _, ep := range adminEndpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			w := performAuthedRequest(r, ep.method, ep.path, nil, normalCookie)
			if w.Code != http.StatusForbidden && w.Code != http.StatusUnauthorized {
				t.Errorf("Admin endpoint %s should return 403 for normal user, got %d", ep.path, w.Code)
			}
		})
	}

	// Admin should succeed (at least not get 403)
	for _, ep := range adminEndpoints {
		t.Run("admin_"+ep.method+" "+ep.path, func(t *testing.T) {
			w := performAuthedRequest(r, ep.method, ep.path, map[string]interface{}{}, cookie)
			if w.Code == http.StatusForbidden {
				t.Errorf("Admin should not get 403 for %s", ep.path)
			}
		})
	}
}

// TestSiteSettingsPublic verifies site-settings is accessible without auth.
func TestSiteSettingsPublic(t *testing.T) {
	r := setupTestRouter(t)

	// site-settings should be public (no auth required)
	w := performRequest(r, "GET", "/api/site-settings", nil)
	if w.Code != http.StatusOK {
		t.Errorf("GET /api/site-settings should be public, got %d", w.Code)
	}

	w = performRequest(r, "GET", "/api/site-settings/icon", nil)
	// Icon may return 404 if not set, but should not return 401
	if w.Code == http.StatusUnauthorized {
		t.Error("GET /api/site-settings/icon should not require auth")
	}
}

// TestNoUnprotectedEndpoints checks for common substring in response
func TestNoUnprotectedEndpoints(t *testing.T) {
	r := setupTestRouter(t)

	// These endpoints should all return 401 without auth
	protectedPaths := []string{
		"/api/comics",
		"/api/tags",
		"/api/categories",
		"/api/stats",
		"/api/groups",
		"/api/goals",
		"/api/export/json",
		"/api/recommendations",
		"/api/translate/config",
	}

	for _, path := range protectedPaths {
		t.Run(path, func(t *testing.T) {
			w := performRequest(r, "GET", path, nil)
			if w.Code != http.StatusUnauthorized {
				t.Errorf("%s returned %d instead of 401", path, w.Code)
			}
			body := w.Body.String()
			if !strings.Contains(body, "Unauthorized") {
				t.Errorf("%s did not return Unauthorized message", path)
			}
		})
	}
}

func TestDataQAHandler_FixPreview_Unauthorized(t *testing.T) {
	r := setupTestRouter(t)

	// No cookie → should get 401
	w := performRequest(r, "POST", "/api/admin/data-qa/fix-preview", map[string]interface{}{
		"issueTypes": []string{"TOTAL_TIME_ZERO"},
		"fixAll":     false,
	})
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401, got %d", w.Code)
	}
}

func TestDataQAHandler_FixPreview_AdminOK(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "POST", "/api/admin/data-qa/fix-preview", map[string]interface{}{
		"issueTypes": []string{},
		"fixAll":     true,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if _, ok := resp["dryRun"]; !ok {
		t.Error("Expected 'dryRun' field in response")
	}
	if _, ok := resp["plans"]; !ok {
		t.Error("Expected 'plans' field in response")
	}
}

func TestDataQAHandler_Fix_NoConfirm(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	// Missing confirm → should get 400
	w := performAuthedRequest(r, "POST", "/api/admin/data-qa/fix", map[string]interface{}{
		"issueTypes": []string{"TOTAL_TIME_ZERO"},
		"fixAll":     false,
	}, cookie)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "confirm") {
		t.Error("Expected error message about confirm")
	}
}

func TestDataQAHandler_Fix_ConfirmTrue(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "POST", "/api/admin/data-qa/fix", map[string]interface{}{
		"issueTypes": []string{},
		"fixAll":     true,
		"confirm":    true,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if _, ok := resp["dryRun"]; !ok {
		t.Error("Expected 'dryRun' field")
	}
	if resp["dryRun"] != false {
		t.Error("Expected dryRun=false for real fix")
	}
	if _, ok := resp["executed"]; !ok {
		t.Error("Expected 'executed' field")
	}
}

func TestDataQAHandler_PageCountRescan_ConfirmTrue(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "POST", "/api/admin/data-qa/pagecount-rescan", map[string]interface{}{
		"confirm":         true,
		"limit":           100,
		"includeNegative": true,
	}, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if _, ok := resp["queued"]; !ok {
		t.Error("Expected 'queued' field in response")
	}
	if _, ok := resp["message"]; !ok {
		t.Error("Expected 'message' field in response")
	}
}

func TestDataQAHandler_PageCountRescan_NoConfirm(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "POST", "/api/admin/data-qa/pagecount-rescan", map[string]interface{}{
		"limit":           100,
		"includeNegative": true,
	}, cookie)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "confirm") {
		t.Error("Expected error message about confirm")
	}
}

func TestDataQAHandler_Summary_AdminOK(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "GET", "/api/admin/data-qa/summary", nil, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if _, ok := resp["totalIssues"]; !ok {
		t.Error("Expected 'totalIssues' field")
	}
}

func TestDataQAHandler_Issues_AdminOK(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	w := performAuthedRequest(r, "GET", "/api/admin/data-qa/issues", nil, cookie)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if _, ok := resp["issues"]; !ok {
		t.Error("Expected 'issues' field")
	}
}
