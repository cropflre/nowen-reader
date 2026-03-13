package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
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
	regBody := map[string]string{
		"username": "admin",
		"password": "password123",
		"nickname": "Admin User",
	}
	w = performRequest(r, "POST", "/api/auth/register", regBody)
	if w.Code != http.StatusOK {
		t.Fatalf("Register failed with status %d: %s", w.Code, w.Body.String())
	}

	var regResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &regResp)
	user := regResp["user"].(map[string]interface{})
	if user["role"] != "admin" {
		t.Errorf("First user should be admin, got '%v'", user["role"])
	}

	// Try registering with same username
	w = performRequest(r, "POST", "/api/auth/register", regBody)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Duplicate registration should fail, got %d", w.Code)
	}

	// Login with correct credentials
	loginBody := map[string]string{
		"username": "admin",
		"password": "password123",
	}
	w = performRequest(r, "POST", "/api/auth/login", loginBody)
	if w.Code != http.StatusOK {
		t.Fatalf("Login failed with status %d: %s", w.Code, w.Body.String())
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

	// List comics (empty)
	w := performRequest(r, "GET", "/api/comics", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("List comics failed with status %d", w.Code)
	}
	var listResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &listResp)
	if listResp["total"].(float64) != 0 {
		t.Errorf("Expected 0 comics, got %v", listResp["total"])
	}

	// Insert test comics via store directly
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{store.FilenameToID("test1.cbz"), "test1.cbz", "Test Comic 1", 1000},
		{store.FilenameToID("test2.cbz"), "test2.cbz", "Test Comic 2", 2000},
	}
	store.BulkCreateComics(comics)

	// List comics
	w = performRequest(r, "GET", "/api/comics", nil)
	json.Unmarshal(w.Body.Bytes(), &listResp)
	if listResp["total"].(float64) != 2 {
		t.Errorf("Expected 2 comics, got %v", listResp["total"])
	}

	// Get single comic
	comicID := comics[0].ID
	w = performRequest(r, "GET", "/api/comics/"+comicID, nil)
	if w.Code != http.StatusOK {
		t.Errorf("Get comic failed with status %d", w.Code)
	}

	// Get non-existent comic
	w = performRequest(r, "GET", "/api/comics/nonexistent", nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("Non-existent comic should return 404, got %d", w.Code)
	}

	// Toggle favorite
	w = performRequest(r, "PUT", "/api/comics/"+comicID+"/favorite", nil)
	if w.Code != http.StatusOK {
		t.Errorf("Toggle favorite failed with status %d: %s", w.Code, w.Body.String())
	}

	// Update rating
	w = performRequest(r, "PUT", "/api/comics/"+comicID+"/rating", map[string]int{"rating": 5})
	if w.Code != http.StatusOK {
		t.Errorf("Update rating failed with status %d", w.Code)
	}

	// Invalid rating
	w = performRequest(r, "PUT", "/api/comics/"+comicID+"/rating", map[string]int{"rating": 10})
	if w.Code != http.StatusBadRequest {
		t.Errorf("Invalid rating should fail, got %d", w.Code)
	}

	// Update progress
	w = performRequest(r, "PUT", "/api/comics/"+comicID+"/progress", map[string]int{"page": 5})
	if w.Code != http.StatusOK {
		t.Errorf("Update progress failed with status %d", w.Code)
	}

	// Add tags
	w = performRequest(r, "POST", "/api/comics/"+comicID+"/tags", map[string]interface{}{
		"tags": []string{"action", "comedy"},
	})
	if w.Code != http.StatusOK {
		t.Errorf("Add tags failed with status %d: %s", w.Code, w.Body.String())
	}

	// Remove tag
	w = performRequest(r, "DELETE", "/api/comics/"+comicID+"/tags", map[string]string{
		"tag": "comedy",
	})
	if w.Code != http.StatusOK {
		t.Errorf("Remove tag failed with status %d: %s", w.Code, w.Body.String())
	}
}

func TestTagsEndpoint(t *testing.T) {
	r := setupTestRouter(t)

	w := performRequest(r, "GET", "/api/tags", nil)
	if w.Code != http.StatusOK {
		t.Errorf("List tags failed with status %d", w.Code)
	}
}

func TestCategoriesEndpoint(t *testing.T) {
	r := setupTestRouter(t)

	// List categories (empty)
	w := performRequest(r, "GET", "/api/categories", nil)
	if w.Code != http.StatusOK {
		t.Errorf("List categories failed with status %d", w.Code)
	}

	// Init categories
	w = performRequest(r, "POST", "/api/categories", map[string]string{"lang": "zh"})
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

	// Get stats (empty)
	w := performRequest(r, "GET", "/api/stats", nil)
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
	w = performRequest(r, "POST", "/api/stats/session", map[string]interface{}{
		"comicId":   "stats-comic-1",
		"startPage": 0,
	})
	if w.Code != http.StatusOK {
		t.Errorf("Start session failed with status %d: %s", w.Code, w.Body.String())
	}

	var sessionResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &sessionResp)
	sessionID := sessionResp["sessionId"]

	// End session
	w = performRequest(r, "PUT", "/api/stats/session", map[string]interface{}{
		"sessionId": sessionID,
		"endPage":   10,
		"duration":  300,
	})
	if w.Code != http.StatusOK {
		t.Errorf("End session failed with status %d: %s", w.Code, w.Body.String())
	}
}

func TestSiteSettingsEndpoints(t *testing.T) {
	r := setupTestRouter(t)

	// Get settings
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
	w := performRequest(r, "POST", "/api/comics/batch", map[string]interface{}{
		"action":   "favorite",
		"comicIds": []string{"batch-api-1", "batch-api-2"},
	})
	if w.Code != http.StatusOK {
		t.Errorf("Batch favorite failed with status %d: %s", w.Code, w.Body.String())
	}

	// Unknown action
	w = performRequest(r, "POST", "/api/comics/batch", map[string]interface{}{
		"action":   "unknown",
		"comicIds": []string{"batch-api-1"},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("Unknown batch action should fail, got %d", w.Code)
	}

	// Empty comicIds
	w = performRequest(r, "POST", "/api/comics/batch", map[string]interface{}{
		"action":   "favorite",
		"comicIds": []string{},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("Empty comicIds should fail, got %d", w.Code)
	}
}

func TestDuplicatesEndpoint(t *testing.T) {
	r := setupTestRouter(t)

	w := performRequest(r, "GET", "/api/comics/duplicates", nil)
	if w.Code != http.StatusOK {
		t.Errorf("Duplicates endpoint failed with status %d", w.Code)
	}
}
