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
