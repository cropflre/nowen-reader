package archive

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	stdhtml "html"
	"io"
	"log"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"golang.org/x/net/html"
)

// ============================================================
// EPUB Reader (pure Go — EPUB is a ZIP with XHTML content)
// ============================================================

type epubChapter struct {
	title       string
	href        string // path inside the EPUB zip
	fragment    string
	level       int
	playOrder   int
	spineIndex  int
	source      string
	content     string // extracted text content (plain text fallback)
	htmlContent string // sanitized HTML content for rich rendering
}

// EpubChapterInfo describes one flattened EPUB TOC entry while preserving
// enough hierarchy metadata for clients to rebuild the navigation tree.
type EpubChapterInfo struct {
	Title       string
	Level       int
	ParentIndex int
	HasChildren bool
}

type epubChapterRef struct {
	title      string
	href       string
	fragment   string
	level      int
	playOrder  int
	spineIndex int
	source     string
}

type epubChapterPart struct {
	href          string
	startFragment string
	endFragment   string
}

type epubReader struct {
	filepath                  string
	comicID                   string // populated later for image URL rewriting
	rc                        *zip.ReadCloser
	chapters                  []epubChapter
	entries                   []Entry
	coverPath                 string // path to cover image inside the EPUB
	resources                 map[string]bool
	spineImages               []string // image paths extracted from XHTML pages in spine order (for comic mode)
	spineImageSet             map[string]bool
	stylesheetBodyBackgrounds map[string][]epubBodyBackgroundRule
}

type epubBodyBackgroundRule struct {
	requiredClasses []string
	imagePath       string
}

// OPF package document structures
type opfPackage struct {
	XMLName  xml.Name    `xml:"package"`
	Version  string      `xml:"version,attr"`
	Metadata opfMetadata `xml:"metadata"`
	Manifest opfManifest `xml:"manifest"`
	Spine    opfSpine    `xml:"spine"`
	Guide    opfGuide    `xml:"guide"`
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
	Meta []opfMeta `xml:"meta"`
}

type opfMeta struct {
	Name    string `xml:"name,attr"`
	Content string `xml:"content,attr"`
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
	Toc      string       `xml:"toc,attr"`
	ItemRefs []opfItemRef `xml:"itemref"`
}

type opfItemRef struct {
	IDRef  string `xml:"idref,attr"`
	Linear string `xml:"linear,attr"`
}

type opfGuide struct {
	References []opfGuideReference `xml:"reference"`
}

type opfGuideReference struct {
	Type string `xml:"type,attr"`
	Href string `xml:"href,attr"`
}

type ncxDocument struct {
	NavMap ncxNavMap `xml:"navMap"`
}

type ncxNavMap struct {
	NavPoints []ncxNavPoint `xml:"navPoint"`
}

type ncxNavPoint struct {
	ID       string        `xml:"id,attr"`
	Play     int           `xml:"playOrder,attr"`
	NavLabel ncxNavLabel   `xml:"navLabel"`
	Content  ncxContent    `xml:"content"`
	Children []ncxNavPoint `xml:"navPoint"`
}

type ncxNavLabel struct {
	Text string `xml:"text"`
}

