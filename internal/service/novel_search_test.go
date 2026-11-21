package service

import (
	"archive/zip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func setupServiceTestDB(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	if err := store.InitDB(dbPath); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	if err := store.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	t.Cleanup(func() {
		InvalidateAllCaches()
		store.CloseDB()
		_ = os.Remove(dbPath)
	})
	return dir
}

func writeZipArchive(t *testing.T, fp string, files map[string]string) {
	t.Helper()
	f, err := os.Create(fp)
	if err != nil {
		t.Fatalf("create zip %s: %v", fp, err)
	}
	zw := zip.NewWriter(f)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create entry %s: %v", name, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("write entry %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip writer: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close zip file: %v", err)
	}
}

func TestSearchNovelContent(t *testing.T) {
	dir := setupServiceTestDB(t)
	libDir := filepath.Join(dir, "novels")
	if err := os.MkdirAll(libDir, 0755); err != nil {
		t.Fatal(err)
	}
	lib := &model.Library{
		ID:            "novel-search-lib",
		Name:          "Novels",
		Type:          "novel",
		RootPath:      libDir,
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   false,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatal(err)
	}

	// 1. TXT novel with default chapters
	txtContent := strings.Join([]string{
		"第一章 初入江湖",
		"张若尘站在古道旁，看着远处的剑影，心中想起Magic Sword的传说。",
		"",
		"第二章 暗潮涌动",
		"夜色深沉，剑影再现于古城墙之上。",
		"",
		"第三章 风云再起",
		"这章没有关键词，只有普通文字。",
	}, "\n")
	if err := os.WriteFile(filepath.Join(libDir, "story.txt"), []byte(txtContent), 0644); err != nil {
		t.Fatal(err)
	}

	// 2. TXT novel with custom chapter rule syntax (【01】...)
	customTxtContent := strings.Join([]string{
		"【01】起点",
		"星辰大海从这里启程。",
		"【02】远航",
		"星辰闪烁，战舰破浪。",
		"【03】归来",
		"星辰依旧。",
	}, "\n")
	if err := os.WriteFile(filepath.Join(libDir, "custom.txt"), []byte(customTxtContent), 0644); err != nil {
		t.Fatal(err)
	}

	// 3. EPUB novel with HTML tags and entities
	writeZipArchive(t, filepath.Join(libDir, "book.epub"), map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OEBPS/content.opf":      `<?xml version="1.0"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test EPUB</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
		"OEBPS/toc.ncx":          `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint playOrder="1"><navLabel><text>Intro</text></navLabel><content src="c1.xhtml"/></navPoint><navPoint playOrder="2"><navLabel><text>Climax</text></navLabel><content src="c2.xhtml"/></navPoint></navMap></ncx>`,
		"OEBPS/c1.xhtml":         `<html><body><h1>Intro</h1><p>Sword &amp; Magic begin here.</p></body></html>`,
		"OEBPS/c2.xhtml":         `<html><body><h1>Climax</h1><p>Another chapter without keyword.</p></body></html>`,
	})

	// 4. CBZ comic (non-novel)
	writeZipArchive(t, filepath.Join(libDir, "comic.cbz"), map[string]string{
		"001.jpg": "fake-jpeg-bytes",
	})

	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES
			('txt-1', 'story.txt', 'Story', 'novel', 'novel-search-lib', 'story.txt'),
			('txt-custom', 'custom.txt', 'Custom', 'novel', 'novel-search-lib', 'custom.txt'),
			('epub-1', 'book.epub', 'Book', 'novel', 'novel-search-lib', 'book.epub'),
			('cbz-1', 'comic.cbz', 'Comic', 'comic', 'novel-search-lib', 'comic.cbz')
	`); err != nil {
		t.Fatal(err)
	}

	t.Run("TXT Chinese substring and valid UTF-8 snippet", func(t *testing.T) {
		res, err := SearchNovelContent(context.Background(), "txt-1", "剑影", 100)
		if err != nil {
			t.Fatalf("SearchNovelContent failed: %v", err)
		}
		if res.MatchedChapters != 2 || res.TotalMatches != 2 || res.Truncated {
			t.Fatalf("unexpected counts: %+v", res)
		}
		for _, item := range res.Results {
			if !utf8.ValidString(item.MatchText) {
				t.Fatalf("snippet is invalid UTF-8: %q", item.MatchText)
			}
			if !strings.Contains(item.MatchText, "剑影") {
				t.Fatalf("snippet missing keyword: %q", item.MatchText)
			}
		}
	})

	t.Run("TXT case-insensitive English", func(t *testing.T) {
		res, err := SearchNovelContent(context.Background(), "txt-1", "magic sword", 100)
		if err != nil {
			t.Fatalf("SearchNovelContent failed: %v", err)
		}
		if len(res.Results) != 1 || res.Results[0].ChapterIndex != 0 {
			t.Fatalf("unexpected English results: %+v", res.Results)
		}
	})

	t.Run("TXT limit truncation", func(t *testing.T) {
		res, err := SearchNovelContent(context.Background(), "txt-1", "剑影", 1)
		if err != nil {
			t.Fatalf("SearchNovelContent failed: %v", err)
		}
		if len(res.Results) != 1 || !res.Truncated {
			t.Fatalf("expected truncated=true and 1 result, got %+v", res)
		}
	})

	t.Run("TXT custom chapter rule", func(t *testing.T) {
		rule, err := store.CreateNovelChapterRule("方括号", `^【\d+】.+$`)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.SetComicChapterRuleSelection("txt-custom", rule.ID); err != nil {
			t.Fatal(err)
		}
		res, err := SearchNovelContent(context.Background(), "txt-custom", "星辰", 100)
		if err != nil {
			t.Fatalf("SearchNovelContent custom rule failed: %v", err)
		}
		if res.TotalChapters != 3 || res.MatchedChapters != 3 {
			t.Fatalf("expected 3 chapters matched under custom rule, got %+v", res)
		}
		if res.Results[1].ChapterTitle != "【02】远航" || res.Results[1].ChapterIndex != 1 {
			t.Fatalf("unexpected chapter 1 metadata: %+v", res.Results[1])
		}
	})

	t.Run("EPUB strips HTML tags and unescapes entities", func(t *testing.T) {
		res, err := SearchNovelContent(context.Background(), "epub-1", "Sword & Magic", 100)
		if err != nil {
			t.Fatalf("SearchNovelContent EPUB failed: %v", err)
		}
		if len(res.Results) != 1 || res.Results[0].ChapterIndex != 0 {
			t.Fatalf("unexpected EPUB search results: %+v", res)
		}
		if strings.Contains(res.Results[0].MatchText, "<p>") {
			t.Fatalf("snippet should strip HTML tags: %q", res.Results[0].MatchText)
		}
	})

	t.Run("Non-novel returns ErrNotNovel", func(t *testing.T) {
		_, err := SearchNovelContent(context.Background(), "cbz-1", "test", 100)
		if !errors.Is(err, ErrNotNovel) {
			t.Fatalf("expected ErrNotNovel, got %v", err)
		}
	})
}
