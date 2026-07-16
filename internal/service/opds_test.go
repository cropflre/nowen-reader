package service

import (
	"encoding/xml"
	"io"
	"strings"
	"testing"
)

func TestRootCatalogIsNavigationFeedWithOpenSearch(t *testing.T) {
	feed := GenerateRootCatalog("http://example.test")
	assertValidXML(t, feed)

	for _, expected := range []string{
		`type="` + OPDSNavigationMIME + `"`,
		`href="http://example.test/api/opds/search.xml"`,
		`type="` + OpenSearchMIME + `"`,
		`href="http://example.test/api/opds/all"`,
		`href="http://example.test/api/opds/recent"`,
		`href="http://example.test/api/opds/favorites"`,
	} {
		if !strings.Contains(feed, expected) {
			t.Fatalf("root catalog missing %q: %s", expected, feed)
		}
	}
}

func TestOpenSearchDescriptionUsesAcquisitionFeedTemplate(t *testing.T) {
	description := GenerateOpenSearchDescription("https://reader.example")
	assertValidXML(t, description)

	for _, expected := range []string{
		`xmlns="` + openSearchNS + `"`,
		`type="` + OPDSAcquisitionMIME + `"`,
		`template="https://reader.example/api/opds/search?q={searchTerms}"`,
	} {
		if !strings.Contains(description, expected) {
			t.Fatalf("OpenSearch description missing %q: %s", expected, description)
		}
	}
}

func TestAcquisitionFeedMetadataPaginationAndLinks(t *testing.T) {
	feed := GenerateAcquisitionFeed(OPDSAcquisitionFeedOptions{
		BaseURL: "http://example.test",
		Title:   "Library",
		FeedID:  "http://example.test/api/opds/search?q=%E4%B9%A6",
		Comics: []OPDSComic{{
			ID:          "comic-1",
			Title:       "Comic",
			Author:      "Author",
			Description: "Description",
			Language:    "zh-CN",
			Genre:       "Action, Drama",
			Publisher:   "Publisher",
			Year:        2025,
			PageCount:   42,
			AddedAt:     "2025-01-02T03:04:05Z",
			UpdatedAt:   "2025-02-03T04:05:06Z",
			Tags:        []string{"Drama", "Complete"},
			Filename:    "comic.cbz",
		}},
		Pagination: OPDSPagination{
			SelfHref:     "/api/opds/search?page=2&pageSize=1&q=%E4%B9%A6",
			FirstHref:    "/api/opds/search?page=1&pageSize=1&q=%E4%B9%A6",
			LastHref:     "/api/opds/search?page=3&pageSize=1&q=%E4%B9%A6",
			NextHref:     "/api/opds/search?page=3&pageSize=1&q=%E4%B9%A6",
			PreviousHref: "/api/opds/search?page=1&pageSize=1&q=%E4%B9%A6",
			TotalResults: 3,
			ItemsPerPage: 1,
			StartIndex:   2,
		},
	})
	assertValidXML(t, feed)

	for _, expected := range []string{
		`xmlns:dcterms="` + dctermsNS + `"`,
		`xmlns:opensearch="` + openSearchNS + `"`,
		`<opensearch:totalResults>3</opensearch:totalResults>`,
		`<opensearch:itemsPerPage>1</opensearch:itemsPerPage>`,
		`<opensearch:startIndex>2</opensearch:startIndex>`,
		`rel="next"`,
		`rel="previous"`,
		`href="http://example.test/api/opds/cover/comic-1"`,
		`href="http://example.test/api/opds/download/comic-1" type="application/x-cbz"`,
		`<dcterms:language>zh-CN</dcterms:language>`,
		`<dcterms:publisher>Publisher</dcterms:publisher>`,
		`<dcterms:issued>2025</dcterms:issued>`,
		`<dcterms:extent>42 pages</dcterms:extent>`,
		`term="Complete"`,
	} {
		if !strings.Contains(feed, expected) {
			t.Fatalf("acquisition feed missing %q: %s", expected, feed)
		}
	}
	if strings.Contains(feed, "acquisition/open-access") {
		t.Fatalf("authenticated acquisition feed must not claim open access: %s", feed)
	}
}

func TestAcquisitionFeedDoesNotClaimFixedThumbnailFormat(t *testing.T) {
	feed := GenerateAcquisitionFeed(OPDSAcquisitionFeedOptions{
		BaseURL: "http://example.test",
		Title:   "Library",
		FeedID:  "urn:test:library",
		Comics:  []OPDSComic{{ID: "comic-1", Title: "Comic", Filename: "comic.cbz"}},
		Pagination: OPDSPagination{
			SelfHref:     "/api/opds/all?page=1&pageSize=100",
			TotalResults: 1,
			ItemsPerPage: 100,
		},
	})

	for _, rel := range []string{
		"http://opds-spec.org/image",
		"http://opds-spec.org/image/thumbnail",
	} {
		linkStart := `<link rel="` + rel + `" href="http://example.test/api/opds/cover/comic-1"`
		if !strings.Contains(feed, linkStart+`></link>`) {
			t.Fatalf("thumbnail link %q should defer to the response Content-Type: %s", rel, feed)
		}
	}
}

func TestUnsupportedPublicationIsNotSerialized(t *testing.T) {
	feed := GenerateAcquisitionFeed(OPDSAcquisitionFeedOptions{
		BaseURL: "http://example.test",
		Title:   "Library",
		FeedID:  "urn:test:library",
		Comics:  []OPDSComic{{ID: "novel-1", Title: "Novel", Filename: "novel.epub"}},
		Pagination: OPDSPagination{
			SelfHref:     "/api/opds/all?page=1&pageSize=100",
			TotalResults: 0,
			ItemsPerPage: 100,
		},
	})
	if strings.Contains(feed, "novel-1") || strings.Contains(feed, "Novel") {
		t.Fatalf("unsupported publication leaked into OPDS feed: %s", feed)
	}
}

func TestOPDSAcquisitionMIMEForFilename(t *testing.T) {
	tests := map[string]string{
		"book.cbz": "application/x-cbz",
		"book.CBR": "application/x-cbr",
		"book.cb7": "application/x-cb7",
		"book.pdf": "application/pdf",
	}
	for filename, expected := range tests {
		actual, ok := OPDSAcquisitionMIMEForFilename(filename)
		if !ok || actual != expected {
			t.Fatalf("OPDSAcquisitionMIMEForFilename(%q) = %q, %v; want %q, true", filename, actual, ok, expected)
		}
	}
	if _, ok := OPDSAcquisitionMIMEForFilename("novel.epub"); ok {
		t.Fatal("EPUB must not be exposed by the comic-only OPDS catalog")
	}
}

func assertValidXML(t *testing.T, value string) {
	t.Helper()
	decoder := xml.NewDecoder(strings.NewReader(value))
	for {
		if _, err := decoder.Token(); err != nil {
			if err == io.EOF {
				return
			}
			t.Fatalf("invalid XML: %v\n%s", err, value)
		}
	}
}
