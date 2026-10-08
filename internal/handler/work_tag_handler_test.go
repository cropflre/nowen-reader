package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestWorkTagPermissionsAndEditing(t *testing.T) {
	router := setupTestRouter(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	admin := registerAndLogin(t, router)
	if err := store.CreateLibrary(&model.Library{
		ID: "tag-library", Name: "Tags", Type: "comic", RootPath: t.TempDir(),
		Enabled: true, DefaultAccess: "private",
	}); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId") VALUES
		 ('tag-v1', '01.cbz', '01', 'comic', 'tag-library'),
		 ('tag-v2', '02.cbz', '02', 'comic', 'tag-library')`,
		`INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle")
		 VALUES ('tag-series', 'tag-library', 'work', 'Work', 'work')`,
		`INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
		 ('tag-series', 'tag-v1', 0), ('tag-series', 'tag-v2', 1)`,
	} {
		if _, err := store.DB().Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	groupID, err := store.CreateGroupWithItems("Tagged collection", "", nil, []string{"tag-series"})
	if err != nil {
		t.Fatal(err)
	}
	groupURL := fmt.Sprintf("/api/groups/%d", groupID)

	sessions := map[string]string{"admin": admin}
	for _, role := range []string{"viewer", "manager", "outsider"} {
		if err := store.CreateUser(&model.User{ID: role, Username: role, Password: "hash", Role: "user"}); err != nil {
			t.Fatal(err)
		}
		if role != "outsider" {
			if err := store.SetUserLibraryAccess(role, []store.LibraryAccessReq{{
				LibraryID: "tag-library", CanView: true, CanManage: role == "manager",
			}}); err != nil {
				t.Fatal(err)
			}
		}
		sessions[role] = role + "-session"
		if err := store.CreateSession(&model.UserSession{
			ID: sessions[role], UserID: role, ExpiresAt: time.Now().Add(time.Hour),
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		role, method, path string
		body               interface{}
		status             int
	}{
		{"", "GET", groupURL + "/tags", nil, http.StatusUnauthorized},
		{"", "PUT", "/api/series/tag-series/tags", map[string]interface{}{"tags": []string{"冒险"}}, http.StatusUnauthorized},
		{"viewer", "PUT", "/api/series/tag-series/tags", map[string]interface{}{"tags": []string{"冒险"}}, http.StatusForbidden},
		{"outsider", "PUT", "/api/series/tag-series/tags", map[string]interface{}{"tags": []string{"冒险"}}, http.StatusForbidden},
		{"viewer", "PUT", groupURL + "/tags", map[string]interface{}{"tags": []string{"冒险"}}, http.StatusForbidden},
		{"manager", "PUT", groupURL + "/tags", map[string]interface{}{"tags": []string{"冒险"}}, http.StatusForbidden},
		{"manager", "PUT", "/api/series/tag-series/tags", map[string]interface{}{}, http.StatusBadRequest},
		{"manager", "PUT", "/api/series/tag-series/tags", map[string]interface{}{"tags": nil}, http.StatusBadRequest},
		{"admin", "PUT", groupURL + "/tags", map[string]interface{}{}, http.StatusBadRequest},
		{"manager", "PUT", "/api/series/missing/tags", map[string]interface{}{"tags": []string{}}, http.StatusNotFound},
		{"admin", "PUT", "/api/groups/99999/tags", map[string]interface{}{"tags": []string{}}, http.StatusNotFound},
	} {
		response := performAuthedRequest(router, test.method, test.path, test.body, sessions[test.role])
		if response.Code != test.status {
			t.Errorf("%s %s as %q = %d, want %d: %s", test.method, test.path, test.role, response.Code, test.status, response.Body.String())
		}
	}

	for _, path := range []string{groupURL + "/tags", "/api/series/tag-series/tags"} {
		cookie := admin
		if path == "/api/series/tag-series/tags" {
			cookie = sessions["manager"]
		}
		response := performAuthedRequest(router, "PUT", path, map[string]interface{}{
			"tags": []string{" 冒险 ", "奇幻", "冒险", " "},
		}, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("save tags = %d: %s", response.Code, response.Body.String())
		}
		var result struct {
			Tags  []store.Tag `json:"tags"`
			Added []string    `json:"added"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Tags) != 2 {
			t.Fatalf("normalized tags = %#v", result.Tags)
		}
		if path == groupURL+"/tags" && len(result.Added) != 2 {
			t.Fatalf("added tags = %#v", result.Added)
		}
	}
	for _, role := range []string{"viewer", "manager", "outsider"} {
		response := performAuthedRequest(router, "GET", groupURL+"/tags", nil, sessions[role])
		want := http.StatusOK
		if role == "outsider" {
			want = http.StatusForbidden
		}
		if response.Code != want {
			t.Fatalf("read tags as %s = %d: %s", role, response.Code, response.Body.String())
		}
		if want == http.StatusOK {
			var result struct {
				Tags []store.Tag `json:"tags"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || len(result.Tags) != 2 {
				t.Fatalf("visible tags = %#v, err = %v", result.Tags, err)
			}
		}
	}
	response := performAuthedRequest(router, "GET", groupURL, nil, sessions["viewer"])
	var detail store.ComicGroupDetail
	if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil || response.Code != http.StatusOK || len(detail.TagItems) != 2 {
		t.Fatalf("detail tags = %#v, status = %d, err = %v", detail.TagItems, response.Code, err)
	}
	var count int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "ComicTag"`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("editing work tags changed child tags: count = %d, err = %v", count, err)
	}
	for _, path := range []string{groupURL + "/tags", "/api/series/tag-series/tags"} {
		response := performAuthedRequest(router, "PUT", path, map[string]interface{}{"tags": []string{}}, admin)
		if response.Code != http.StatusOK {
			t.Fatalf("clear tags = %d: %s", response.Code, response.Body.String())
		}
		var result struct {
			Tags []store.Tag `json:"tags"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Tags == nil || len(result.Tags) != 0 {
			t.Fatalf("cleared tags = %#v, err = %v", result.Tags, err)
		}
	}
}
