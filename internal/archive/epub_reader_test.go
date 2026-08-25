package archive

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEpubReaderPrefersNCXOverSpine(t *testing.T) {
	fp := writeTestEpub(t, "converted-book.zip", map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OEBPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata><title>Converted</title></metadata>
  <manifest>
    <item href="text00000.html" id="id_1" media-type="application/xhtml+xml"/>
    <item href="text00001.html" id="id_2" media-type="application/xhtml+xml"/>
    <item href="text00002.html" id="id_3" media-type="application/xhtml+xml"/>
    <item href="text00003.html" id="id_4" media-type="application/xhtml+xml"/>
    <item href="text00004.html" id="id_5" media-type="application/xhtml+xml"/>
    <item href="text00005.html" id="id_6" media-type="application/xhtml+xml"/>
    <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="id_1"/>
    <itemref idref="id_2"/>
    <itemref idref="id_3"/>
    <itemref idref="id_4"/>
    <itemref idref="id_5"/>
    <itemref idref="id_6"/>
  </spine>
</package>`,
		"OEBPS/toc.ncx": `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="nav1" playOrder="1">
      <navLabel><text>第一章 正文开始</text></navLabel>
      <content src="text00003.html#start"/>
    </navPoint>
    <navPoint id="nav2" playOrder="2">
      <navLabel><text>第二章 嵌套父项</text></navLabel>
      <content src="text00004.html#start"/>
      <navPoint id="nav3" playOrder="3">
        <navLabel><text>第三章 嵌套子项</text></navLabel>
        <content src="text00005.html#start"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>`,
		"OEBPS/text00000.html": testXHTML("empty-0", ""),
		"OEBPS/text00001.html": testXHTML("empty-1", ""),
		"OEBPS/text00002.html": testXHTML("empty-2", ""),
		"OEBPS/text00003.html": testXHTML("wrong title", "chapter one"),
		"OEBPS/text00004.html": testXHTML("wrong title", "chapter two"),
		"OEBPS/text00005.html": testXHTML("wrong title", "chapter three"),
	})

	if got := DetectType(fp); got != TypeEpub {
		t.Fatalf("DetectType() = %q, want %q", got, TypeEpub)
	}

	reader, err := NewReader(fp)
	if err != nil {
		t.Fatalf("NewReader() error = %v", err)
	}
	defer reader.Close()

	entries := reader.ListEntries()
	if len(entries) != 3 {
		t.Fatalf("ListEntries() length = %d, want 3", len(entries))
	}

	titles := GetEpubChapterTitles(reader)
	wantTitles := []string{"第一章 正文开始", "第二章 嵌套父项", "第三章 嵌套子项"}
	if len(titles) != len(wantTitles) {
		t.Fatalf("GetEpubChapterTitles() length = %d, want %d: %v", len(titles), len(wantTitles), titles)
	}
	for i, want := range wantTitles {
		if titles[i] != want {
			t.Fatalf("title[%d] = %q, want %q", i, titles[i], want)
		}
	}

	infos := GetEpubChapterInfos(reader)
	if infos[0].Level != 0 || infos[0].ParentIndex != -1 || infos[0].HasChildren {
		t.Fatalf("chapter info[0] = %+v, want top-level leaf", infos[0])
	}
	if infos[1].Level != 0 || infos[1].ParentIndex != -1 || !infos[1].HasChildren {
		t.Fatalf("chapter info[1] = %+v, want top-level parent", infos[1])
	}
	if infos[2].Level != 1 || infos[2].ParentIndex != 1 || infos[2].HasChildren {
		t.Fatalf("chapter info[2] = %+v, want child of chapter 1", infos[2])
	}
}

func TestEpubReaderAggregatesSpineDocumentsWithinTOCBoundary(t *testing.T) {
	fp := writeTestEpub(t, "split-chapters.epub", map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": testContainerXML,
		"OEBPS/content.opf": testOPF(
			[]string{"title1.xhtml", "body1.xhtml", "title2.xhtml", "body2.xhtml"},
			true,
		),
		"OEBPS/toc.ncx": testNCX(
			`<navPoint id="one" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="title1.xhtml"/></navPoint>`,
			`<navPoint id="two" playOrder="2"><navLabel><text>第二章</text></navLabel><content src="title2.xhtml"/></navPoint>`,
		),
		"OEBPS/title1.xhtml": testXHTML("第一章", "chapter one title"),
		"OEBPS/body1.xhtml":  testXHTML("第一章", "chapter one body"),
		"OEBPS/title2.xhtml": testXHTML("第二章", "chapter two title"),
		"OEBPS/body2.xhtml":  testXHTML("第二章", "chapter two body"),
	})

	reader, err := NewReader(fp)
	if err != nil {
		t.Fatalf("NewReader() error = %v", err)
	}
	defer reader.Close()

	first, err := reader.ExtractEntry("chapter-0001.html")
	if err != nil {
		t.Fatalf("ExtractEntry(first) error = %v", err)
	}
	if !containsAll(string(first), "chapter one title", "chapter one body") {
		t.Fatalf("first chapter did not aggregate its spine range: %s", first)
	}
	if containsAll(string(first), "chapter two title") {
		t.Fatalf("first chapter crossed the next TOC boundary: %s", first)
	}

	second, err := reader.ExtractEntry("chapter-0002.html")
	if err != nil {
		t.Fatalf("ExtractEntry(second) error = %v", err)
	}
	if !containsAll(string(second), "chapter two title", "chapter two body") {
		t.Fatalf("second chapter did not include trailing spine content: %s", second)
	}
}

func TestEpubReaderSlicesSharedDocumentByFragments(t *testing.T) {
	fp := writeTestEpub(t, "fragment-chapters.epub", map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": testContainerXML,
		"OEBPS/content.opf":      testOPF([]string{"shared.xhtml"}, true),
		"OEBPS/toc.ncx": testNCX(
			`<navPoint id="one" playOrder="1"><navLabel><text>第一节</text></navLabel><content src="shared.xhtml#one"/></navPoint>`,
			`<navPoint id="two" playOrder="2"><navLabel><text>第二节</text></navLabel><content src="shared.xhtml#two"/></navPoint>`,
		),
		"OEBPS/shared.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html><head><title>Shared</title></head><body>
<h2 id="one">第一节</h2><p>alpha section</p>
<h2 id="two">第二节</h2><p>beta section</p>
</body></html>`,
	})

	reader, err := NewReader(fp)
	if err != nil {
		t.Fatalf("NewReader() error = %v", err)
	}
	defer reader.Close()

	first, err := reader.ExtractEntry("chapter-0001.html")
	if err != nil {
		t.Fatalf("ExtractEntry(first) error = %v", err)
	}
	if !containsAll(string(first), "alpha section") || containsAll(string(first), "beta section") {
		t.Fatalf("first fragment slice is incorrect: %s", first)
	}

	second, err := reader.ExtractEntry("chapter-0002.html")
	if err != nil {
		t.Fatalf("ExtractEntry(second) error = %v", err)
	}
	if !containsAll(string(second), "beta section") || containsAll(string(second), "alpha section") {
		t.Fatalf("second fragment slice is incorrect: %s", second)
	}
}

