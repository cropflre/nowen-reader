package store

import (
	"sort"
	"testing"
)

func TestBuildTitleSortKeyNaturalNumbers(t *testing.T) {
	titles := []string{"第10卷", "第2卷", "第1卷", "第02卷"}
	sort.SliceStable(titles, func(i, j int) bool {
		return BuildTitleSortKey(titles[i]) < BuildTitleSortKey(titles[j])
	})

	want := []string{"第1卷", "第2卷", "第02卷", "第10卷"}
	for i := range want {
		if titles[i] != want[i] {
			t.Fatalf("natural title order mismatch: got %v, want %v", titles, want)
		}
	}
}

func TestBuildTitleSortKeyChinesePinyinOrder(t *testing.T) {
	titles := []string{"张三", "王五", "李四", "阿部"}
	sort.SliceStable(titles, func(i, j int) bool {
		return BuildTitleSortKey(titles[i]) < BuildTitleSortKey(titles[j])
	})

	want := []string{"阿部", "李四", "王五", "张三"}
	for i := range want {
		if titles[i] != want[i] {
			t.Fatalf("pinyin title order mismatch: got %v, want %v", titles, want)
		}
	}
}

func TestSortSeriesShelfItemsChineseTitleDirections(t *testing.T) {
	titles := []string{
		"龙珠漫画",
		"刺客信条：鹰之传奇",
		"刺客信条：英灵殿",
		"刺客信条：圣殿骑士",
		"刺客信条：起义",
		"刺客信条：密谋",
		"刺客信条：记忆",
		"刺客信条：羁绊 第01卷",
		"刺客信条：刺客",
		"刺客信条：王朝",
		"镖人1-11（共11册）-许先哲",
		"西游记漫画全套（共20册）",
	}
	items := make([]ComicListItem, len(titles))
	for i, title := range titles {
		// Leave TitleSortKey empty to verify the mixed-shelf fallback too.
		items[i] = ComicListItem{ID: title, Title: title}
	}

	assertOrder := func(order string, want []string) {
		t.Helper()
		gotItems := append([]ComicListItem(nil), items...)
		sortSeriesShelfItems(gotItems, "title", order)
		got := make([]string, len(gotItems))
		for i := range gotItems {
			got[i] = gotItems[i].Title
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s title order mismatch: got %v, want %v", order, got, want)
			}
		}
	}

	ascending := []string{
		"镖人1-11（共11册）-许先哲",
		"刺客信条：刺客",
		"刺客信条：羁绊 第01卷",
		"刺客信条：记忆",
		"刺客信条：密谋",
		"刺客信条：起义",
		"刺客信条：圣殿骑士",
		"刺客信条：王朝",
		"刺客信条：英灵殿",
		"刺客信条：鹰之传奇",
		"龙珠漫画",
		"西游记漫画全套（共20册）",
	}
	assertOrder("asc", ascending)

	descending := append([]string(nil), ascending...)
	for left, right := 0, len(descending)-1; left < right; left, right = left+1, right-1 {
		descending[left], descending[right] = descending[right], descending[left]
	}
	assertOrder("desc", descending)
}

func TestTitleSortKeySQLFunction(t *testing.T) {
	dbPath := testDBPath(t)
	if err := InitDB(dbPath); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer CloseDB()

	var key string
	if err := db.QueryRow(`SELECT title_sort_key(?)`, "第10卷").Scan(&key); err != nil {
		t.Fatalf("title_sort_key SQL function failed: %v", err)
	}
	if key == "" {
		t.Fatal("title_sort_key SQL function returned empty key")
	}
}

func TestGetAllComicsTitleSortUsesNaturalOrder(t *testing.T) {
	dbPath := testDBPath(t)
	if err := InitDB(dbPath); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer CloseDB()

	now := "2024-01-01T00:00:00Z"
	fixtures := []struct {
		id    string
		title string
	}{
		{"comic-10", "第10卷"},
		{"comic-2", "第2卷"},
		{"comic-a", "阿部"},
	}
	for _, f := range fixtures {
		if _, err := db.Exec(`INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "addedAt", "updatedAt") VALUES (?, ?, ?, 0, 1, ?, ?)`,
			f.id, f.id+".cbz", f.title, now, now); err != nil {
			t.Fatalf("insert fixture %s failed: %v", f.id, err)
		}
	}

	result, err := GetAllComics(ComicListOptions{SortBy: "title", SortOrder: "asc"})
	if err != nil {
		t.Fatalf("GetAllComics failed: %v", err)
	}
	got := []string{result.Comics[0].Title, result.Comics[1].Title, result.Comics[2].Title}
	want := []string{"阿部", "第2卷", "第10卷"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("title order mismatch: got %v, want %v", got, want)
		}
	}
	for _, c := range result.Comics {
		if c.TitleSortKey == "" {
			t.Fatalf("comic %s has empty titleSortKey", c.ID)
		}
	}
}
