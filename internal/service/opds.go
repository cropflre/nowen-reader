package service

import (
	"encoding/xml"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	OPDSNavigationMIME  = "application/atom+xml;profile=opds-catalog;kind=navigation"
	OPDSAcquisitionMIME = "application/atom+xml;profile=opds-catalog;kind=acquisition"
	OpenSearchMIME      = "application/opensearchdescription+xml"

	opdsNS        = "http://www.w3.org/2005/Atom"
	opdsCatalogNS = "http://opds-spec.org/2010/catalog"
	opdsPSENS     = "http://vaemendis.net/opds-pse/ns"
	opdsPSEStream = "http://vaemendis.net/opds-pse/stream"
	dctermsNS     = "http://purl.org/dc/terms/"
	openSearchNS  = "http://a9.com/-/spec/opensearch/1.1/"
)

// OPDSComic holds comic data for OPDS feed generation.
type OPDSComic struct {
	ID           string
	Title        string
	Author       string
	Description  string
	Language     string
	Genre        string
	Publisher    string
	Year         int
	PageCount    int
	FileSize     int64
	AddedAt      string
	UpdatedAt    string
	Tags         []string
	Filename     string
	ComicType    string
	Collections  []OPDSCollectionLink
	LastReadPage int
	LastReadAt   string
}

type OPDSCollectionLink struct {
	Path  string
	Title string
}

type OPDSSeries struct {
	ID        string
	Title     string
	ItemCount int
	UpdatedAt string
}

type OPDSCollection struct {
	ID        string
	Title     string
	ItemCount int
	UpdatedAt string
}

type OPDSPagination struct {
	SelfHref     string
	FirstHref    string
	LastHref     string
	NextHref     string
	PreviousHref string
	TotalResults int
	ItemsPerPage int
	StartIndex   int
}

type OPDSAcquisitionFeedOptions struct {
	BaseURL    string
	Title      string
	FeedID     string
	Comics     []OPDSComic
	Pagination OPDSPagination
}

type OPDSSeriesFeedOptions struct {
	BaseURL    string
	Title      string
	FeedID     string
	Series     []OPDSSeries
	Pagination OPDSPagination
}

type OPDSCollectionFeedOptions struct {
	BaseURL     string
	Title       string
	FeedID      string
	Collections []OPDSCollection
	Pagination  OPDSPagination
}

type atomFeed struct {
	XMLName      xml.Name    `xml:"feed"`
	XMLNS        string      `xml:"xmlns,attr"`
	OPDS         string      `xml:"xmlns:opds,attr,omitempty"`
	PSE          string      `xml:"xmlns:pse,attr,omitempty"`
	DCTerms      string      `xml:"xmlns:dcterms,attr,omitempty"`
	OpenSearch   string      `xml:"xmlns:opensearch,attr,omitempty"`
	ID           string      `xml:"id"`
	Title        string      `xml:"title"`
	Updated      string      `xml:"updated"`
	Author       *atomAuthor `xml:"author,omitempty"`
	Links        []atomLink  `xml:"link"`
	TotalResults *int        `xml:"opensearch:totalResults,omitempty"`
	ItemsPerPage *int        `xml:"opensearch:itemsPerPage,omitempty"`
	StartIndex   *int        `xml:"opensearch:startIndex,omitempty"`
	Entries      []atomEntry `xml:"entry"`
}

type atomAuthor struct {
	Name string `xml:"name"`
	URI  string `xml:"uri,omitempty"`
}

type atomLink struct {
	Rel          string `xml:"rel,attr"`
	Href         string `xml:"href,attr"`
	Type         string `xml:"type,attr,omitempty"`
	Title        string `xml:"title,attr,omitempty"`
	Length       string `xml:"length,attr,omitempty"`
	Count        int    `xml:"pse:count,attr,omitempty"`
	LastRead     *int   `xml:"pse:lastRead,attr,omitempty"`
	LastReadDate string `xml:"pse:lastReadDate,attr,omitempty"`
}

type atomEntry struct {
	Title      string         `xml:"title"`
	ID         string         `xml:"id"`
	Updated    string         `xml:"updated"`
	Published  string         `xml:"published,omitempty"`
	Summary    *atomContent   `xml:"summary,omitempty"`
	Links      []atomLink     `xml:"link"`
	Author     *atomAuthor    `xml:"author,omitempty"`
	Categories []atomCategory `xml:"category,omitempty"`
	Language   string         `xml:"dcterms:language,omitempty"`
	Publisher  string         `xml:"dcterms:publisher,omitempty"`
	Issued     string         `xml:"dcterms:issued,omitempty"`
	Extent     string         `xml:"dcterms:extent,omitempty"`
}

