package service

import (
	"context"
	"errors"
	"fmt"
	stdhtml "html"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

var (
	ErrNotNovel           = errors.New("content is not a novel")
	ErrEmptySearchQuery   = errors.New("search query is required")
	htmlTagStripRegexp    = regexp.MustCompile(`<[^>]*>`)
	whitespaceStripRegexp = regexp.MustCompile(`\s+`)
)

// NovelSearchResultItem matches the frontend/Flutter per-chapter search result payload.
type NovelSearchResultItem struct {
	ChapterIndex int    `json:"chapterIndex"`
	ChapterTitle string `json:"chapterTitle"`
	MatchText    string `json:"matchText"`
	MatchCount   int    `json:"matchCount"`
}

// NovelSearchResponse holds full-book search results across all chapters.
type NovelSearchResponse struct {
	Query           string                  `json:"query"`
	TotalChapters   int                     `json:"totalChapters"`
	MatchedChapters int                     `json:"matchedChapters"`
	TotalMatches    int                     `json:"totalMatches"`
	Truncated       bool                    `json:"truncated"`
	Results         []NovelSearchResultItem `json:"results"`
}

// SearchNovelContent searches all chapters of a novel book server-side,
// respecting custom TXT chapter rules when configured.
func SearchNovelContent(ctx context.Context, comicID, query string, limit int) (*NovelSearchResponse, error) {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return nil, ErrEmptySearchQuery
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}

	archiveType := archive.DetectType(fp)
	if !archive.IsNovelType(archiveType) {
		return nil, ErrNotNovel
	}

	comic, dbErr := store.GetComicByID(comicID)
	if archive.IsEbookType(archiveType) && dbErr == nil && comic != nil && comic.ComicType == "comic" {
		return nil, ErrNotNovel
	}
	if archive.IsEbookType(archiveType) && (archiveType == archive.TypeMobi || archiveType == archive.TypeAzw3) {
		if archive.IsMobiImageHeavy(fp) {
			return nil, ErrNotNovel
		}
	}

	var reader archive.Reader
	if archiveType == archive.TypeTxt {
		selection, selErr := store.GetComicChapterRuleSelection(comicID)
		if selErr != nil {
			return nil, selErr
		}
		if selection != nil && selection.Rule != nil && selection.RuleID != store.ChapterRuleAutoID {
			reader, err = getConfiguredTxtReader(comicID, fp, selection.RuleID, selection.Rule.Pattern)
			if err != nil {
				return nil, err
			}
		}
	}
	if reader == nil {
		reader, err = getPooledReader(fp)
		if err != nil {
			return nil, err
		}
	}

	var entries []string
	for _, entry := range reader.ListEntries() {
		if !entry.IsDirectory {
			entries = append(entries, entry.Name)
		}
	}
	titles := getChapterTitles(reader, archiveType)

	totalChapters := len(entries)
	lowerQuery := strings.ToLower(trimmed)
	isHTMLFormat := archiveType == archive.TypeEpub ||
		archiveType == archive.TypeMobi ||
		archiveType == archive.TypeAzw3 ||
		archiveType == archive.TypeHtml

	results := make([]NovelSearchResultItem, 0)
	matchedChapters := 0
	totalMatches := 0
	truncated := false

	for i := 0; i < totalChapters; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		var rawText string
		var title string
		extracted := false
		if archiveType == archive.TypeTxt {
			if txtContent, txtTitle, ok := archive.ExtractTxtChapterByIndex(reader, i); ok {
				rawText = txtContent
				title = txtTitle
				extracted = true
			}
		}
		if !extracted {
			data, extractErr := reader.ExtractEntry(entries[i])
			if extractErr != nil {
				continue
			}
			rawText = string(data)
		}
		if title == "" {
			if i < len(titles) && strings.TrimSpace(titles[i]) != "" {
				title = titles[i]
			} else {
				title = fmt.Sprintf("第 %d 章", i+1)
			}
		}

		plainText := rawText
		if isHTMLFormat {
			plainText = htmlToSearchablePlainText(rawText)
		}

		matchCount, snippet := findMatchesInChapter(plainText, lowerQuery)
		if matchCount == 0 {
			continue
		}

		if len(results) >= limit {
			truncated = true
			break
		}

		matchedChapters++
		totalMatches += matchCount
		results = append(results, NovelSearchResultItem{
			ChapterIndex: i,
			ChapterTitle: title,
			MatchText:    snippet,
			MatchCount:   matchCount,
		})
	}

	return &NovelSearchResponse{
		Query:           trimmed,
		TotalChapters:   totalChapters,
		MatchedChapters: matchedChapters,
		TotalMatches:    totalMatches,
		Truncated:       truncated,
		Results:         results,
	}, nil
}

func htmlToSearchablePlainText(raw string) string {
	if raw == "" {
		return ""
	}
	stripped := htmlTagStripRegexp.ReplaceAllString(raw, " ")
	unescaped := stdhtml.UnescapeString(stripped)
	return unescaped
}

func findMatchesInChapter(plainText, lowerQuery string) (int, string) {
	if plainText == "" || lowerQuery == "" {
		return 0, ""
	}
	lowerText := strings.ToLower(plainText)
	idx := strings.Index(lowerText, lowerQuery)
	if idx < 0 {
		return 0, ""
	}

	firstIdx := idx
	count := 0
	for idx >= 0 {
		count++
		nextStart := idx + len(lowerQuery)
		if nextStart >= len(lowerText) {
			break
		}
		rel := strings.Index(lowerText[nextStart:], lowerQuery)
		if rel < 0 {
			break
		}
		idx = nextStart + rel
	}

	source := plainText
	if len(lowerText) != len(plainText) {
		source = lowerText
	}
	snippet := extractRuneSafeSnippet(source, firstIdx, len(lowerQuery), 30, 35)
	return count, snippet
}

func extractRuneSafeSnippet(text string, matchStartByte, matchByteLen, beforeRunes, afterRunes int) string {
	if matchStartByte < 0 {
		matchStartByte = 0
	}
	if matchStartByte > len(text) {
		matchStartByte = len(text)
	}
	matchEndByte := matchStartByte + matchByteLen
	if matchEndByte > len(text) {
		matchEndByte = len(text)
	}

	startByte := matchStartByte
	for i := 0; i < beforeRunes && startByte > 0; i++ {
		_, size := utf8.DecodeLastRuneInString(text[:startByte])
		if size <= 0 {
			break
		}
		startByte -= size
	}

	endByte := matchEndByte
	for i := 0; i < afterRunes && endByte < len(text); i++ {
		_, size := utf8.DecodeRuneInString(text[endByte:])
		if size <= 0 {
			break
		}
		endByte += size
	}

	rawSnippet := strings.TrimSpace(whitespaceStripRegexp.ReplaceAllString(text[startByte:endByte], " "))
	if startByte > 0 {
		rawSnippet = "..." + rawSnippet
	}
	if endByte < len(text) {
		rawSnippet += "..."
	}
	return rawSnippet
}
