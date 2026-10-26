package service

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestDetectComicSeriesWithDepthMatrix(t *testing.T) {
	// Fixture reproducing Issue #43 ("韩漫" aggregated as one huge work at depth=1)
	// plus all boundary cases from the plan matrix.
	items := []store.SeriesSourceItem{
		{ID: "kr-a-1", Title: "01", RelativePath: "韩漫/书A/01.cbz"},
		{ID: "kr-a-2", Title: "02", RelativePath: "韩漫/书A/02.cbz"},
		{ID: "kr-a-s1", Title: "01", RelativePath: "韩漫/书A/第一季/01.cbz"},
		{ID: "kr-b-1", Title: "韩漫 书B", RelativePath: "韩漫/书B/书B.cbz"},
		{ID: "jp-a-1", Title: "01", RelativePath: "日漫/书A/01.cbz"},
		{ID: "kr-img-ch", Title: "第01.5话", RelativePath: "韩漫/图片书/第01.5话/"},
		{ID: "kr-img-single", Title: "整本图片漫画", RelativePath: "韩漫/整本图片漫画/"},
		{ID: "kr-shallow", Title: "散本", RelativePath: "韩漫/散本.cbz"},
		{ID: "root-shallow", Title: "根散本", RelativePath: "根散本.cbz"},
	}

	// Baseline depth=1 reproduces Issue #43: everything under "韩漫/" collapses into "韩漫".
	depth1 := DetectComicSeriesWithDepth("lib-1", 1, items)
	if len(depth1) != 1 || depth1[0].RootRelativePath != "韩漫" || depth1[0].Title != "韩漫" {
		t.Fatalf("depth=1 expected single '韩漫' series (jp-a-1 has 1 item so standalone), got %#v", depth1)
	}

	// Depth=2 separates categories from works, keeps single-chapter works,
	// distinguishes same-title works across categories, and leaves shallow items standalone.
	depth2 := DetectComicSeriesWithDepth("lib-1", 2, items)
	byRoot := make(map[string]store.DetectedSeries, len(depth2))
	groupedIDs := make(map[string]bool)
	for _, s := range depth2 {
		byRoot[s.RootRelativePath] = s
		for _, item := range s.Items {
			groupedIDs[item.ComicID] = true
		}
	}
	if len(depth2) != 4 {
		t.Fatalf("depth=2 series count = %d, want 4 (日漫/书A, 韩漫/书A, 韩漫/书B, 韩漫/图片书): %#v", len(depth2), depth2)
	}

	krA, ok := byRoot["韩漫/书A"]
	if !ok || krA.Title != "书A" || len(krA.Sections) != 1 || krA.Sections[0].Title != "第一季" || krA.Sections[0].RelativePath != "韩漫/书A/第一季" {
		t.Fatalf("unexpected 韩漫/书A at depth=2: %#v", krA)
	}
	jpA, ok := byRoot["日漫/书A"]
	if !ok || jpA.Title != "书A" || len(jpA.Items) != 1 {
		t.Fatalf("unexpected 日漫/书A at depth=2: %#v", jpA)
	}
	if krA.ID == jpA.ID {
		t.Fatalf("same-named works under different categories must NOT share ID: %s", krA.ID)
	}

	krB, ok := byRoot["韩漫/书B"]
	if !ok || krB.Title != "书B" || len(krB.Items) != 1 {
		t.Fatalf("single-chapter work 韩漫/书B missing or wrong: %#v", krB)
	}
	if krB.Items[0].DisplayLabel != "书B" {
		t.Fatalf("DisplayLabel leaked category name: got %q, want %q", krB.Items[0].DisplayLabel, "书B")
	}

	imgBook, ok := byRoot["韩漫/图片书"]
	if !ok || len(imgBook.Items) != 1 || imgBook.Items[0].DisplayLabel != "第01.5话" {
		t.Fatalf("image-folder chapter work unexpected: %#v", imgBook)
	}

	for _, standaloneID := range []string{"kr-img-single", "kr-shallow", "root-shallow"} {
		if groupedIDs[standaloneID] {
			t.Fatalf("shallow item %s must stay standalone at depth=2", standaloneID)
		}
	}

	// Depth=3: two category layers ("区域/韩漫/书A/01.cbz")
	depth3Items := []store.SeriesSourceItem{
		{ID: "d3-1", Title: "01", RelativePath: "亚洲/韩漫/书A/第一季/01.cbz"},
		{ID: "d3-shallow", Title: "浅层", RelativePath: "亚洲/韩漫/散本.cbz"},
	}
	depth3 := DetectComicSeriesWithDepth("lib-1", 3, depth3Items)
	if len(depth3) != 1 || depth3[0].RootRelativePath != "亚洲/韩漫/书A" || depth3[0].Title != "书A" {
		t.Fatalf("depth=3 unexpected series: %#v", depth3)
	}
	if len(depth3[0].Sections) != 1 || depth3[0].Sections[0].RelativePath != "亚洲/韩漫/书A/第一季" {
		t.Fatalf("depth=3 section offset unexpected: %#v", depth3[0].Sections)
	}
}
