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

func TestWorkCategoryPermissionsAndEditing(t *testing.T) {
	router := setupTestRouter(t)
	if err := store.RunMigrations(); err != nil {
		t.Fatal(err)
	}
	admin := registerAndLogin(t, router)
	if err := store.CreateLibrary(&model.Library{
		ID: "category-library", Name: "Categories", Type: "comic", RootPath: t.TempDir(),
		Enabled: true, DefaultAccess: "private",
	}); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`INSERT INTO "Category" ("name", "slug", "icon") VALUES ('冒险', 'adventure', '📚'), ('奇幻', 'fantasy', '✨')`,
		`INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId") VALUES
		 ('category-v1', '01.cbz', '01', 'comic', 'category-library'),
		 ('category-v2', '02.cbz', '02', 'comic', 'category-library')`,
		`INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle", "manualLocked")
		 VALUES ('category-series', 'category-library', 'work', 'Work', 'work', 1)`,
		`INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
		 ('category-series', 'category-v1', 0), ('category-series', 'category-v2', 1)`,
	} {
		if _, err := store.DB().Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	groupID, err := store.CreateGroupWithItems("Categorized collection", "", nil, []string{"category-series"})
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
				LibraryID: "category-library", CanView: true, CanManage: role == "manager",
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
		{"", "GET", groupURL + "/categories", nil, http.StatusUnauthorized},
		{"", "PUT", "/api/series/category-series/categories", map[string]interface{}{"categorySlugs": []string{"adventure"}}, http.StatusUnauthorized},
		{"viewer", "PUT", "/api/series/category-series/categories", map[string]interface{}{"categorySlugs": []string{"adventure"}}, http.StatusForbidden},
		{"outsider", "PUT", "/api/series/category-series/categories", map[string]interface{}{"categorySlugs": []string{"adventure"}}, http.StatusForbidden},
		{"viewer", "PUT", groupURL + "/categories", map[string]interface{}{"categorySlugs": []string{"adventure"}}, http.StatusForbidden},
		{"manager", "PUT", groupURL + "/categories", map[string]interface{}{"categorySlugs": []string{"adventure"}}, http.StatusForbidden},
		{"manager", "PUT", "/api/series/category-series/categories", map[string]interface{}{}, http.StatusBadRequest},
		{"manager", "PUT", "/api/series/category-series/categories", map[string]interface{}{"categorySlugs": nil}, http.StatusBadRequest},
		{"admin", "PUT", groupURL + "/categories", map[string]interface{}{}, http.StatusBadRequest},
		{"manager", "PUT", "/api/series/missing/categories", map[string]interface{}{"categorySlugs": []string{}}, http.StatusNotFound},
		{"admin", "PUT", "/api/groups/99999/categories", map[string]interface{}{"categorySlugs": []string{}}, http.StatusNotFound},
	} {
		response := performAuthedRequest(router, test.method, test.path, test.body, sessions[test.role])
		if response.Code != test.status {
			t.Errorf("%s %s as %q = %d, want %d: %s", test.method, test.path, test.role, response.Code, test.status, response.Body.String())
		}
	}

	for _, path := range []string{groupURL + "/categories", "/api/series/category-series/categories"} {
		cookie := admin
		if path == "/api/series/category-series/categories" {
			cookie = sessions["manager"]
		}
		response := performAuthedRequest(router, "PUT", path, map[string]interface{}{
			"categorySlugs": []string{" adventure ", "fantasy", "adventure", " "},
		}, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("save categories = %d: %s", response.Code, response.Body.String())
		}
		var result struct {
			Categories []store.CategoryWithCount `json:"categories"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Categories) != 2 {
			t.Fatalf("normalized categories = %#v", result.Categories)
		}
	}
	for _, path := range []string{groupURL + "/categories", "/api/series/category-series/categories"} {
		response := performAuthedRequest(router, "PUT", path, map[string]interface{}{"categorySlugs": []string{"missing-category"}}, admin)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid category = %d: %s", response.Code, response.Body.String())
		}
	}
	for _, role := range []string{"viewer", "manager", "outsider"} {
		response := performAuthedRequest(router, "GET", groupURL+"/categories", nil, sessions[role])
		want := http.StatusOK
		if role == "outsider" {
			want = http.StatusForbidden
		}
		if response.Code != want {
			t.Fatalf("read categories as %s = %d: %s", role, response.Code, response.Body.String())
		}
		if want == http.StatusOK {
			var result struct {
				Categories []store.CategoryWithCount `json:"categories"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || len(result.Categories) != 2 {
				t.Fatalf("visible categories = %#v, err = %v", result.Categories, err)
			}
		}
	}
	response := performAuthedRequest(router, "GET", groupURL, nil, sessions["viewer"])
	var detail store.ComicGroupDetail
	if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil || response.Code != http.StatusOK || len(detail.Categories) != 2 {
		t.Fatalf("detail categories = %#v, status = %d, err = %v", detail.Categories, response.Code, err)
	}
	response = performAuthedRequest(router, "GET", "/api/series/category-series", nil, sessions["viewer"])
	var seriesDetail store.SeriesDetail
	if err := json.Unmarshal(response.Body.Bytes(), &seriesDetail); err != nil || response.Code != http.StatusOK || len(seriesDetail.Series.Categories) != 2 {
		t.Fatalf("directory detail categories = %#v, status = %d, err = %v", seriesDetail.Series.Categories, response.Code, err)
	}
	var count int
	if err := store.DB().QueryRow(`SELECT COUNT(*) FROM "ComicCategory"`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("editing work categories changed child categories: count = %d, err = %v", count, err)
	}
	for _, path := range []string{groupURL + "/categories", "/api/series/category-series/categories"} {
		response := performAuthedRequest(router, "PUT", path, map[string]interface{}{"categorySlugs": []string{}}, admin)
		if response.Code != http.StatusOK {
			t.Fatalf("clear categories = %d: %s", response.Code, response.Body.String())
		}
		var result struct {
			Categories []store.CategoryWithCount `json:"categories"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Categories == nil || len(result.Categories) != 0 {
			t.Fatalf("cleared categories = %#v, err = %v", result.Categories, err)
		}
	}
}
