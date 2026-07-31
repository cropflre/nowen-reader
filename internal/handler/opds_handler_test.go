package handler

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
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

func TestOPDSFeedRequiresDownloadAccessAndExcludesNovelLibraries(t *testing.T) {
	router := setupTestRouter(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	user, token := createOPDSTestUserAndKey(t, "opds-reader", "opds-reader")
	createOPDSHandlerLibrary(t, "opds-download-lib", "comic", true)
	createOPDSHandlerLibrary(t, "opds-view-lib", "comic", true)
	createOPDSHandlerLibrary(t, "opds-novel-lib", "novel", true)
	createOPDSHandlerComic(t, "opds-download-comic", "Download Comic.cbz", "comic", "opds-download-lib")
	createOPDSHandlerComic(t, "opds-download-ebook", "Download Ebook.epub", "novel", "opds-download-lib")
	createOPDSHandlerComic(t, "opds-view-comic", "View Comic.cbz", "comic", "opds-view-lib")
	createOPDSHandlerComic(t, "opds-novel", "Novel.epub", "novel", "opds-novel-lib")
	if _, err := store.DB().Exec(`
		UPDATE "Comic" SET "pageCount" = 12
		WHERE "id" IN ('opds-download-comic', 'opds-download-ebook')
	`); err != nil {
		t.Fatalf("set OPDS page counts failed: %v", err)
	}

	if err := store.SetUserLibraryAccess(user.ID, []store.LibraryAccessReq{
		{LibraryID: "opds-download-lib", CanDownload: true},
		{LibraryID: "opds-view-lib", CanView: true},
		{LibraryID: "opds-novel-lib", CanDownload: true},
	}); err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}

	response := performOPDSBasicRequest(router, "/api/opds/all?page=1&pageSize=10", user.Username, token)
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
	for _, expected := range []string{"opds-download-comic", "opds-download-ebook"} {
		if !strings.Contains(body, expected) {
			t.Fatalf("downloadable comic-library publication %q missing from feed: %s", expected, body)
		}
	}
	for _, forbidden := range []string{"opds-view-comic", "opds-novel"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("forbidden publication %q leaked into feed: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, `<opensearch:totalResults>2</opensearch:totalResults>`) {
		t.Fatalf("feed total does not reflect permission and type filters: %s", body)
	}
	if !strings.Contains(body, `/api/opds/stream/opds-download-comic?`) {
		t.Fatalf("comic is missing OPDS-PSE link: %s", body)
	}
	if strings.Contains(body, `/api/opds/stream/opds-download-ebook?`) {
		t.Fatalf("text novel advertised OPDS-PSE: %s", body)
	}

	novelDownload := performOPDSBasicRequest(router, "/api/opds/download/opds-novel", user.Username, token)
	if novelDownload.Code != http.StatusNotFound {
		t.Fatalf("direct novel download returned %d, want 404: %s", novelDownload.Code, novelDownload.Body.String())
	}
}

func TestOPDSPSEStreamsJPEGWithDownloadPermission(t *testing.T) {
	router := setupTestRouter(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	user, token := createOPDSTestUserAndKey(t, "opds-pse-user", "opds-pse-user")
	viewer, viewerToken := createOPDSTestUserAndKey(t, "opds-pse-viewer", "opds-pse-viewer")

	libraryDir := t.TempDir()
	library := &model.Library{
		ID:            "opds-pse-lib",
		Name:          "opds-pse-lib",
		Type:          "comic",
		RootPath:      libraryDir,
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}

	filename := "PSE Comic.cbz"
	if err := os.WriteFile(filepath.Join(libraryDir, filename), createImageCBZ(t), 0o600); err != nil {
		t.Fatalf("write PSE CBZ failed: %v", err)
	}
	createOPDSHandlerComic(t, "opds-pse-comic", filename, "comic", library.ID)
	readAt := time.Now().UTC().Truncate(time.Second)
	if _, err := store.DB().Exec(`
		UPDATE "Comic" SET "pageCount" = 1 WHERE "id" = 'opds-pse-comic';
		INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt")
		VALUES (?, 'opds-pse-comic', 0, ?)
	`, user.ID, readAt); err != nil {
		t.Fatalf("prepare PSE comic state failed: %v", err)
	}
	if err := store.SetUserLibraryAccess(user.ID, []store.LibraryAccessReq{{
		LibraryID: library.ID, CanDownload: true,
	}}); err != nil {
		t.Fatalf("set PSE download access failed: %v", err)
	}
	if err := store.SetUserLibraryAccess(viewer.ID, []store.LibraryAccessReq{{
		LibraryID: library.ID, CanView: true,
	}}); err != nil {
		t.Fatalf("set PSE view access failed: %v", err)
	}

	feed := performOPDSBasicRequest(router, "/api/opds/all", user.Username, token)
	if feed.Code != http.StatusOK {
		t.Fatalf("PSE feed returned %d: %s", feed.Code, feed.Body.String())
	}
	for _, expected := range []string{
		`xmlns:pse="http://vaemendis.net/opds-pse/ns"`,
		`rel="http://vaemendis.net/opds-pse/stream"`,
		`pse:count="1"`,
		`pse:lastRead="1"`,
		`pse:lastReadDate="` + readAt.Format(time.RFC3339) + `"`,
	} {
		if !strings.Contains(feed.Body.String(), expected) {
			t.Fatalf("PSE feed missing %q: %s", expected, feed.Body.String())
		}
	}

	streamPath := "/api/opds/stream/opds-pse-comic?page=0&width=2"
	page := performOPDSBasicRequest(router, streamPath, user.Username, token)
	if page.Code != http.StatusOK {
		t.Fatalf("PSE page returned %d: %s", page.Code, page.Body.String())
	}
	if got := page.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("PSE Content-Type = %q, want image/jpeg", got)
	}
	if got := page.Header().Get("Cache-Control"); !strings.HasPrefix(got, "private,") {
		t.Fatalf("PSE Cache-Control = %q, want private cache", got)
	}
	decoded, err := jpeg.Decode(bytes.NewReader(page.Body.Bytes()))
	if err != nil {
		t.Fatalf("decode PSE JPEG: %v", err)
	}
	if got := decoded.Bounds().Size(); got.X != 2 || got.Y != 1 {
		t.Fatalf("PSE JPEG size = %dx%d, want 2x1", got.X, got.Y)
	}

	etag := page.Header().Get("ETag")
	notModified := performOPDSRequest(router, http.MethodGet, streamPath, user.Username, token, map[string]string{"If-None-Match": etag})
	if notModified.Code != http.StatusNotModified {
		t.Fatalf("PSE conditional request returned %d, want 304", notModified.Code)
	}
	denied := performOPDSBasicRequest(router, streamPath, viewer.Username, viewerToken)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("view-only PSE request returned %d, want 403", denied.Code)
	}
}

