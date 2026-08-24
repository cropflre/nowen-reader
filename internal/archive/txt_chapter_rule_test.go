package archive

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPreviewTxtChapterPatternAndCustomReader(t *testing.T) {
	fp := filepath.Join(t.TempDir(), "book.txt")
	text := "序言\n这是一段前言。\n【001】起源\n第一章正文。\n【002】远行\n第二章正文。\n【003】终局\n第三章正文。\n"
	if err := os.WriteFile(fp, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}

	pattern := `^【\d+】.+$`
	count, preview, err := PreviewTxtChapterPattern(fp, pattern, 20)
	if err != nil {
		t.Fatalf("PreviewTxtChapterPattern failed: %v", err)
	}
	if count != 3 {
		t.Fatalf("expected 3 matched headings, got %d", count)
	}
	if len(preview) != 3 || preview[0] != "【001】起源" || preview[2] != "【003】终局" {
		t.Fatalf("unexpected preview: %#v", preview)
	}

	reader, err := NewTxtReaderWithPattern(fp, pattern)
	if err != nil {
		t.Fatalf("NewTxtReaderWithPattern failed: %v", err)
	}
	defer reader.Close()

	entries := reader.ListEntries()
	// Non-empty text before the first matched heading remains a synthetic preface
	// chapter, preserving all source text instead of dropping it.
	if len(entries) != 4 {
		t.Fatalf("expected preface + 3 chapters, got %d", len(entries))
	}
	titles := GetTxtChapterTitles(reader)
	want := []string{"前言", "【001】起源", "【002】远行", "【003】终局"}
	if len(titles) != len(want) {
		t.Fatalf("expected %d titles, got %#v", len(want), titles)
	}
	for i := range want {
		if titles[i] != want[i] {
			t.Fatalf("title %d: want %q, got %q", i, want[i], titles[i])
		}
	}

	chapter, err := reader.ExtractEntry(entries[2].Name)
	if err != nil {
		t.Fatalf("ExtractEntry failed: %v", err)
	}
	if string(chapter) != "【002】远行\n第二章正文。" {
		t.Fatalf("unexpected chapter content: %q", string(chapter))
	}
}

func TestPreviewTxtChapterPatternRejectsInvalidRegex(t *testing.T) {
	fp := filepath.Join(t.TempDir(), "book.txt")
	if err := os.WriteFile(fp, []byte("第1章\n正文"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := PreviewTxtChapterPattern(fp, "([", 20); err == nil {
		t.Fatal("expected invalid regex error")
	}
}

func TestCustomTxtRuleFallsBackWhenFewerThanTwoHeadingsMatch(t *testing.T) {
	fp := filepath.Join(t.TempDir(), "book.txt")
	text := "【001】唯一命中\n" + string(make([]byte, 0)) + "这本书没有第二个匹配标题。\n"
	if err := os.WriteFile(fp, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}

	reader, err := NewTxtReaderWithPattern(fp, `^【\d+】.+$`)
	if err != nil {
		t.Fatalf("NewTxtReaderWithPattern failed: %v", err)
	}
	defer reader.Close()
	titles := GetTxtChapterTitles(reader)
	if len(titles) == 0 || titles[0] != "第 1 页" {
		t.Fatalf("expected fixed-size fallback, got titles %#v", titles)
	}
}