type atomContent struct {
	Type string `xml:"type,attr"`
	Text string `xml:",chardata"`
}

type atomCategory struct {
	Term  string `xml:"term,attr"`
	Label string `xml:"label,attr,omitempty"`
}

type openSearchDescription struct {
	XMLName       xml.Name      `xml:"OpenSearchDescription"`
	XMLNS         string        `xml:"xmlns,attr"`
	ShortName     string        `xml:"ShortName"`
	Description   string        `xml:"Description"`
	InputEncoding string        `xml:"InputEncoding"`
	URL           openSearchURL `xml:"Url"`
}

type openSearchURL struct {
	Type     string `xml:"type,attr"`
	Template string `xml:"template,attr"`
}

// GenerateRootCatalog creates the OPDS 1.2 root navigation feed.
func GenerateRootCatalog(baseURL string) string {
	now := time.Now().UTC().Format(time.RFC3339)
	root := absoluteOPDSURL(baseURL, "/api/opds")

	feed := atomFeed{
		XMLNS:   opdsNS,
		OPDS:    opdsCatalogNS,
		ID:      root,
		Title:   "NowenReader Comics",
		Updated: now,
		Author:  &atomAuthor{Name: "NowenReader", URI: baseURL},
		Links: []atomLink{
			{Rel: "self", Href: root, Type: OPDSNavigationMIME},
			{Rel: "start", Href: root, Type: OPDSNavigationMIME},
			{Rel: "search", Href: absoluteOPDSURL(baseURL, "/api/opds/search.xml"), Type: OpenSearchMIME},
		},
		Entries: []atomEntry{
			newNavigationEntry(baseURL, now, "All Comics", "/api/opds/all", "Browse all downloadable comics", "subsection", OPDSAcquisitionMIME),
			newNavigationEntry(baseURL, now, "Collections", "/api/opds/collections", "Browse administrator-curated collections", "subsection", OPDSNavigationMIME),
			newNavigationEntry(baseURL, now, "Directory Works", "/api/opds/series", "Browse comics grouped by directory structure", "subsection", OPDSNavigationMIME),
			newNavigationEntry(baseURL, now, "Recently Added", "/api/opds/recent", "Recently added comics", "http://opds-spec.org/sort/new", OPDSAcquisitionMIME),
			newNavigationEntry(baseURL, now, "Favorites", "/api/opds/favorites", "Your favorite comics", "http://opds-spec.org/shelf", OPDSAcquisitionMIME),
		},
	}

	return marshalOPDSXML(feed)
}

func newNavigationEntry(baseURL, updated, title, href, description, rel, feedType string) atomEntry {
	absoluteHref := absoluteOPDSURL(baseURL, href)
	return atomEntry{
		Title:   title,
		ID:      absoluteHref,
		Updated: updated,
		Summary: &atomContent{Type: "text", Text: description},
		Links:   []atomLink{{Rel: rel, Href: absoluteHref, Type: feedType}},
	}
}

// GenerateSeriesNavigationFeed creates the series branch of the catalog.
func GenerateSeriesNavigationFeed(opts OPDSSeriesFeedOptions) string {
	groups := make([]opdsNavigationGroup, 0, len(opts.Series))
	for _, series := range opts.Series {
		groups = append(groups, opdsNavigationGroup{
			ID:        series.ID,
			Title:     series.Title,
			ItemCount: series.ItemCount,
			UpdatedAt: series.UpdatedAt,
		})
	}
	return generateGroupNavigationFeed(opdsGroupNavigationFeedOptions{
		BaseURL:      opts.BaseURL,
		Title:        opts.Title,
		FeedID:       opts.FeedID,
		Groups:       groups,
		Pagination:   opts.Pagination,
		PathPrefix:   "/api/opds/series",
		URNPrefix:    "urn:nowen:series:",
		UntitledName: "Untitled Directory Work",
	})
}

