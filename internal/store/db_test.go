package store

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

// testDBPath returns a temporary database path for testing.
func testDBPath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "test.db")
}

// setupTestDB initializes a test database.
func setupTestDB(t *testing.T) {
	t.Helper()
	dbPath := testDBPath(t)
	if err := InitDB(dbPath); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	t.Cleanup(func() {
		CloseDB()
		os.Remove(dbPath)
	})
}

func TestInitDB(t *testing.T) {
	setupTestDB(t)

	if DB() == nil {
		t.Fatal("DB() returned nil after InitDB")
	}

	// Verify tables exist by querying them
	tables := []string{"User", "UserSession", "Comic", "Tag", "ComicTag", "Category", "ComicCategory", "ReadingSession"}
	for _, table := range tables {
		_, err := DB().Exec(`SELECT COUNT(*) FROM "` + table + `"`)
		if err != nil {
			t.Errorf("Table %s does not exist: %v", table, err)
		}
	}
}

func TestUserCRUD(t *testing.T) {
	setupTestDB(t)

	// Create user
	user := &model.User{
		ID:       "test-user-1",
		Username: "testuser",
		Password: "hashedpassword",
		Nickname: "Test User",
		Role:     "admin",
	}
	if err := CreateUser(user); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Count users
	count, err := CountUsers()
	if err != nil {
		t.Fatalf("CountUsers failed: %v", err)
	}
	if count != 1 {
		t.Errorf("Expected 1 user, got %d", count)
	}

	// Get by username
	found, err := GetUserByUsername("testuser")
	if err != nil {
		t.Fatalf("GetUserByUsername failed: %v", err)
	}
	if found == nil {
		t.Fatal("GetUserByUsername returned nil")
	}
	if found.Nickname != "Test User" {
		t.Errorf("Expected nickname 'Test User', got '%s'", found.Nickname)
	}

	// Get by ID
	found, err = GetUserByID("test-user-1")
	if err != nil {
		t.Fatalf("GetUserByID failed: %v", err)
	}
	if found == nil {
		t.Fatal("GetUserByID returned nil")
	}

	// Get non-existent user
	notFound, err := GetUserByUsername("nonexistent")
	if err != nil {
		t.Fatalf("GetUserByUsername for nonexistent failed: %v", err)
	}
	if notFound != nil {
		t.Error("Expected nil for nonexistent user")
	}

	// Update profile
	if err := UpdateUserProfile("test-user-1", "New Nickname"); err != nil {
		t.Fatalf("UpdateUserProfile failed: %v", err)
	}
	found, _ = GetUserByID("test-user-1")
	if found.Nickname != "New Nickname" {
		t.Errorf("Expected nickname 'New Nickname', got '%s'", found.Nickname)
	}

	// Update password
	if err := UpdateUserPassword("test-user-1", "newhashedpassword"); err != nil {
		t.Fatalf("UpdateUserPassword failed: %v", err)
	}
	found, _ = GetUserByID("test-user-1")
	if found.Password != "newhashedpassword" {
		t.Errorf("Password not updated")
	}

	// List users
	users, err := ListUsers()
	if err != nil {
		t.Fatalf("ListUsers failed: %v", err)
	}
	if len(users) != 1 {
		t.Errorf("Expected 1 user in list, got %d", len(users))
	}

	// Delete user
	if err := DeleteUser("test-user-1"); err != nil {
		t.Fatalf("DeleteUser failed: %v", err)
	}
	count, _ = CountUsers()
	if count != 0 {
		t.Errorf("Expected 0 users after delete, got %d", count)
	}
}

func TestSessionCRUD(t *testing.T) {
	setupTestDB(t)

	// Create user first (foreign key)
	user := &model.User{
		ID:       "session-test-user",
		Username: "sessionuser",
		Password: "hash",
		Nickname: "Session User",
		Role:     "user",
	}
	if err := CreateUser(user); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	// Create session
	session := &model.UserSession{
		ID:     "test-session-token",
		UserID: "session-test-user",
	}
	// Set expiry to 30 days from now
	session.ExpiresAt = user.CreatedAt.AddDate(0, 0, 30)
	if err := CreateSession(session); err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// Get session with user
	sess, u, err := GetSessionWithUser("test-session-token")
	if err != nil {
		t.Fatalf("GetSessionWithUser failed: %v", err)
	}
	if sess == nil || u == nil {
		t.Fatal("GetSessionWithUser returned nil")
	}
	if u.Username != "sessionuser" {
		t.Errorf("Expected username 'sessionuser', got '%s'", u.Username)
	}

	// Get non-existent session
	sess, u, err = GetSessionWithUser("nonexistent-token")
	if err != nil {
		t.Fatalf("GetSessionWithUser for nonexistent failed: %v", err)
	}
	if sess != nil || u != nil {
		t.Error("Expected nil for nonexistent session")
	}

	// Delete session
	if err := DeleteSession("test-session-token"); err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}
	sess, _, _ = GetSessionWithUser("test-session-token")
	if sess != nil {
		t.Error("Session should be deleted")
	}
}

