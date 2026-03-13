package service

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"
)

// ============================================================
// OPDS 1.2 Atom XML Feed Generator
// ============================================================

const (
	opdsNS             = "http://www.w3.org/2005/Atom"
	opdsCatalogNS      = "http://opds-spec.org/2010/catalog"
	opdsMIME           = "application/atom+xml;profile=opds-catalog;kind=navigation"
	opdsAcquisitionMIME = "application/atom+xml;profile=opds-catalog;kind=acquisition"
	dcNS               = "http://purl.org/dc/elements/1.1/"
)

// OPDSComic holds comic data for OPDS feed generation.
type OPDSComic struct {
	ID          string
	Title       string
	Author      string
	Description string
	Language    string
	Genre       string
	Publisher   string
	Year        int
	PageCount   int
	AddedAt     string
	UpdatedAt   string
	Tags        []string
	Filename    string
}

// ============================================================
// XML structures
// ============================================================

type atomFeed struct {
	XMLName xml.Name   `xml:"feed"`
	XMLNS   string     `xml:"xmlns,attr"`
	OPDS    string     `xml:"xmlns:opds,attr,omitempty"`
	DC      string     `xml:"xmlns:dc,attr,omitempty"`
	ID      string     `xml:"id"`
	Title   string     `xml:"title"`
	Updated string     `xml:"updated"`
	Author  *atomAuthor `xml:"author,omitempty"`
	Links   []atomLink  `xml:"link"`
	Entries []atomEntry `xml:"entry"`
}

type atomAuthor struct {
	Name string `xml:"name"`
	URI  string `xml:"uri,omitempty"`
}

type atomLink struct {
	Rel  string `xml:"rel,attr"`
	Href string `xml:"href,attr"`
	Type string `xml:"type,attr"`
}

type atomEntry struct {
	Title      string         `xml:"title"`
	ID         string         `xml:"id"`
	Updated    string         `xml:"updated,omitempty"`
	Published  string         `xml:"published,omitempty"`
	Content    *atomContent   `xml:"content,omitempty"`
	Links      []atomLink     `xml:"link"`
	Author     *atomAuthor    `xml:"author,omitempty"`
	Categories []atomCategory `xml:"category,omitempty"`
}

type atomContent struct {
	Type string `xml:"type,attr"`
	Text string `xml:",chardata"`
}

type atomCategory struct {
	Term  string `xml:"term,attr"`
	Label string `xml:"label,attr"`
}

// ============================================================
// Feed generators
// ============================================================

// GenerateRootCatalog creates the OPDS root navigation feed.
func GenerateRootCatalog(baseURL string) string {
	now := time.Now().UTC().Format(time.RFC3339)

	feed := atomFeed{
		XMLNS: opdsNS,
		OPDS:  opdsCatalogNS,
		ID:    baseURL + "/api/opds",
		Title: "NowenReader OPDS Catalog",
		Updated: now,
		Author: &atomAuthor{Name: "NowenReader", URI: baseURL},
		Links: []atomLink{
			{Rel: "self", Href: "/api/opds", Type: opdsMIME},
			{Rel: "start", Href: "/api/opds", Type: opdsMIME},
			{Rel: "search", Href: "/api/opds/search?q={searchTerms}", Type: opdsAcquisitionMIME},
		},
		Entries: []atomEntry{
			{
				Title:   "All Comics",
				ID:      baseURL + "/api/opds/all",
				Updated: now,
				Content: &atomContent{Type: "text", Text: "Browse all comics in the library"},
				Links:   []atomLink{{Rel: "subsection", Href: "/api/opds/all", Type: opdsAcquisitionMIME}},
			},
			{
				Title:   "Recently Added",
				ID:      baseURL + "/api/opds/recent",
				Updated: now,
				Content: &atomContent{Type: "text", Text: "Recently added comics"},
				Links:   []atomLink{{Rel: "subsection", Href: "/api/opds/recent", Type: opdsAcquisitionMIME}},
			},
			{
				Title:   "Favorites",
				ID:      baseURL + "/api/opds/favorites",
				Updated: now,
				Content: &atomContent{Type: "text", Text: "Favorite comics"},
				Links:   []atomLink{{Rel: "subsection", Href: "/api/opds/favorites", Type: opdsAcquisitionMIME}},
			},
		},
	}

	return marshalFeed(feed)
}

// GenerateAcquisitionFeed creates an OPDS acquisition feed.
func GenerateAcquisitionFeed(baseURL, title, feedID string, comics []OPDSComic, selfHref string) string {
	now := time.Now().UTC().Format(time.RFC3339)

	var entries []atomEntry
	for _, comic := range comics {
		ext := "zip"
		if idx := strings.LastIndex(comic.Filename, "."); idx >= 0 {
			ext = strings.ToLower(comic.Filename[idx+1:])
		}
		mimeType := mimeTypeForExt(ext)

		description := comic.Description
		if description == "" {
			description = fmt.Sprintf("%d pages", comic.PageCount)
		}

		entry := atomEntry{
			Title:     comic.Title,
			ID:        "urn:nowen:" + comic.ID,
			Updated:   comic.UpdatedAt,
			Published: comic.AddedAt,
			Content:   &atomContent{Type: "text", Text: description},
			Links: []atomLink{
				{Rel: "http://opds-spec.org/image", Href: "/api/comics/" + comic.ID + "/thumbnail", Type: "image/webp"},
				{Rel: "http://opds-spec.org/image/thumbnail", Href: "/api/comics/" + comic.ID + "/thumbnail", Type: "image/webp"},
				{Rel: "http://opds-spec.org/acquisition", Href: "/api/opds/download/" + comic.ID, Type: mimeType},
				{Rel: "http://opds-spec.org/acquisition/open-access", Href: "/api/comics/" + comic.ID + "/page/0", Type: "image/jpeg"},
			},
		}

		if comic.Author != "" {
			entry.Author = &atomAuthor{Name: comic.Author}
		}

		for _, tag := range comic.Tags {
			entry.Categories = append(entry.Categories, atomCategory{Term: tag, Label: tag})
		}

		entries = append(entries, entry)
	}

	feed := atomFeed{
		XMLNS:   opdsNS,
		OPDS:    opdsCatalogNS,
		DC:      dcNS,
		ID:      feedID,
		Title:   title,
		Updated: now,
		Links: []atomLink{
			{Rel: "self", Href: selfHref, Type: opdsAcquisitionMIME},
			{Rel: "start", Href: "/api/opds", Type: opdsMIME},
			{Rel: "search", Href: "/api/opds/search?q={searchTerms}", Type: opdsAcquisitionMIME},
		},
		Entries: entries,
	}

	return marshalFeed(feed)
}

func mimeTypeForExt(ext string) string {
	switch ext {
	case "cbz", "zip":
		return "application/x-cbz"
	case "cbr", "rar":
		return "application/x-cbr"
	case "cb7", "7z":
		return "application/x-cb7"
	case "pdf":
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}

func marshalFeed(feed atomFeed) string {
	data, err := xml.MarshalIndent(feed, "", "  ")
	if err != nil {
		return ""
	}
	return xml.Header + string(data)
}