// GenerateCollectionNavigationFeed creates the curated collection branch.
func GenerateCollectionNavigationFeed(opts OPDSCollectionFeedOptions) string {
	groups := make([]opdsNavigationGroup, 0, len(opts.Collections))
	for _, collection := range opts.Collections {
		groups = append(groups, opdsNavigationGroup{
			ID:        collection.ID,
			Title:     collection.Title,
			ItemCount: collection.ItemCount,
			UpdatedAt: collection.UpdatedAt,
		})
	}
	return generateGroupNavigationFeed(opdsGroupNavigationFeedOptions{
		BaseURL:      opts.BaseURL,
		Title:        opts.Title,
		FeedID:       opts.FeedID,
		Groups:       groups,
		Pagination:   opts.Pagination,
		PathPrefix:   "/api/opds/collections",
		URNPrefix:    "urn:nowen:collection:",
		UntitledName: "Untitled Collection",
	})
}

type opdsNavigationGroup struct {
	ID        string
	Title     string
	ItemCount int
	UpdatedAt string
}

type opdsGroupNavigationFeedOptions struct {
	BaseURL      string
	Title        string
	FeedID       string
	Groups       []opdsNavigationGroup
	Pagination   OPDSPagination
	PathPrefix   string
	URNPrefix    string
	UntitledName string
}

func generateGroupNavigationFeed(opts opdsGroupNavigationFeedOptions) string {
	now := time.Now().UTC().Format(time.RFC3339)
	entries := make([]atomEntry, 0, len(opts.Groups))
	for _, group := range opts.Groups {
		title := strings.TrimSpace(group.Title)
		if title == "" {
			title = opts.UntitledName
		}
		hrefPath := strings.TrimRight(opts.PathPrefix, "/") + "/" + url.PathEscape(group.ID)
		href := absoluteOPDSURL(opts.BaseURL, hrefPath)
		entry := atomEntry{
			Title:   title,
			ID:      opts.URNPrefix + group.ID,
			Updated: validAtomDate(group.UpdatedAt, now),
			Summary: &atomContent{Type: "text", Text: fmt.Sprintf("%d comics", group.ItemCount)},
			Links: []atomLink{
				{Rel: "http://opds-spec.org/image", Href: absoluteOPDSURL(opts.BaseURL, hrefPath+"/cover")},
				{Rel: "http://opds-spec.org/image/thumbnail", Href: absoluteOPDSURL(opts.BaseURL, hrefPath+"/cover")},
				{Rel: "subsection", Href: href, Type: OPDSAcquisitionMIME},
			},
		}
		entries = append(entries, entry)
	}

	total := opts.Pagination.TotalResults
	itemsPerPage := opts.Pagination.ItemsPerPage
	startIndex := opts.Pagination.StartIndex
	feed := atomFeed{
		XMLNS:        opdsNS,
		OPDS:         opdsCatalogNS,
		OpenSearch:   openSearchNS,
		ID:           opts.FeedID,
		Title:        opts.Title,
		Updated:      now,
		Author:       &atomAuthor{Name: "NowenReader", URI: opts.BaseURL},
		TotalResults: &total,
		ItemsPerPage: &itemsPerPage,
		StartIndex:   &startIndex,
		Links: []atomLink{
			{Rel: "self", Href: absoluteOPDSURL(opts.BaseURL, opts.Pagination.SelfHref), Type: OPDSNavigationMIME},
			{Rel: "start", Href: absoluteOPDSURL(opts.BaseURL, "/api/opds"), Type: OPDSNavigationMIME},
			{Rel: "search", Href: absoluteOPDSURL(opts.BaseURL, "/api/opds/search.xml"), Type: OpenSearchMIME},
		},
		Entries: entries,
	}
	appendOPDSPaginationLinks(&feed, opts.BaseURL, opts.Pagination, OPDSNavigationMIME)
	return marshalOPDSXML(feed)
}

// GenerateOpenSearchDescription publishes the OPDS search template.
func GenerateOpenSearchDescription(baseURL string) string {
	description := openSearchDescription{
		XMLNS:         openSearchNS,
		ShortName:     "NowenReader",
		Description:   "Search the NowenReader comic catalog",
		InputEncoding: "UTF-8",
		URL: openSearchURL{
			Type:     OPDSAcquisitionMIME,
			Template: absoluteOPDSURL(baseURL, "/api/opds/search?q={searchTerms}"),
		},
	}
	return marshalOPDSXML(description)
}

