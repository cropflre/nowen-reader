package store

import "testing"

func TestExtractFileFormatAndPriority(t *testing.T) {
	cases := map[string]string{
		"三体.epub":      "epub",
		"三体.EPUB":      "epub",
		"folder/a.HTM": "html",
		"a/b.azw3":     "azw3",
		"manga/01/":    "folder",
		"plain":        "book",
	}
	for input, want := range cases {
		if got := ExtractFileFormat(input); got != want {
			t.Errorf("ExtractFileFormat(%q) = %q, want %q", input, got, want)
		}
	}

	if FormatPriority("novel", "epub") >= FormatPriority("novel", "pdf") {
		t.Fatal("novel epub priority should be higher (smaller) than pdf")
	}
	if FormatPriority("comic", "cbz") >= FormatPriority("comic", "pdf") {
		t.Fatal("comic cbz priority should be higher (smaller) than pdf")
	}
}

func TestBuildEditionStemKeyAndLabels(t *testing.T) {
	k1 := BuildEditionStemKey("科幻/三体.epub")
	k2 := BuildEditionStemKey("科幻/三体 (精校版).mobi")
	k3 := BuildEditionStemKey("科幻/三体[PDF].pdf")
	if k1 == "" || k1 != k2 || k1 != k3 {
		t.Fatalf("same-directory format variants should share stem key: %q, %q, %q", k1, k2, k3)
	}
	if got := ExtractEditionLabel("科幻/三体 (精校版).mobi"); got != "精校版" {
		t.Fatalf("ExtractEditionLabel = %q, want 精校版", got)
	}
	if got := ExtractEditionLabel("《万古神帝》〔精排〕作者：飞天鱼.epub"); got != "精排" {
		t.Fatalf("ExtractEditionLabel = %q, want 精排", got)
	}
	if got := ExtractAuthorFromFilename("《万古神帝》〔精排〕作者：飞天鱼.epub"); got != "飞天鱼" {
		t.Fatalf("ExtractAuthorFromFilename = %q, want 飞天鱼", got)
	}

	// Different directories must NOT share stem key
	if BuildEditionStemKey("A/三体.epub") == BuildEditionStemKey("B/三体.pdf") {
		t.Fatal("different directories must not share same-directory stem key")
	}

	// Volumes in same directory must NOT collide
	if BuildEditionStemKey("海贼王/第01卷.cbz") == BuildEditionStemKey("海贼王/第02卷.cbz") {
		t.Fatal("distinct volumes in same directory must not collide")
	}
	if BuildEditionStemKey("海贼王/第01卷.cbz") != BuildEditionStemKey("海贼王/第01卷.pdf") {
		t.Fatal("same volume with different formats in same directory must share stem key")
	}

	// Image folders return empty stem key
	if BuildEditionStemKey("漫画/单本/") != "" {
		t.Fatal("image folder should return empty stem key")
	}
}

func TestBuildEditionMatchKeyPreservesVolumesAndFiltersGenerics(t *testing.T) {
	m1 := BuildEditionMatchKey("EPUB/三体1.epub", "三体1")
	m2 := BuildEditionMatchKey("PDF/三体1.pdf", "三体1")
	m3 := BuildEditionMatchKey("EPUB/三体2.epub", "三体2")
	if m1 == "" || m1 != m2 {
		t.Fatalf("cross-dir volume 1 match keys should match: %q vs %q", m1, m2)
	}
	if m1 == m3 {
		t.Fatalf("distinct volumes must NOT share match key: %q vs %q", m1, m3)
	}

	// Traditional vs simplified
	if BuildEditionMatchKey("EPUB/進擊的巨人 第1卷.epub", "") != BuildEditionMatchKey("PDF/进击的巨人 第1卷.pdf", "") {
		t.Fatal("traditional and simplified match keys should normalize identically")
	}

	// Upper vs lower volumes
	if BuildEditionMatchKey("庆余年（上）.epub", "") == BuildEditionMatchKey("庆余年（下）.epub", "") {
		t.Fatal("上 and 下 volumes must NOT share match key")
	}

	// Generic / numeric-only root names must not cross-merge
	for _, generic := range []string{"01.cbz", "第1话.cbz", "EPUB/正文.txt", "book.epub"} {
		if got := BuildEditionMatchKey(generic, ""); got != "" {
			t.Fatalf("generic filename %q should return empty match key, got %q", generic, got)
		}
	}

	// Volume inside series folder gets parent context
	s1 := BuildEditionMatchKey("海贼王/第01卷.cbz", "")
	s2 := BuildEditionMatchKey("PDF/海贼王 第01卷.pdf", "")
	if s1 == "" || s1 != s2 {
		t.Fatalf("series volume should match standalone volume with series title: %q vs %q", s1, s2)
	}
}