func TestEpubReaderSpineFallbackKeepsDocumentsSeparate(t *testing.T) {
	fp := writeTestEpub(t, "spine-only.epub", map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": testContainerXML,
		"OEBPS/content.opf":      testOPF([]string{"one.xhtml", "two.xhtml"}, false),
		"OEBPS/one.xhtml":        testXHTML("One", "first document"),
		"OEBPS/two.xhtml":        testXHTML("Two", "second document"),
	})

	reader, err := NewReader(fp)
	if err != nil {
		t.Fatalf("NewReader() error = %v", err)
	}
	defer reader.Close()

	entries := reader.ListEntries()
	if len(entries) != 2 {
		t.Fatalf("ListEntries() length = %d, want 2", len(entries))
	}
	first, err := reader.ExtractEntry(entries[0].Name)
	if err != nil {
		t.Fatalf("ExtractEntry(first) error = %v", err)
	}
	if !containsAll(string(first), "first document") || containsAll(string(first), "second document") {
		t.Fatalf("spine fallback merged separate documents: %s", first)
	}
}

func TestEpubReaderExtractsEPUB2MetadataCover(t *testing.T) {
	cover := "jpeg-cover-data"
	fp := writeTestEpub(t, "epub2-meta-cover.epub", map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": testContainerXML,
		"OEBPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata><meta name="cover" content="mid4221"/></metadata>
  <manifest>
    <item id="mid4221" href="Images/mid4221.jpg" media-type="image/jpeg"/>
    <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`,
		"OEBPS/Images/mid4221.jpg": cover,
		"OEBPS/Text/chapter.xhtml": testXHTML("Chapter", "body"),
	})

	reader, err := NewReader(fp)
	if err != nil {
		t.Fatalf("NewReader() error = %v", err)
	}
	defer reader.Close()

	got, err := GetEpubCoverImage(reader)
	if err != nil {
		t.Fatalf("GetEpubCoverImage() error = %v", err)
	}
	if string(got) != cover {
		t.Fatalf("GetEpubCoverImage() = %q, want %q", got, cover)
	}
}

func TestEpubReaderExtractsEPUB2GuideSVGCover(t *testing.T) {
	cover := "guide-cover-data"
	fp := writeTestEpub(t, "epub2-guide-cover.epub", map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": testContainerXML,
		"OEBPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata><title>Guide cover</title></metadata>
  <manifest>
    <item id="image42" href="Images/image42.jpg" media-type="image/jpeg"/>
    <item id="coverpage" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="coverpage"/><itemref idref="chapter"/></spine>
  <guide><reference type="cover" href="Text/cover.xhtml"/></guide>
</package>`,
		"OEBPS/Images/image42.jpg": cover,
		"OEBPS/Text/cover.xhtml":   `<html xmlns="http://www.w3.org/1999/xhtml"><body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../Images/image42.jpg"/></svg></body></html>`,
		"OEBPS/Text/chapter.xhtml": testXHTML("Chapter", "body"),
	})

	reader, err := NewReader(fp)
	if err != nil {
		t.Fatalf("NewReader() error = %v", err)
	}
	defer reader.Close()

	got, err := GetEpubCoverImage(reader)
	if err != nil {
		t.Fatalf("GetEpubCoverImage() error = %v", err)
	}
	if string(got) != cover {
		t.Fatalf("GetEpubCoverImage() = %q, want %q", got, cover)
	}

	SetEpubComicID(reader, "book-1")
	chapter, err := reader.ExtractEntry("chapter-0001.html")
	if err != nil {
		t.Fatalf("ExtractEntry(cover) error = %v", err)
	}
	chapterHTML := string(chapter)
	wantURL := `/api/comics/book-1/epub-resource/OEBPS/Images/image42.jpg`
	if !strings.Contains(chapterHTML, `xlink:href="`+wantURL+`"`) {
		t.Fatalf("cover SVG URL was not rewritten: %s", chapterHTML)
	}
	if strings.Contains(chapterHTML, "../Images/image42.jpg") {
		t.Fatalf("cover SVG kept its relative image URL: %s", chapterHTML)
	}
}

