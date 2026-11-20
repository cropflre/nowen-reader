package service

import (
	"strings"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestDetectComicSeriesSkipsSingleBookMultiFormatFolder(t *testing.T) {
	items := []store.SeriesSourceItem{
		// Single-book multi-format folder at depth=1 -> NOT a ComicSeries
		{ID: "alita-cbz", Title: "铳梦", RelativePath: "铳梦/铳梦.cbz"},
		{ID: "alita-pdf", Title: "铳梦", RelativePath: "铳梦/铳梦.pdf"},
		// Multi-volume series where Volume 1 has 2 formats -> STILL a ComicSeries
		{ID: "op-v1-cbz", Title: "第01卷", RelativePath: "海贼王/第01卷.cbz"},
		{ID: "op-v1-pdf", Title: "第01卷", RelativePath: "海贼王/第01卷.pdf"},
		{ID: "op-v2-cbz", Title: "第02卷", RelativePath: "海贼王/第02卷.cbz"},
	}

	series := DetectComicSeriesWithDepth("lib-c", 1, items)
	if len(series) != 1 || series[0].RootRelativePath != "海贼王" {
		t.Fatalf("detected series = %#v, want ONLY 海贼王 (not single-book multi-format folder 铳梦)", series)
	}
	if len(series[0].Items) != 3 {
		t.Fatalf("海贼王 items = %d, want 3 raw files (collapsed later by GetSeriesDetail)", len(series[0].Items))
	}
}

func TestAcquisitionFeedEmitsMultipleFormatLinks(t *testing.T) {
	feed := GenerateAcquisitionFeed(OPDSAcquisitionFeedOptions{
		BaseURL: "http://example.test",
		Title:   "MultiFormat",
		FeedID:  "urn:test:multiformat",
		Comics: []OPDSComic{{
			ID:        "ed-1",
			Title:     "Three Body",
			Filename:  "Three Body.cbz",
			ComicType: "comic",
			FileSize:  1234,
			AddedAt:   "2026-01-01T00:00:00Z",
			UpdatedAt: "2026-01-01T00:00:00Z",
			Editions: []OPDSEditionLink{
				{ComicID: "ed-1", Filename: "Three Body.cbz", Format: "CBZ", FileSize: 1234},
				{ComicID: "ed-2", Filename: "Three Body.pdf", Format: "PDF", FileSize: 5678},
			},
		}},
	})
	assertValidXML(t, feed)

	for _, expected := range []string{
		`href="http://example.test/api/opds/download/ed-1/Three%20Body.cbz" type="application/vnd.comicbook+zip" title="CBZ" length="1234"`,
		`href="http://example.test/api/opds/download/ed-2/Three%20Body.pdf" type="application/pdf" title="PDF" length="5678"`,
	} {
		if !strings.Contains(feed, expected) {
			t.Fatalf("multi-format OPDS feed missing %q: %s", expected, feed)
		}
	}
}
