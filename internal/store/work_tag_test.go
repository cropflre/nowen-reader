package store

import "testing"

func TestWorkTagsFilterCountAndMerge(t *testing.T) {
	setupTestDB(t)
	for _, statement := range []string{
		`INSERT INTO "Library" ("id", "name", "rootPath", "type", "enabled") VALUES
		 ('visible-tags', 'Visible', '/visible', 'comic', 1), ('hidden-tags', 'Hidden', '/hidden', 'comic', 1)`,
		`INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId") VALUES
		 ('tags-v1', '01.cbz', '01', 'comic', 'visible-tags'),
		 ('tags-v2', '02.cbz', '02', 'comic', 'visible-tags'),
		 ('tags-hidden', 'hidden.cbz', 'Hidden', 'comic', 'hidden-tags')`,
		`INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle") VALUES
		 ('tags-series', 'visible-tags', 'work', 'Work', 'work')`,
		`INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
		 ('tags-series', 'tags-v1', 0), ('tags-series', 'tags-v2', 1)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	groupID, err := CreateGroupWithItems("Visible collection", "", nil, []string{"tags-series"})
	if err != nil {
		t.Fatal(err)
	}
	hiddenID, err := CreateGroupWithItems("Hidden collection", "", []string{"tags-hidden"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, save := range []func() error{
		func() error { return SetSeriesTags("tags-series", []string{"目录标签"}) },
		func() error { return SetGroupTags(int(groupID), []string{"合集标签"}) },
		func() error { return SetGroupTags(int(hiddenID), []string{"隐藏标签"}) },
		func() error { return AddTagsToComic("tags-v1", []string{"卷标签"}) },
	} {
		if err := save(); err != nil {
			t.Fatal(err)
		}
	}
	for _, query := range []func(ComicListOptions) (*ComicListResult, error){GetAllComicsShelfSafe, GetAllComics} {
		result, err := query(ComicListOptions{
			SeriesView: true, Tags: []string{"目录标签"}, ContentType: "comic",
			FilterLibraryIDs: true, LibraryIDs: []string{"visible-tags"}, Page: 1, PageSize: 24,
		})
		if err != nil || result.Total != 1 || len(result.Comics) != 1 || result.Comics[0].ID != SeriesShelfIDPrefix+"tags-series" {
			t.Fatalf("tagged directory shelf = %#v, err = %v", result, err)
		}
		found := false
		for _, tag := range result.Comics[0].Tags {
			found = found || tag.Name == "目录标签"
		}
		if !found {
			t.Fatalf("directory tags missing from shelf: %#v", result.Comics[0].Tags)
		}
	}
	untagged, err := GetAllComicsShelfSafe(ComicListOptions{
		SeriesView: true, Untagged: true, ContentType: "comic",
		FilterLibraryIDs: true, LibraryIDs: []string{"visible-tags"},
	})
	if err != nil || untagged.Total != 0 {
		t.Fatalf("tagged directory appeared as untagged: %#v, err = %v", untagged, err)
	}
	flat, err := GetAllComics(ComicListOptions{Tags: []string{"目录标签"}})
	if err != nil || flat.Total != 0 {
		t.Fatalf("directory tags leaked onto individual units: %#v, err = %v", flat, err)
	}
	for _, names := range [][]string{{"合集标签"}, {"合集标签", "卷标签"}, {"隐藏标签"}} {
		groups, err := GetAllGroupsWithOptions(GroupListOptions{
			Tags: names, FilterLibraryIDs: true, LibraryIDs: []string{"visible-tags"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if names[0] == "隐藏标签" {
			if len(groups) != 0 {
				t.Fatalf("hidden group leaked through own tag filter: %#v", groups)
			}
		} else if len(groups) != 1 || groups[0].ID != int(groupID) {
			t.Fatalf("own/member tag filter %v = %#v", names, groups)
		}
	}

	// Merge into a tag already present on some of the same works. Every
	// association must survive without duplicate rows or dropped work tags.
	for _, save := range []func() error{
		func() error { return SetSeriesTags("tags-series", []string{"旧标签", "目标标签"}) },
		func() error { return SetGroupTags(int(groupID), []string{"旧标签", "目标标签"}) },
		func() error { return AddTagsToComic("tags-v1", []string{"旧标签"}) },
	} {
		if err := save(); err != nil {
			t.Fatal(err)
		}
	}
	if err := RenameTag("旧标签", "目标标签"); err != nil {
		t.Fatal(err)
	}
	seriesTags, err := GetSeriesTags("tags-series")
	if err != nil || len(seriesTags) != 1 || seriesTags[0].Name != "目标标签" {
		t.Fatalf("merged series tags = %#v, err = %v", seriesTags, err)
	}
	groupTags, err := GetGroupTags(int(groupID))
	if err != nil || len(groupTags) != 1 || groupTags[0].Name != "目标标签" {
		t.Fatalf("merged group tags = %#v, err = %v", groupTags, err)
	}
	tags, err := GetAllTags()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tag := range tags {
		if tag.Name == "旧标签" {
			t.Fatal("merged source still exists")
		}
		if tag.Name == "目标标签" {
			found = true
			if tag.Count != 3 {
				t.Fatalf("merged tag count = %d, want comic + series + collection", tag.Count)
			}
		}
	}
	if !found {
		t.Fatal("merged target tag missing")
	}
}

func TestGroupTagSaveRollsBackOnFailure(t *testing.T) {
	setupTestDB(t)
	id, err := CreateGroup("Tags")
	if err != nil {
		t.Fatal(err)
	}
	if err := SetGroupTags(int(id), []string{"原标签"}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER reject_test_tag BEFORE INSERT ON "Tag"
	 WHEN NEW."name" = '拒绝标签' BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := SetGroupTags(int(id), []string{"新标签", "拒绝标签"}); err == nil {
		t.Fatal("expected save failure")
	}
	tags, err := GetGroupTags(int(id))
	if err != nil || len(tags) != 1 || tags[0].Name != "原标签" {
		t.Fatalf("original tags lost on failure: %#v, err = %v", tags, err)
	}
}
