package store

import (
	"fmt"
	"strings"
)

const seriesMembershipBatchSize = 500

// GetAllComicsShelfSafe returns the logical shelf without exceeding SQLite's
// variable limit on large libraries. Novel-only shelves and shelves without
// directory series keep the normal SQL pagination path instead of loading the
// entire library into memory.
func GetAllComicsShelfSafe(opts ComicListOptions) (*ComicListResult, error) {
	if !opts.SeriesView {
		return GetAllComics(opts)
	}

	bypass, err := canBypassSeriesCollapse(opts)
	if err != nil {
		return nil, err
	}
	if bypass {
		plain := opts
		plain.SeriesView = false
		return GetAllComics(plain)
	}

	return getAllComicsSeriesViewBatched(opts)
}

func canBypassSeriesCollapse(opts ComicListOptions) (bool, error) {
	if opts.ContentType == "novel" {
		return true, nil
	}

	ids := normalizedShelfLibraryIDs(opts.LibraryIDs)
	if opts.FilterLibraryIDs && len(ids) == 0 {
		return true, nil
	}

	// If every explicitly selected library is a novel library, directory
	// series cannot participate in this shelf at all.
	if opts.FilterLibraryIDs && len(ids) > 0 {
		allNovel := true
		for i := 0; i < len(ids); i += seriesMembershipBatchSize {
			end := i + seriesMembershipBatchSize
			if end > len(ids) {
				end = len(ids)
			}
			batch := ids[i:end]
			placeholders := make([]string, len(batch))
			args := make([]interface{}, len(batch))
			for j, id := range batch {
				placeholders[j] = "?"
				args[j] = id
			}
			var nonNovel int
			if err := db.QueryRow(
				fmt.Sprintf(`SELECT COUNT(*) FROM "Library" WHERE "id" IN (%s) AND "type" <> 'novel'`, strings.Join(placeholders, ",")),
				args...,
			).Scan(&nonNovel); err != nil {
				return false, fmt.Errorf("inspect library types: %w", err)
			}
			if nonNovel > 0 {
				allNovel = false
				break
			}
		}
		if allNovel {
			return true, nil
		}
	}

	// The common self-hosted case has no detected directory series at all. A
	// cheap EXISTS query lets even a 50k+ mixed/novel shelf retain real SQL
	// pagination instead of materialising every item in Go.
	if !opts.FilterLibraryIDs {
		var exists int
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM "ComicSeriesItem" LIMIT 1)`).Scan(&exists); err != nil {
			return false, fmt.Errorf("inspect series memberships: %w", err)
		}
		return exists == 0, nil
	}

	for i := 0; i < len(ids); i += seriesMembershipBatchSize {
		end := i + seriesMembershipBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]
		placeholders := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for j, id := range batch {
			placeholders[j] = "?"
			args[j] = id
		}
		var exists int
		if err := db.QueryRow(fmt.Sprintf(`
			SELECT EXISTS(
				SELECT 1
				FROM "ComicSeriesItem" si
				JOIN "Comic" c ON c."id" = si."comicId"
				WHERE c."libraryId" IN (%s)
				LIMIT 1
			)
		`, strings.Join(placeholders, ",")), args...).Scan(&exists); err != nil {
			return false, fmt.Errorf("inspect scoped series memberships: %w", err)
		}
		if exists != 0 {
			return false, nil
		}
	}
	return true, nil
}

func normalizedShelfLibraryIDs(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	ids := make([]string, 0, len(raw))
	for _, id := range raw {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func getAllComicsSeriesViewBatched(opts ComicListOptions) (*ComicListResult, error) {
	page, pageSize := opts.Page, opts.PageSize
	if page < 1 {
		page = 1
	}

	flatOpts := opts
	flatOpts.SeriesView = false
	flatOpts.Page = 0
	flatOpts.PageSize = 0
	flat, err := GetAllComics(flatOpts)
	if err != nil {
		return nil, err
	}

	items, err := collapseComicListIntoSeriesBatched(flat.Comics, opts.UserID)
	if err != nil {
		return nil, err
	}

	shelfOrders := map[string]shelfSeriesOrder{}
	if opts.SortBy == "" || opts.SortBy == "title" {
		shelfOrders, err = loadShelfSeriesOrders()
		if err != nil {
			return nil, fmt.Errorf("load shelf series order: %w", err)
		}
	}
	sortSeriesShelfItemsWithOrders(items, opts.SortBy, opts.SortOrder, shelfOrders)

	total := len(items)
	totalPages := 1
	if pageSize > 0 {
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		start := (page - 1) * pageSize
		if start >= total {
			items = []ComicListItem{}
		} else {
			end := start + pageSize
			if end > total {
				end = total
			}
			items = items[start:end]
		}
	} else {
		pageSize = total
	}

	return &ComicListResult{
		Comics:     items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

// collapseComicListIntoSeriesBatched mirrors CollapseComicListIntoSeries but
// resolves memberships in bounded batches. The old implementation generated
// one SQL placeholder per shelf item, which fails with "too many SQL variables"
// on large libraries.
func collapseComicListIntoSeriesBatched(items []ComicListItem, userID string) ([]ComicListItem, error) {
	if len(items) == 0 {
		return items, nil
	}

	// Directory series are a comic feature. Skipping novel IDs both reduces DB
	// work and avoids needlessly touching tens of thousands of novel rows.
	candidateIDs := make([]string, 0, len(items))
	for _, item := range items {
		if item.ComicType == "comic" {
			candidateIDs = append(candidateIDs, item.ID)
		}
	}
	if len(candidateIDs) == 0 {
		return items, nil
	}

	memberToSeries := make(map[string]string)
	seriesIDs := make(map[string]struct{})
	for i := 0; i < len(candidateIDs); i += seriesMembershipBatchSize {
		end := i + seriesMembershipBatchSize
		if end > len(candidateIDs) {
			end = len(candidateIDs)
		}
		batch := candidateIDs[i:end]
		placeholders := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for j, id := range batch {
			placeholders[j] = "?"
			args[j] = id
		}

		rows, err := db.Query(
			fmt.Sprintf(`SELECT "comicId", "seriesId" FROM "ComicSeriesItem" WHERE "comicId" IN (%s)`, strings.Join(placeholders, ",")),
			args...,
		)
		if err != nil {
			return nil, fmt.Errorf("load series memberships: %w", err)
		}
		for rows.Next() {
			var comicID, seriesID string
			if err := rows.Scan(&comicID, &seriesID); err != nil {
				rows.Close()
				return nil, err
			}
			memberToSeries[comicID] = seriesID
			seriesIDs[seriesID] = struct{}{}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	if len(seriesIDs) == 0 {
		return items, nil
	}

	collapsed := make([]ComicListItem, 0, len(items)-len(memberToSeries)+len(seriesIDs))
	for _, item := range items {
		if _, grouped := memberToSeries[item.ID]; !grouped {
			collapsed = append(collapsed, item)
		}
	}
	for seriesID := range seriesIDs {
		summary, err := seriesSummaryByID(seriesID, userID)
		if err != nil {
			return nil, err
		}
		if summary == nil || summary.ItemCount < 2 {
			continue
		}
		tags := []ComicTagInfo{{Name: fmt.Sprintf("%d 项", summary.ItemCount), Color: ""}}
		if summary.SectionCount > 0 {
			tags = append(tags, ComicTagInfo{Name: fmt.Sprintf("%d 季/篇", summary.SectionCount), Color: ""})
		}
		collapsed = append(collapsed, ComicListItem{
			ID:            SeriesShelfIDPrefix + summary.ID,
			Filename:      "__series__.cbz",
			Title:         summary.Title,
			TitleSortKey:  BuildTitleSortKey(summary.Title),
			PageCount:     summary.ItemCount,
			FileSize:      summary.FileSize,
			AddedAt:       summary.CreatedAt,
			UpdatedAt:     summary.UpdatedAt,
			LastReadPage:  summary.CompletedItemCount,
			LastReadAt:    summary.LastReadAt,
			IsFavorite:    summary.IsFavorite,
			TotalReadTime: summary.TotalReadTime,
			CoverURL:      summary.CoverURL,
			ComicType:     "comic",
			LibraryID:     summary.LibraryID,
			ComicCount:    summary.ItemCount,
			Tags:          tags,
			Categories:    []ComicCategoryInfo{},
		})
	}
	return collapsed, nil
}
