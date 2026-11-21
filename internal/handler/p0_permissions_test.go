package handler

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func registerUserAndGetCookie(t *testing.T, r *gin.Engine, username, password, nickname string) (string, string) {
	t.Helper()
	w := performRequest(r, http.MethodPost, "/api/auth/register", map[string]string{
		"username": username,
		"password": password,
		"nickname": nickname,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("register %s failed: %d %s", username, w.Code, w.Body.String())
	}
	var resp struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse register response: %v", err)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == middleware.SessionCookie {
			return resp.User.ID, c.Value
		}
	}
	t.Fatalf("no session cookie for %s", username)
	return "", ""
}

func TestUserSelfServiceAndAdminPasswordReset(t *testing.T) {
	r := setupTestRouter(t)
	adminCookie := registerAndLogin(t, r)
	normalUserID, normalCookie := registerUserAndGetCookie(t, r, "alice", "secret123", "Alice")

	// Normal user updates own nickname
	w := performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":   "updateProfile",
		"nickname": "  Alice Wonderland  ",
	}, normalCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("non-admin updateProfile failed: %d %s", w.Code, w.Body.String())
	}
	u, err := store.GetUserByID(normalUserID)
	if err != nil || u == nil || u.Nickname != "Alice Wonderland" {
		t.Fatalf("expected trimmed nickname 'Alice Wonderland', got %+v (err=%v)", u, err)
	}

	// Normal user rejects empty nickname
	w = performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":   "updateProfile",
		"nickname": "   ",
	}, normalCookie)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blank nickname, got %d", w.Code)
	}

	// Normal user changes own password (rejects < 6 chars first)
	w = performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":      "changePassword",
		"oldPassword": "secret123",
		"newPassword": "123",
	}, normalCookie)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short new password, got %d", w.Code)
	}

	w = performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":      "changePassword",
		"oldPassword": "secret123",
		"newPassword": "newsecret456",
	}, normalCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("non-admin changePassword failed: %d %s", w.Code, w.Body.String())
	}

	// Normal user cannot update another user's profile or call admin resetPassword
	adminUser, err := store.GetUserByUsername("admin")
	if err != nil || adminUser == nil {
		t.Fatalf("failed to load admin user: %v", err)
	}
	w = performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":   "updateProfile",
		"userId":   adminUser.ID,
		"nickname": "Hacked",
	}, normalCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when non-admin updates other profile, got %d", w.Code)
	}

	w = performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":      "resetPassword",
		"userId":      adminUser.ID,
		"newPassword": "hacked123",
	}, normalCookie)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when non-admin calls resetPassword, got %d", w.Code)
	}

	// Admin resets normal user's password and revokes normal user's active session
	w = performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":      "resetPassword",
		"userId":      normalUserID,
		"newPassword": "adminReset789",
	}, adminCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("admin resetPassword failed: %d %s", w.Code, w.Body.String())
	}

	// Old session should be revoked
	w = performAuthedRequest(r, http.MethodPut, "/api/auth/users", map[string]any{
		"action":   "updateProfile",
		"nickname": "ShouldFail",
	}, normalCookie)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after admin resetPassword revoked sessions, got %d", w.Code)
	}

	// Logging in with the reset password succeeds
	w = performRequest(r, http.MethodPost, "/api/auth/login", map[string]string{
		"username": "alice",
		"password": "adminReset789",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("login with reset password failed: %d %s", w.Code, w.Body.String())
	}
}

