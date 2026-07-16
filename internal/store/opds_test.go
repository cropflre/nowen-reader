package store

import (
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestGetUserDownloadableLibraryIDs(t *testing.T) {
	setupTestDB(t)
	createTestUser(t, "opds-user", "opds-user", "user")
	createTestUser(t, "opds-admin", "opds-admin", "admin")
	createTestLibrary(t, "opds-public", "Public", "public", true)
	createTestLibrary(t, "opds-view", "View only", "private", true)
	createTestLibrary(t, "opds-download", "Download", "private", true)
	createTestLibrary(t, "opds-group-download", "Group download", "private", true)
	createTestLibrary(t, "opds-disabled", "Disabled", "private", false)

	if err := SetUserLibraryAccess("opds-user", []LibraryAccessReq{
		{LibraryID: "opds-view", CanView: true},
		{LibraryID: "opds-download", CanDownload: true},
		{LibraryID: "opds-disabled", CanDownload: true},
	}); err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}
	if err := CreateUserGroup(&model.UserGroup{ID: "opds-group", Name: "OPDS group"}); err != nil {
		t.Fatalf("CreateUserGroup failed: %v", err)
	}
	if err := SetGroupMembers("opds-group", []string{"opds-user"}); err != nil {
		t.Fatalf("SetGroupMembers failed: %v", err)
	}
	if err := SetGroupLibraryAccessFull("opds-group", []GroupLibraryPermission{{
		LibraryID:   "opds-group-download",
		CanDownload: true,
	}}); err != nil {
		t.Fatalf("SetGroupLibraryAccessFull failed: %v", err)
	}

	userIDs, err := GetUserDownloadableLibraryIDs("opds-user")
	if err != nil {
		t.Fatalf("GetUserDownloadableLibraryIDs(user) failed: %v", err)
	}
	if len(userIDs) != 2 || !containsString(userIDs, "opds-download") || !containsString(userIDs, "opds-group-download") {
		t.Fatalf("downloadable libraries = %v, want direct and group downloads", userIDs)
	}

	adminIDs, err := GetUserDownloadableLibraryIDs("opds-admin")
	if err != nil {
		t.Fatalf("GetUserDownloadableLibraryIDs(admin) failed: %v", err)
	}
	if containsString(adminIDs, "opds-disabled") {
		t.Fatalf("disabled library leaked into admin download access: %v", adminIDs)
	}
	for _, expected := range []string{"opds-public", "opds-view", "opds-download", "opds-group-download"} {
		if !containsString(adminIDs, expected) {
			t.Fatalf("admin download access missing %q: %v", expected, adminIDs)
		}
	}
}

