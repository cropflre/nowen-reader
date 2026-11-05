package handler

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestComicTagReadAndWritePermissions(t *testing.T) {
	// Keep AI configuration isolated and disabled: permission checks must run
	// before configuration validation or any call to an external provider.
	t.Setenv("DATA_DIR", t.TempDir())
	router := setupTestRouter(t)
	sessions := map[string]string{"admin": registerAndLogin(t, router)}
	if err := store.CreateLibrary(&model.Library{
		ID: "comic-tag-library", Name: "Comic Tags", Type: "comic", RootPath: t.TempDir(),
		Enabled: true, DefaultAccess: "private",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId")
		VALUES ('comic-tag-book', 'tags.cbz', 'Tagged Book', 'comic', 'comic-tag-library')
	`); err != nil {
		t.Fatal(err)
	}
	if err := store.AddTagsToComic("comic-tag-book", []string{"Existing tag"}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"viewer", "manager", "outsider"} {
		if err := store.CreateUser(&model.User{
			ID: role, Username: role, Password: "unused", Role: "user", AiEnabled: true,
		}); err != nil {
			t.Fatal(err)
		}
		if role != "outsider" {
			if err := store.SetUserLibraryAccess(role, []store.LibraryAccessReq{{
				LibraryID: "comic-tag-library", CanView: true, CanManage: role == "manager",
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

	const comicURL = "/api/comics/comic-tag-book"
	for _, role := range []string{"viewer", "manager", "admin"} {
		t.Run("read_tags_as_"+role, func(t *testing.T) {
			response := performAuthedRequest(router, http.MethodGet, comicURL, nil, sessions[role])
			if response.Code != http.StatusOK {
				t.Fatalf("read detail = %d: %s", response.Code, response.Body.String())
			}
			var detail struct {
				Tags []struct {
					Name string `json:"name"`
				} `json:"tags"`
				CanManage bool `json:"canManage"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil {
				t.Fatal(err)
			}
			if len(detail.Tags) != 1 || detail.Tags[0].Name != "Existing tag" {
				t.Fatalf("detail tags = %#v", detail.Tags)
			}
			if detail.CanManage != (role != "viewer") {
				t.Fatalf("canManage = %v for %s", detail.CanManage, role)
			}
		})
	}

	for _, test := range []struct {
		name, role, method, path string
		body                     interface{}
		status                   int
	}{
		{"outsider_cannot_read", "outsider", http.MethodGet, comicURL, nil, http.StatusForbidden},
		{"viewer_cannot_add", "viewer", http.MethodPost, comicURL + "/tags", map[string]interface{}{"tags": []string{"Unauthorized tag"}}, http.StatusForbidden},
		{"viewer_cannot_remove", "viewer", http.MethodDelete, comicURL + "/tags", map[string]string{"tag": "Existing tag"}, http.StatusForbidden},
		{"viewer_cannot_clear", "viewer", http.MethodDelete, comicURL + "/tags/clear-all", nil, http.StatusForbidden},
		{"viewer_cannot_apply_ai_tags", "viewer", http.MethodPost, comicURL + "/ai-suggest-tags", map[string]bool{"apply": true}, http.StatusForbidden},
		{"viewer_can_request_ai_suggestions", "viewer", http.MethodPost, comicURL + "/ai-suggest-tags", map[string]bool{"apply": false}, http.StatusBadRequest},
		{"manager_can_apply_ai_tags", "manager", http.MethodPost, comicURL + "/ai-suggest-tags", map[string]bool{"apply": true}, http.StatusBadRequest},
		{"admin_can_apply_ai_tags", "admin", http.MethodPost, comicURL + "/ai-suggest-tags", map[string]bool{"apply": true}, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := performAuthedRequest(router, test.method, test.path, test.body, sessions[test.role])
			if response.Code != test.status {
				t.Errorf("%s %s as %s = %d, want %d: %s", test.method, test.path, test.role, response.Code, test.status, response.Body.String())
			}
			if test.status == http.StatusBadRequest {
				var result struct {
					Error string `json:"error"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Error != "AI not configured" {
					t.Errorf("expected AI configuration check, got %s (decode error: %v)", response.Body.String(), err)
				}
			}
			comic, err := store.GetComicByID("comic-tag-book")
			if err != nil || comic == nil {
				t.Fatalf("read stored comic: comic = %#v, error = %v", comic, err)
			}
			if len(comic.Tags) != 1 || comic.Tags[0].Name != "Existing tag" {
				t.Errorf("request changed stored tags: %#v", comic.Tags)
			}
		})
	}
}
