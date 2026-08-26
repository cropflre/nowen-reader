package store

import (
	"fmt"
	"strings"
)

// getAllComicsPageCountSQL handles page-count sorting without materialising the
// complete filtered library. With SeriesView it sorts logical Series cards by
// member count (the same value exposed as PageCount); otherwise it pages Comic
// rows directly by c.pageCount.
func getAllComicsPageCountSQL(opts ComicListOptions) (*ComicListResult, error) {
	whereClause, joinClause, joinArgs, filterArgs, err := buildLogicalShelfFilter(opts)
	if err != nil {
		return nil, err
	}
	page := opts.Page
	if page < 1 {
		page = 1
	}
	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = largeShelfDefaultPageSize
	}
	if pageSize > largeShelfMaxPageSize {
		pageSize = largeShelfMaxPageSize
	}
	direction := "ASC"
	if strings.EqualFold(opts.SortOrder, "desc") {
		direction = "DESC"
	}
	baseArgs := append(append([]interface{}{}, joinArgs...), filterArgs...)

	if !opts.SeriesView {
		var total int
		countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM "Comic" c %s %s`, joinClause, whereClause)
		if err := db.QueryRow(countQuery, baseArgs...).Scan(&total); err != nil {
			return nil, fmt.Errorf("count page-count shelf: %w", err)
		}
		totalPages := 1
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		query := fmt.Sprintf(`SELECT c."id" FROM "Comic" c %s %s ORDER BY c."pageCount" %s, c."titleSortKey" ASC, c."title" ASC, c."id" ASC LIMIT ? OFFSET ?`, joinClause, whereClause, direction)
		args := append(append([]interface{}{}, baseArgs...), pageSize, (page-1)*pageSize)
		rows, err := db.Query(query, args...)
		if err != nil {
			return nil, fmt.Errorf("page page-count shelf: %w", err)
		}
		ids := make([]string, 0, pageSize)
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		items, err := hydrateComicShelfIDs(ids, opts.UserID)
		if err != nil {
			return nil, err
		}
		return &ComicListResult{Comics: items, Total: total, Page: page, PageSize: pageSize, TotalPages: totalPages}, nil
	}

	cte := fmt.Sprintf(`
WITH filtered AS (
	SELECT c."id", c."title", c."titleSortKey", c."pageCount"
	FROM "Comic" c
	%s
	%s
), eligible_series AS (
	SELECT DISTINCT si."seriesId" AS "id"
	FROM filtered f
	JOIN "ComicSeriesItem" si ON si."comicId" = f."id"
	WHERE (SELECT COUNT(*) FROM "ComicSeriesItem" allsi WHERE allsi."seriesId" = si."seriesId") >= 2
), logical AS (
	SELECT 'comic' AS "kind", f."id" AS "id", f."pageCount" AS "pageCount", f."titleSortKey" AS "sortKey", f."title" AS "title"
	FROM filtered f
	LEFT JOIN "ComicSeriesItem" si ON si."comicId" = f."id"
	LEFT JOIN eligible_series es ON es."id" = si."seriesId"
	WHERE es."id" IS NULL
	UNION ALL
	SELECT 'series' AS "kind", s."id" AS "id",
	       (SELECT COUNT(*) FROM "ComicSeriesItem" allsi WHERE allsi."seriesId" = s."id") AS "pageCount",
	       COALESCE(NULLIF(s."sortTitle", ''), title_sort_key(s."title")) AS "sortKey",
	       s."title" AS "title"
	FROM eligible_series es
	JOIN "ComicSeries" s ON s."id" = es."id"
)
`, joinClause, whereClause)

	var total int
	if err := db.QueryRow(cte+`SELECT COUNT(*) FROM logical`, baseArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count logical page-count shelf: %w", err)
	}
	totalPages := 1
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	query := cte + fmt.Sprintf(`SELECT "kind", "id" FROM logical ORDER BY "pageCount" %s, "sortKey" ASC, "title" ASC, "kind" ASC, "id" ASC LIMIT ? OFFSET ?`, direction)
	args := append(append([]interface{}{}, baseArgs...), pageSize, (page-1)*pageSize)
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("page logical page-count shelf: %w", err)
	}
	keys := make([]logicalShelfKey, 0, pageSize)
	for rows.Next() {
		var key logicalShelfKey
		if err := rows.Scan(&key.Kind, &key.ID); err != nil {
			rows.Close()
			return nil, err
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	items := make([]ComicListItem, 0, len(keys))
	for _, key := range keys {
		if key.Kind == "series" {
			summary, err := seriesSummaryByID(key.ID, opts.UserID)
			if err != nil {
				return nil, err
			}
			if summary != nil && summary.ItemCount >= 2 {
				items = append(items, seriesSummaryToShelfItem(summary))
			}
			continue
		}
		item, err := hydrateComicShelfID(key.ID, opts.UserID)
		if err != nil {
			return nil, err
		}
		if item != nil {
			items = append(items, *item)
		}
	}
	return &ComicListResult{Comics: items, Total: total, Page: page, PageSize: pageSize, TotalPages: totalPages}, nil
}

func hydrateComicShelfIDs(ids []string, userID string) ([]ComicListItem, error) {
	items := make([]ComicListItem, 0, len(ids))
	for _, id := range ids {
		item, err := hydrateComicShelfID(id, userID)
		if err != nil {
			return nil, err
		}
		if item != nil {
			items = append(items, *item)
		}
	}
	return items, nil
}

func hydrateComicShelfID(id, userID string) (*ComicListItem, error) {
	if userID != "" {
		return GetComicByIDForUser(id, userID)
	}
	return GetComicByID(id)
}
