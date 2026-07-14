package service

import (
	"strings"
	"testing"
)

func TestAcquisitionFeedDoesNotClaimFixedThumbnailFormat(t *testing.T) {
	feed := GenerateAcquisitionFeed(
		"http://example.test",
		"Library",
		"urn:test:library",
		[]OPDSComic{{ID: "comic-1", Title: "Comic", Filename: "comic.cbz"}},
		"/api/opds/all",
	)

	for _, rel := range []string{
		"http://opds-spec.org/image",
		"http://opds-spec.org/image/thumbnail",
	} {
		linkStart := `<link rel="` + rel + `" href="/api/comics/comic-1/thumbnail"`
		if !strings.Contains(feed, linkStart+`></link>`) {
			t.Fatalf("thumbnail link %q should defer to the response Content-Type: %s", rel, feed)
		}
	}
}