func TestOPDSDownloadSupportsFullRangeAndHeadRequests(t *testing.T) {
	router := setupTestRouter(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	user, token := createOPDSTestUserAndKey(t, "opds-range", "opds-range")

	libraryDir := t.TempDir()
	library := &model.Library{
		ID:            "opds-range-lib",
		Name:          "opds-range-lib",
		Type:          "comic",
		RootPath:      libraryDir,
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}

	filename := "Range Comic.cbz"
	content := createTestCBZ(t)
	if err := os.WriteFile(filepath.Join(libraryDir, filename), content, 0o600); err != nil {
		t.Fatalf("write test CBZ failed: %v", err)
	}
	createOPDSHandlerComic(t, "opds-range-comic", filename, "comic", library.ID)
	if err := store.SetUserLibraryAccess(user.ID, []store.LibraryAccessReq{{
		LibraryID:   library.ID,
		CanDownload: true,
	}}); err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}

	downloadPath := "/api/opds/download/opds-range-comic/Range%20Comic.cbz"
	full := performOPDSRequest(router, http.MethodGet, downloadPath, user.Username, token, nil)
	if full.Code != http.StatusOK {
		t.Fatalf("full download returned %d: %s", full.Code, full.Body.String())
	}
	if got := full.Header().Get("Content-Type"); got != "application/vnd.comicbook+zip" {
		t.Fatalf("full Content-Type = %q", got)
	}
	if got := full.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("full Accept-Ranges = %q, want bytes", got)
	}
	if got := full.Header().Get("Content-Length"); got != strconv.Itoa(len(content)) {
		t.Fatalf("full Content-Length = %q, want %d", got, len(content))
	}
	if !bytes.Equal(full.Body.Bytes(), content) {
		t.Fatal("full download content differs from the source file")
	}
	if _, err := zip.NewReader(bytes.NewReader(full.Body.Bytes()), int64(full.Body.Len())); err != nil {
		t.Fatalf("downloaded CBZ is not a valid ZIP: %v", err)
	}

	const tailSize = 22
	rangeHeader := map[string]string{"Range": "bytes=-22"}
	partial := performOPDSRequest(router, http.MethodGet, downloadPath, user.Username, token, rangeHeader)
	if partial.Code != http.StatusPartialContent {
		t.Fatalf("range download returned %d: %s", partial.Code, partial.Body.String())
	}
	expectedRange := "bytes " + strconv.Itoa(len(content)-tailSize) + "-" + strconv.Itoa(len(content)-1) + "/" + strconv.Itoa(len(content))
	if got := partial.Header().Get("Content-Range"); got != expectedRange {
		t.Fatalf("Content-Range = %q, want %q", got, expectedRange)
	}
	if !bytes.Equal(partial.Body.Bytes(), content[len(content)-tailSize:]) {
		t.Fatal("range response does not contain the requested ZIP tail")
	}

	head := performOPDSRequest(router, http.MethodHead, downloadPath, user.Username, token, nil)
	if head.Code != http.StatusOK {
		t.Fatalf("HEAD download returned %d: %s", head.Code, head.Body.String())
	}
	if head.Body.Len() != 0 {
		t.Fatalf("HEAD response body length = %d, want 0", head.Body.Len())
	}
	if got := head.Header().Get("Content-Length"); got != strconv.Itoa(len(content)) {
		t.Fatalf("HEAD Content-Length = %q, want %d", got, len(content))
	}

	legacy := performOPDSRequest(router, http.MethodGet, "/api/opds/download/opds-range-comic", user.Username, token, nil)
	if legacy.Code != http.StatusOK || !bytes.Equal(legacy.Body.Bytes(), content) {
		t.Fatalf("legacy filename-free download failed with status %d", legacy.Code)
	}

	ebookFilename := "Comic Ebook.epub"
	ebookContent := []byte("epub transport")
	if err := os.WriteFile(filepath.Join(libraryDir, ebookFilename), ebookContent, 0o600); err != nil {
		t.Fatalf("write test EPUB failed: %v", err)
	}
	createOPDSHandlerComic(t, "opds-ebook-comic", ebookFilename, "novel", library.ID)
	ebook := performOPDSRequest(
		router,
		http.MethodGet,
		"/api/opds/download/opds-ebook-comic/Comic%20Ebook.epub",
		user.Username,
		token,
		nil,
	)
	if ebook.Code != http.StatusOK {
		t.Fatalf("comic-library EPUB download returned %d: %s", ebook.Code, ebook.Body.String())
	}
	if got := ebook.Header().Get("Content-Type"); got != "application/epub+zip" {
		t.Fatalf("EPUB Content-Type = %q", got)
	}
	if !bytes.Equal(ebook.Body.Bytes(), ebookContent) {
		t.Fatal("comic-library EPUB download content differs from source")
	}
}

