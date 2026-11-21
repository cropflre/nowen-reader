package archive

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// ============================================================
// TXT Reader (pure Go — chapter-based splitting)
// ============================================================

// Default chars per virtual page when no chapters are detected
const defaultCharsPerPage = 2000

// Chapter title patterns (Chinese and English)
var chapterPatterns = []*regexp.Regexp{
	// Chinese: 第X章, 第X节, 第X回, 第X卷
	regexp.MustCompile(`^[ \t]*第[零一二三四五六七八九十百千万\d]+[章节回卷部篇集]`),
	// Chinese: 章节 N, 卷 N
	regexp.MustCompile(`^[ \t]*[章节卷][ \t]*[零一二三四五六七八九十百千万\d]+`),
	// English: Chapter N, CHAPTER N
	regexp.MustCompile(`(?i)^[ \t]*chapter\s+[\divxlc]+`),
	// English: Part N
	regexp.MustCompile(`(?i)^[ \t]*part\s+[\divxlc]+`),
	// Numbered: 1. Title, 01. Title
	regexp.MustCompile(`^[ \t]*\d{1,4}[.、]\s+\S`),
	// Separators used as chapter dividers
	regexp.MustCompile(`^[ \t]*[=＝]{3,}`),
	regexp.MustCompile(`^[ \t]*[—–]{3,}`),
}

// txtChapterMeta stores chapter boundary info without content (for lazy loading)
type txtChapterMeta struct {
	title      string
	byteOffset int // offset in the normalized text
	byteLength int // length in bytes
}

type txtReader struct {
	filepath string
	// Lazy mode: store only metadata + original text, extract on demand
	text     string           // normalized UTF-8 text (kept for ExtractEntry)
	chapters []txtChapterMeta // chapter boundaries
	entries  []Entry
}

func newTxtReader(fp string) (*txtReader, error) {
	start := time.Now()
	data, err := os.ReadFile(fp)
	if err != nil {
		return nil, fmt.Errorf("read txt %s: %w", fp, err)
	}
	fileSize := len(data)

	// Detect and convert encoding to UTF-8
	text := detectAndDecodeText(data)
	// Release original data early
	data = nil

	// Normalize line endings BEFORE splitting so byte offsets are consistent
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")

	// Split into chapters (returns metadata with offsets into normalized text)
	chapterMetas := splitIntoChapterMetas(text)

	r := &txtReader{
		filepath: fp,
		text:     text,
		chapters: chapterMetas,
		entries:  make([]Entry, len(chapterMetas)),
	}

	for i := range chapterMetas {
		r.entries[i] = Entry{
			Name:        fmt.Sprintf("chapter-%04d.txt", i+1),
			IsDirectory: false,
		}
	}

	elapsed := time.Since(start)
	if elapsed > 1*time.Second {
		log.Printf("[txt] Parsed %s: %.1fMB, %d chapters in %v", fp, float64(fileSize)/(1024*1024), len(chapterMetas), elapsed)
	}

	return r, nil
}

func (r *txtReader) ListEntries() []Entry {
	return r.entries
}

func (r *txtReader) ExtractEntry(entryName string) ([]byte, error) {
	for i, e := range r.entries {
		if e.Name == entryName {
			meta := r.chapters[i]
			content := r.text[meta.byteOffset : meta.byteOffset+meta.byteLength]
			return []byte(strings.TrimSpace(content)), nil
		}
	}
	return nil, fmt.Errorf("entry not found in txt: %s", entryName)
}

func (r *txtReader) Close() {
	// Nothing to clean up
}

// GetChapterTitle returns the title for a chapter entry name.
func (r *txtReader) GetChapterTitle(entryName string) string {
	for i, e := range r.entries {
		if e.Name == entryName {
			return r.chapters[i].title
		}
	}
	return ""
}

// ============================================================
// Text encoding detection and conversion
// ============================================================

func detectAndDecodeText(data []byte) string {
	// Check for BOM markers
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		// UTF-8 BOM
		return string(data[3:])
	}
	if len(data) >= 2 && data[0] == 0xFF && data[1] == 0xFE {
		// UTF-16 LE BOM
		return decodeUTF16LE(data[2:])
	}
	if len(data) >= 2 && data[0] == 0xFE && data[1] == 0xFF {
		// UTF-16 BE BOM
		return decodeUTF16BE(data[2:])
	}

	// Try UTF-8 first
	if utf8.Valid(data) {
		return string(data)
	}

	// Likely GBK/GB18030 — try simple GBK to UTF-8 conversion
	return decodeGBK(data)
}