// GenerateAcquisitionFeed creates a paginated OPDS 1.2 acquisition feed.
func GenerateAcquisitionFeed(opts OPDSAcquisitionFeedOptions) string {
	now := time.Now().UTC().Format(time.RFC3339)
	entries := make([]atomEntry, 0, len(opts.Comics))
	for _, comic := range opts.Comics {
		mimeType, ok := OPDSAcquisitionMIMEForFilename(comic.Filename)
		if !ok {
			continue
		}

		description := strings.TrimSpace(comic.Description)
		if description == "" && comic.PageCount > 0 {
			description = fmt.Sprintf("%d pages", comic.PageCount)
		}
		title := strings.TrimSpace(comic.Title)
		if title == "" {
			title = strings.TrimSuffix(filepath.Base(comic.Filename), filepath.Ext(comic.Filename))
		}

		entry := atomEntry{
			Title:     title,
			ID:        "urn:nowen:comic:" + comic.ID,
			Updated:   validAtomDate(comic.UpdatedAt, now),
			Published: validAtomDate(comic.AddedAt, ""),
			Links: []atomLink{
				{Rel: "http://opds-spec.org/image", Href: absoluteOPDSURL(opts.BaseURL, "/api/opds/cover/"+comic.ID)},
				{Rel: "http://opds-spec.org/image/thumbnail", Href: absoluteOPDSURL(opts.BaseURL, "/api/opds/cover/"+comic.ID)},
				{
					Rel:    "http://opds-spec.org/acquisition",
					Href:   absoluteOPDSURL(opts.BaseURL, opdsDownloadPath(comic.ID, comic.Filename)),
					Type:   mimeType,
					Length: opdsFileLength(comic.FileSize),
				},
			},
			Language:  strings.TrimSpace(comic.Language),
			Publisher: strings.TrimSpace(comic.Publisher),
		}
		if OPDSPSESupported(comic.Filename, comic.ComicType, comic.PageCount) {
			streamLink := atomLink{
				Rel:   opdsPSEStream,
				Href:  absoluteOPDSURL(opts.BaseURL, opdsPSEStreamPath(comic.ID)),
				Type:  "image/jpeg",
				Count: comic.PageCount,
			}
			if comic.LastReadAt != "" {
				lastRead := comic.LastReadPage + 1
				if lastRead < 1 {
					lastRead = 1
				}
				if lastRead > comic.PageCount {
					lastRead = comic.PageCount
				}
				streamLink.LastRead = &lastRead
				streamLink.LastReadDate = validAtomDate(comic.LastReadAt, "")
			}
			entry.Links = append(entry.Links, streamLink)
		}
		for _, collection := range comic.Collections {
			if strings.TrimSpace(collection.Path) == "" {
				continue
			}
			entry.Links = append(entry.Links, atomLink{
				Rel:   "collection",
				Href:  absoluteOPDSURL(opts.BaseURL, collection.Path),
				Type:  OPDSAcquisitionMIME,
				Title: strings.TrimSpace(collection.Title),
			})
		}
		if description != "" {
			entry.Summary = &atomContent{Type: "text", Text: description}
		}
		if author := strings.TrimSpace(comic.Author); author != "" {
			entry.Author = &atomAuthor{Name: author}
		}
		if comic.Year > 0 {
			entry.Issued = strconv.Itoa(comic.Year)
		}
		if comic.PageCount > 0 {
			entry.Extent = fmt.Sprintf("%d pages", comic.PageCount)
		}
		entry.Categories = opdsCategories(comic.Genre, comic.Tags)
		entries = append(entries, entry)
	}

	total := opts.Pagination.TotalResults
	itemsPerPage := opts.Pagination.ItemsPerPage
	startIndex := opts.Pagination.StartIndex
	feed := atomFeed{
		XMLNS:        opdsNS,
		OPDS:         opdsCatalogNS,
		PSE:          opdsPSENS,
		DCTerms:      dctermsNS,
		OpenSearch:   openSearchNS,
		ID:           opts.FeedID,
		Title:        opts.Title,
		Updated:      now,
		Author:       &atomAuthor{Name: "NowenReader", URI: opts.BaseURL},
		TotalResults: &total,
		ItemsPerPage: &itemsPerPage,
		StartIndex:   &startIndex,
		Links: []atomLink{
			{Rel: "self", Href: absoluteOPDSURL(opts.BaseURL, opts.Pagination.SelfHref), Type: OPDSAcquisitionMIME},
			{Rel: "start", Href: absoluteOPDSURL(opts.BaseURL, "/api/opds"), Type: OPDSNavigationMIME},
			{Rel: "search", Href: absoluteOPDSURL(opts.BaseURL, "/api/opds/search.xml"), Type: OpenSearchMIME},
		},
		Entries: entries,
	}
	appendOPDSPaginationLinks(&feed, opts.BaseURL, opts.Pagination, OPDSAcquisitionMIME)

	return marshalOPDSXML(feed)
}

