package store

import (
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestSingleSeriesGroupInheritsSeriesMetadataWithoutMemberSync(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatal(err)
	}

	library := &model.Library{
		ID:            "group-series-metadata-library",
		Name:          "Group Series Metadata",
		Type:          "comic",
		RootPath:      t.TempDir(),
		Enabled:       true,
		DefaultAccess: "public",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(library); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath") VALUES
			('group-series-volume-1', 'work/01.cbz', '01', 'comic', ?, 'work/01.cbz'),
			('group-series-volume-2', 'work/02.cbz', '02', 'comic', ?, 'work/02.cbz')
	`, library.ID, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle", "coverComicId")
		VALUES ('group-series-source', ?, 'work', 'Source Work', 'Source Work', 'group-series-volume-1')
	`, library.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := DB().Exec(`
		INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
			('group-series-source', 'group-series-volume-1', 0),
			('group-series-source', 'group-series-volume-2', 1)
	`); err != nil {
		t.Fatal(err)
	}

	author := "Series Author"
	description := "Series Description"
	publisher := "Series Publisher"
	language := "zh"
	genre := "Adventure"
	status := "finished"
	coverURL := "https://example.com/series-cover.jpg"
	year := 2026
	rating := 8.8
	ratingMax := 10.0
	ratingSource := "test"
	ratingAt := time.Now().UTC()
	if err := UpdateSeriesMetadata("group-series-source", SeriesMetadataUpdate{
		Author:                  &author,
		Description:             &description,
		Publisher:               &publisher,
		Language:                &language,
		Genre:                   &genre,
		Status:                  &status,
		CoverURL:                &coverURL,
		Year:                    &year,
		ExternalRating:          &rating,
		ExternalRatingMax:       &ratingMax,
		ExternalRatingSource:    &ratingSource,
		ExternalRatingUpdatedAt: &ratingAt,
	}); err != nil {
		t.Fatal(err)
	}
	if err := SetSeriesTags("group-series-source", []string{"Adventure", "Drama"}); err != nil {
		t.Fatal(err)
	}

	groupID64, err := CreateGroupWithItems("Custom Collection", "", nil, []string{"group-series-source"})
	if err != nil {
		t.Fatal(err)
	}
	groupID := int(groupID64)
	customAuthor := "Custom Author"
	if err := UpdateGroupMetadata(groupID, GroupMetadataUpdate{Author: &customAuthor}); err != nil {
		t.Fatal(err)
	}

	policy, err := GetGroupMetadataPolicy(groupID)
	if err != nil {
		t.Fatal(err)
	}
	if policy == nil || policy.DirectComicCount != 0 || policy.SeriesCount != 1 ||
		policy.SingleSeriesID != "group-series-source" || policy.AllowsMemberSync() {
		t.Fatalf("unexpected policy: %#v", policy)
	}

	result, err := InheritGroupMetadata(groupID)
	if err != nil {
		t.Fatal(err)
	}
	if result.SourceType != "series" || result.SourceID != "group-series-source" || result.TagsCopied != 2 {
		t.Fatalf("unexpected inheritance result: %#v", result)
	}
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil {
		t.Fatalf("load group: %v", err)
	}
	if group.Name != "Custom Collection" || group.Author != customAuthor ||
		group.Description != description || group.Publisher != publisher ||
		group.Language != language || group.Genre != genre || group.Status != status ||
		group.Year == nil || *group.Year != year {
		t.Fatalf("unexpected inherited group: %#v", group)
	}
	if len(group.SeriesList) != 1 || group.SeriesList[0].CoverURL != "/api/comics/series_group-series-source/thumbnail" ||
		group.CoverURL != "/api/comics/series_group-series-source/thumbnail" {
		t.Fatalf("series cover was not inherited dynamically: %#v", group.SeriesList)
	}
	tags, err := GetGroupTags(groupID)
	if err != nil || len(tags) != 2 {
		t.Fatalf("group tags = %#v, err=%v", tags, err)
	}
	var storedRating float64
	if err := DB().QueryRow(`SELECT "externalRating" FROM "ComicGroup" WHERE "id" = ?`, groupID).Scan(&storedRating); err != nil {
		t.Fatal(err)
	}
	if storedRating != rating {
		t.Fatalf("group rating = %v, want %v", storedRating, rating)
	}
}
