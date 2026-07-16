package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestOPDSBasicAPIKeyAuthentication(t *testing.T) {
	router := setupTestRouter(t)
	user, token := createOPDSTestUserAndKey(t, "opds-basic", "opds-basic")

	response := performOPDSBasicRequest(router, "/api/opds", user.Username, token)
	if response.Code != http.StatusOK {
		t.Fatalf("Basic OPDS request returned %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, service.OPDSNavigationMIME) {
		t.Fatalf("root Content-Type = %q, want %q", contentType, service.OPDSNavigationMIME)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("root Cache-Control = %q, want private, no-store", cacheControl)
	}

	invalid := performOPDSBasicRequest(router, "/api/opds", "wrong-user", token)
	if invalid.Code != http.StatusUnauthorized {
		t.Fatalf("mismatched Basic username returned %d, want 401", invalid.Code)
	}
	if challenge := invalid.Header().Get("WWW-Authenticate"); !strings.Contains(challenge, "Nowen Reader OPDS") {
		t.Fatalf("missing OPDS Basic challenge: %q", challenge)
	}

	outsideOPDS := performOPDSBasicRequest(router, "/api/comics", user.Username, token)
	if outsideOPDS.Code != http.StatusUnauthorized {
		t.Fatalf("Basic API key escaped OPDS scope: /api/comics returned %d", outsideOPDS.Code)
	}
}

func TestOPDSFeedRequiresDownloadAccessAndExcludesNovels(t *testing.T) {
	router := setupTestRouter(t)
	user, token := createOPDSTestUserAndKey(t, "opds-reader", "opds-reader")
	createOPDSHandlerLibrary(t, "opds-download-lib", "comic", true)
	createOPDSHandlerLibrary(t, "opds-view-lib", "comic", true)
	createOPDSHandlerLibrary(t, "opds-novel-lib", "novel", true)
	createOPDSHandlerComic(t, "opds-download-comic", "Download Comic.cbz", "comic", "opds-download-lib")
	createOPDSHandlerComic(t, "opds-view-comic", "View Comic.cbz", "comic", "opds-view-lib")
	createOPDSHandlerComic(t, "opds-novel", "Novel.epub", "novel", "opds-novel-lib")

	if err := store.SetUserLibraryAccess(user.ID, []store.LibraryAccessReq{
		{LibraryID: "opds-download-lib", CanDownload: true},
		{LibraryID: "opds-view-lib", CanView: true},
		{LibraryID: "opds-novel-lib", CanDownload: true},
	}); err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}

	response := performOPDSBasicRequest(router, "/api/opds/all?page=1&pageSize=1", user.Username, token)
	if response.Code != http.StatusOK {
		t.Fatalf("OPDS all returned %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, service.OPDSAcquisitionMIME) {
		t.Fatalf("acquisition Content-Type = %q, want %q", contentType, service.OPDSAcquisitionMIME)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("acquisition Cache-Control = %q, want private, no-store", cacheControl)
	}
	body := response.Body.String()
	if !strings.Contains(body, "opds-download-comic") {
		t.Fatalf("downloadable comic missing from feed: %s", body)
	}
	for _, forbidden := range []string{"opds-view-comic", "opds-novel"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("forbidden publication %q leaked into feed: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, `<opensearch:totalResults>1</opensearch:totalResults>`) {
		t.Fatalf("feed total does not reflect permission and type filters: %s", body)
	}

	novelDownload := performOPDSBasicRequest(router, "/api/opds/download/opds-novel", user.Username, token)
	if novelDownload.Code != http.StatusNotFound {
		t.Fatalf("direct novel download returned %d, want 404: %s", novelDownload.Code, novelDownload.Body.String())
	}
}

func TestOPDSSearchDescriptionEndpoint(t *testing.T) {
	router := setupTestRouter(t)
	user, token := createOPDSTestUserAndKey(t, "opds-search", "opds-search")

	response := performOPDSBasicRequest(router, "/api/opds/search.xml", user.Username, token)
	if response.Code != http.StatusOK {
		t.Fatalf("OpenSearch description returned %d: %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, service.OpenSearchMIME) {
		t.Fatalf("OpenSearch Content-Type = %q, want %q", contentType, service.OpenSearchMIME)
	}
	if !strings.Contains(response.Body.String(), "{searchTerms}") {
		t.Fatalf("OpenSearch template missing searchTerms: %s", response.Body.String())
	}
}

func createOPDSTestUserAndKey(t *testing.T, id, username string) (*model.User, string) {
	t.Helper()
	user := &model.User{ID: id, Username: username, Password: "hashed", Role: "user"}
	if err := store.CreateUser(user); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	_, token, err := store.CreateAPIKey(user.ID, "OPDS", nil)
	if err != nil {
		t.Fatalf("CreateAPIKey failed: %v", err)
	}
	return user, token
}

func createOPDSHandlerLibrary(t *testing.T, id, libraryType string, enabled bool) {
	t.Helper()
	library := &model.Library{
		ID:            id,
		Name:          id,
		Type:          libraryType,
		RootPath:      "/test/" + id,
		Enabled:       enabled,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary(%s) failed: %v", id, err)
	}
}

func createOPDSHandlerComic(t *testing.T, id, filename, comicType, libraryID string) {
	t.Helper()
	now := time.Now().UTC()
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" (
			"id", "filename", "title", "type", "libraryId", "relativePath", "addedAt", "updatedAt"
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, id, filename, id, comicType, libraryID, filename, now, now); err != nil {
		t.Fatalf("insert comic %s failed: %v", id, err)
	}
}

func performOPDSBasicRequest(router *gin.Engine, path, username, token string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.SetBasicAuth(username, token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