func TestOPDSSeriesFeedsAreDownloadScopedAndFlattenSections(t *testing.T) {
	router := setupTestRouter(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	user, token := createOPDSTestUserAndKey(t, "opds-series-user", "opds-series-user")
	createOPDSHandlerLibrary(t, "opds-series-download", "comic", true)
	createOPDSHandlerLibrary(t, "opds-series-view", "comic", true)
	createOPDSHandlerComic(t, "opds-series-v1", "Work/Work 01.cbz", "comic", "opds-series-download")
	createOPDSHandlerComic(t, "opds-series-v2", "Work/Season 1/Work 02.pdf", "comic", "opds-series-download")
	createOPDSHandlerComic(t, "opds-view-v1", "Private/Private 01.cbz", "comic", "opds-series-view")
	createOPDSHandlerComic(t, "opds-view-v2", "Private/Private 02.cbz", "comic", "opds-series-view")

	if err := store.SetUserLibraryAccess(user.ID, []store.LibraryAccessReq{
		{LibraryID: "opds-series-download", CanDownload: true},
		{LibraryID: "opds-series-view", CanView: true},
	}); err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle", "coverComicId", "manualLocked") VALUES
		('opds-series-visible', 'opds-series-download', 'Work', 'Work', 'work', 'opds-series-v1', 1),
		('opds-series-private', 'opds-series-view', 'Private', 'Private', 'private', 'opds-view-v1', 1);
		INSERT INTO "ComicSeriesSection" ("id", "seriesId", "title", "relativePath", "sortIndex") VALUES
		('opds-series-section', 'opds-series-visible', 'Season 1', 'Work/Season 1', 0);
		INSERT INTO "ComicSeriesItem" ("seriesId", "sectionId", "comicId", "sortIndex", "displayLabel") VALUES
		('opds-series-visible', NULL, 'opds-series-v1', 0, '01'),
		('opds-series-visible', 'opds-series-section', 'opds-series-v2', 1, '02'),
		('opds-series-private', NULL, 'opds-view-v1', 0, '01'),
		('opds-series-private', NULL, 'opds-view-v2', 1, '02')
	`); err != nil {
		t.Fatalf("insert OPDS series failed: %v", err)
	}

	list := performOPDSBasicRequest(router, "/api/opds/series", user.Username, token)
	if list.Code != http.StatusOK {
		t.Fatalf("OPDS series returned %d: %s", list.Code, list.Body.String())
	}
	if contentType := list.Header().Get("Content-Type"); !strings.HasPrefix(contentType, service.OPDSNavigationMIME) {
		t.Fatalf("series Content-Type = %q, want navigation feed", contentType)
	}
	if !strings.Contains(list.Body.String(), "opds-series-visible") || strings.Contains(list.Body.String(), "opds-series-private") {
		t.Fatalf("series list did not enforce download access: %s", list.Body.String())
	}

	detail := performOPDSBasicRequest(router, "/api/opds/series/opds-series-visible", user.Username, token)
	if detail.Code != http.StatusOK {
		t.Fatalf("OPDS series detail returned %d: %s", detail.Code, detail.Body.String())
	}
	body := detail.Body.String()
	first := strings.Index(body, "<title>01</title>")
	second := strings.Index(body, "<title>Season 1 - 02</title>")
	if first < 0 || second < 0 || first >= second {
		t.Fatalf("series items were not flattened in order: %s", body)
	}
	if !strings.Contains(body, `rel="collection" href="http://example.com/api/opds/series/opds-series-visible"`) {
		t.Fatalf("series detail entries are missing collection relation: %s", body)
	}

	all := performOPDSBasicRequest(router, "/api/opds/all", user.Username, token)
	if !strings.Contains(all.Body.String(), `rel="collection" href="http://example.com/api/opds/series/opds-series-visible"`) {
		t.Fatalf("flat feed entries are missing collection relation: %s", all.Body.String())
	}
	denied := performOPDSBasicRequest(router, "/api/opds/series/opds-series-private", user.Username, token)
	if denied.Code != http.StatusNotFound {
		t.Fatalf("view-only series returned %d, want 404: %s", denied.Code, denied.Body.String())
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
	return performOPDSRequest(router, http.MethodGet, path, username, token, nil)
}

func performOPDSRequest(router *gin.Engine, method, path, username, token string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	request.SetBasicAuth(username, token)
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func createTestCBZ(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("001.txt")
	if err != nil {
		t.Fatalf("create test CBZ entry failed: %v", err)
	}
	if _, err := entry.Write([]byte("page")); err != nil {
		t.Fatalf("write test CBZ entry failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close test CBZ failed: %v", err)
	}
	return buffer.Bytes()
}

func createImageCBZ(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("001.png")
	if err != nil {
		t.Fatalf("create image CBZ entry failed: %v", err)
	}
	page := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			page.Set(x, y, color.NRGBA{R: 20, G: 80, B: 180, A: 255})
		}
	}
	if err := png.Encode(entry, page); err != nil {
		t.Fatalf("encode image CBZ page failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close image CBZ failed: %v", err)
	}
	return buffer.Bytes()
}
