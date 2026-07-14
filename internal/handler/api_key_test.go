package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func performCredentialRequest(r *gin.Engine, method, path string, body any, cookie, bearer string) *httptest.ResponseRecorder {
	var requestBody []byte
	if body != nil {
		requestBody, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(requestBody))
	req.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: middleware.SessionCookie, Value: cookie})
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func createAPIKeyForTest(t *testing.T, r *gin.Engine, cookie, password string) (string, string) {
	t.Helper()
	w := performAuthedRequest(r, http.MethodPost, "/api/auth/api-keys", map[string]any{
		"name":            "test client",
		"currentPassword": password,
		"expiresInDays":   30,
	}, cookie)
	if w.Code != http.StatusCreated {
		t.Fatalf("create API key: %d %s", w.Code, w.Body.String())
	}
	var response struct {
		Key    string `json:"key"`
		APIKey struct {
			ID string `json:"id"`
		} `json:"apiKey"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode API key response: %v", err)
	}
	return response.Key, response.APIKey.ID
}

func TestAPIKeyHTTPAuthenticationAndSessionBoundary(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	wrongPassword := performAuthedRequest(r, http.MethodPost, "/api/auth/api-keys", map[string]any{
		"name": "bad", "currentPassword": "wrong",
	}, cookie)
	if wrongPassword.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password status = %d, want 401", wrongPassword.Code)
	}

	plaintext, keyID := createAPIKeyForTest(t, r, cookie, "password123")
	list := performAuthedRequest(r, http.MethodGet, "/api/auth/api-keys", nil, cookie)
	if list.Code != http.StatusOK || strings.Contains(list.Body.String(), plaintext) || strings.Contains(list.Body.String(), "secretHash") {
		t.Fatalf("API key list exposed secret material: %d %s", list.Code, list.Body.String())
	}
	me := performCredentialRequest(r, http.MethodGet, "/api/auth/me", nil, "", plaintext)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"username":"admin"`) {
		t.Fatalf("API key /auth/me: %d %s", me.Code, me.Body.String())
	}

	listWithKey := performCredentialRequest(r, http.MethodGet, "/api/auth/api-keys", nil, "", plaintext)
	if listWithKey.Code != http.StatusUnauthorized {
		t.Fatalf("API key managed credentials with status %d, want 401", listWithKey.Code)
	}

	invalidWithCookie := performCredentialRequest(r, http.MethodGet, "/api/comics", nil, cookie, "invalid")
	if invalidWithCookie.Code != http.StatusUnauthorized {
		t.Fatalf("invalid Bearer fell back to cookie: status %d", invalidWithCookie.Code)
	}

	revoke := performAuthedRequest(r, http.MethodDelete, "/api/auth/api-keys/"+keyID, nil, cookie)
	if revoke.Code != http.StatusNoContent {
		t.Fatalf("revoke API key: %d %s", revoke.Code, revoke.Body.String())
	}
	meAfterRevoke := performCredentialRequest(r, http.MethodGet, "/api/auth/me", nil, "", plaintext)
	if meAfterRevoke.Code != http.StatusUnauthorized {
		t.Fatalf("revoked API key status = %d, want 401", meAfterRevoke.Code)
	}
}

func TestAPIKeyFollowsCurrentLibraryPermissions(t *testing.T) {
	r := setupTestRouter(t)
	adminCookie := registerAndLogin(t, r)

	createUser := performAuthedRequest(r, http.MethodPost, "/api/auth/users", map[string]any{
		"username": "reader", "password": "readerpass", "nickname": "Reader", "role": "user",
	}, adminCookie)
	if createUser.Code != http.StatusOK {
		t.Fatalf("create reader: %d %s", createUser.Code, createUser.Body.String())
	}
	var createResponse struct {
		User model.AuthUser `json:"user"`
	}
	if err := json.Unmarshal(createUser.Body.Bytes(), &createResponse); err != nil {
		t.Fatalf("decode reader: %v", err)
	}

	login := performRequest(r, http.MethodPost, "/api/auth/login", map[string]string{
		"username": "reader", "password": "readerpass",
	})
	var readerCookie string
	for _, cookie := range login.Result().Cookies() {
		if cookie.Name == middleware.SessionCookie {
			readerCookie = cookie.Value
		}
	}
	if readerCookie == "" {
		t.Fatalf("reader login failed: %d %s", login.Code, login.Body.String())
	}
	plaintext, _ := createAPIKeyForTest(t, r, readerCookie, "readerpass")

	library := &model.Library{
		ID: "api-key-private-library", Name: "Private", Type: "comic", RootPath: t.TempDir(),
		Enabled: true, DefaultAccess: "private", ScanEnabled: true,
	}
	if err := store.CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}
	if err := store.BulkCreateComics([]struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{{ID: "api-key-comic", Filename: "book.cbz", Title: "Book", FileSize: 100}}); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}
	if _, err := store.DB().Exec(`UPDATE "Comic" SET "libraryId" = ?, "relativePath" = ? WHERE "id" = ?`, library.ID, "book.cbz", "api-key-comic"); err != nil {
		t.Fatalf("assign comic library: %v", err)
	}

	getComic := func() *httptest.ResponseRecorder {
		return performCredentialRequest(r, http.MethodGet, "/api/comics/api-key-comic", nil, "", plaintext)
	}
	if response := getComic(); response.Code != http.StatusForbidden {
		t.Fatalf("ungranted API key status = %d, want 403", response.Code)
	}

	if err := store.SetUserLibraryAccess(createResponse.User.ID, []store.LibraryAccessReq{{
		LibraryID: library.ID, CanView: true,
	}}); err != nil {
		t.Fatalf("grant library access: %v", err)
	}
	if response := getComic(); response.Code != http.StatusOK {
		t.Fatalf("granted API key status = %d, want 200: %s", response.Code, response.Body.String())
	}

	if err := store.SetUserLibraryAccess(createResponse.User.ID, nil); err != nil {
		t.Fatalf("remove library access: %v", err)
	}
	if response := getComic(); response.Code != http.StatusForbidden {
		t.Fatalf("revoked permission status = %d, want 403", response.Code)
	}
}