func TestEpubReaderRewritesHTMLAndSVGImageURLs(t *testing.T) {
	rawHTML := `<body><img src="../Images/chapter.webp"><svg><image href='../Images/cover.jpg'/></svg><img src="https://example.com/external.jpg"></body>`
	sanitized := sanitizeEpubHTML(rawHTML, "OEBPS/Text")
	r := &epubReader{comicID: "book-2"}
	got := r.rewriteImageURLs(sanitized)

	for _, want := range []string{
		`src="/api/comics/book-2/epub-resource/OEBPS/Images/chapter.webp"`,
		`href='/api/comics/book-2/epub-resource/OEBPS/Images/cover.jpg'`,
		`src="https://example.com/external.jpg"`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("rewritten HTML missing %q: %s", want, got)
		}
	}
}

func TestEpubReaderMaterializesCSSBodyBackgroundImages(t *testing.T) {
	fp := writeTestEpub(t, "css-background-pages.epub", map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": testContainerXML,
		"OEBPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata><title>CSS pages</title></metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="Styles/book.css" media-type="text/css"/>
    <item id="secondImage" href="Images/second.jpg" media-type="image/jpeg"/>
    <item id="thirdImage" href="Images/third.jpg" media-type="image/jpeg"/>
    <item id="second" href="Text/second.xhtml" media-type="application/xhtml+xml"/>
    <item id="third" href="Text/third.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="second"/><itemref idref="third"/><itemref idref="chapter"/></spine>
</package>`,
		"OEBPS/toc.ncx": testNCX(
			`<navPoint id="second" playOrder="1"><navLabel><text>制作说明</text></navLabel><content src="Text/second.xhtml"/></navPoint>`,
			`<navPoint id="third" playOrder="2"><navLabel><text>内容介绍</text></navLabel><content src="Text/third.xhtml"/></navPoint>`,
			`<navPoint id="chapter" playOrder="3"><navLabel><text>第一章</text></navLabel><content src="Text/chapter.xhtml"/></navPoint>`,
		),
		"OEBPS/Styles/book.css": `body.qmp000 { background-image: url('../Images/second.jpg'); }
body.qmp00 { background: #fff url("../Images/third.jpg") no-repeat center; }`,
		"OEBPS/Images/second.jpg":  "second-image",
		"OEBPS/Images/third.jpg":   "third-image",
		"OEBPS/Text/second.xhtml":  `<html><head><link href="../Styles/book.css" rel="stylesheet"/></head><body class="qmp000"><p>&#160;</p></body></html>`,
		"OEBPS/Text/third.xhtml":   `<html><head><link rel="stylesheet" href="../Styles/book.css"/></head><body class="qmp00"><p>&#160;</p></body></html>`,
		"OEBPS/Text/chapter.xhtml": testXHTML("First", "body"),
	})

	reader, err := NewReader(fp)
	if err != nil {
		t.Fatalf("NewReader() error = %v", err)
	}
	defer reader.Close()
	SetEpubComicID(reader, "book-3")

	chapters := []struct {
		entryName string
		imageName string
	}{
		{entryName: "chapter-0001.html", imageName: "second.jpg"},
		{entryName: "chapter-0002.html", imageName: "third.jpg"},
	}
	for index, expected := range chapters {
		chapter, err := reader.ExtractEntry(expected.entryName)
		if err != nil {
			t.Fatalf("ExtractEntry(%d) error = %v", index, err)
		}
		wantURL := "/api/comics/book-3/epub-resource/OEBPS/Images/" + expected.imageName
		if !strings.Contains(string(chapter), `src="`+wantURL+`"`) {
			t.Fatalf("chapter %d missing CSS background image %q: %s", index, wantURL, chapter)
		}
	}

	images := ListEpubEmbeddedImages(reader)
	if len(images) < 2 || images[0] != "OEBPS/Images/second.jpg" || images[1] != "OEBPS/Images/third.jpg" {
		t.Fatalf("spine image order = %v, want CSS backgrounds first", images)
	}
}

