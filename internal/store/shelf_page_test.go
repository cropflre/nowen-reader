package store

import (
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func seedShelf(t testing.TB, novels, comics int) {
	t.Helper()
	for _, lib := range []model.Library{
		{ID: "novels", Name: "Novels", Type: "novel", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "public"},
		{ID: "comics", Name: "Comics", Type: "comic", RootPath: t.TempDir(), Enabled: true, DefaultAccess: "private"},
	} {
		if err := CreateLibrary(&lib); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "type", "libraryId", "relativePath", "pageCount", "fileSize", "description", "addedAt", "updatedAt", "rating", "sortOrder") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	defer stmt.Close()
	for _, config := range []struct {
		count          int
		kind, lib, ext string
	}{{novels, "novel", "novels", "txt"}, {comics, "comic", "comics", "cbz"}} {
		for i := 0; i < config.count; i++ {
			id := fmt.Sprintf("%s-%05d", config.kind, i)
			title := fmt.Sprintf("作品 %d", i)
			filename := id + "." + config.ext
			date := fmt.Sprintf("2026-01-%02dT00:00:00Z", i%28+1)
			if _, err := stmt.Exec(id, filename, title, BuildTitleSortKey(title), config.kind, config.lib, filename, i%100+1, i*100, strings.Repeat("内容", 100), date, date, i%5, i%7); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	works := []DetectedSeries{}
	for i := 0; i+4 < comics; i += 5 {
		title := fmt.Sprintf("目录 %d", i/5)
		work := DetectedSeries{ID: fmt.Sprintf("work-%05d", i/5), LibraryID: "comics", RootRelativePath: title, Title: title, SortTitle: BuildTitleSortKey(title), CoverComicID: fmt.Sprintf("comic-%05d", i)}
		for j := 0; j < 5; j++ {
			work.Items = append(work.Items, DetectedSeriesItem{ComicID: fmt.Sprintf("comic-%05d", i+j), SortIndex: j})
		}
		works = append(works, work)
	}
	if err := ReplaceDetectedSeries("comics", works); err != nil {
		t.Fatal(err)
	}
}

// Reference to the former full-materialization path, kept only in tests.
func legacyShelf(opts ComicListOptions) (*ComicListResult, error) {
	bypass, err := canBypassSeriesCollapse(opts)
	if err != nil {
		return nil, err
	}
	if bypass {
		opts.SeriesView = false
		opts.Page = 0
		opts.PageSize = 0
		return GetAllComics(opts)
	}
	flat := opts
	flat.SeriesView = false
	flat.Page = 0
	flat.PageSize = 0
	flat.MatchSeriesTags = true
	flat.MatchSeriesCategories = true
	result, err := GetAllComics(flat)
	if err != nil {
		return nil, err
	}
	items, err := legacyCollapseBatched(result.Comics, opts.UserID)
	if err != nil {
		return nil, err
	}
	orders, err := loadShelfSeriesOrders()
	if err != nil {
		return nil, err
	}
	sortSeriesShelfItemsWithOrders(items, opts.SortBy, opts.SortOrder, orders)
	if opts.SortBy == "pageCount" {
		sort.SliceStable(items, func(i, j int) bool {
			a, b := items[i], items[j]
			if a.PageCount != b.PageCount {
				if opts.SortOrder == "desc" {
					return a.PageCount > b.PageCount
				}
				return a.PageCount < b.PageCount
			}
			if a.TitleSortKey != b.TitleSortKey {
				return a.TitleSortKey < b.TitleSortKey
			}
			return a.ID < b.ID
		})
	}
	return &ComicListResult{Comics: items, Total: len(items)}, nil
}

// Match the former large-library-safe implementation: bounded membership SQL,
// but full book hydration and one separate summary lookup per directory work.
func legacyCollapseBatched(items []ComicListItem, userID string) ([]ComicListItem, error) {
	members := map[string]string{}
	works := map[string]bool{}
	ids := []string{}
	for _, item := range items {
		if item.ComicType == "comic" {
			ids = append(ids, item.ID)
		}
	}
	for start := 0; start < len(ids); start += seriesMembershipBatchSize {
		end := start + seriesMembershipBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		placeholders := []string{}
		args := []interface{}{}
		for _, id := range ids[start:end] {
			placeholders = append(placeholders, "?")
			args = append(args, id)
		}
		rows, err := db.Query(`SELECT "comicId", "seriesId" FROM "ComicSeriesItem" WHERE "comicId" IN (`+strings.Join(placeholders, ",")+`)`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var comicID, seriesID string
			if err := rows.Scan(&comicID, &seriesID); err != nil {
				rows.Close()
				return nil, err
			}
			members[comicID] = seriesID
			works[seriesID] = true
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	result := []ComicListItem{}
	for _, item := range items {
		if _, ok := members[item.ID]; !ok {
			result = append(result, item)
		}
	}
	for id := range works {
		summary, err := seriesSummaryByID(id, userID)
		if err != nil {
			return nil, err
		}
		if summary != nil && summary.ItemCount >= 2 {
			result = append(result, seriesShelfItem(*summary))
		}
	}
	return result, nil
}

func TestLogicalShelfMatchesLegacyFiltersAndSorts(t *testing.T) {
	setupTestDB(t)
	seedShelf(t, 13, 17)
	if err := CreateUser(&model.User{ID: "reader", Username: "reader", Password: "unused", Role: "user"}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"comic-00001", "novel-00004"} {
		if err := UpdateReadingProgress(id, 4, 5, "reader"); err != nil {
			t.Fatal(err)
		}
		if _, err := ToggleFavorite(id, "reader"); err != nil {
			t.Fatal(err)
		}
		if err := AddTagsToComic(id, []string{"精选"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := SetSeriesTags("work-00001", []string{"目录标签"}); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO "Category" ("name","slug") VALUES ('精选','selected')`)
	if err := SetSeriesCategories("work-00002", []string{"selected"}); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO "ComicGroup" ("id","name","shelfSeries","shelfSortMode") VALUES (7,'丛书',1,'manual')`)
	exec(`INSERT INTO "ComicGroupSeries" ("groupId","seriesId","sortIndex") VALUES (7,'work-00000',2),(7,'work-00001',1)`)
	exec(`INSERT INTO "ComicGroupItem" ("groupId","comicId","sortIndex") VALUES (7,'novel-00001',0)`)
	filters := []ComicListOptions{
		{}, {ContentType: "novel"}, {ContentType: "comic"}, {Search: "作品 1"}, {Tags: []string{"精选"}}, {Tags: []string{"目录标签"}},
		{Category: "selected"}, {Uncategorized: true}, {Untagged: true}, {FavoritesOnly: true}, {ReadingStatus: "finished"},
		{ExcludeGrouped: true}, {MetaFilter: "missing"}, {MetaFilter: "with"}, {FilterLibraryIDs: true, LibraryIDs: []string{"comics"}},
		{FilterLibraryIDs: true, LibraryIDs: []string{"novels"}}, {FilterLibraryIDs: true},
	}
	for _, mode := range []string{"manual", "volume", "publication"} {
		exec(`UPDATE "ComicGroup" SET "shelfSortMode"=? WHERE "id"=7`, mode)
		for fi, filter := range filters {
			for _, sortBy := range []string{"title", "addedAt", "updatedAt", "lastReadAt", "rating", "custom", "fileSize", "metadataSource", "pageCount"} {
				for _, direction := range []string{"asc", "desc"} {
					opts := filter
					opts.SeriesView = true
					opts.UserID = "reader"
					opts.SortBy = sortBy
					opts.SortOrder = direction
					want, err := legacyShelf(opts)
					if err != nil {
						t.Fatal(err)
					}
					gotIDs := []string{}
					for page := 1; page <= want.Total/3+1; page++ {
						opts.Page = page
						opts.PageSize = 3
						got, err := GetAllComicsShelfSafe(opts)
						if err != nil {
							t.Fatalf("mode=%s filter=%d sort=%s/%s: %v", mode, fi, sortBy, direction, err)
						}
						if got.Total != want.Total {
							t.Fatalf("mode=%s filter=%d sort=%s/%s total=%d want=%d", mode, fi, sortBy, direction, got.Total, want.Total)
						}
						for _, item := range got.Comics {
							gotIDs = append(gotIDs, item.ID)
						}
					}
					wantIDs := []string{}
					for _, item := range want.Comics {
						wantIDs = append(wantIDs, item.ID)
					}
					if !reflect.DeepEqual(gotIDs, wantIDs) {
						t.Fatalf("mode=%s filter=%d sort=%s/%s\ngot %v\nwant %v", mode, fi, sortBy, direction, gotIDs, wantIDs)
					}
				}
			}
		}
	}
}

func TestAccessibleLibrariesLogicalCountsAndPermissions(t *testing.T) {
	setupTestDB(t)
	seedShelf(t, 12, 17)
	for _, user := range []model.User{{ID: "reader", Username: "reader", Password: "unused", Role: "user"}, {ID: "admin", Username: "admin", Password: "unused", Role: "admin"}} {
		if err := CreateUser(&user); err != nil {
			t.Fatal(err)
		}
	}
	libs, err := GetAccessibleLibrariesWithCount("reader")
	if err != nil {
		t.Fatal(err)
	}
	if len(libs) != 1 || libs[0].ID != "novels" || libs[0].ShelfCount != 12 || libs[0].CanManage {
		t.Fatalf("public access: %+v", libs)
	}
	if err := SetUserLibraryAccess("reader", []LibraryAccessReq{{LibraryID: "comics", CanView: true, CanManage: true}}); err != nil {
		t.Fatal(err)
	}
	libs, err = GetAccessibleLibrariesWithCount("reader")
	if err != nil {
		t.Fatal(err)
	}
	for _, lib := range libs {
		if lib.ID == "comics" && (lib.ComicCount != 17 || lib.ShelfCount != 5 || !lib.CanManage) {
			t.Fatalf("comic counts/grants: %+v", lib)
		}
		shelf, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, FilterLibraryIDs: true, LibraryIDs: []string{lib.ID}, Page: 1, PageSize: 2})
		if err != nil {
			t.Fatal(err)
		}
		if shelf.Total != lib.ShelfCount {
			t.Fatalf("count mismatch: library=%+v shelf=%d", lib, shelf.Total)
		}
	}
	manageable, err := GetUserManageableLibraryIDs("admin")
	if err != nil {
		t.Fatal(err)
	}
	if !manageable["novels"] || !manageable["comics"] {
		t.Fatal(manageable)
	}
	if err := SetUserLibraryAccess("reader", nil); err != nil {
		t.Fatal(err)
	}
	if err := CreateUserGroup(&model.UserGroup{ID: "managers", Name: "Managers"}); err != nil {
		t.Fatal(err)
	}
	if err := SetGroupMembers("managers", []string{"reader"}); err != nil {
		t.Fatal(err)
	}
	if err := SetGroupLibraryAccessFull("managers", []GroupLibraryPermission{{LibraryID: "comics", CanView: true, CanManage: true}}); err != nil {
		t.Fatal(err)
	}
	inherited, err := GetUserManageableLibraryIDs("reader")
	if err != nil || !inherited["comics"] {
		t.Fatal("missing inherited grant", err)
	}
	if _, err := db.Exec(`UPDATE "Library" SET "enabled"=0 WHERE "id"='comics'`); err != nil {
		t.Fatal(err)
	}
	inherited, err = GetUserManageableLibraryIDs("reader")
	if err != nil || inherited["comics"] {
		t.Fatal("disabled library manageable", err)
	}

}

func TestLogicalShelfPreservesMembersOfStaleSeries(t *testing.T) {
	setupTestDB(t)
	seedShelf(t, 0, 5)
	if _, err := db.Exec(`DELETE FROM "Comic" WHERE "id" <> 'comic-00000'`); err != nil {
		t.Fatal(err)
	}
	shelf, err := GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	if shelf.Total != 1 || len(shelf.Comics) != 1 || shelf.Comics[0].ID != "comic-00000" {
		t.Fatalf("remaining book hidden: %+v", shelf)
	}
	if _, err := db.Exec(`UPDATE "Comic" SET "libraryId"='novels' WHERE "id"='comic-00000'`); err != nil {
		t.Fatal(err)
	}
	shelf, err = GetAllComicsShelfSafe(ComicListOptions{SeriesView: true, FilterLibraryIDs: true, LibraryIDs: []string{"novels"}, PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	if shelf.Total != 1 || shelf.Comics[0].LibraryID != "novels" {
		t.Fatalf("moved member hidden: %+v", shelf)
	}
}

func BenchmarkLogicalShelf(b *testing.B) {
	for _, size := range []int{17000, 50000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			if err := InitDB(b.TempDir() + "/shelf.db"); err != nil {
				b.Fatal(err)
			}
			defer CloseDB()
			if err := RunMigrations(); err != nil {
				b.Fatal(err)
			}
			comics := size * 5 / 17
			comics -= comics % 5
			seedShelf(b, size-comics, comics)
			opts := ComicListOptions{SeriesView: true, Page: 1, PageSize: 24, SortBy: "title", SortOrder: "asc"}
			for _, name := range []string{"SQL", "Legacy"} {
				b.Run(name, func(b *testing.B) {
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						var result *ComicListResult
						var err error
						if name == "SQL" {
							result, err = GetAllComicsShelfSafe(opts)
						} else {
							result, err = legacyShelf(opts)
						}
						if err != nil {
							b.Fatal(err)
						}
						if result.Total != size-comics+comics/5 {
							b.Fatal(result.Total)
						}
					}
				})
			}
		})
	}
}