// OPDSPSESupported reports whether a publication can be represented as
// zero-based image pages. Text-oriented publications remain downloadable
// through OPDS but do not advertise page streaming.
func OPDSPSESupported(filename, comicType string, pageCount int) bool {
	if comicType != "comic" || pageCount <= 0 {
		return false
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".cbz", ".zip", ".cbr", ".rar", ".cb7", ".7z", ".pdf",
		".epub", ".mobi", ".azw3":
		return true
	default:
		return false
	}
}

func opdsPSEStreamPath(comicID string) string {
	return "/api/opds/stream/" + comicID + "?page={pageNumber}&width={maxWidth}"
}

func opdsDownloadPath(comicID, filename string) string {
	name := filepath.Base(strings.TrimSpace(filename))
	if name == "" || name == "." {
		return "/api/opds/download/" + comicID
	}
	return "/api/opds/download/" + comicID + "/" + url.PathEscape(name)
}

func opdsFileLength(fileSize int64) string {
	if fileSize <= 0 {
		return ""
	}
	return strconv.FormatInt(fileSize, 10)
}

func appendOPDSPaginationLinks(feed *atomFeed, baseURL string, pagination OPDSPagination, feedType string) {
	links := []struct {
		rel  string
		href string
	}{
		{rel: "first", href: pagination.FirstHref},
		{rel: "last", href: pagination.LastHref},
		{rel: "previous", href: pagination.PreviousHref},
		{rel: "next", href: pagination.NextHref},
	}
	for _, link := range links {
		if link.href != "" {
			feed.Links = append(feed.Links, atomLink{Rel: link.rel, Href: absoluteOPDSURL(baseURL, link.href), Type: feedType})
		}
	}
}

// OPDSAcquisitionMIMEForFilename returns the comic publication media type.
func OPDSAcquisitionMIMEForFilename(filename string) (string, bool) {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".cbz", ".zip":
		return "application/vnd.comicbook+zip", true
	case ".cbr", ".rar":
		return "application/x-cbr", true
	case ".cb7", ".7z":
		return "application/x-cb7", true
	case ".pdf":
		return "application/pdf", true
	case ".epub":
		return "application/epub+zip", true
	case ".mobi":
		return "application/x-mobipocket-ebook", true
	case ".azw3":
		return "application/vnd.amazon.mobi8-ebook", true
	case ".txt":
		return "text/plain", true
	case ".html", ".htm":
		return "text/html", true
	default:
		return "", false
	}
}

func opdsCategories(genre string, tags []string) []atomCategory {
	seen := make(map[string]struct{})
	values := make([]string, 0, len(tags)+2)
	values = append(values, strings.FieldsFunc(genre, func(r rune) bool {
		return r == ',' || r == ';' || r == '/' || r == '\uFF0C' || r == '\uFF1B'
	})...)
	values = append(values, tags...)

	categories := make([]atomCategory, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		categories = append(categories, atomCategory{Term: value, Label: value})
	}
	return categories
}

func validAtomDate(value, fallback string) string {
	if value == "" {
		return fallback
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return fallback
	}
	return parsed.UTC().Format(time.RFC3339)
}

func absoluteOPDSURL(baseURL, href string) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}

	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" {
		return strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(href, "/")
	}

	basePath := strings.TrimRight(u.Path, "/")
	hrefURL, err := url.Parse(href)
	if err != nil {
		hrefURL = &url.URL{Path: href}
	}

	cleanHref := hrefURL.Path
	if !strings.HasPrefix(cleanHref, "/") {
		cleanHref = "/" + cleanHref
	}

	if basePath != "" && (strings.HasPrefix(cleanHref, basePath+"/") || cleanHref == basePath) {
		u.Path = cleanHref
	} else {
		u.Path = basePath + cleanHref
	}

	u.RawQuery = hrefURL.RawQuery
	u.Fragment = hrefURL.Fragment
	return u.String()
}

func marshalOPDSXML(value interface{}) string {
	data, err := xml.MarshalIndent(value, "", "  ")
	if err != nil {
		return ""
	}
	return xml.Header + string(data)
}
