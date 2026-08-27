package service

import "testing"

func TestThumbnailCacheOwnerID(t *testing.T) {
	cases := map[string]string{
		"abc123_300x400.webp":             "abc123",
		"legacy_id_with_underscore_300x400.webp": "legacy_id_with_underscore",
		"group_13_300x400.webp":           "group_13",
		"series_ser_123_300x400.webp":     "series_ser_123",
		"invalid.webp":                    "",
	}
	for name, want := range cases {
		if got := thumbnailCacheOwnerID(name); got != want {
			t.Fatalf("thumbnailCacheOwnerID(%q)=%q, want %q", name, got, want)
		}
	}
}
