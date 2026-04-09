package service

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/archive"
)

func ParseComicInfoXML(xmlContent string) *ComicMetadata {
	m := &ComicMetadata{Source: "comicinfo"}

	getValue := func(tag string) string {
		re := regexp.MustCompile(`(?i)<` + tag + `>([^<]*)</` + tag + `>`)
		matches := re.FindStringSubmatch(xmlContent)
		if len(matches) > 1 {
			return strings.TrimSpace(matches[1])
		}
		return ""
	}

	m.Title = getValue("Title")
	author := getValue("Writer")
	if author == "" {
		author = getValue("Author")
	}
	m.Author = author
	m.Publisher = getValue("Publisher")
	m.Description = getValue("Summary")
	m.Language = getValue("LanguageISO")
	m.Genre = getValue("Genre")

	if y := getValue("Year"); y != "" {
		var year int
		if _, err := fmt.Sscanf(y, "%d", &year); err == nil {
			m.Year = &year
		}
	}

	return m
}

// ExtractComicInfoFromArchive tries to extract ComicInfo.xml from an archive.
func ExtractComicInfoFromArchive(archivePath string) (*ComicMetadata, error) {
	reader, err := archive.NewReader(archivePath)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	entries := reader.ListEntries()

	for _, e := range entries {
		lower := strings.ToLower(e.Name)
		if lower == "comicinfo.xml" || strings.HasSuffix(lower, "/comicinfo.xml") {
			data, err := reader.ExtractEntry(e.Name)
			if err != nil {
				return nil, err
			}
			return ParseComicInfoXML(string(data)), nil
		}
	}
	return nil, nil
}

// ============================================================
// EPUB OPF metadata extraction (小说专用)
// ============================================================

// ExtractEpubMetadata 从 EPUB 文件中提取 OPF 元数据，转换为 ComicMetadata。
// 支持提取 title、author、publisher、description、language、date、genre（subject）。
func ExtractEpubMetadata(filePath string) (*ComicMetadata, error) {
	epubMeta, err := archive.ExtractEpubOPFMetadata(filePath)
	if err != nil {
		return nil, err
	}

	// 至少需要标题才认为有效
	if epubMeta.Title == "" {
		return nil, nil
	}

	m := &ComicMetadata{
		Title:       epubMeta.Title,
		Author:      epubMeta.Author,
		Publisher:   epubMeta.Publisher,
		Description: epubMeta.Description,
		Language:    epubMeta.Language,
		Genre:       epubMeta.Genre,
		Source:      "epub_opf",
	}

	// 从日期中提取年份
	if epubMeta.Date != "" {
		var year int
		if _, err := fmt.Sscanf(epubMeta.Date, "%d", &year); err == nil && year > 0 {
			m.Year = &year
		}
	}

	return m, nil
}

// ============================================================
// Filename → search query extraction
// ============================================================

var (
	// bracketRe 匹配 [] 【】 () （） {} 及其内容，整体替换为空格
	bracketRe = regexp.MustCompile(`[\[【\(（{][^\]】\)）}]*[\]】\)）}]`)
	// bookTitleRe 仅去掉中文书名号 《》 符号本身，保留里面的内容
	bookTitleRe  = regexp.MustCompile(`[《》]`)
	volChRe      = regexp.MustCompile(`(?i)\b(v|vol|ch|c|#)\.?\s*\d+`)
	resolutionRe = regexp.MustCompile(`(?i)\b\d{3,4}[px]\b`)
	sepRe        = regexp.MustCompile(`[-_.]+`)
	spaceRe      = regexp.MustCompile(`\s+`)
)

// ExtractSearchQuery cleans a filename to derive a search query.