// decodeGBK converts GBK/GB18030-encoded bytes to UTF-8 string.
// Uses golang.org/x/text/encoding/simplifiedchinese for accurate decoding.
func decodeGBK(data []byte) string {
	// Try GB18030 first (superset of GBK, handles more characters)
	reader := transform.NewReader(bytes.NewReader(data), simplifiedchinese.GB18030.NewDecoder())
	decoded, err := readAll(reader)
	if err == nil {
		return decoded
	}

	// Fallback: try GBK decoder
	reader = transform.NewReader(bytes.NewReader(data), simplifiedchinese.GBK.NewDecoder())
	decoded, err = readAll(reader)
	if err == nil {
		return decoded
	}

	// Last resort: replace non-UTF8 bytes with replacement character
	var buf strings.Builder
	for i := 0; i < len(data); {
		r, size := utf8.DecodeRune(data[i:])
		if r == utf8.RuneError && size <= 1 {
			buf.WriteRune(0xFFFD)
			i++
		} else {
			buf.WriteRune(r)
			i += size
		}
	}
	return buf.String()
}

// readAll reads all bytes from a transform.Reader and returns as string.
func readAll(r *transform.Reader) (string, error) {
	var buf bytes.Buffer
	_, err := buf.ReadFrom(r)
	if err != nil {
		return "", err
	}
	return buf.String(), nil
}

// decodeUTF16LE decodes UTF-16 Little Endian bytes to string.
func decodeUTF16LE(data []byte) string {
	var buf strings.Builder
	for i := 0; i+1 < len(data); i += 2 {
		r := rune(data[i]) | rune(data[i+1])<<8
		if r >= 0xD800 && r <= 0xDBFF && i+3 < len(data) {
			// Surrogate pair
			lo := rune(data[i+2]) | rune(data[i+3])<<8
			if lo >= 0xDC00 && lo <= 0xDFFF {
				r = (r-0xD800)*0x400 + (lo - 0xDC00) + 0x10000
				i += 2
			}
		}
		buf.WriteRune(r)
	}
	return buf.String()
}

// decodeUTF16BE decodes UTF-16 Big Endian bytes to string.
func decodeUTF16BE(data []byte) string {
	var buf strings.Builder
	for i := 0; i+1 < len(data); i += 2 {
		r := rune(data[i])<<8 | rune(data[i+1])
		if r >= 0xD800 && r <= 0xDBFF && i+3 < len(data) {
			lo := rune(data[i+2])<<8 | rune(data[i+3])
			if lo >= 0xDC00 && lo <= 0xDFFF {
				r = (r-0xD800)*0x400 + (lo - 0xDC00) + 0x10000
				i += 2
			}
		}
		buf.WriteRune(r)
	}
	return buf.String()
}

// ============================================================
// Chapter splitting logic
// ============================================================

// splitIntoChapterMetas scans text and returns chapter metadata with byte offsets.
// This avoids duplicating the entire text content in memory.
// NOTE: text must already have normalized line endings (\n only).
func splitIntoChapterMetas(text string) []txtChapterMeta {
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024) // 10MB max line

	// Phase 1: quick scan to count chapter markers
	chapterCount := 0
	lineCount := 0
	for scanner.Scan() {
		lineCount++
		if isChapterTitle(scanner.Text()) {
			chapterCount++
		}
	}

	if lineCount == 0 {
		return []txtChapterMeta{{title: "全文", byteOffset: 0, byteLength: len(text)}}
	}

	// If too few chapter markers, fall back to fixed-size pages
	if chapterCount < 2 {
		return splitBySizeMetas(text)
	}

	// Phase 2: split by chapter markers, recording byte offsets
	scanner2 := bufio.NewScanner(strings.NewReader(text))
	scanner2.Buffer(make([]byte, 1024*1024), 10*1024*1024)

	metas := make([]txtChapterMeta, 0, chapterCount+1)
	var currentTitle string
	currentOffset := 0 // byte offset where current chapter started
	pos := 0           // current byte position in text

	for scanner2.Scan() {
		line := scanner2.Text()
		lineLen := len(line) + 1 // +1 for the \n that scanner stripped

		if isChapterTitle(line) {
			// Save previous chapter
			chunkLen := pos - currentOffset
			if chunkLen > 0 || currentTitle != "" {
				title := currentTitle
				if title == "" {
					title = "前言"
				}
				if chunkLen > 0 {
					metas = append(metas, txtChapterMeta{
						title:      title,
						byteOffset: currentOffset,
						byteLength: chunkLen,
					})
				}
			}
			currentTitle = strings.TrimSpace(line)
			currentOffset = pos
		}
		pos += lineLen
	}

	// Last chapter
	chunkLen := len(text) - currentOffset
	if chunkLen > 0 {
		title := currentTitle
		if title == "" {
			title = "正文"
		}
		metas = append(metas, txtChapterMeta{
			title:      title,
			byteOffset: currentOffset,
			byteLength: chunkLen,
		})
	}

	if len(metas) == 0 {
		return splitBySizeMetas(text)
	}

	return metas
}