type ncxContent struct {
	Src string `xml:"src,attr"`
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
		filepath:                  fp,
		rc:                        rc,
		resources:                 make(map[string]bool),
		stylesheetBodyBackgrounds: make(map[string][]epubBodyBackgroundRule),
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

	// Build manifest ID -> item map
	manifestMap := make(map[string]opfItem, len(pkg.Manifest.Items))
	for _, item := range pkg.Manifest.Items {
		manifestMap[item.ID] = item
		// Track all resources
		href, _ := resolveEpubHref(opfDir, item.Href)
		r.resources[href] = true
	}
	r.coverPath = r.findPackageCover(pkg, opfDir, manifestMap)

	// Step 3: Build spine order. It remains the content index and fallback order,
	// but EPUB nav/NCX is preferred for the visible chapter list.
	spineRefs := make([]epubChapterRef, 0, len(pkg.Spine.ItemRefs))
	spineIndexByHref := make(map[string]int, len(pkg.Spine.ItemRefs))
	for i, ref := range pkg.Spine.ItemRefs {
		if item, ok := manifestMap[ref.IDRef]; ok {
			if strings.HasPrefix(item.MediaType, "application/xhtml") ||
				strings.HasPrefix(item.MediaType, "text/html") {
				href, fragment := resolveEpubHref(opfDir, item.Href)
				if _, exists := spineIndexByHref[href]; !exists {
					spineIndexByHref[href] = i
				}
				if strings.EqualFold(ref.Linear, "no") {
					continue
				}
				spineRefs = append(spineRefs, epubChapterRef{
					href:       href,
					fragment:   fragment,
					spineIndex: i,
					source:     "spine",
				})
			}
		}
	}

	if len(spineRefs) == 0 {
		return fmt.Errorf("no chapters found in EPUB spine")
	}

	// Step 4: Prefer standard table-of-contents sources.
	chapterRefs := r.validChapterRefs(r.parseNavChapters(pkg, opfDir, spineIndexByHref))
	if len(chapterRefs) == 0 {
		chapterRefs = r.validChapterRefs(r.parseNCXChapters(pkg, opfDir, manifestMap, spineIndexByHref))
	}
	if len(chapterRefs) == 0 {
		chapterRefs = spineRefs
	}

	// Step 5: Extract chapter content. TOC entries define visible chapter
	// boundaries, while the spine supplies every XHTML document in that range.
	// This supports converted EPUBs that split a title page and its body into
	// adjacent spine documents.
	r.chapters = make([]epubChapter, 0, len(chapterRefs))
	r.entries = make([]Entry, 0, len(chapterRefs))

	for i, ref := range chapterRefs {
		parts := chapterParts(chapterRefs, spineRefs, i)
		var titleHTML string
		var textParts []string
		var htmlParts []string
		for _, part := range parts {
			data, err := r.readZipFile(part.href)
			if err != nil {
				continue
			}
			rawHTML := string(data)
			if titleHTML == "" {
				titleHTML = rawHTML
			}
			chapterHTML := sliceXHTMLByFragments(rawHTML, part.startFragment, part.endFragment)
			if textContent := strings.TrimSpace(extractTextFromXHTML(chapterHTML)); textContent != "" {
				textParts = append(textParts, textContent)
			}
			chapterDir := path.Dir(part.href)
			htmlContent := sanitizeEpubHTML(chapterHTML, chapterDir)
			if backgroundPath := r.findBodyBackgroundImage(chapterHTML, part.href); backgroundPath != "" {
				backgroundHTML := `<img src="` + stdhtml.EscapeString(backgroundPath) + `" alt="">`
				if htmlContent == "" {
					htmlContent = backgroundHTML
				} else {
					htmlContent = backgroundHTML + "\n" + htmlContent
				}
			}
			if htmlContent != "" {
				htmlParts = append(htmlParts, htmlContent)
			}
		}
		if titleHTML == "" {
			continue
		}

		title := strings.TrimSpace(ref.title)
		if title == "" {
			title = extractXHTMLTitle(titleHTML)
		}
		if title == "" {
			title = fmt.Sprintf("第 %d 章", i+1)
		}

		entryName := fmt.Sprintf("chapter-%04d.html", i+1)
		r.entries = append(r.entries, Entry{
			Name:        entryName,
			IsDirectory: false,
		})

		r.chapters = append(r.chapters, epubChapter{
			title:       title,
			href:        ref.href,
			fragment:    ref.fragment,
			level:       ref.level,
			playOrder:   ref.playOrder,
			spineIndex:  ref.spineIndex,
			source:      ref.source,
			content:     strings.Join(textParts, "\n\n"),
			htmlContent: strings.Join(htmlParts, "\n"),
		})
	}

	// Log if no chapters have text content (image-heavy EPUB)
	textChapterCount := 0
	for _, ch := range r.chapters {
		if ch.content != "" {
			textChapterCount++
		}
	}
	if textChapterCount == 0 {
		log.Printf("[epub] No text chapters in %s (image-heavy, will use comic mode)", r.filepath)
	}

	// Step 5: Extract image paths from each XHTML page in spine order.
	// This is used by comic mode to list embedded images in correct reading order
	// rather than the arbitrary zip entry order.
	r.spineImages = make([]string, 0)
	r.spineImageSet = make(map[string]bool)
	imgSrcRegex := regexp.MustCompile(`(?i)<img[^>]+src\s*=\s*"([^"]+)"`)
	svgImgRegex := regexp.MustCompile(`(?i)<image[^>]+href\s*=\s*"([^"]+)"`)
	for _, ref := range spineRefs {
		data, err := r.readZipFile(ref.href)
		if err != nil {
			log.Printf("[epub] Step5: failed to read %s: %v", ref.href, err)
			continue
		}
		html := string(data)
		chapterDir := path.Dir(ref.href)
		if backgroundPath := r.findBodyBackgroundImage(html, ref.href); backgroundPath != "" && !r.spineImageSet[backgroundPath] {
			r.spineImageSet[backgroundPath] = true
			r.spineImages = append(r.spineImages, backgroundPath)
		}

		// Extract <img src="...">
		for _, m := range imgSrcRegex.FindAllStringSubmatch(html, -1) {
			src := m[1]
			if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") || strings.HasPrefix(src, "data:") {
				continue
			}
			resolved := src
			if !strings.HasPrefix(src, "/") && chapterDir != "" && chapterDir != "." {
				resolved = path.Join(chapterDir, src)
			} else if strings.HasPrefix(src, "/") {
				resolved = strings.TrimPrefix(src, "/")
			}
			if !r.spineImageSet[resolved] {
				r.spineImageSet[resolved] = true
				r.spineImages = append(r.spineImages, resolved)
			}
		}

		// Extract <image href="..."> (SVG)
		for _, m := range svgImgRegex.FindAllStringSubmatch(html, -1) {
			src := m[1]
			if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") || strings.HasPrefix(src, "data:") {
				continue
			}
			resolved := src
			if !strings.HasPrefix(src, "/") && chapterDir != "" && chapterDir != "." {
				resolved = path.Join(chapterDir, src)
			} else if strings.HasPrefix(src, "/") {
				resolved = strings.TrimPrefix(src, "/")
			}
			if !r.spineImageSet[resolved] {
				r.spineImageSet[resolved] = true
				r.spineImages = append(r.spineImages, resolved)
			}
		}
	}

	return nil
}

