package store

import "testing"

func TestGetAICandidateComicIDs(t *testing.T) {
	setupTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO "Library" ("id", "name", "rootPath", "type", "enabled") VALUES
			('ai-library-a', 'AI A', '/ai-a', 'comic', 1),
			('ai-library-b', 'AI B', '/ai-b', 'comic', 1)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath", "addedAt") VALUES
			('tagged-comic', 'tagged.cbz', 'Tagged', 'comic', 'ai-library-a', 'tagged.cbz', '2026-01-01T00:00:00Z'),
			('untagged-comic', 'untagged.cbz', 'Untagged', 'comic', 'ai-library-a', 'untagged.cbz', '2026-01-02T00:00:00Z'),
			('untagged-novel', 'novel.epub', 'Novel', 'novel', 'ai-library-a', 'novel.epub', '2026-01-03T00:00:00Z'),
			('hidden-comic', 'hidden.cbz', 'Hidden', 'comic', 'ai-library-b', 'hidden.cbz', '2026-01-04T00:00:00Z')
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO "Tag" ("name") VALUES ('existing-tag')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO "ComicTag" ("comicId", "tagId") SELECT 'tagged-comic', "id" FROM "Tag" WHERE "name" = 'existing-tag'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO "Category" ("name", "slug") VALUES ('Existing', 'existing')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO "ComicCategory" ("comicId", "categoryId") SELECT 'untagged-comic', "id" FROM "Category" WHERE "slug" = 'existing'`); err != nil {
		t.Fatal(err)
	}

	t.Run("filters untagged candidates before applying limit", func(t *testing.T) {
		result, err := GetAICandidateComicIDs(AICandidateOptions{
			Filter:           "untagged",
			LibraryIDs:       []string{"ai-library-a"},
			FilterLibraryIDs: true,
			Limit:            1,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Total != 2 {
			t.Fatalf("total = %d, want 2", result.Total)
		}
		if len(result.ComicIDs) != 1 || result.ComicIDs[0] != "untagged-novel" {
			t.Fatalf("comic IDs = %#v, want newest eligible item", result.ComicIDs)
		}
	})

	t.Run("supports content type and category filters", func(t *testing.T) {
		result, err := GetAICandidateComicIDs(AICandidateOptions{
			Filter:           "uncategorized",
			ContentType:      "comic",
			LibraryIDs:       []string{"ai-library-a"},
			FilterLibraryIDs: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Total != 1 || len(result.ComicIDs) != 1 || result.ComicIDs[0] != "tagged-comic" {
			t.Fatalf("result = %#v, want tagged-comic only", result)
		}
	})

	t.Run("empty authorized library list returns no candidates", func(t *testing.T) {
		result, err := GetAICandidateComicIDs(AICandidateOptions{
			Filter:           "all",
			FilterLibraryIDs: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Total != 0 || len(result.ComicIDs) != 0 {
			t.Fatalf("result = %#v, want empty", result)
		}
	})
}