func TestComicCRUD(t *testing.T) {
	setupTestDB(t)

	// FilenameToID
	id := FilenameToID("test-comic.cbz")
	if id == "" || len(id) != 12 {
		t.Errorf("FilenameToID returned invalid ID: '%s'", id)
	}

	// FilenameToTitle
	title := FilenameToTitle("test-comic.cbz")
	if title != "test-comic" {
		t.Errorf("Expected title 'test-comic', got '%s'", title)
	}

	// Bulk create comics
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{FilenameToID("comic1.cbz"), "comic1.cbz", "Comic 1", 1000},
		{FilenameToID("comic2.cbz"), "comic2.cbz", "Comic 2", 2000},
		{FilenameToID("comic3.cbz"), "comic3.cbz", "Comic 3", 3000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	// Get all comic IDs
	ids, err := GetAllComicIDs()
	if err != nil {
		t.Fatalf("GetAllComicIDs failed: %v", err)
	}
	if len(ids) != 3 {
		t.Errorf("Expected 3 comic IDs, got %d", len(ids))
	}

	// Get comic by ID
	comic, err := GetComicByID(comics[0].ID)
	if err != nil {
		t.Fatalf("GetComicByID failed: %v", err)
	}
	if comic == nil {
		t.Fatal("GetComicByID returned nil")
	}
	if comic.Title != "Comic 1" {
		t.Errorf("Expected title 'Comic 1', got '%s'", comic.Title)
	}

	// Toggle favorite
	newState, err := ToggleFavorite(comics[0].ID)
	if err != nil {
		t.Fatalf("ToggleFavorite failed: %v", err)
	}
	if !newState {
		t.Error("Expected favorite to be true after toggle")
	}

	// Update rating
	rating := 5
	if err := UpdateRating(comics[0].ID, &rating); err != nil {
		t.Fatalf("UpdateRating failed: %v", err)
	}

	// Update reading progress
	if err := UpdateReadingProgress(comics[0].ID, 10); err != nil {
		t.Fatalf("UpdateReadingProgress failed: %v", err)
	}

	// Update page count
	if err := UpdateComicPageCount(comics[0].ID, 50); err != nil {
		t.Fatalf("UpdateComicPageCount failed: %v", err)
	}

	// List comics with filtering
	result, err := GetAllComics(ComicListOptions{
		SortBy:    "title",
		SortOrder: "asc",
	})
	if err != nil {
		t.Fatalf("GetAllComics failed: %v", err)
	}
	if result.Total != 3 {
		t.Errorf("Expected 3 comics, got %d", result.Total)
	}

	// List favorites only
	result, err = GetAllComics(ComicListOptions{
		FavoritesOnly: true,
	})
	if err != nil {
		t.Fatalf("GetAllComics favorites failed: %v", err)
	}
	if result.Total != 1 {
		t.Errorf("Expected 1 favorite, got %d", result.Total)
	}

	// Search
	result, err = GetAllComics(ComicListOptions{
		Search: "Comic 2",
	})
	if err != nil {
		t.Fatalf("GetAllComics search failed: %v", err)
	}
	if result.Total != 1 {
		t.Errorf("Expected 1 search result, got %d", result.Total)
	}

	// Pagination
	result, err = GetAllComics(ComicListOptions{
		Page:     1,
		PageSize: 2,
	})
	if err != nil {
		t.Fatalf("GetAllComics pagination failed: %v", err)
	}
	if len(result.Comics) != 2 {
		t.Errorf("Expected 2 comics on page 1, got %d", len(result.Comics))
	}
	if result.TotalPages != 2 {
		t.Errorf("Expected 2 total pages, got %d", result.TotalPages)
	}

	// Delete comic
	if err := BulkDeleteComicsByIDs([]string{comics[2].ID}); err != nil {
		t.Fatalf("BulkDeleteComicsByIDs failed: %v", err)
	}
	ids, _ = GetAllComicIDs()
	if len(ids) != 2 {
		t.Errorf("Expected 2 comics after delete, got %d", len(ids))
	}
}

func TestTagOperations(t *testing.T) {
	setupTestDB(t)

	// Create comic for tag association
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"tag-test-1", "tag-test.cbz", "Tag Test", 1000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	// Add tags
	if err := AddTagsToComic("tag-test-1", []string{"action", "comedy", "drama"}); err != nil {
		t.Fatalf("AddTagsToComic failed: %v", err)
	}

	// Get all tags
	tags, err := GetAllTags()
	if err != nil {
		t.Fatalf("GetAllTags failed: %v", err)
	}
	if len(tags) != 3 {
		t.Errorf("Expected 3 tags, got %d", len(tags))
	}

	// Update tag color
	if err := UpdateTagColor("action", "red"); err != nil {
		t.Fatalf("UpdateTagColor failed: %v", err)
	}

	// Remove tag
	if err := RemoveTagFromComic("tag-test-1", "drama"); err != nil {
		t.Fatalf("RemoveTagFromComic failed: %v", err)
	}
	tags, _ = GetAllTags()
	if len(tags) != 2 {
		t.Errorf("Expected 2 tags after remove, got %d", len(tags))
	}
}

func TestCategoryOperations(t *testing.T) {
	setupTestDB(t)

	// Create comic
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"cat-test-1", "cat-test.cbz", "Cat Test", 1000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	// Init predefined categories
	if err := InitCategories("zh"); err != nil {
		t.Fatalf("InitCategories failed: %v", err)
	}

	// Get all categories
	cats, err := GetAllCategories()
	if err != nil {
		t.Fatalf("GetAllCategories failed: %v", err)
	}
	if len(cats) == 0 {
		t.Error("Expected predefined categories, got 0")
	}

	// Add category to comic
	if err := AddCategoriesToComic("cat-test-1", []string{"action", "comedy"}); err != nil {
		t.Fatalf("AddCategoriesToComic failed: %v", err)
	}

	// Set categories (replace)
	if err := SetComicCategories("cat-test-1", []string{"romance"}); err != nil {
		t.Fatalf("SetComicCategories failed: %v", err)
	}

	// Remove category
	if err := RemoveCategoryFromComic("cat-test-1", "romance"); err != nil {
		t.Fatalf("RemoveCategoryFromComic failed: %v", err)
	}
}

func TestReadingSessionOperations(t *testing.T) {
	setupTestDB(t)

	// Create comic
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"session-comic-1", "session-test.cbz", "Session Test", 1000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	// Start session
	sessionID, err := StartReadingSession("session-comic-1", 0)
	if err != nil {
		t.Fatalf("StartReadingSession failed: %v", err)
	}
	if sessionID == 0 {
		t.Error("Expected non-zero session ID")
	}

	// End session
	if err := EndReadingSession(int(sessionID), 10, 300); err != nil {
		t.Fatalf("EndReadingSession failed: %v", err)
	}

	// Get reading stats
	stats, err := GetReadingStats()
	if err != nil {
		t.Fatalf("GetReadingStats failed: %v", err)
	}
	if stats == nil {
		t.Fatal("GetReadingStats returned nil")
	}
}

func TestBatchOperations(t *testing.T) {
	setupTestDB(t)

	// Create comics
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"batch-1", "batch1.cbz", "Batch 1", 1000},
		{"batch-2", "batch2.cbz", "Batch 2", 2000},
		{"batch-3", "batch3.cbz", "Batch 3", 3000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	// Batch set favorite
	ids := []string{"batch-1", "batch-2"}
	affected, err := BatchSetFavorite(ids, true)
	if err != nil {
		t.Fatalf("BatchSetFavorite failed: %v", err)
	}
	if affected != 2 {
		t.Errorf("Expected 2 affected, got %d", affected)
	}

	// Batch add tags
	if err := BatchAddTags(ids, []string{"tag1", "tag2"}); err != nil {
		t.Fatalf("BatchAddTags failed: %v", err)
	}

	// Batch set category
	if err := InitCategories("en"); err != nil {
		t.Fatalf("InitCategories failed: %v", err)
	}
	if err := BatchSetCategory(ids, []string{"action"}); err != nil {
		t.Fatalf("BatchSetCategory failed: %v", err)
	}

	// Batch delete
	n, err := BatchDeleteComics([]string{"batch-3"})
	if err != nil {
		t.Fatalf("BatchDeleteComics failed: %v", err)
	}
	if n != 1 {
		t.Errorf("Expected 1 deleted, got %d", n)
	}
}

func TestSortOrders(t *testing.T) {
	setupTestDB(t)

	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"sort-1", "sort1.cbz", "Sort 1", 1000},
		{"sort-2", "sort2.cbz", "Sort 2", 2000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	orders := []struct {
		ID        string
		SortOrder int
	}{
		{"sort-1", 2},
		{"sort-2", 1},
	}
	if err := UpdateSortOrders(orders); err != nil {
		t.Fatalf("UpdateSortOrders failed: %v", err)
	}

	// Verify sort order via custom sort
	result, err := GetAllComics(ComicListOptions{
		SortBy:    "custom",
		SortOrder: "asc",
	})
	if err != nil {
		t.Fatalf("GetAllComics failed: %v", err)
	}
	if len(result.Comics) != 2 {
		t.Fatalf("Expected 2 comics, got %d", len(result.Comics))
	}
	if result.Comics[0].ID != "sort-2" {
		t.Errorf("Expected sort-2 first (sortOrder=1), got %s", result.Comics[0].ID)
	}
}