func resolveEpubHref(baseDir, href string) (string, string) {
	href = strings.TrimSpace(href)
	if href == "" {
		return "", ""
	}

	filePart, fragment, _ := strings.Cut(href, "#")
	filePart, _, _ = strings.Cut(filePart, "?")
	if decoded, err := url.PathUnescape(filePart); err == nil {
		filePart = decoded
	}
	if decoded, err := url.PathUnescape(fragment); err == nil {
		fragment = decoded
	}
	filePart = strings.TrimPrefix(filePart, "/")
	if filePart == "" {
		return "", fragment
	}
	if baseDir != "" && baseDir != "." {
		filePart = path.Join(baseDir, filePart)
	}
	filePart = path.Clean(filePart)
	if filePart == "." {
		filePart = ""
	}
	return filePart, fragment
}

func (r *epubReader) findPackageCover(pkg opfPackage, opfDir string, manifestMap map[string]opfItem) string {
	for _, item := range pkg.Manifest.Items {
		if hasSpaceSeparatedToken(item.Props, "cover-image") && strings.HasPrefix(item.MediaType, "image/") {
			href, _ := resolveEpubHref(opfDir, item.Href)
			return href
		}
	}

	for _, meta := range pkg.Metadata.Meta {
		if !strings.EqualFold(strings.TrimSpace(meta.Name), "cover") {
			continue
		}
		id := strings.TrimPrefix(strings.TrimSpace(meta.Content), "#")
		if item, ok := manifestMap[id]; ok {
			if coverPath := r.coverPathFromManifestItem(item, opfDir); coverPath != "" {
				return coverPath
			}
		}
	}

	for _, ref := range pkg.Guide.References {
		if !strings.EqualFold(strings.TrimSpace(ref.Type), "cover") {
			continue
		}
		guidePath, _ := resolveEpubHref(opfDir, ref.Href)
		if guidePath == "" {
			continue
		}
		for _, item := range pkg.Manifest.Items {
			itemPath, _ := resolveEpubHref(opfDir, item.Href)
			if itemPath == guidePath && strings.HasPrefix(item.MediaType, "image/") {
				return guidePath
			}
		}
		if coverPath := r.coverPathFromDocument(guidePath); coverPath != "" {
			return coverPath
		}
	}

	for _, item := range pkg.Manifest.Items {
		if strings.Contains(strings.ToLower(item.ID), "cover") && strings.HasPrefix(item.MediaType, "image/") {
			href, _ := resolveEpubHref(opfDir, item.Href)
			return href
		}
	}
	return ""
}

func (r *epubReader) coverPathFromManifestItem(item opfItem, opfDir string) string {
	itemPath, _ := resolveEpubHref(opfDir, item.Href)
	if itemPath == "" {
		return ""
	}
	if strings.HasPrefix(item.MediaType, "image/") {
		return itemPath
	}
	if strings.HasPrefix(item.MediaType, "application/xhtml") || strings.HasPrefix(item.MediaType, "text/html") {
		return r.coverPathFromDocument(itemPath)
	}
	return ""
}

func (r *epubReader) coverPathFromDocument(documentPath string) string {
	data, err := r.readZipFile(documentPath)
	if err != nil {
		return ""
	}

	tokenizer := html.NewTokenizer(strings.NewReader(string(data)))
	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			return ""
		}
		if tokenType != html.StartTagToken && tokenType != html.SelfClosingTagToken {
			continue
		}
		token := tokenizer.Token()
		if !strings.EqualFold(token.Data, "img") && !strings.EqualFold(token.Data, "image") {
			continue
		}
		for _, attr := range token.Attr {
			key := strings.ToLower(attr.Key)
			if key != "src" && key != "href" && key != "xlink:href" &&
				!(strings.EqualFold(attr.Namespace, "xlink") && key == "href") {
				continue
			}
			imageHref := strings.TrimSpace(attr.Val)
			if imageHref == "" || strings.HasPrefix(imageHref, "data:") || strings.HasPrefix(imageHref, "//") {
				continue
			}
			if parsed, err := url.Parse(imageHref); err == nil && parsed.IsAbs() {
				continue
			}
			baseDir := path.Dir(documentPath)
			if baseDir == "." {
				baseDir = ""
			}
			imagePath, _ := resolveEpubHref(baseDir, imageHref)
			if imagePath != "" && r.epubFileExists(imagePath) {
				return imagePath
			}
		}
	}
}

