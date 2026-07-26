package handler

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestApplySeriesScrapedMetadata(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	originalConfig := config.GetSiteConfig()
	enabled := true
	siteConfig := originalConfig
	siteConfig.ScraperEnabled = &enabled
	if err := config.SaveSiteConfig(&siteConfig); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = config.SaveSiteConfig(&originalConfig) })

	router := setupTestRouter(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	cookie := registerAndLogin(t, router)
	library := &model.Library{
		ID:            "series-scrape-library",
		Name:          "Series Scrape",
		Type:          "comic",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(library); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES
			('scrape-volume-1', 'work/01.cbz', '01', 'comic', ?, 'work/01.cbz'),
			('scrape-volume-2', 'work/02.cbz', '02', 'comic', ?, 'work/02.cbz')
	`, library.ID, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle")
		VALUES ('series-scrape', ?, 'work', 'Work', 'work')
	`, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
			('series-scrape', 'scrape-volume-1', 0),
			('series-scrape', 'scrape-volume-2', 1)
	`); err != nil {
		t.Fatal(err)
	}

	response := performAuthedRequest(router, http.MethodPost, "/api/series/series-scrape/apply-metadata", map[string]interface{}{
		"metadata": map[string]interface{}{
			"author":      "Test Author",
			"description": "Test Description",
			"genre":       "Adventure,Fantasy",
			"publisher":   "Test Publisher",
			"language":    "zh",
			"year":        2026,
			"source":      "test",
		},
		"fields":        []string{"author", "description", "genre", "publisher", "language", "year", "tags"},
		"overwrite":     true,
		"syncTags":      true,
		"syncToVolumes": true,
	}, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("apply metadata status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Success     bool `json:"success"`
		SyncSuccess int  `json:"syncSuccess"`
		SyncErrors  int  `json:"syncErrors"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Success || payload.SyncSuccess != 2 || payload.SyncErrors != 0 {
		t.Fatalf("unexpected response: %#v", payload)
	}

	detail, err := store.GetSeriesDetail("series-scrape", "")
	if err != nil || detail == nil {
		t.Fatalf("GetSeriesDetail failed: %v", err)
	}
	if detail.Series.Author != "Test Author" || detail.Series.Description != "Test Description" ||
		detail.Series.Publisher != "Test Publisher" || detail.Series.Year == nil || *detail.Series.Year != 2026 ||
		len(detail.Series.Tags) != 2 {
		t.Fatalf("unexpected series metadata: %#v", detail.Series)
	}
	if !detail.Series.MetadataLocked || detail.Series.ManualLocked {
		t.Fatalf("unexpected metadata/structure locks: %#v", detail.Series)
	}
	for _, comicID := range []string{"scrape-volume-1", "scrape-volume-2"} {
		comic, err := store.GetComicByID(comicID)
		if err != nil || comic == nil {
			t.Fatalf("load comic %s: %v", comicID, err)
		}
		if comic.Author != "Test Author" || comic.Description != "Test Description" || comic.Year == nil || *comic.Year != 2026 {
			t.Fatalf("metadata not synced to %s: %#v", comicID, comic)
		}
	}

	manager := &model.User{ID: "series-manager", Username: "series-manager", Password: "hash", Role: "user"}
	if err := store.CreateUser(manager); err != nil {
		t.Fatal(err)
	}
	if err := store.SetUserLibraryAccess(manager.ID, []store.LibraryAccessReq{{
		LibraryID: library.ID,
		CanView:   true,
		CanManage: true,
	}}); err != nil {
		t.Fatal(err)
	}
	managerSession := "series-manager-session"
	if err := store.CreateSession(&model.UserSession{
		ID: managerSession, UserID: manager.ID, ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	response = performAuthedRequest(router, http.MethodPost, "/api/series/series-scrape/apply-metadata", map[string]interface{}{}, managerSession)
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-admin manager apply status = %d, want 403", response.Code)
	}
}