func TestGetOPDSComicsIsComicOnlyAndUserScoped(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	for _, user := range []*model.User{
		{ID: "opds-a", Username: "opds-a", Password: "hashed", Role: "user"},
		{ID: "opds-b", Username: "opds-b", Password: "hashed", Role: "user"},
	} {
		if err := CreateUser(user); err != nil {
			t.Fatalf("CreateUser(%s) failed: %v", user.ID, err)
		}
	}

	createOPDSTestLibrary(t, "opds-comics", "comic", true)
	createOPDSTestLibrary(t, "opds-novels", "novel", true)
	createOPDSTestLibrary(t, "opds-off", "comic", false)
	createOPDSTestComic(t, "comic-ok", "Comic OK.cbz", "comic", "opds-comics")
	createOPDSTestComic(t, "comic-favorite-b", "Comic B.pdf", "comic", "opds-comics")
	createOPDSTestComic(t, "novel-row", "Novel.epub", "novel", "opds-comics")
	createOPDSTestComic(t, "wrong-extension", "Wrong.epub", "comic", "opds-comics")
	createOPDSTestComic(t, "wrong-library", "Wrong Library.cbz", "comic", "opds-novels")
	createOPDSTestComic(t, "disabled-library", "Disabled.cbz", "comic", "opds-off")

	if _, err := db.Exec(`
		INSERT INTO "UserComicState" ("userId", "comicId", "isFavorite") VALUES
		('opds-a', 'comic-ok', 1),
		('opds-b', 'comic-favorite-b', 1)
	`); err != nil {
		t.Fatalf("insert favorites failed: %v", err)
	}

	libraryIDs := []string{"opds-comics", "opds-novels", "opds-off"}
	rows, total, err := GetOPDSComics(OPDSQueryOptions{
		LibraryIDs: libraryIDs,
		Sort:       OPDSSortTitle,
		Limit:      100,
	})
	if err != nil {
		t.Fatalf("GetOPDSComics failed: %v", err)
	}
	if total != 2 || len(rows) != 2 {
		t.Fatalf("comic-only OPDS rows = %v, total=%d; want two comic publications", opdsRowIDs(rows), total)
	}
	for _, forbidden := range []string{"novel-row", "wrong-extension", "wrong-library", "disabled-library"} {
		if containsString(opdsRowIDs(rows), forbidden) {
			t.Fatalf("forbidden publication %q leaked into OPDS rows: %v", forbidden, opdsRowIDs(rows))
		}
	}

	favorites, total, err := GetOPDSComics(OPDSQueryOptions{
		LibraryIDs:    libraryIDs,
		UserID:        "opds-a",
		FavoritesOnly: true,
		Sort:          OPDSSortTitle,
		Limit:         100,
	})
	if err != nil {
		t.Fatalf("GetOPDSComics favorites failed: %v", err)
	}
	if total != 1 || len(favorites) != 1 || favorites[0].ID != "comic-ok" {
		t.Fatalf("user favorites = %v, total=%d; want [comic-ok]", opdsRowIDs(favorites), total)
	}

	empty, total, err := GetOPDSComics(OPDSQueryOptions{Sort: OPDSSortTitle, Limit: 100})
	if err != nil {
		t.Fatalf("GetOPDSComics empty access failed: %v", err)
	}
	if total != 0 || len(empty) != 0 {
		t.Fatalf("empty library access returned %v, total=%d", opdsRowIDs(empty), total)
	}
}

