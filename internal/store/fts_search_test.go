package store

import (
	"testing"
)

func TestComicSearchChineseTrigramAndShortTokens(t *testing.T) {
	setupTestDB(t)

	comics := []struct {
		id         string
		filename   string
		title      string
		author     string
		seriesName string
		genre      string
	}{
		{"c1", "wangu.epub", "万古神帝", "飞天鱼", "神帝系列", "玄幻"},
		{"c2", "one-piece-100.cbz", "One Piece Vol.100", "Eiichiro Oda", "One Piece", "Adventure"},
		{"c3", "aot-01.cbz", "进击的巨人 第1卷", "谏山创", "进击的巨人", "热血"},
		{"c4", "special.cbz", `100% "Special" (vol.1)`, "Author_X", "", "Sci-Fi"},
	}

	for _, c := range comics {
		if _, err := DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "author", "seriesName", "genre", "type", "libraryId", "relativePath")
			VALUES (?, ?, ?, ?, ?, ?, 'comic', 'default', ?)
		`, c.id, c.filename, c.title, c.author, c.seriesName, c.genre, c.filename); err != nil {
			t.Fatalf("insert comic %s: %v", c.id, err)
		}
	}

	tests := []struct {
		name    string
		query   string
		wantIDs []string
	}{
		{"Chinese 1-char suffix", "帝", []string{"c1"}},
		{"Chinese 2-char suffix", "神帝", []string{"c1"}},
		{"Chinese 2-char middle", "古神", []string{"c1"}},
		{"Chinese 3-char middle/suffix", "古神帝", []string{"c1"}},
		{"Chinese full title", "万古神帝", []string{"c1"}},
		{"Chinese 3-char in longer title", "击的巨", []string{"c3"}},
		{"Chinese author 2-char", "飞天", []string{"c1"}},
		{"Chinese author 3-char", "谏山创", []string{"c3"}},
		{"English case-insensitive substring", "piece", []string{"c2"}},
		{"English middle substring", "iichiro", []string{"c2"}},
		{"Multi-word AND matching across fields", "进击 谏山创", []string{"c3"}},
		{"Multi-word AND excludes partial match", "万古 谏山创", nil},
		{"Special chars safety (quotes, percent, parens, underscore)", `100% "Special" Author_X`, []string{"c4"}},
		{"Blank search matches all", "   ", []string{"c1", "c2", "c3", "c4"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res, err := GetAllComics(ComicListOptions{
				Page:     1,
				PageSize: 50,
				Search:   tc.query,
			})
			if err != nil {
				t.Fatalf("GetAllComics(%q) failed: %v", tc.query, err)
			}
			got := make([]string, len(res.Comics))
			for i, item := range res.Comics {
				got[i] = item.ID
			}
			if len(got) != len(tc.wantIDs) {
				t.Fatalf("query %q: got %v, want %v", tc.query, got, tc.wantIDs)
			}
			gotSet := map[string]bool{}
			for _, id := range got {
				gotSet[id] = true
			}
			for _, want := range tc.wantIDs {
				if !gotSet[want] {
					t.Fatalf("query %q: missing %s in %v", tc.query, want, got)
				}
			}
		})
	}
}

func TestComicUpdateTriggerNarrowedToIndexedColumns(t *testing.T) {
	setupTestDB(t)

	var triggerSQL string
	err := DB().QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'Comic_au_fts'`).Scan(&triggerSQL)
	if err != nil {
		t.Fatalf("load Comic_au_fts trigger: %v", err)
	}
	if triggerSQL == "" || !containsAll(triggerSQL, []string{`UPDATE OF`, `"title"`, `"author"`, `"filename"`, `"description"`, `"seriesName"`, `"genre"`}) {
		t.Fatalf("expected narrowed Comic_au_fts trigger, got: %s", triggerSQL)
	}
}

func containsAll(haystack string, needles []string) bool {
	for _, n := range needles {
		found := false
		for i := 0; i+len(n) <= len(haystack); i++ {
			if haystack[i:i+len(n)] == n {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
