package store

import (
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestReconcileComicOwnershipPreservesRelations(t *testing.T) {
	setupTestDB(t)

	user := &model.User{ID: "reconcile-user", Username: "reconcile-user", Password: "hash", Role: "user"}
	if err := CreateUser(user); err != nil {
		t.Fatal(err)
	}
	for _, lib := range []*model.Library{
		{ID: "parent-lib", Name: "Parent", Type: "comic", RootPath: "/books", Enabled: true},
		{ID: "novel-lib", Name: "Novels", Type: "novel", RootPath: "/books/novels", Enabled: true},
	} {
		if err := CreateLibrary(lib); err != nil {
			t.Fatal(err)
		}
	}

	now := time.Now().UTC()
	insertComic := func(id, filename, title, libraryID, author string) {
		t.Helper()
		_, err := db.Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath", "author", "addedAt", "updatedAt")
			VALUES (?, ?, ?, 3, 100, 'novel', ?, ?, ?, ?, ?)
		`, id, filename, title, libraryID, filename, author, now, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	insertComic("parent-row", "novels/book.epub", "Book", "parent-lib", "Author")
	insertComic("target-row", "book.epub", "Book", "novel-lib", "")

	if _, err := db.Exec(`INSERT INTO "Tag" ("name") VALUES ('kept-tag')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO "ComicTag" ("comicId", "tagId") SELECT 'parent-row', "id" FROM "Tag" WHERE "name" = 'kept-tag'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt", "isFavorite", "totalReadTime", "readingStatus")
		VALUES ('reconcile-user', 'parent-row', 2, ?, 1, 120, 'reading')
	`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO "ReadingSession" ("comicId", "userId", "duration") VALUES ('parent-row', 'reconcile-user', 120)`); err != nil {
		t.Fatal(err)
	}

	if err := ReconcileComicOwnership("target-row", []string{"parent-row"}, "target-row", "novel-lib", "book.epub", "novel"); err != nil {
		t.Fatal(err)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "id" = 'parent-row'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("source row still exists: count=%d err=%v", count, err)
	}
	var author string
	if err := db.QueryRow(`SELECT "author" FROM "Comic" WHERE "id" = 'target-row'`).Scan(&author); err != nil || author != "Author" {
		t.Fatalf("author not preserved: %q err=%v", author, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM "ComicTag" WHERE "comicId" = 'target-row'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("tags not preserved: count=%d err=%v", count, err)
	}
	var page, favorite, readTime int
	if err := db.QueryRow(`SELECT "lastReadPage", "isFavorite", "totalReadTime" FROM "UserComicState" WHERE "userId" = 'reconcile-user' AND "comicId" = 'target-row'`).Scan(&page, &favorite, &readTime); err != nil {
		t.Fatal(err)
	}
	if page != 2 || favorite != 1 || readTime != 120 {
		t.Fatalf("user state not preserved: page=%d favorite=%d readTime=%d", page, favorite, readTime)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM "ReadingSession" WHERE "comicId" = 'target-row'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("reading sessions not preserved: count=%d err=%v", count, err)
	}
}