func TestGetOPDSSeriesFiltersAccessFormatsAndPreservesOrder(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	createOPDSTestLibrary(t, "series-download", "comic", true)
	createOPDSTestLibrary(t, "series-other", "comic", true)

	createOPDSTestComic(t, "series-v1", "Work/Work 01.cbz", "comic", "series-download")
	createOPDSTestComic(t, "series-v2", "Work/Season 1/Work 02.pdf", "comic", "series-download")
	createOPDSTestComic(t, "series-unsupported", "Work/Work 03.epub", "comic", "series-download")
	createOPDSTestComic(t, "series-single", "Single/Single 01.cbz", "comic", "series-download")
	createOPDSTestComic(t, "series-single-unsupported", "Single/Single 02.epub", "comic", "series-download")
	createOPDSTestComic(t, "series-foreign-1", "Other/Other 01.cbz", "comic", "series-other")
	createOPDSTestComic(t, "series-foreign-2", "Other/Other 02.cbz", "comic", "series-other")

	if err := ReplaceDetectedSeries("series-download", []DetectedSeries{
		{
			ID:               "series-visible",
			LibraryID:        "series-download",
			RootRelativePath: "Work",
			Title:            "Work",
			SortTitle:        "work",
			CoverComicID:     "series-unsupported",
			Sections: []DetectedSeriesSection{{
				ID:              "series-section",
				Title:           "Season 1",
				RelativePath:    "Work/Season 1",
				SortIndex:       0,
				DetectionSource: "directory",
			}},
			Items: []DetectedSeriesItem{
				{ComicID: "series-v2", SectionID: "series-section", SortIndex: 1, DisplayLabel: "02"},
				{ComicID: "series-v1", SortIndex: 0, DisplayLabel: "01"},
				{ComicID: "series-unsupported", SortIndex: 2, DisplayLabel: "03"},
			},
		},
		{
			ID:               "series-hidden-single",
			LibraryID:        "series-download",
			RootRelativePath: "Single",
			Title:            "Single",
			SortTitle:        "single",
			Items: []DetectedSeriesItem{
				{ComicID: "series-single", SortIndex: 0},
				{ComicID: "series-single-unsupported", SortIndex: 1},
			},
		},
	}); err != nil {
		t.Fatalf("ReplaceDetectedSeries(download) failed: %v", err)
	}
	if err := ReplaceDetectedSeries("series-other", []DetectedSeries{{
		ID:               "series-foreign",
		LibraryID:        "series-other",
		RootRelativePath: "Other",
		Title:            "Other",
		SortTitle:        "other",
		Items: []DetectedSeriesItem{
			{ComicID: "series-foreign-1", SortIndex: 0},
			{ComicID: "series-foreign-2", SortIndex: 1},
		},
	}}); err != nil {
		t.Fatalf("ReplaceDetectedSeries(other) failed: %v", err)
	}

	empty, total, err := GetOPDSSeries(OPDSSeriesQueryOptions{})
	if err != nil || total != 0 || len(empty) != 0 {
		t.Fatalf("empty access series = %#v, total=%d, err=%v", empty, total, err)
	}
	series, total, err := GetOPDSSeries(OPDSSeriesQueryOptions{LibraryIDs: []string{"series-download"}})
	if err != nil {
		t.Fatalf("GetOPDSSeries failed: %v", err)
	}
	if total != 1 || len(series) != 1 || series[0].ID != "series-visible" || series[0].ItemCount != 2 {
		t.Fatalf("filtered series = %#v, total=%d; want visible two-item series", series, total)
	}
	if series[0].CoverComicID != "series-v1" && series[0].CoverComicID != "series-v2" {
		t.Fatalf("unsupported cover did not fall back to a publishable comic: %#v", series[0])
	}

	comics, total, err := GetOPDSComics(OPDSQueryOptions{
		LibraryIDs: []string{"series-download"},
		SeriesID:   "series-visible",
	})
	if err != nil {
		t.Fatalf("GetOPDSComics(series) failed: %v", err)
	}
	if total != 2 || len(comics) != 2 || comics[0].ID != "series-v1" || comics[1].ID != "series-v2" {
		t.Fatalf("series comics = %#v, total=%d; want v1 then v2", comics, total)
	}
	if comics[0].SeriesID != "series-visible" || comics[1].SectionTitle != "Season 1" || comics[1].DisplayLabel != "02" {
		t.Fatalf("series metadata missing from comics: %#v", comics)
	}

	all, _, err := GetOPDSComics(OPDSQueryOptions{LibraryIDs: []string{"series-download"}})
	if err != nil {
		t.Fatalf("GetOPDSComics(all) failed: %v", err)
	}
	for _, comic := range all {
		if comic.ID == "series-single" && comic.SeriesID != "" {
			t.Fatalf("single publishable member received a dead series relation: %#v", comic)
		}
	}
}

func createOPDSTestLibrary(t *testing.T, id, libraryType string, enabled bool) {
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
	if err := CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary(%s) failed: %v", id, err)
	}
}

func createOPDSTestComic(t *testing.T, id, filename, comicType, libraryID string) {
	t.Helper()
	now := time.Now().UTC()
	if _, err := db.Exec(`
		INSERT INTO "Comic" (
			"id", "filename", "title", "type", "libraryId", "relativePath", "addedAt", "updatedAt"
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, id, filename, id, comicType, libraryID, filename, now, now); err != nil {
		t.Fatalf("insert comic %s failed: %v", id, err)
	}
}

func opdsRowIDs(rows []OPDSComicRow) []string {
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.ID
	}
	return ids
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
