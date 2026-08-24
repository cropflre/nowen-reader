package archive

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"
)

const maxCustomChapterTitleLength = 512

// NewTxtReaderWithPattern creates a TXT reader whose chapter boundaries are
// detected with a user-supplied Go/RE2 regular expression. The original TXT
// file is never modified. When fewer than two headings are matched, the reader
// keeps the existing fixed-size fallback behavior.
func NewTxtReaderWithPattern(fp, pattern string) (Reader, error) {
	if strings.TrimSpace(pattern) == "" {
		return nil, fmt.Errorf("chapter pattern cannot be empty")
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid chapter pattern: %w", err)
	}

	text, err := readNormalizedTxt(fp)
	if err != nil {
		return nil, err
	}
	chapters := splitIntoChapterMetasWithPattern(text, re)
	r := &txtReader{
		filepath: fp,
		text:     text,
		chapters: chapters,
		entries:  make([]Entry, len(chapters)),
	}
	for i := range chapters {
		r.entries[i] = Entry{
			Name:        fmt.Sprintf("chapter-%04d.txt", i+1),
			IsDirectory: false,
		}
	}
	return r, nil
}

// PreviewTxtChapterPattern scans a TXT file with a candidate rule without
// changing any persisted book setting. It returns the exact number of matched
// headings and at most limit titles for UI preview.
func PreviewTxtChapterPattern(fp, pattern string, limit int) (int, []string, error) {
	if strings.TrimSpace(pattern) == "" {
		return 0, nil, fmt.Errorf("chapter pattern cannot be empty")
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return 0, nil, fmt.Errorf("invalid chapter pattern: %w", err)
	}
	text, err := readNormalizedTxt(fp)
	if err != nil {
		return 0, nil, err
	}
	if limit <= 0 {
		limit = 20
	}

	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
	count := 0
	titles := make([]string, 0, limit)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if customChapterTitleMatches(line, re) {
			count++
			if len(titles) < limit {
				titles = append(titles, line)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, nil, err
	}
	return count, titles, nil
}

func readNormalizedTxt(fp string) (string, error) {
	data, err := os.ReadFile(fp)
	if err != nil {
		return "", fmt.Errorf("read txt %s: %w", fp, err)
	}
	text := detectAndDecodeText(data)
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return text, nil
}

func customChapterTitleMatches(line string, re *regexp.Regexp) bool {
	if line == "" || len(line) > maxCustomChapterTitleLength {
		return false
	}
	return re.MatchString(line)
}

func splitIntoChapterMetasWithPattern(text string, re *regexp.Regexp) []txtChapterMeta {
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)

	chapterCount := 0
	lineCount := 0
	for scanner.Scan() {
		lineCount++
		if customChapterTitleMatches(strings.TrimSpace(scanner.Text()), re) {
			chapterCount++
		}
	}
	if lineCount == 0 {
		return []txtChapterMeta{{title: "全文", byteOffset: 0, byteLength: len(text)}}
	}
	if chapterCount < 2 {
		return splitBySizeMetas(text)
	}

	scanner = bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
	metas := make([]txtChapterMeta, 0, chapterCount+1)
	currentTitle := ""
	currentOffset := 0
	pos := 0

	for scanner.Scan() {
		line := scanner.Text()
		lineLen := len(line) + 1
		if customChapterTitleMatches(strings.TrimSpace(line), re) {
			chunkLen := pos - currentOffset
			if chunkLen > 0 || currentTitle != "" {
				title := currentTitle
				if title == "" {
					title = "前言"
				}
				if chunkLen > 0 {
					metas = append(metas, txtChapterMeta{title: title, byteOffset: currentOffset, byteLength: chunkLen})
				}
			}
			currentTitle = strings.TrimSpace(line)
			currentOffset = pos
		}
		pos += lineLen
	}

	chunkLen := len(text) - currentOffset
	if chunkLen > 0 {
		title := currentTitle
		if title == "" {
			title = "正文"
		}
		metas = append(metas, txtChapterMeta{title: title, byteOffset: currentOffset, byteLength: chunkLen})
	}
	if len(metas) == 0 {
		return splitBySizeMetas(text)
	}
	return metas
}
