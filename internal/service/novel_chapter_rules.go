package service

import (
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const configuredTxtReaderCacheMax = 8

type configuredTxtReaderCacheEntry struct {
	reader   archive.Reader
	path     string
	ruleID   string
	pattern  string
	size     int64
	modUnix  int64
	lastUsed time.Time
}

var (
	configuredTxtReaderMu    sync.Mutex
	configuredTxtReaderCache = map[string]*configuredTxtReaderCacheEntry{}
)

// GetConfiguredTxtPages returns a custom/preset TXT chapter list when the book
// has explicitly selected a rule. configured=false means callers should keep
// using the existing automatic novel parser.
func GetConfiguredTxtPages(comicID string) (*PagesResult, bool, error) {
	selection, err := store.GetComicChapterRuleSelection(comicID)
	if err != nil {
		return nil, false, err
	}
	if selection == nil || selection.Rule == nil || selection.RuleID == store.ChapterRuleAutoID {
		return nil, false, nil
	}

	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, true, err
	}
	if archive.DetectType(fp) != archive.TypeTxt {
		return nil, false, nil
	}
	reader, err := getConfiguredTxtReader(comicID, fp, selection.RuleID, selection.Rule.Pattern)
	if err != nil {
		return nil, true, err
	}

	entries := make([]string, 0)
	for _, entry := range reader.ListEntries() {
		if !entry.IsDirectory {
			entries = append(entries, entry.Name)
		}
	}
	titles := archive.GetTxtChapterTitles(reader)
	infos := make([]ChapterInfo, len(titles))
	for i, title := range titles {
		infos[i] = ChapterInfo{Title: title, ParentIndex: -1}
	}
	return &PagesResult{
		Entries:       entries,
		ChapterTitles: titles,
		ChapterInfos:  infos,
		IsNovel:       true,
		IsPdf:         false,
	}, true, nil
}

func GetConfiguredTxtChapter(comicID string, chapterIndex int) (*ChapterContent, bool, error) {
	selection, err := store.GetComicChapterRuleSelection(comicID)
	if err != nil {
		return nil, false, err
	}
	if selection == nil || selection.Rule == nil || selection.RuleID == store.ChapterRuleAutoID {
		return nil, false, nil
	}
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, true, err
	}
	if archive.DetectType(fp) != archive.TypeTxt {
		return nil, false, nil
	}
	reader, err := getConfiguredTxtReader(comicID, fp, selection.RuleID, selection.Rule.Pattern)
	if err != nil {
		return nil, true, err
	}

	entries := make([]string, 0)
	for _, entry := range reader.ListEntries() {
		if !entry.IsDirectory {
			entries = append(entries, entry.Name)
		}
	}
	if chapterIndex < 0 || chapterIndex >= len(entries) {
		return nil, true, fmt.Errorf("chapter index %d out of range (0-%d)", chapterIndex, len(entries)-1)
	}
	data, err := reader.ExtractEntry(entries[chapterIndex])
	if err != nil {
		return nil, true, fmt.Errorf("extract chapter %d: %w", chapterIndex, err)
	}
	title := ""
	if titles := archive.GetTxtChapterTitles(reader); chapterIndex < len(titles) {
		title = titles[chapterIndex]
	}
	return &ChapterContent{Content: string(data), Title: title, MimeType: "text/plain; charset=utf-8"}, true, nil
}

// GetResolvedChapterContent is the single chapter-content entry point for
// features that need to respect a book's selected TXT chapter rule. EPUB/MOBI
// and TXT books in automatic mode continue through the existing parser.
func GetResolvedChapterContent(comicID string, chapterIndex int) (*ChapterContent, error) {
	chapter, configured, err := GetConfiguredTxtChapter(comicID, chapterIndex)
	if err != nil {
		return nil, err
	}
	if configured {
		return chapter, nil
	}
	return GetChapterContent(comicID, chapterIndex)
}

func PreviewTxtChapterRule(comicID, pattern string) (int, []string, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return 0, nil, err
	}
	if archive.DetectType(fp) != archive.TypeTxt {
		return 0, nil, fmt.Errorf("custom chapter rules are only supported for TXT novels")
	}
	return archive.PreviewTxtChapterPattern(fp, pattern, 20)
}

// InvalidateConfiguredTxtCache only clears the affected book. It deliberately
// does not touch EPUB/MOBI readers or unrelated TXT books. Chapter-indexed AI
// summaries are also cleared because a rule change can redefine every index.
func InvalidateConfiguredTxtCache(comicID string) {
	ClearChapterSummaryCache(comicID)

	configuredTxtReaderMu.Lock()
	defer configuredTxtReaderMu.Unlock()
	if entry, ok := configuredTxtReaderCache[comicID]; ok {
		entry.reader.Close()
		delete(configuredTxtReaderCache, comicID)
	}
}

func getConfiguredTxtReader(comicID, fp, ruleID, pattern string) (archive.Reader, error) {
	stat, err := os.Stat(fp)
	if err != nil {
		return nil, err
	}
	size := stat.Size()
	modUnix := stat.ModTime().UnixNano()

	// Fast path under lock.
	configuredTxtReaderMu.Lock()
	if cached, ok := configuredTxtReaderCache[comicID]; ok &&
		cached.path == fp && cached.ruleID == ruleID && cached.pattern == pattern &&
		cached.size == size && cached.modUnix == modUnix {
		cached.lastUsed = time.Now()
		reader := cached.reader
		configuredTxtReaderMu.Unlock()
		return reader, nil
	}
	configuredTxtReaderMu.Unlock()

	// TXT decoding/splitting can be expensive for large books. Never hold the
	// global cache mutex while parsing the file.
	candidate, err := archive.NewTxtReaderWithPattern(fp, pattern)
	if err != nil {
		return nil, err
	}

	configuredTxtReaderMu.Lock()
	defer configuredTxtReaderMu.Unlock()

	// Another goroutine may have populated the same fresh reader while this one
	// was parsing. Reuse it and close the duplicate candidate.
	if cached, ok := configuredTxtReaderCache[comicID]; ok &&
		cached.path == fp && cached.ruleID == ruleID && cached.pattern == pattern &&
		cached.size == size && cached.modUnix == modUnix {
		cached.lastUsed = time.Now()
		candidate.Close()
		return cached.reader, nil
	}

	// Remove stale entry for this book before inserting the newly parsed reader.
	if stale, ok := configuredTxtReaderCache[comicID]; ok {
		stale.reader.Close()
		delete(configuredTxtReaderCache, comicID)
	}

	if len(configuredTxtReaderCache) >= configuredTxtReaderCacheMax {
		oldestID := ""
		var oldest time.Time
		for id, cached := range configuredTxtReaderCache {
			if oldestID == "" || cached.lastUsed.Before(oldest) {
				oldestID = id
				oldest = cached.lastUsed
			}
		}
		if oldestID != "" {
			configuredTxtReaderCache[oldestID].reader.Close()
			delete(configuredTxtReaderCache, oldestID)
		}
	}

	configuredTxtReaderCache[comicID] = &configuredTxtReaderCacheEntry{
		reader:   candidate,
		path:     fp,
		ruleID:   ruleID,
		pattern:  pattern,
		size:     size,
		modUnix:  modUnix,
		lastUsed: time.Now(),
	}
	return candidate, nil
}