func isChapterTitle(line string) bool {
	trimmed := strings.TrimSpace(line)
	if len(trimmed) == 0 || len(trimmed) > 80 {
		return false
	}

	// Fast path: check first non-space character to avoid regex on most lines.
	// Chapter titles typically start with: 第, 章, 节, 卷, C/c (Chapter), P/p (Part), digit, =, —, –
	firstByte := trimmed[0]
	firstRune, _ := utf8.DecodeRuneInString(trimmed)

	isMaybeChapter := false
	switch {
	case firstByte >= '0' && firstByte <= '9':
		isMaybeChapter = true
	case firstByte == '=' || firstByte == '-':
		isMaybeChapter = true
	case firstByte == 'c' || firstByte == 'C' || firstByte == 'p' || firstByte == 'P':
		isMaybeChapter = true
	case firstRune == '第' || firstRune == '章' || firstRune == '节' || firstRune == '卷':
		isMaybeChapter = true
	case firstRune == '＝' || firstRune == '—' || firstRune == '–':
		isMaybeChapter = true
	}

	if !isMaybeChapter {
		return false
	}

	for _, p := range chapterPatterns {
		if p.MatchString(trimmed) {
			return true
		}
	}
	return false
}

// splitBySizeMetas splits text into fixed-size virtual pages, returning metadata.
func splitBySizeMetas(text string) []txtChapterMeta {
	if len(text) == 0 {
		return []txtChapterMeta{{title: "空文件", byteOffset: 0, byteLength: 0}}
	}

	var metas []txtChapterMeta
	pageNum := 1
	bytePos := 0
	textLen := len(text)

	for bytePos < textLen {
		// Target: ~defaultCharsPerPage chars. For UTF-8 Chinese text, ~3 bytes/char.
		// Use a rough byte estimate then find a good break point.
		targetBytes := defaultCharsPerPage * 3
		endPos := bytePos + targetBytes
		if endPos > textLen {
			endPos = textLen
		}

		// Try to break at a newline boundary near the end
		if endPos < textLen {
			bestBreak := -1
			searchStart := bytePos + targetBytes/2
			if searchStart < bytePos {
				searchStart = bytePos
			}
			for i := endPos; i > searchStart; i-- {
				if text[i] == '\n' {
					bestBreak = i + 1
					break
				}
			}
			if bestBreak > bytePos {
				endPos = bestBreak
			}
		}

		metas = append(metas, txtChapterMeta{
			title:      fmt.Sprintf("第 %d 页", pageNum),
			byteOffset: bytePos,
			byteLength: endPos - bytePos,
		})
		pageNum++
		bytePos = endPos
	}

	return metas
}

// GetTxtChapterTitles returns chapter titles for a TXT file.
// Used by the pages API to provide chapter names to the frontend.
func GetTxtChapterTitles(r Reader) []string {
	if tr, ok := r.(*txtReader); ok {
		titles := make([]string, len(tr.chapters))
		for i, ch := range tr.chapters {
			titles[i] = ch.title
		}
		return titles
	}
	return nil
}

// ExtractChapterByIndex returns chapter content in O(1) without scanning entries.
func (r *txtReader) ExtractChapterByIndex(index int) ([]byte, error) {
	if index < 0 || index >= len(r.chapters) {
		return nil, fmt.Errorf("chapter index %d out of range", index)
	}
	meta := r.chapters[index]
	content := r.text[meta.byteOffset : meta.byteOffset+meta.byteLength]
	return []byte(strings.TrimSpace(content)), nil
}

// ChapterTitleByIndex returns the chapter title at index in O(1).
func (r *txtReader) ChapterTitleByIndex(index int) string {
	if index < 0 || index >= len(r.chapters) {
		return ""
	}
	return r.chapters[index].title
}

// ChapterCount returns the total parsed chapter count.
func (r *txtReader) ChapterCount() int {
	return len(r.chapters)
}

// ExtractTxtChapterByIndex extracts a TXT chapter by index in O(1) when r is a txtReader.
func ExtractTxtChapterByIndex(r Reader, index int) (content string, title string, ok bool) {
	tr, isTxt := r.(*txtReader)
	if !isTxt {
		return "", "", false
	}
	data, err := tr.ExtractChapterByIndex(index)
	if err != nil {
		return "", "", false
	}
	return string(data), tr.ChapterTitleByIndex(index), true
}
