package archive

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"regexp"
	"strings"
)

// ============================================================
// EPUB Reader (pure Go — EPUB is a ZIP with XHTML content)
// ============================================================

type epubChapter struct {
	title       string
	href        string // path inside the EPUB zip
	content     string // extracted text content (plain text fallback)
	htmlContent string // sanitized HTML content for rich rendering
}

type epubReader struct {
	filepath  string
	comicID   string // populated later for image URL rewriting
	rc        *zip.ReadCloser
	chapters  []epubChapter
	entries   []Entry
	coverPath string // path to cover image inside the EPUB
	resources map[string]bool
}

// OPF package document structures
type opfPackage struct {
	XMLName  xml.Name    `xml:"package"`
	Metadata opfMetadata `xml:"metadata"`
	Manifest opfManifest `xml:"manifest"`
	Spine    opfSpine    `xml:"spine"`
}

type opfMetadata struct {
	Title       string   `xml:"title"`
	Creator     string   `xml:"creator"`
	Publisher   string   `xml:"publisher"`
	Description string   `xml:"description"`
	Language    string   `xml:"language"`
	Date        string   `xml:"date"`
	Subjects    []string `xml:"subject"`
	Identifiers []struct {
		Value  string `xml:",chardata"`
		Scheme string `xml:"scheme,attr"`
	} `xml:"identifier"`
}

type opfManifest struct {
	Items []opfItem `xml:"item"`
}

type opfItem struct {
	ID        string `xml:"id,attr"`
	Href      string `xml:"href,attr"`
	MediaType string `xml:"media-type,attr"`
	Props     string `xml:"properties,attr"`
}

type opfSpine struct {
	ItemRefs []opfItemRef `xml:"itemref"`
}

type opfItemRef struct {
	IDRef string `xml:"idref,attr"`
}

// container.xml structure
type epubContainer struct {
	XMLName   xml.Name       `xml:"container"`
	RootFiles []epubRootFile `xml:"rootfiles>rootfile"`
}

type epubRootFile struct {
	FullPath  string `xml:"full-path,attr"`
	MediaType string `xml:"media-type,attr"`
}

func newEpubReader(fp string) (*epubReader, error) {
	rc, err := zip.OpenReader(fp)
	if err != nil {
		return nil, fmt.Errorf("open epub %s: %w", fp, err)
	}

	r := &epubReader{
		filepath:  fp,
		rc:        rc,
		resources: make(map[string]bool),
	}

	if err := r.parseEpub(); err != nil {
		rc.Close()
		return nil, fmt.Errorf("parse epub %s: %w", fp, err)
	}

	return r, nil
}

func (r *epubReader) parseEpub() error {
	// Step 1: Find the OPF file path from META-INF/container.xml
	opfPath, err := r.findOPFPath()
	if err != nil {
		return err
	}

	opfDir := path.Dir(opfPath)
	if opfDir == "." {
		opfDir = ""
	}

	// Step 2: Parse the OPF file
	opfData, err := r.readZipFile(opfPath)
	if err != nil {
		return fmt.Errorf("read OPF: %w", err)
	}

	var pkg opfPackage
	if err := xml.Unmarshal(opfData, &pkg); err != nil {
		return fmt.Errorf("parse OPF: %w", err)
	}

	// Build manifest ID → item map
	manifestMap := make(map[string]opfItem, len(pkg.Manifest.Items))
	for _, item := range pkg.Manifest.Items {
		manifestMap[item.ID] = item
		// Track all resources
		href := item.Href
		if opfDir != "" {
			href = opfDir + "/" + href
		}
		r.resources[href] = true

		// Find cover image
		if item.Props == "cover-image" ||
			strings.Contains(strings.ToLower(item.ID), "cover") &&
				strings.HasPrefix(item.MediaType, "image/") {
			if r.coverPath == "" {
				r.coverPath = href
			}
		}
	}

	// Step 3: Get reading order from spine
	var chapterHrefs []string
	for _, ref := range pkg.Spine.ItemRefs {
		if item, ok := manifestMap[ref.IDRef]; ok {
			if strings.HasPrefix(item.MediaType, "application/xhtml") ||
				strings.HasPrefix(item.MediaType, "text/html") {
				href := item.Href
				if opfDir != "" {
					href = opfDir + "/" + href
				}
				chapterHrefs = append(chapterHrefs, href)
			}
		}
	}

	if len(chapterHrefs) == 0 {
		return fmt.Errorf("no chapters found in EPUB spine")
	}

	// Step 4: Extract each chapter's text content
	r.chapters = make([]epubChapter, 0, len(chapterHrefs))
	r.entries = make([]Entry, 0, len(chapterHrefs))

	for i, href := range chapterHrefs {
		data, err := r.readZipFile(href)
		if err != nil {
			continue
		}

		rawHTML := string(data)
		textContent := extractTextFromXHTML(rawHTML)
		if len(strings.TrimSpace(textContent)) == 0 {
			continue
		}

		// Sanitize HTML: keep formatting tags, rewrite image src to API URLs
		chapterDir := path.Dir(href)
		htmlContent := sanitizeEpubHTML(rawHTML, chapterDir)

		title := extractXHTMLTitle(rawHTML)
		if title == "" {
			title = fmt.Sprintf("第 %d 章", i+1)
		}

		entryName := fmt.Sprintf("chapter-%04d.html", i+1)
		r.chapters = append(r.chapters, epubChapter{
			title:       title,
			href:        href,
			content:     textContent,
			htmlContent: htmlContent,
		})
		r.entries = append(r.entries, Entry{
			Name:        entryName,
			IsDirectory: false,
		})
	}

	if len(r.chapters) == 0 {
		return fmt.Errorf("no readable chapters in EPUB")
	}

	return nil
}

