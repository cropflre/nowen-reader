package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestResolveAIBatchSelectionFiltersRequestedLibrariesByAccess(t *testing.T) {
	setupTestRouter(t)

	user := &model.User{
		ID:        "ai-selection-user",
		Username:  "ai-selection-user",
		Password:  "unused",
		Nickname:  "AI Selection",
		Role:      "user",
		AiEnabled: true,
	}
	if err := store.CreateUser(user); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "Library" ("id", "name", "rootPath", "type", "enabled") VALUES
			('ai-visible-library', 'Visible', '/ai-visible', 'comic', 1),
			('ai-hidden-library', 'Hidden', '/ai-hidden', 'comic', 1)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES
			('ai-visible-comic', 'visible.cbz', 'Visible', 'comic', 'ai-visible-library', 'visible.cbz'),
			('ai-hidden-comic', 'hidden.cbz', 'Hidden', 'comic', 'ai-hidden-library', 'hidden.cbz')
	`); err != nil {
		t.Fatal(err)
	}
	if err := store.SetUserLibraryAccess(user.ID, []store.LibraryAccessReq{{LibraryID: "ai-visible-library", CanView: true}}); err != nil {
		t.Fatal(err)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(middleware.ContextKeyUser, &model.AuthUser{
		ID:        user.ID,
		Username:  user.Username,
		Role:      user.Role,
		AiEnabled: true,
	})
	body := aiBatchRequest{Selector: &aiBatchSelector{
		Scope:      "missing",
		LibraryIDs: []string{"ai-visible-library", "ai-hidden-library"},
		Limit:      30,
	}}

	selection, err := resolveAIBatchSelection(c, &body, "tags")
	if err != nil {
		t.Fatal(err)
	}
	if selection.Eligible != 1 || len(selection.ComicIDs) != 1 || selection.ComicIDs[0] != "ai-visible-comic" {
		t.Fatalf("selection = %#v, want visible comic only", selection)
	}
}

func TestResolveAIBatchSelectionKeepsExplicitIDsCompatible(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	body := aiBatchRequest{ComicIDs: []string{" comic-a ", "comic-a", "comic-b"}}

	selection, err := resolveAIBatchSelection(c, &body, "tags")
	if err != nil {
		t.Fatal(err)
	}
	if selection.Eligible != 2 || len(selection.ComicIDs) != 2 || selection.ComicIDs[0] != "comic-a" || selection.ComicIDs[1] != "comic-b" {
		t.Fatalf("selection = %#v", selection)
	}
}