func chapterParts(chapterRefs, spineRefs []epubChapterRef, chapterIndex int) []epubChapterPart {
	ref := chapterRefs[chapterIndex]
	direct := func(endFragment string) []epubChapterPart {
		return []epubChapterPart{{
			href:          ref.href,
			startFragment: ref.fragment,
			endFragment:   endFragment,
		}}
	}
	if ref.spineIndex < 0 || ref.source == "spine" {
		return direct("")
	}

	endSpineIndex := -1
	for i := chapterIndex + 1; i < len(chapterRefs); i++ {
		next := chapterRefs[i]
		if next.spineIndex < 0 {
			continue
		}
		if next.spineIndex < ref.spineIndex {
			// A non-monotonic TOC cannot safely define a spine range.
			return direct("")
		}
		if next.spineIndex == ref.spineIndex {
			if next.href == ref.href && next.fragment != ref.fragment {
				return direct(next.fragment)
			}
			return direct("")
		}
		endSpineIndex = next.spineIndex
		break
	}

	parts := make([]epubChapterPart, 0, 2)
	for _, spineRef := range spineRefs {
		if spineRef.spineIndex < ref.spineIndex {
			continue
		}
		if endSpineIndex >= 0 && spineRef.spineIndex >= endSpineIndex {
			break
		}
		part := epubChapterPart{href: spineRef.href}
		if spineRef.spineIndex == ref.spineIndex && spineRef.href == ref.href {
			part.startFragment = ref.fragment
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 || parts[0].href != ref.href {
		return direct("")
	}
	return parts
}

func sliceXHTMLByFragments(rawHTML, startFragment, endFragment string) string {
	if startFragment == "" && endFragment == "" {
		return rawHTML
	}

	tokenizer := html.NewTokenizer(strings.NewReader(rawHTML))
	offset := 0
	bodyStart := 0
	bodyEnd := len(rawHTML)
	startOffset := -1
	endOffset := -1

	for {
		tokenType := tokenizer.Next()
		rawToken := tokenizer.Raw()
		tokenStart := offset
		offset += len(rawToken)

		switch tokenType {
		case html.ErrorToken:
			if startFragment != "" && startOffset < 0 {
				return rawHTML
			}
			if endFragment != "" && endOffset < 0 {
				endOffset = bodyEnd
			}
			if startOffset < 0 {
				startOffset = bodyStart
			}
			if endOffset < 0 {
				endOffset = bodyEnd
			}
			if startOffset >= endOffset || startOffset < 0 || endOffset > len(rawHTML) {
				return rawHTML
			}
			return rawHTML[startOffset:endOffset]

		case html.StartTagToken, html.SelfClosingTagToken:
			token := tokenizer.Token()
			if strings.EqualFold(token.Data, "body") {
				bodyStart = offset
			}
			fragment := tokenFragment(token)
			if startFragment != "" && startOffset < 0 && fragment == startFragment {
				startOffset = tokenStart
			}
			if endFragment != "" && endOffset < 0 && fragment == endFragment {
				endOffset = tokenStart
			}

		case html.EndTagToken:
			token := tokenizer.Token()
			if strings.EqualFold(token.Data, "body") {
				bodyEnd = tokenStart
			}
		}
	}
}

func tokenFragment(token html.Token) string {
	for _, attr := range token.Attr {
		if strings.EqualFold(attr.Key, "id") || strings.EqualFold(attr.Key, "name") {
			return attr.Val
		}
	}
	return ""
}

func (r *epubReader) validChapterRefs(refs []epubChapterRef) []epubChapterRef {
	if len(refs) == 0 {
		return nil
	}

	valid := make([]epubChapterRef, 0, len(refs))
	seen := make(map[string]bool, len(refs))
	for _, ref := range refs {
		if ref.href == "" || !r.epubFileExists(ref.href) {
			continue
		}
		key := ref.href + "#" + ref.fragment
		if seen[key] {
			continue
		}
		seen[key] = true
		valid = append(valid, ref)
	}
	if len(valid) == 0 {
		return nil
	}

	// If most TOC links are broken, treat that TOC as unusable and let spine
	// fallback take over. Converted EPUBs often have messy structure, but a
	// usable NCX/nav should still resolve most entries.
	if len(valid)*100/len(refs) < 60 {
		return nil
	}
	return valid
}

func (r *epubReader) epubFileExists(name string) bool {
	if name == "" {
		return false
	}
	if _, err := r.readZipFile(name); err == nil {
		return true
	}
	return false
}

func (r *epubReader) parseNCXChapters(pkg opfPackage, opfDir string, manifestMap map[string]opfItem, spineIndexByHref map[string]int) []epubChapterRef {
	var ncxItem opfItem
	found := false
	if pkg.Spine.Toc != "" {
		if item, ok := manifestMap[pkg.Spine.Toc]; ok {
			ncxItem = item
			found = true
		}
	}
	if !found {
		for _, item := range pkg.Manifest.Items {
			if item.MediaType == "application/x-dtbncx+xml" || strings.EqualFold(item.ID, "ncx") {
				ncxItem = item
				found = true
				break
			}
		}
	}
	if !found {
		return nil
	}

	ncxPath, _ := resolveEpubHref(opfDir, ncxItem.Href)
	data, err := r.readZipFile(ncxPath)
	if err != nil {
		return nil
	}

	var doc ncxDocument
	if err := xml.Unmarshal(data, &doc); err != nil {
		log.Printf("[epub] failed to parse NCX %s: %v", ncxPath, err)
		return nil
	}

	baseDir := path.Dir(ncxPath)
	if baseDir == "." {
		baseDir = ""
	}
	var refs []epubChapterRef
	var walk func(points []ncxNavPoint, level int)
	walk = func(points []ncxNavPoint, level int) {
		for _, point := range points {
			if point.Content.Src != "" {
				href, fragment := resolveEpubHref(baseDir, point.Content.Src)
				ref := epubChapterRef{
					title:     strings.TrimSpace(point.NavLabel.Text),
					href:      href,
					fragment:  fragment,
					level:     level,
					playOrder: point.Play,
					source:    "epub2-ncx",
				}
				if idx, ok := spineIndexByHref[href]; ok {
					ref.spineIndex = idx
				} else {
					ref.spineIndex = -1
				}
				refs = append(refs, ref)
			}
			walk(point.Children, level+1)
		}
	}
	walk(doc.NavMap.NavPoints, 0)

	if hasUsablePlayOrder(refs) {
		sort.SliceStable(refs, func(i, j int) bool {
			return refs[i].playOrder < refs[j].playOrder
		})
	}
	return refs
}

func hasUsablePlayOrder(refs []epubChapterRef) bool {
	if len(refs) == 0 {
		return false
	}
	seen := make(map[int]bool, len(refs))
	for _, ref := range refs {
		if ref.playOrder <= 0 || seen[ref.playOrder] {
			return false
		}
		seen[ref.playOrder] = true
	}
	return true
}

func (r *epubReader) parseNavChapters(pkg opfPackage, opfDir string, spineIndexByHref map[string]int) []epubChapterRef {
	var navItem opfItem
	found := false
	for _, item := range pkg.Manifest.Items {
		if hasSpaceSeparatedToken(item.Props, "nav") &&
			(strings.HasPrefix(item.MediaType, "application/xhtml") || strings.HasPrefix(item.MediaType, "text/html")) {
			navItem = item
			found = true
			break
		}
	}
	if !found {
		return nil
	}

	navPath, _ := resolveEpubHref(opfDir, navItem.Href)
	data, err := r.readZipFile(navPath)
	if err != nil {
		return nil
	}
	doc, err := html.Parse(strings.NewReader(string(data)))
	if err != nil {
		log.Printf("[epub] failed to parse nav %s: %v", navPath, err)
		return nil
	}

	baseDir := path.Dir(navPath)
	if baseDir == "." {
		baseDir = ""
	}
	tocNav := findTOCNav(doc)
	if tocNav == nil {
		tocNav = findFirstElement(doc, "nav")
	}
	if tocNav == nil {
		return nil
	}

	var refs []epubChapterRef
	collectNavAnchors(tocNav, baseDir, spineIndexByHref, 0, &refs)
	return refs
}

func hasSpaceSeparatedToken(s, token string) bool {
	for _, part := range strings.Fields(s) {
		if part == token {
			return true
		}
	}
	return false
}

func findTOCNav(n *html.Node) *html.Node {
	if n == nil {
		return nil
	}
	if n.Type == html.ElementNode && n.Data == "nav" {
		for _, attr := range n.Attr {
			if strings.EqualFold(attr.Key, "epub:type") || strings.EqualFold(attr.Key, "type") {
				for _, part := range strings.Fields(attr.Val) {
					if part == "toc" {
						return n
					}
				}
			}
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findTOCNav(c); found != nil {
			return found
		}
	}
	return nil
}

func findFirstElement(n *html.Node, name string) *html.Node {
	if n == nil {
		return nil
	}
	if n.Type == html.ElementNode && n.Data == name {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findFirstElement(c, name); found != nil {
			return found
		}
	}
	return nil
}

func collectNavAnchors(n *html.Node, baseDir string, spineIndexByHref map[string]int, level int, refs *[]epubChapterRef) {
	if n == nil {
		return
	}
	if n.Type == html.ElementNode && n.Data == "a" {
		hrefAttr := ""
		for _, attr := range n.Attr {
			if strings.EqualFold(attr.Key, "href") {
				hrefAttr = attr.Val
				break
			}
		}
		if hrefAttr != "" {
			href, fragment := resolveEpubHref(baseDir, hrefAttr)
			ref := epubChapterRef{
				title:     strings.TrimSpace(nodeText(n)),
				href:      href,
				fragment:  fragment,
				level:     level,
				playOrder: len(*refs) + 1,
				source:    "epub3-nav",
			}
			if idx, ok := spineIndexByHref[href]; ok {
				ref.spineIndex = idx
			} else {
				ref.spineIndex = -1
			}
			*refs = append(*refs, ref)
		}
	}

	nextLevel := level
	if n.Type == html.ElementNode && n.Data == "ol" {
		nextLevel++
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		collectNavAnchors(c, baseDir, spineIndexByHref, nextLevel, refs)
	}
}

func nodeText(n *html.Node) string {
	if n == nil {
		return ""
	}
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(cur *html.Node) {
		if cur.Type == html.TextNode {
			b.WriteString(cur.Data)
		}
		for c := cur.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
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
	// Exact match first
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
	// Case-insensitive fallback (some EPUBs have case mismatches
	// between OPF references and actual ZIP entry names)
	lower := strings.ToLower(name)
	for _, f := range r.rc.File {
		if strings.ToLower(f.Name) == lower {
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
	return rewriteEpubImageAttributes(html, func(src string) string {
		if !isLocalEpubResource(src) {
			return src
		}
		resourcePath := strings.TrimPrefix(src, "/")
		return config.JoinBasePath("/api/comics/" + r.comicID + "/epub-resource/" + resourcePath)
	})
}

var epubImageAttrRegex = regexp.MustCompile(`(?i)(<(?:img|image)\b[^>]*?\s(?:src|(?:xlink:)?href)\s*=\s*)(["'])([^"']+)(["'])`)

func rewriteEpubImageAttributes(fragment string, rewrite func(string) string) string {
	return epubImageAttrRegex.ReplaceAllStringFunc(fragment, func(match string) string {
		parts := epubImageAttrRegex.FindStringSubmatch(match)
		if len(parts) < 5 {
			return match
		}
		return parts[1] + parts[2] + rewrite(parts[3]) + parts[4]
	})
}

func isLocalEpubResource(resourceURL string) bool {
	resourceURL = strings.TrimSpace(resourceURL)
	if resourceURL == "" || strings.HasPrefix(resourceURL, "//") || strings.HasPrefix(resourceURL, "#") {
		return false
	}
	parsed, err := url.Parse(resourceURL)
	return err == nil && !parsed.IsAbs()
}

func resolveLocalEpubResource(baseDir, resourceURL string) string {
	if !isLocalEpubResource(resourceURL) {
		return ""
	}
	if strings.HasPrefix(resourceURL, "/") {
		baseDir = ""
		resourceURL = strings.TrimPrefix(resourceURL, "/")
	}
	resolved, _ := resolveEpubHref(baseDir, resourceURL)
	return resolved
}

func (r *epubReader) findBodyBackgroundImage(rawHTML, documentPath string) string {
	bodyClasses, inlineStyle, stylesheetHrefs := epubDocumentPresentation(rawHTML)
	if len(bodyClasses) == 0 && inlineStyle == "" && len(stylesheetHrefs) == 0 {
		return ""
	}
	if r.stylesheetBodyBackgrounds == nil {
		r.stylesheetBodyBackgrounds = make(map[string][]epubBodyBackgroundRule)
	}

	documentDir := path.Dir(documentPath)
	if documentDir == "." {
		documentDir = ""
	}
	classSet := make(map[string]bool, len(bodyClasses))
	for _, className := range bodyClasses {
		classSet[className] = true
	}

	backgroundPath := ""
	for _, stylesheetHref := range stylesheetHrefs {
		stylesheetPath := resolveLocalEpubResource(documentDir, stylesheetHref)
		if stylesheetPath == "" {
			continue
		}
		rules, ok := r.stylesheetBodyBackgrounds[stylesheetPath]
		if !ok {
			rules = r.readStylesheetBodyBackgrounds(stylesheetPath)
			r.stylesheetBodyBackgrounds[stylesheetPath] = rules
		}
		for _, rule := range rules {
			if bodyBackgroundRuleMatches(rule, classSet) {
				backgroundPath = rule.imagePath
			}
		}
	}

	if inlineURL := cssBackgroundImageURL(inlineStyle); inlineURL != "" {
		if resolved := resolveLocalEpubResource(documentDir, inlineURL); resolved != "" {
			backgroundPath = resolved
		}
	}
	return backgroundPath
}

func epubDocumentPresentation(rawHTML string) ([]string, string, []string) {
	tokenizer := html.NewTokenizer(strings.NewReader(rawHTML))
	var stylesheets []string
	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			return nil, "", stylesheets
		}
		if tokenType != html.StartTagToken && tokenType != html.SelfClosingTagToken {
			continue
		}
		token := tokenizer.Token()
		switch strings.ToLower(token.Data) {
		case "link":
			var rel, href string
			for _, attr := range token.Attr {
				switch strings.ToLower(attr.Key) {
				case "rel":
					rel = attr.Val
				case "href":
					href = attr.Val
				}
			}
			for _, relPart := range strings.Fields(rel) {
				if strings.EqualFold(relPart, "stylesheet") && href != "" {
					stylesheets = append(stylesheets, href)
					break
				}
			}
		case "body":
			var classes []string
			var inlineStyle string
			for _, attr := range token.Attr {
				switch strings.ToLower(attr.Key) {
				case "class":
					classes = strings.Fields(attr.Val)
				case "style":
					inlineStyle = attr.Val
				}
			}
			return classes, inlineStyle, stylesheets
		}
	}
}

var (
	cssCommentRegex       = regexp.MustCompile(`(?s)/\*.*?\*/`)
	cssRuleRegex          = regexp.MustCompile(`(?s)([^{}]+)\{([^{}]*)\}`)
	cssBackgroundURLRegex = regexp.MustCompile(`(?is)(?:background-image|background)\s*:\s*[^;{}]*?url\(\s*["']?([^"')]+)["']?\s*\)`)
)

func (r *epubReader) readStylesheetBodyBackgrounds(stylesheetPath string) []epubBodyBackgroundRule {
	data, err := r.readZipFile(stylesheetPath)
	if err != nil {
		return nil
	}
	stylesheetDir := path.Dir(stylesheetPath)
	if stylesheetDir == "." {
		stylesheetDir = ""
	}

	css := cssCommentRegex.ReplaceAllString(string(data), "")
	var rules []epubBodyBackgroundRule
	for _, match := range cssRuleRegex.FindAllStringSubmatch(css, -1) {
		if len(match) < 3 {
			continue
		}
		imageURL := cssBackgroundImageURL(match[2])
		imagePath := resolveLocalEpubResource(stylesheetDir, imageURL)
		if imagePath == "" {
			continue
		}
		for _, selector := range strings.Split(match[1], ",") {
			requiredClasses, ok := bodySelectorClasses(selector)
			if !ok {
				continue
			}
			rules = append(rules, epubBodyBackgroundRule{
				requiredClasses: requiredClasses,
				imagePath:       imagePath,
			})
		}
	}
	return rules
}

func cssBackgroundImageURL(declarations string) string {
	matches := cssBackgroundURLRegex.FindAllStringSubmatch(declarations, -1)
	if len(matches) == 0 {
		return ""
	}
	last := matches[len(matches)-1]
	if len(last) < 2 {
		return ""
	}
	return strings.TrimSpace(last[1])
}

func bodySelectorClasses(selector string) ([]string, bool) {
	selector = strings.TrimSpace(selector)
	if strings.EqualFold(selector, "body") {
		return nil, true
	}
	if len(selector) <= len("body.") || !strings.EqualFold(selector[:len("body.")], "body.") {
		return nil, false
	}
	if strings.ContainsAny(selector, " >+~:#[") {
		return nil, false
	}
	classes := strings.Split(selector[len("body."):], ".")
	for _, className := range classes {
		if className == "" {
			return nil, false
		}
	}
	return classes, true
}

func bodyBackgroundRuleMatches(rule epubBodyBackgroundRule, classSet map[string]bool) bool {
	for _, className := range rule.requiredClasses {
		if !classSet[className] {
			return false
		}
	}
	return true
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

	// Resolve local image references to full EPUB-internal paths. EPUB 2 cover
	// pages commonly use SVG <image xlink:href="..."> instead of <img src>.
	html = rewriteEpubImageAttributes(html, func(src string) string {
		if !isLocalEpubResource(src) {
			return src
		}
		if strings.HasPrefix(src, "/") {
			return strings.TrimPrefix(src, "/")
		}
		resolved, fragment := resolveEpubHref(chapterDir, src)
		if fragment != "" {
			resolved += "#" + fragment
		}
		return resolved
	})

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

// GetEpubChapterInfos returns flattened chapter entries with their original
// TOC hierarchy. ParentIndex is -1 for top-level entries.
func GetEpubChapterInfos(r Reader) []EpubChapterInfo {
	er, ok := r.(*epubReader)
	if !ok {
		return nil
	}

	infos := make([]EpubChapterInfo, len(er.chapters))
	ancestors := make([]int, 0, 4)
	for i, chapter := range er.chapters {
		level := max(chapter.level, 0)
		if level > len(ancestors) {
			level = len(ancestors)
		}
		for len(ancestors) > level {
			ancestors = ancestors[:len(ancestors)-1]
		}
		parentIndex := -1
		if level > 0 && len(ancestors) > 0 {
			parentIndex = ancestors[len(ancestors)-1]
		}
		infos[i] = EpubChapterInfo{
			Title:       chapter.title,
			Level:       level,
			ParentIndex: parentIndex,
		}
		ancestors = append(ancestors, i)
	}
	for i := 0; i+1 < len(infos); i++ {
		infos[i].HasChildren = infos[i+1].Level > infos[i].Level
	}
	return infos
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

// ============================================================
// EPUB 内容类型检测：漫画 vs 小说
// ============================================================

// imgTagRegex 匹配 HTML 中的 <img> 标签、SVG 中的 <image> 标签
var imgTagRegex = regexp.MustCompile(`(?i)<(?:img|image)\s`)

// svgTagRegex 匹配 SVG 标签（Calibre 转换 mobi 时常用 SVG 包裹图片）
var svgTagRegex = regexp.MustCompile(`(?i)<svg[\s>]`)

// IsImageHeavyEpub 检测 EPUB 文件是否以图片为主（漫画/画集类型）。
// 通过分析 manifest 中图片资源占比和章节内容中图片与文字的比例来判断。
// 返回 true 表示该 EPUB 应被视为漫画而非小说。
func IsImageHeavyEpub(filePath string) bool {
	rc, err := zip.OpenReader(filePath)
	if err != nil {
		return false
	}
	defer rc.Close()

	// 方法1：统计 manifest 中图片资源 vs 文本资源的数量和大小
	var imageCount, textCount int
	var imageSize, textSize int64
	for _, f := range rc.File {
		lower := strings.ToLower(f.Name)
		if strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") ||
			strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".gif") ||
			strings.HasSuffix(lower, ".webp") || strings.HasSuffix(lower, ".bmp") ||
			strings.HasSuffix(lower, ".svg") {
			imageCount++
			imageSize += int64(f.UncompressedSize64)
		} else if strings.HasSuffix(lower, ".xhtml") || strings.HasSuffix(lower, ".html") ||
			strings.HasSuffix(lower, ".htm") {
			textCount++
			textSize += int64(f.UncompressedSize64)
		}
	}

	// 如果图片数量 >= 5 且图片总大小占比 > 80%，判定为漫画
	totalContentSize := imageSize + textSize
	log.Printf("[IsImageHeavyEpub] %s: images=%d (%.1f KB), texts=%d (%.1f KB)",
		filePath, imageCount, float64(imageSize)/1024, textCount, float64(textSize)/1024)
	if imageCount >= 5 && totalContentSize > 0 {
		imageRatio := float64(imageSize) / float64(totalContentSize)
		log.Printf("[IsImageHeavyEpub] Image ratio: %.2f%% (threshold: 80%%)", imageRatio*100)
		if imageRatio > 0.80 {
			return true
		}
	}

	// 方法2：抽样检查前几个章节的内容，看图片标签 vs 纯文字的比例
	// 找到 OPF 文件
	opfPath := ""
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

	if opfPath == "" {
		// 兜底：直接搜索 .opf 文件
		for _, f := range rc.File {
			if strings.HasSuffix(strings.ToLower(f.Name), ".opf") {
				opfPath = f.Name
				break
			}
		}
	}

	if opfPath == "" {
		return false
	}

	// 解析 OPF 获取 spine 中的章节
	var opfData []byte
	for _, f := range rc.File {
		if f.Name == opfPath {
			opfData, _ = readZipEntry(f)
			break
		}
	}
	if opfData == nil {
		return false
	}

	opfDir := path.Dir(opfPath)
	if opfDir == "." {
		opfDir = ""
	}

	var pkg opfPackage
	if err := xml.Unmarshal(opfData, &pkg); err != nil {
		return false
	}

	manifestMap := make(map[string]opfItem, len(pkg.Manifest.Items))
	for _, item := range pkg.Manifest.Items {
		manifestMap[item.ID] = item
	}

	// 抽样检查最多 10 个章节
	sampleCount := 0
	imageHeavyCount := 0
	maxSamples := 10

	for _, ref := range pkg.Spine.ItemRefs {
		if sampleCount >= maxSamples {
			break
		}
		item, ok := manifestMap[ref.IDRef]
		if !ok {
			continue
		}
		if !strings.HasPrefix(item.MediaType, "application/xhtml") &&
			!strings.HasPrefix(item.MediaType, "text/html") {
			continue
		}

		href := item.Href
		if opfDir != "" {
			href = opfDir + "/" + href
		}

		// 读取章节内容
		var chapterData []byte
		for _, f := range rc.File {
			if f.Name == href {
				chapterData, _ = readZipEntry(f)
				break
			}
		}
		if chapterData == nil {
			continue
		}

		sampleCount++
		html := string(chapterData)

		// 统计 <img> 和 <image> 标签数量
		imgMatches := imgTagRegex.FindAllStringIndex(html, -1)
		imgCount := len(imgMatches)

		// 也统计 <svg> 标签数量（Calibre 转换 mobi 时常用 SVG 包裹图片）
		svgMatches := svgTagRegex.FindAllStringIndex(html, -1)
		svgCount := len(svgMatches)

		// 提取纯文字长度
		plainText := extractTextFromXHTML(html)
		textLen := len(strings.TrimSpace(plainText))

		// 如果章节中有图片（img/image/svg）且纯文字很少（< 100字符），认为是图片为主的章节
		if (imgCount > 0 || svgCount > 0) && textLen < 100 {
			imageHeavyCount++
		}
	}

	// 如果 >= 60% 的抽样章节是图片为主，判定为漫画
	log.Printf("[IsImageHeavyEpub] Chapter sampling: %d/%d image-heavy (threshold: 60%%)", imageHeavyCount, sampleCount)
	if sampleCount > 0 && float64(imageHeavyCount)/float64(sampleCount) >= 0.6 {
		return true
	}

	return false
}

// ListEpubEmbeddedImages 返回 EPUB 内嵌的所有图片资源路径（zip 内部的相对路径）。
// 对于漫画类 EPUB，使用 spine 阅读顺序排列图片；否则按 zip 目录顺序。
func ListEpubEmbeddedImages(r Reader) []string {
	er, ok := r.(*epubReader)
	if !ok || er.rc == nil {
		return nil
	}
	var images []string
	seen := make(map[string]bool)

	// 如果有 spine 顺序的图片列表，优先使用（漫画模式）
	if len(er.spineImages) > 0 {
		for _, img := range er.spineImages {
			if !seen[img] {
				seen[img] = true
				images = append(images, img)
			}
		}
		// 补充 spine 中未出现的其他图片（如封面等）
		for _, f := range er.rc.File {
			if f.FileInfo().IsDir() {
				continue
			}
			name := f.Name
			base := path.Base(name)
			if strings.HasPrefix(name, "__MACOSX") || strings.HasPrefix(base, ".") {
				continue
			}
			if !config.IsImageFile(name) {
				continue
			}
			if !seen[name] {
				seen[name] = true
				images = append(images, name)
			}
		}
		return images
	}

	// 非 spine 模式：封面优先，然后按 zip 目录顺序
	if er.coverPath != "" && config.IsImageFile(er.coverPath) {
		images = append(images, er.coverPath)
		seen[er.coverPath] = true
	}
	for _, f := range er.rc.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := f.Name
		base := path.Base(name)
		if strings.HasPrefix(name, "__MACOSX") || strings.HasPrefix(base, ".") {
			continue
		}
		if !config.IsImageFile(name) {
			continue
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		images = append(images, name)
	}
	return images
}

// GetEpubEmbeddedImageData 提取 EPUB 内嵌图片数据。
func GetEpubEmbeddedImageData(r Reader, internalPath string) ([]byte, string, error) {
	er, ok := r.(*epubReader)
	if !ok {
		return nil, "", fmt.Errorf("not an EPUB reader")
	}
	// Try exact path first
	data, err := er.readZipFile(internalPath)
	if err == nil {
		return data, GetMimeType(internalPath), nil
	}
	// Fallback: try with common EPUB root prefixes
	prefixes := []string{"OEBPS/", "OPS/", "EPUB/", "content/"}
	for _, prefix := range prefixes {
		if data, err2 := er.readZipFile(prefix + internalPath); err2 == nil {
			return data, GetMimeType(internalPath), nil
		}
	}
	// Fallback: try stripping known prefixes from the path
	for _, prefix := range prefixes {
		if strings.HasPrefix(internalPath, prefix) {
			if data, err2 := er.readZipFile(strings.TrimPrefix(internalPath, prefix)); err2 == nil {
				return data, GetMimeType(internalPath), nil
			}
		}
	}
	return nil, "", fmt.Errorf("resource not found in EPUB: %s", internalPath)
}