const testContainerXML = `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`

func testOPF(chapters []string, withNCX bool) string {
	manifest := ""
	spine := ""
	for i, chapter := range chapters {
		id := "chapter" + string(rune('a'+i))
		manifest += `<item href="` + chapter + `" id="` + id + `" media-type="application/xhtml+xml"/>`
		spine += `<itemref idref="` + id + `"/>`
	}
	tocManifest := ""
	tocAttr := ""
	if withNCX {
		tocManifest = `<item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>`
		tocAttr = ` toc="ncx"`
	}
	return `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata><title>Test</title></metadata><manifest>` +
		manifest + tocManifest + `</manifest><spine` + tocAttr + `>` + spine + `</spine></package>`
}

func testNCX(points ...string) string {
	body := ""
	for _, point := range points {
		body += point
	}
	return `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>` +
		body + `</navMap></ncx>`
}

func containsAll(s string, parts ...string) bool {
	for _, part := range parts {
		if !strings.Contains(s, part) {
			return false
		}
	}
	return true
}

func writeTestEpub(t *testing.T, name string, files map[string]string) string {
	t.Helper()

	fp := filepath.Join(t.TempDir(), name)
	f, err := os.Create(fp)
	if err != nil {
		t.Fatalf("create epub: %v", err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return fp
}

func testXHTML(title, body string) string {
	return `<?xml version="1.0" encoding="UTF-8"?><html><head><title>` + title + `</title></head><body><p>` + body + `</p></body></html>`
}