func (r *epubReader) findOPFPath() (string, error) {
	data, err := r.readZipFile("META-INF/container.xml")
	if err != nil {
		// Fallback: search for .opf file directly
		for _, f := range r.rc.File {
			if strings.HasSuffix(strings.ToLower(f.Name), ".opf") {
				return f.Name, nil
			}
		}
		return "", fmt.Errorf("no container.xml or .opf file found")
	}

	var container epubContainer
	if err := xml.Unmarshal(data, &container); err != nil {
		return "", fmt.Errorf("parse container.xml: %w", err)
	}

	for _, rf := range container.RootFiles {
		if rf.MediaType == "application/oebps-package+xml" || strings.HasSuffix(rf.FullPath, ".opf") {
			return rf.FullPath, nil
		}
	}

	if len(container.RootFiles) > 0 {
		return container.RootFiles[0].FullPath, nil
	}

	return "", fmt.Errorf("no rootfile found in container.xml")
}

func (r *epubReader) readZipFile(name string) ([]byte, error) {
	for _, f := range r.rc.File {
		if f.Name == name {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, fmt.Errorf("file not found in EPUB: %s", name)
}

func (r *epubReader) ListEntries() []Entry {
	return r.entries
}

func (r *epubReader) ExtractEntry(entryName string) ([]byte, error) {
	for i, e := range r.entries {
		if e.Name == entryName {
			ch := r.chapters[i]
			if ch.htmlContent != "" {
				html := ch.htmlContent
				// Rewrite image src to API URLs if comicID is set
				if r.comicID != "" {
					html = r.rewriteImageURLs(html)
				}
				return []byte(html), nil
			}
			return []byte(ch.content), nil
		}
	}

	// Also allow extracting raw resources (images, CSS)
	for _, f := range r.rc.File {
		if f.Name == entryName {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}

	return nil, fmt.Errorf("entry not found in epub: %s", entryName)
}

// ExtractEntryText returns the plain text content of a chapter (no HTML).
func (r *epubReader) ExtractEntryText(entryName string) ([]byte, error) {
	for i, e := range r.entries {
		if e.Name == entryName {
			return []byte(r.chapters[i].content), nil
		}
	}
	return nil, fmt.Errorf("entry not found in epub: %s", entryName)
}

// SetComicID sets the comic ID for image URL rewriting.
func (r *epubReader) SetComicID(id string) {
	r.comicID = id
}

// rewriteImageURLs replaces relative image paths in HTML with API URLs.
func (r *epubReader) rewriteImageURLs(html string) string {
	imgSrcRegex := regexp.MustCompile(`(<img[^>]*\s+src\s*=\s*")([^"]+)(")`)
	return imgSrcRegex.ReplaceAllStringFunc(html, func(match string) string {
		parts := imgSrcRegex.FindStringSubmatch(match)
		if len(parts) < 4 {
			return match
		}
		src := parts[2]
		// Skip external URLs and data URIs
		if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") || strings.HasPrefix(src, "data:") {
			return match
		}
		// Convert to API URL: /api/comics/{comicID}/epub-resource/{resourcePath}
		return parts[1] + "/api/comics/" + r.comicID + "/epub-resource/" + src + parts[3]
	})
}

// GetResourceData extracts a raw resource from the EPUB by its internal path.
func (r *epubReader) GetResourceData(resourcePath string) ([]byte, string, error) {
	// Try exact path first
	data, err := r.readZipFile(resourcePath)
	if err == nil {
		mime := GetMimeType(resourcePath)
		return data, mime, nil
	}

	// Try with common prefixes
	prefixes := []string{"OEBPS/", "OPS/", "EPUB/", "content/"}
	for _, prefix := range prefixes {
		data, err = r.readZipFile(prefix + resourcePath)
		if err == nil {
			mime := GetMimeType(resourcePath)
			return data, mime, nil
		}
	}

	return nil, "", fmt.Errorf("resource not found in EPUB: %s", resourcePath)
}

func (r *epubReader) Close() {
	if r.rc != nil {
		r.rc.Close()
	}
}

// GetCoverImage extracts the cover image from the EPUB.
func (r *epubReader) GetCoverImage() ([]byte, error) {
	if r.coverPath == "" {
		// Try common cover paths
		candidates := []string{
			"cover.jpg", "cover.jpeg", "cover.png",
			"images/cover.jpg", "images/cover.jpeg", "images/cover.png",
			"OEBPS/cover.jpg", "OEBPS/images/cover.jpg",
			"OEBPS/cover.jpeg", "OEBPS/images/cover.jpeg",
			"OEBPS/cover.png", "OEBPS/images/cover.png",
		}
		for _, c := range candidates {
			if data, err := r.readZipFile(c); err == nil {
				return data, nil
			}
		}

		// Search for any image with "cover" in the name
		for _, f := range r.rc.File {
			lower := strings.ToLower(f.Name)
			if strings.Contains(lower, "cover") &&
				(strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") ||
					strings.HasSuffix(lower, ".png")) {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				data, err := io.ReadAll(rc)
				rc.Close()
				if err == nil {
					return data, nil
				}
			}
		}

		return nil, fmt.Errorf("no cover image found in EPUB")
	}

	return r.readZipFile(r.coverPath)
}

// ============================================================
// XHTML text extraction utilities
// ============================================================

// Regex patterns for HTML tag removal
var (
	htmlTagRegex    = regexp.MustCompile(`<[^>]+>`)
	htmlEntityRegex = regexp.MustCompile(`&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;`)
	multiSpaceRegex = regexp.MustCompile(`[ \t]+`)
	multiNewline    = regexp.MustCompile(`\n{3,}`)
)

// sanitizeEpubHTML cleans XHTML content for safe rendering:
//   - Removes <script>, <style>, <head>, <meta>, <link> blocks
//   - Extracts only <body> content
//   - Keeps safe formatting tags: p, div, h1-h6, span, em, strong, b, i, u, br, img,
//     ul, ol, li, blockquote, a, table, tr, td, th, pre, code, sup, sub, hr, figure, figcaption
//   - Resolves relative image paths using chapterDir
func sanitizeEpubHTML(rawHTML string, chapterDir string) string {
	// Extract body content if present
	bodyRegex := regexp.MustCompile(`(?is)<body[^>]*>(.*)</body>`)
	if m := bodyRegex.FindStringSubmatch(rawHTML); len(m) > 1 {
		rawHTML = m[1]
	}

	// Remove script, style, head, meta, link, title, noscript blocks
	for _, tag := range []string{"script", "style", "head", "meta", "link", "title", "noscript"} {
		re := regexp.MustCompile(`(?is)<` + tag + `[^>]*>.*?</` + tag + `>`)
		rawHTML = re.ReplaceAllString(rawHTML, "")
	}
	html := rawHTML
	// Also remove self-closing meta/link
	selfCloseRegex := regexp.MustCompile(`(?i)<(meta|link)[^>]*/?>`)
	html = selfCloseRegex.ReplaceAllString(html, "")

	// Remove all class and style attributes (they reference EPUB CSS we don't load)
	attrRegex := regexp.MustCompile(`\s+(class|style|id|epub:type|xmlns[^=]*)\s*=\s*"[^"]*"`)
	html = attrRegex.ReplaceAllString(html, "")
	attrRegex2 := regexp.MustCompile(`\s+(class|style|id|epub:type|xmlns[^=]*)\s*=\s*'[^']*'`)
	html = attrRegex2.ReplaceAllString(html, "")

	// Remove XML declarations and processing instructions
	xmlDeclRegex := regexp.MustCompile(`<\?[^?]*\?>`)
	html = xmlDeclRegex.ReplaceAllString(html, "")

	// Resolve relative image src paths to full EPUB-internal paths
	if chapterDir != "" && chapterDir != "." {
		imgResolveRegex := regexp.MustCompile(`(<img[^>]*\s+src\s*=\s*")([^"]+)(")`)
		html = imgResolveRegex.ReplaceAllStringFunc(html, func(match string) string {
			parts := imgResolveRegex.FindStringSubmatch(match)
			if len(parts) < 4 {
				return match
			}
			src := parts[2]
			// Skip absolute/external URLs
			if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") || strings.HasPrefix(src, "data:") || strings.HasPrefix(src, "/") {
				return match
			}
			// Resolve relative path: ../images/foo.png -> OEBPS/images/foo.png
			resolved := path.Join(chapterDir, src)
			return parts[1] + resolved + parts[3]
		})
	}

	// Decode common HTML entities
	html = decodeHTMLEntities(html)

	// Clean up excessive whitespace
	html = multiNewline.ReplaceAllString(html, "\n\n")

	return strings.TrimSpace(html)
}

// GetEpubResourceData extracts a resource (image, etc.) from an EPUB Reader.
func GetEpubResourceData(r Reader, resourcePath string) ([]byte, string, error) {
	if er, ok := r.(*epubReader); ok {
		return er.GetResourceData(resourcePath)
	}
	return nil, "", fmt.Errorf("not an EPUB reader")
}

// SetEpubComicID sets the comic ID on an EPUB reader for image URL rewriting.
func SetEpubComicID(r Reader, comicID string) {
	if er, ok := r.(*epubReader); ok {
		er.SetComicID(comicID)
	}
}

// extractTextFromXHTML extracts readable text from XHTML/HTML content.
func extractTextFromXHTML(html string) string {
	// Remove script and style blocks
	text := html
	for _, tag := range []string{"script", "style"} {
		re := regexp.MustCompile(`(?is)<` + tag + `[^>]*>.*?</` + tag + `>`)
		text = re.ReplaceAllString(text, "")
	}

	// Replace <br>, <p>, <div>, <h*> with newlines for paragraph separation
	blockTagRegex := regexp.MustCompile(`(?i)<(?:br|p|div|h[1-6]|li|tr|blockquote)[^>]*/?>`)
	text = blockTagRegex.ReplaceAllString(text, "\n")

	closingBlockRegex := regexp.MustCompile(`(?i)</(?:p|div|h[1-6]|li|tr|blockquote)>`)
	text = closingBlockRegex.ReplaceAllString(text, "\n")

	// Remove all remaining HTML tags
	text = htmlTagRegex.ReplaceAllString(text, "")

	// Decode common HTML entities
	text = decodeHTMLEntities(text)

	// Clean up whitespace
	text = multiSpaceRegex.ReplaceAllString(text, " ")
	text = multiNewline.ReplaceAllString(text, "\n\n")

	return strings.TrimSpace(text)
}

// extractXHTMLTitle extracts the <title> or first <h1> from XHTML.
func extractXHTMLTitle(html string) string {
	// Try <title> tag
	titleRegex := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	if m := titleRegex.FindStringSubmatch(html); len(m) > 1 {
		title := strings.TrimSpace(htmlTagRegex.ReplaceAllString(m[1], ""))
		if title != "" {
			return decodeHTMLEntities(title)
		}
	}

	// Try <h1>, <h2>, <h3>
	for _, tag := range []string{"h1", "h2", "h3"} {
		hRegex := regexp.MustCompile(fmt.Sprintf(`(?is)<%s[^>]*>(.*?)</%s>`, tag, tag))
		if m := hRegex.FindStringSubmatch(html); len(m) > 1 {
			title := strings.TrimSpace(htmlTagRegex.ReplaceAllString(m[1], ""))
			if title != "" {
				return decodeHTMLEntities(title)
			}
		}
	}

	return ""
}

func decodeHTMLEntities(s string) string {
	replacer := strings.NewReplacer(
		"&amp;", "&",
		"&lt;", "<",
		"&gt;", ">",
		"&quot;", `"`,
		"&apos;", "'",
		"&#39;", "'",
		"&nbsp;", " ",
		"&mdash;", "—",
		"&ndash;", "–",
		"&hellip;", "…",
		"&laquo;", "«",
		"&raquo;", "»",
		"&ldquo;", "\u201C",
		"&rdquo;", "\u201D",
		"&lsquo;", "\u2018",
		"&rsquo;", "\u2019",
		"&copy;", "©",
	)
	return replacer.Replace(s)
}

// GetEpubChapterTitles returns chapter titles for an EPUB file.
func GetEpubChapterTitles(r Reader) []string {
	if er, ok := r.(*epubReader); ok {
		titles := make([]string, len(er.chapters))
		for i, ch := range er.chapters {
			titles[i] = ch.title
		}
		return titles
	}
	return nil
}

// GetEpubCoverImage extracts the cover image from an EPUB Reader.
func GetEpubCoverImage(r Reader) ([]byte, error) {
	if er, ok := r.(*epubReader); ok {
		return er.GetCoverImage()
	}
	return nil, fmt.Errorf("not an EPUB reader")
}

// EpubOPFMetadata 从 EPUB 文件的 OPF 中提取的元数据
type EpubOPFMetadata struct {
	Title       string
	Author      string
	Publisher   string
	Description string
	Language    string
	Date        string // 出版日期，格式如 "2023" 或 "2023-01-15"
	Genre       string // 由 subject 拼接
	ISBN        string // 从 identifier 中提取的 ISBN
}

// ExtractEpubOPFMetadata 从 EPUB 文件中提取 OPF 元数据，不需要完整解析章节内容。
// 适用于小说刮削时快速提取本地元数据。
func ExtractEpubOPFMetadata(filePath string) (*EpubOPFMetadata, error) {
	rc, err := zip.OpenReader(filePath)
	if err != nil {
		return nil, fmt.Errorf("open epub %s: %w", filePath, err)
	}
	defer rc.Close()

	// 查找 OPF 文件路径
	opfPath := ""

	// 先尝试从 container.xml 获取
	for _, f := range rc.File {
		if f.Name == "META-INF/container.xml" {
			data, err := readZipEntry(f)
			if err == nil {
				var container epubContainer
				if err := xml.Unmarshal(data, &container); err == nil {
					for _, rf := range container.RootFiles {
						if rf.MediaType == "application/oebps-package+xml" || strings.HasSuffix(rf.FullPath, ".opf") {
							opfPath = rf.FullPath
							break
						}
					}
					if opfPath == "" && len(container.RootFiles) > 0 {
						opfPath = container.RootFiles[0].FullPath
					}
				}
			}
			break
		}
	}

	// 兜底：直接搜索 .opf 文件
	if opfPath == "" {
		for _, f := range rc.File {
			if strings.HasSuffix(strings.ToLower(f.Name), ".opf") {
				opfPath = f.Name
				break
			}
		}
	}

	if opfPath == "" {
		return nil, fmt.Errorf("no OPF file found in EPUB")
	}

	// 读取 OPF 文件
	var opfData []byte
	for _, f := range rc.File {
		if f.Name == opfPath {
			opfData, err = readZipEntry(f)
			if err != nil {
				return nil, fmt.Errorf("read OPF: %w", err)
			}
			break
		}
	}
	if opfData == nil {
		return nil, fmt.Errorf("OPF file not found: %s", opfPath)
	}

	// 解析 OPF
	var pkg opfPackage
	if err := xml.Unmarshal(opfData, &pkg); err != nil {
		return nil, fmt.Errorf("parse OPF: %w", err)
	}

	meta := &EpubOPFMetadata{
		Title:       strings.TrimSpace(pkg.Metadata.Title),
		Author:      strings.TrimSpace(pkg.Metadata.Creator),
		Publisher:   strings.TrimSpace(pkg.Metadata.Publisher),
		Description: strings.TrimSpace(pkg.Metadata.Description),
		Language:    strings.TrimSpace(pkg.Metadata.Language),
		Date:        strings.TrimSpace(pkg.Metadata.Date),
	}

	// 提取 genre（从 subject 标签）
	var subjects []string
	for _, s := range pkg.Metadata.Subjects {
		s = strings.TrimSpace(s)
		if s != "" {
			subjects = append(subjects, s)
		}
	}
	if len(subjects) > 0 {
		meta.Genre = strings.Join(subjects, ", ")
	}

	// 提取 ISBN
	for _, id := range pkg.Metadata.Identifiers {
		scheme := strings.ToLower(id.Scheme)
		value := strings.TrimSpace(id.Value)
		if scheme == "isbn" || strings.Contains(value, "978") || strings.Contains(value, "979") {
			// 清理 ISBN 中的非数字字符（保留 X）
			cleaned := ""
			for _, ch := range value {
				if (ch >= '0' && ch <= '9') || ch == 'X' || ch == 'x' {
					cleaned += string(ch)
				}
			}
			if len(cleaned) == 10 || len(cleaned) == 13 {
				meta.ISBN = cleaned
				break
			}
		}
	}

	return meta, nil
}

// readZipEntry 读取 zip 文件中的一个条目
func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}