func TestNonAdminReadingGoalsLifecycle(t *testing.T) {
	r := setupTestRouter(t)
	_ = registerAndLogin(t, r)
	_, aliceCookie := registerUserAndGetCookie(t, r, "alice", "password123", "Alice")
	_, bobCookie := registerUserAndGetCookie(t, r, "bob", "password123", "Bob")

	// Alice sets daily and weekly goals
	for _, gt := range []string{"daily", "weekly"} {
		w := performAuthedRequest(r, http.MethodPost, "/api/goals", map[string]any{
			"goalType":    gt,
			"targetMins":  45,
			"targetBooks": 2,
		}, aliceCookie)
		if w.Code != http.StatusOK {
			t.Fatalf("non-admin POST /api/goals (%s) failed: %d %s", gt, w.Code, w.Body.String())
		}
	}

	// Bob also sets daily goal (should be isolated from Alice)
	w := performAuthedRequest(r, http.MethodPost, "/api/goals", map[string]any{
		"goalType":    "daily",
		"targetMins":  90,
		"targetBooks": 1,
	}, bobCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("bob POST /api/goals failed: %d %s", w.Code, w.Body.String())
	}

	// Delete via path param (/api/goals/:goalType) as used by frontend
	w = performAuthedRequest(r, http.MethodDelete, "/api/goals/daily", nil, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE /api/goals/daily failed: %d %s", w.Code, w.Body.String())
	}

	// Delete via query param (/api/goals?goalType=weekly)
	w = performAuthedRequest(r, http.MethodDelete, "/api/goals?goalType=weekly", nil, aliceCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE /api/goals?goalType=weekly failed: %d %s", w.Code, w.Body.String())
	}

	// Invalid goalType rejected
	w = performAuthedRequest(r, http.MethodDelete, "/api/goals/monthly", nil, aliceCookie)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid goalType, got %d", w.Code)
	}

	// Bob's daily goal remains intact
	w = performAuthedRequest(r, http.MethodGet, "/api/goals", nil, bobCookie)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/goals for bob failed: %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"targetMins":90`) {
		t.Fatalf("expected bob's goal targetMins=90 to remain, got %s", w.Body.String())
	}
}

func TestExportComicsCSVMultiUserIsolation(t *testing.T) {
	r := setupTestRouter(t)
	adminCookie := registerAndLogin(t, r)
	aliceID, aliceCookie := registerUserAndGetCookie(t, r, "alice", "password123", "Alice")

	lib := &model.Library{
		ID:            "csv-public-lib",
		Name:          "CSV Public",
		Type:          "novel",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   false,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "type", "genre", "libraryId", "relativePath", "lastReadPage", "isFavorite")
		VALUES ('csv-book-1', 'novel.epub', 'CSV Test Novel', 100, 'novel', 'Fantasy', 'csv-public-lib', 'novel.epub', 90, 1)
	`); err != nil {
		t.Fatal(err)
	}

	// Alice has read to page 20 and NOT favorited
	if err := store.UpdateReadingProgress("csv-book-1", 20, 100, aliceID); err != nil {
		t.Fatal(err)
	}
	// Admin has read to page 80 and favorited
	adminUser, err := store.GetUserByUsername("admin")
	if err != nil || adminUser == nil {
		t.Fatal(err)
	}
	if err := store.UpdateReadingProgress("csv-book-1", 80, 100, adminUser.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ToggleFavorite("csv-book-1", adminUser.ID); err != nil {
		t.Fatal(err)
	}

	parseCSV := func(body string) [][]string {
		cleaned := strings.TrimPrefix(body, "\xef\xbb\xbf")
		rows, err := csv.NewReader(strings.NewReader(cleaned)).ReadAll()
		if err != nil {
			t.Fatalf("parse csv failed: %v", err)
		}
		return rows
	}

	wAlice := performAuthedRequest(r, http.MethodGet, "/api/export/csv/comics", nil, aliceCookie)
	if wAlice.Code != http.StatusOK {
		t.Fatalf("alice CSV export failed: %d %s", wAlice.Code, wAlice.Body.String())
	}
	aliceRows := parseCSV(wAlice.Body.String())
	if len(aliceRows) != 2 {
		t.Fatalf("expected header + 1 row for alice, got %d", len(aliceRows))
	}
	// Header should separate 类型 and 题材
	if aliceRows[0][6] != "类型" || aliceRows[0][7] != "题材" {
		t.Fatalf("unexpected type/genre columns: %v", aliceRows[0])
	}
	if aliceRows[1][6] != "novel" || aliceRows[1][7] != "Fantasy" {
		t.Fatalf("unexpected type/genre values: %v", aliceRows[1])
	}
	// Progress col=11 (20%), favorite col=14 (否)
	if aliceRows[1][11] != "20" || aliceRows[1][14] != "否" {
		t.Fatalf("expected alice progress=20 fav=否, got progress=%q fav=%q", aliceRows[1][11], aliceRows[1][14])
	}

	wAdmin := performAuthedRequest(r, http.MethodGet, "/api/export/csv/comics", nil, adminCookie)
	if wAdmin.Code != http.StatusOK {
		t.Fatalf("admin CSV export failed: %d %s", wAdmin.Code, wAdmin.Body.String())
	}
	adminRows := parseCSV(wAdmin.Body.String())
	if len(adminRows) != 2 {
		t.Fatalf("expected header + 1 row for admin, got %d", len(adminRows))
	}
	if adminRows[1][11] != "80" || adminRows[1][14] != "是" {
		t.Fatalf("expected admin progress=80 fav=是, got progress=%q fav=%q", adminRows[1][11], adminRows[1][14])
	}
}
