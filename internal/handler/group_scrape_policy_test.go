package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestGroupScrapeDoesNotSyncIntoDirectorySeries(t *testing.T) {
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
		ID:            "group-scrape-policy-library",
		Name:          "Group Scrape Policy",
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
			('group-policy-volume-1', 'work/01.cbz', '01', 'comic', ?, 'work/01.cbz'),
			('group-policy-volume-2', 'work/02.cbz', '02', 'comic', ?, 'work/02.cbz')
	`, library.ID, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle")
		VALUES ('group-policy-series', ?, 'work', 'Work', 'work')
	`, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
			('group-policy-series', 'group-policy-volume-1', 0),
			('group-policy-series', 'group-policy-volume-2', 1)
	`); err != nil {
		t.Fatal(err)
	}
	groupID, err := store.CreateGroupWithItems("Franchise", "", nil, []string{"group-policy-series"})
	if err != nil {
		t.Fatal(err)
	}

	response := performAuthedRequest(router, http.MethodPost, "/api/groups/"+strconv.FormatInt(groupID, 10)+"/apply-metadata", map[string]interface{}{
		"metadata": map[string]interface{}{
			"author": "Group Display Author",
			"genre":  "Adventure",
			"source": "test",
		},
		"fields":        []string{"author", "genre", "tags"},
		"overwrite":     true,
		"syncTags":      true,
		"syncToVolumes": true,
	}, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("apply status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		MemberSyncAllowed bool `json:"memberSyncAllowed"`
		MemberSyncSkipped bool `json:"memberSyncSkipped"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.MemberSyncAllowed || !payload.MemberSyncSkipped {
		t.Fatalf("unexpected sync policy response: %#v", payload)
	}

	group, err := store.GetGroupByID(int(groupID))
	if err != nil || group == nil || group.Author != "Group Display Author" {
		t.Fatalf("group display metadata was not applied: %#v, err=%v", group, err)
	}
	for _, comicID := range []string{"group-policy-volume-1", "group-policy-volume-2"} {
		comic, err := store.GetComicByID(comicID)
		if err != nil || comic == nil {
			t.Fatalf("load comic %s: %v", comicID, err)
		}
		if comic.Author != "" {
			t.Fatalf("directory member %s author was overwritten: %q", comicID, comic.Author)
		}
		var tagCount int
		if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "ComicTag" WHERE "comicId" = ?`, comicID).Scan(&tagCount); err != nil {
			t.Fatal(err)
		}
		if tagCount != 0 {
			t.Fatalf("directory member %s received %d group tags", comicID, tagCount)
		}
	}
}

func TestFirstGroupRecognitionComicUsesDirectorySeriesMember(t *testing.T) {
	group := &store.ComicGroupDetail{
		SeriesList: []store.GroupSeriesItem{
			{
				SeriesID: "series-1",
				Comics: []store.GroupComicItem{
					{ComicID: "series-volume-1", Filename: "work/01.cbz"},
				},
			},
		},
	}

	comic, ok := firstGroupRecognitionComic(group)
	if !ok {
		t.Fatal("expected a directory series member")
	}
	if comic.ComicID != "series-volume-1" {
		t.Fatalf("comic id = %q, want series-volume-1", comic.ComicID)
	}
}

func TestFirstGroupRecognitionComicPrefersDirectMember(t *testing.T) {
	group := &store.ComicGroupDetail{
		Comics: []store.GroupComicItem{
			{ComicID: "direct-volume", Filename: "direct.cbz"},
		},
		SeriesList: []store.GroupSeriesItem{
			{
				SeriesID: "series-1",
				Comics: []store.GroupComicItem{
					{ComicID: "series-volume-1", Filename: "work/01.cbz"},
				},
			},
		},
	}

	comic, ok := firstGroupRecognitionComic(group)
	if !ok {
		t.Fatal("expected a direct member")
	}
	if comic.ComicID != "direct-volume" {
		t.Fatalf("comic id = %q, want direct-volume", comic.ComicID)
	}
}
