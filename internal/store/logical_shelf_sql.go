package store

import (
	"fmt"
	"strings"
)

const (
	// Once a filtered shelf reaches this size, never fall back to the legacy
	// materialise-everything Series path. 4 GB ARM/NAS devices can otherwise
	// allocate tens of thousands of ComicListItem values just to return 24.
	largeShelfMaterializeLimit = 5000
	largeShelfMaxPageSize      = 500
	largeShelfDefaultPageSize  = 100
)

type logicalShelfKey struct {
	Kind string
	ID   string
}

// getAllComicsSeriesViewSQL pages the logical title shelf inside SQLite.
// It first resolves only the IDs for the requested page, then hydrates those
// items. Memory therefore scales with pageSize rather than the library size.
//
// This path intentionally targets the default/title sort. Custom shelf-series
// ordering has richer application-side semantics and uses the legacy path only
// while the filtered dataset is small; large datasets degrade to flat SQL
// pagination instead of risking OOM.
func getAllComicsSeriesViewSQL(opts ComicListOptions) (*ComicListResult, error) {
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

	cte := fmt.Sprintf(`
WITH filtered AS (
	SELECT c."id", c."title", c."titleSortKey"
	FROM "Comic" c
	%s
	%s
), eligible_series AS (
	SELECT DISTINCT si."seriesId" AS "id"
	FROM filtered f
	JOIN "ComicSeriesItem" si ON si."comicId" = f."id"
	JOIN "ComicSeries" s ON s."id" = si."seriesId"
	WHERE (SELECT COUNT(*) FROM "ComicSeriesItem" allsi WHERE allsi."seriesId" = si."seriesId") >= 2
), logical AS (
	SELECT 'comic' AS "kind", f."id" AS "id", f."titleSortKey" AS "sortKey", f."title" AS "title"
	FROM filtered f
	LEFT JOIN "ComicSeriesItem" si ON si."comicId" = f."id"
	LEFT JOIN eligible_series es ON es."id" = si."seriesId"
	WHERE es."id" IS NULL
	UNION ALL
	SELECT 'series' AS "kind", s."id" AS "id",
	       COALESCE(NULLIF(s."sortTitle", ''), title_sort_key(s."title")) AS "sortKey",
	       s."title" AS "title"
	FROM eligible_series es
	JOIN "ComicSeries" s ON s."id" = es."id"
)
`, joinClause, whereClause)

	baseArgs := append(append([]interface{}{}, joinArgs...), filterArgs...)
	var total int
	if err := db.QueryRow(cte+`SELECT COUNT(*) FROM logical`, baseArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count logical shelf: %w", err)
	}

	totalPages := 1
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize
	direction := "ASC"
	if strings.EqualFold(opts.SortOrder, "desc") {
		direction = "DESC"
	}
	query := cte + fmt.Sprintf(`
SELECT "kind", "id"
FROM logical
ORDER BY "sortKey" %s, "title" %s, "kind" ASC, "id" ASC
LIMIT ? OFFSET ?`, direction, direction)
	queryArgs := append(append([]interface{}{}, baseArgs...), pageSize, offset)
	rows, err := db.Query(query, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("page logical shelf: %w", err)
	}
	keys := make([]logicalShelfKey, 0, pageSize)
	for rows.Next() {
		var key logicalShelfKey
		if err := rows.Scan(&key.Kind, &key.ID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan logical shelf key: %w", err)
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
				return nil, fmt.Errorf("hydrate series %s: %w", key.ID, err)
			}
			if summary == nil || summary.ItemCount < 2 {
				continue
			}
			items = append(items, seriesSummaryToShelfItem(summary))
			continue
		}

		var item *ComicListItem
		var err error
		if opts.UserID != "" {
			item, err = GetComicByIDForUser(key.ID, opts.UserID)
		} else {
			item, err = GetComicByID(key.ID)
		}
		if err != nil {
			return nil, fmt.Errorf("hydrate comic %s: %w", key.ID, err)
		}
		if item != nil {
			items = append(items, *item)
		}
	}

	return &ComicListResult{
		Comics:     items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func seriesSummaryToShelfItem(summary *SeriesSummary) ComicListItem {
	tags := []ComicTagInfo{{Name: fmt.Sprintf("%d 项", summary.ItemCount), Color: ""}}
	if summary.SectionCount > 0 {
		tags = append(tags, ComicTagInfo{Name: fmt.Sprintf("%d 季/篇", summary.SectionCount), Color: ""})
	}
	return ComicListItem{
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
	}
}

func hasShelfSeriesGroups() (bool, error) {
	var exists int
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM "ComicGroup" WHERE COALESCE("shelfSeries", 0) = 1 LIMIT 1)`).Scan(&exists); err != nil {
		return false, err
	}
	return exists != 0, nil
}

func countLogicalShelfFilteredRows(opts ComicListOptions) (int, error) {
	whereClause, joinClause, joinArgs, filterArgs, err := buildLogicalShelfFilter(opts)
	if err != nil {
		return 0, err
	}
	args := append(append([]interface{}{}, joinArgs...), filterArgs...)
	var total int
	query := fmt.Sprintf(`SELECT COUNT(*) FROM "Comic" c %s %s`, joinClause, whereClause)
	if err := db.QueryRow(query, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("count filtered shelf rows: %w", err)
	}
	return total, nil
}

// buildLogicalShelfFilter mirrors GetAllComics filtering. Keeping the logical
// projection in SQL avoids pulling every matching Comic into Go just to learn
// whether it belongs to a Series.
func buildLogicalShelfFilter(opts ComicListOptions) (whereClause, joinClause string, joinArgs, args []interface{}, err error) {
	var conditions []string

	if opts.Search != "" {
		conditions = append(conditions, `c.rowid IN (SELECT rowid FROM "ComicFTS" WHERE "ComicFTS" MATCH ?)`)
		args = append(args, ftsEscapeQuery(opts.Search))
	}
	if opts.FavoritesOnly {
		if opts.UserID != "" {
			conditions = append(conditions, `COALESCE(ucs."isFavorite", 0) = 1`)
		} else {
			conditions = append(conditions, `c."isFavorite" = 1`)
		}
	}
	if len(opts.Tags) > 0 {
		placeholders := make([]string, len(opts.Tags))
		for i, tag := range opts.Tags {
			placeholders[i] = "?"
			args = append(args, tag)
		}
		conditions = append(conditions, fmt.Sprintf(
			`c."id" IN (SELECT ct."comicId" FROM "ComicTag" ct JOIN "Tag" t ON ct."tagId" = t."id" WHERE t."name" IN (%s))`,
			strings.Join(placeholders, ","),
		))
	}
	if opts.Category != "" {
		if opts.Category == "uncategorized" {
			conditions = append(conditions, `c."id" NOT IN (SELECT "comicId" FROM "ComicCategory")`)
		} else {
			conditions = append(conditions, `c."id" IN (SELECT cc."comicId" FROM "ComicCategory" cc JOIN "Category" cat ON cc."categoryId" = cat."id" WHERE cat."slug" = ?)`)
			args = append(args, opts.Category)
		}
	}
	if opts.ContentType == "novel" {
		conditions = append(conditions, `c."type" = 'novel'`)
	} else if opts.ContentType == "comic" {
		conditions = append(conditions, `c."type" = 'comic'`)
	}
	if opts.ReadingStatus != "" {
		if opts.UserID != "" {
			conditions = append(conditions, `ucs."readingStatus" = ?`)
		} else {
			conditions = append(conditions, `c."readingStatus" = ?`)
		}
		args = append(args, opts.ReadingStatus)
	}
	if opts.ExcludeGrouped {
		conditions = append(conditions, `c."id" NOT IN (SELECT gi."comicId" FROM "ComicGroupItem" gi INNER JOIN "ComicGroup" g ON g."id" = gi."groupId")`)
	}
	if opts.Uncategorized {
		conditions = append(conditions, `c."id" NOT IN (SELECT "comicId" FROM "ComicCategory")`)
	}
	if opts.Untagged {
		conditions = append(conditions, `c."id" NOT IN (SELECT "comicId" FROM "ComicTag")`)
	}
	if opts.MetaFilter == "with" {
		conditions = append(conditions, `c."metadataSource" != '' AND c."metadataSource" IS NOT NULL`)
	} else if opts.MetaFilter == "missing" {
		conditions = append(conditions, `(c."metadataSource" = '' OR c."metadataSource" IS NULL)`)
	}

	ids := normalizedShelfLibraryIDs(opts.LibraryIDs)
	if opts.FilterLibraryIDs {
		if len(ids) == 0 {
			conditions = append(conditions, "1=0")
		} else {
			placeholders := make([]string, len(ids))
			for i, id := range ids {
				placeholders[i] = "?"
				args = append(args, id)
			}
			conditions = append(conditions, fmt.Sprintf(`c."libraryId" IN (%s)`, strings.Join(placeholders, ",")))
		}
	} else if len(ids) > 0 {
		placeholders := make([]string, len(ids))
		for i, id := range ids {
			placeholders[i] = "?"
			args = append(args, id)
		}
		conditions = append(conditions, fmt.Sprintf(`c."libraryId" IN (%s)`, strings.Join(placeholders, ",")))
	}

	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}
	if opts.UserID != "" {
		joinClause = `LEFT JOIN "UserComicState" ucs ON ucs."comicId" = c."id" AND ucs."userId" = ?`
		joinArgs = append(joinArgs, opts.UserID)
	}
	return whereClause, joinClause, joinArgs, args, nil
}
