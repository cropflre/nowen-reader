package store

import (
	"database/sql"
	"fmt"
	"strings"
)

// shelfKeysSQL collapses filtered physical IDs inside SQLite. A matching member
// selects its whole work; summaries still describe all members, not just matches.
// Cross-library and one-member stale relationships never hide readable books.
func shelfKeysSQL(opts ComicListOptions) (string, []interface{}) {
	opts.MatchSeriesTags = true
	opts.MatchSeriesCategories = true
	join, where, joinArgs, args := comicListFilter(opts)
	vsWhere := ""
	var vsArgs []interface{}
	if len(opts.LibraryIDs) > 0 && len(opts.LibraryIDs) <= seriesMembershipBatchSize {
		placeholders := make([]string, len(opts.LibraryIDs))
		for i, id := range opts.LibraryIDs {
			placeholders[i] = "?"
			vsArgs = append(vsArgs, id)
		}
		vsWhere = fmt.Sprintf(` AND s."libraryId" IN (%s)`, strings.Join(placeholders, ","))
	}

	var esArgs []interface{}
	edUserJoin := ""
	edLastRead := `ec."lastReadAt"`
	edLastPage := `ec."lastReadPage"`
	edStatus := `ec."readingStatus"`
	if opts.UserID != "" {
		edUserJoin = `LEFT JOIN "UserComicState" eucs ON eucs."comicId" = ec."id" AND eucs."userId" = ?`
		edLastRead = `eucs."lastReadAt"`
		edLastPage = `COALESCE(eucs."lastReadPage", 0)`
		edStatus = `COALESCE(eucs."readingStatus", '')`
		esArgs = append(esArgs, opts.UserID)
	}
	var edConds []string
	edConds = append(edConds, `evs."id" IS NULL`)
	if opts.FilterLibraryIDs {
		if len(opts.LibraryIDs) == 0 {
			edConds = append(edConds, `1=0`)
		} else if len(opts.LibraryIDs) <= seriesMembershipBatchSize {
			ph := make([]string, len(opts.LibraryIDs))
			for i, id := range opts.LibraryIDs {
				ph[i] = "?"
				esArgs = append(esArgs, id)
			}
			edConds = append(edConds, `ec."libraryId" IN (`+strings.Join(ph, ",")+`)`)
		}
	} else if len(opts.LibraryIDs) > 0 && len(opts.LibraryIDs) <= seriesMembershipBatchSize {
		ph := make([]string, len(opts.LibraryIDs))
		for i, id := range opts.LibraryIDs {
			ph[i] = "?"
			esArgs = append(esArgs, id)
		}
		edConds = append(edConds, `ec."libraryId" IN (`+strings.Join(ph, ",")+`)`)
	}
	if opts.DirectoryPath != "" {
		if cleanDir, err := ValidateDirectoryRelativePath(opts.DirectoryPath); err != nil {
			edConds = append(edConds, `1=0`)
		} else if cleanDir != "" {
			lower, upper := DirectoryPrefixRange(cleanDir)
			edConds = append(edConds, `ec."libraryId" != '' AND ec."relativePath" != '' AND ec."relativePath" > ? AND ec."relativePath" < ?`)
			esArgs = append(esArgs, lower, upper)
		}
	}
	if opts.ContentType == "novel" || opts.ContentType == "comic" {
		edConds = append(edConds, `ec."type" = ?`)
		esArgs = append(esArgs, opts.ContentType)
	}

	editionCTE := fmt.Sprintf(`, edition_scoped AS (
        SELECT bei."comicId" AS "id", bei."groupId",
            ROW_NUMBER() OVER (
                PARTITION BY bei."groupId"
                ORDER BY
                    CASE
                        WHEN %[1]s IS NOT NULL AND %[1]s != '' THEN 0
                        WHEN %[2]s > 0 OR %[3]s IN ('reading', 'finished') THEN 1
                        ELSE 2
                    END ASC,
                    COALESCE(%[1]s, '') DESC,
                    bei."formatPriority" ASC,
                    bei."sortIndex" ASC,
                    bei."comicId" ASC
            ) AS "rn",
            COUNT(*) OVER (PARTITION BY bei."groupId") AS "memberCount"
        FROM "BookEditionItem" bei
        JOIN "Comic" ec ON ec."id" = bei."comicId"
        JOIN "Library" el ON el."id" = ec."libraryId" AND el."enabled" = 1
        %[4]s
        LEFT JOIN "ComicSeriesItem" esi ON esi."comicId" = ec."id" AND ec."type" = 'comic'
        LEFT JOIN valid_series evs ON evs."id" = esi."seriesId" AND evs."libraryId" = ec."libraryId"
        WHERE %[5]s
    ), edition_winners AS (
        SELECT "groupId", "id" AS "repComicId"
        FROM edition_scoped
        WHERE "memberCount" >= 2 AND "rn" = 1
    ), valid_editions AS (
        SELECT es."id", ew."repComicId"
        FROM edition_scoped es
        JOIN edition_winners ew ON ew."groupId" = es."groupId"
    )`, edLastRead, edLastPage, edStatus, edUserJoin, strings.Join(edConds, " AND "))

	allArgs := make([]interface{}, 0, len(vsArgs)+len(esArgs)+len(joinArgs)+len(args))
	allArgs = append(allArgs, vsArgs...)
	allArgs = append(allArgs, esArgs...)
	allArgs = append(allArgs, joinArgs...)
	allArgs = append(allArgs, args...)

	return `WITH valid_series AS (
        SELECT s."id", s."libraryId"
        FROM "ComicSeries" s
        JOIN "Library" l ON l."id" = s."libraryId"
        JOIN "ComicSeriesItem" si ON si."seriesId" = s."id"
        CROSS JOIN "Comic" c ON c."id" = si."comicId" AND c."libraryId" = s."libraryId"
        WHERE c."type" = 'comic'` + vsWhere + `
        GROUP BY s."id" HAVING COUNT(*) >= ` + effectiveSeriesMinMembersSQL("l") + `
    )` + editionCTE + `, matched AS (
        SELECT CASE WHEN vs."id" IS NULL AND ve."repComicId" IS NOT NULL THEN ve."repComicId" ELSE c."id" END AS "id",
               vs."id" AS "seriesId"
        FROM "Comic" c ` + join + `
        LEFT JOIN "ComicSeriesItem" si ON si."comicId" = c."id" AND c."type" = 'comic'
        LEFT JOIN valid_series vs ON vs."id" = si."seriesId" AND vs."libraryId" = c."libraryId"
        LEFT JOIN valid_editions ve ON ve."id" = c."id"
        ` + where + `
    ), shelf_keys AS (
        SELECT DISTINCT CASE WHEN "seriesId" IS NULL THEN "id" ELSE 'series-' || "seriesId" END AS "id", "seriesId"
        FROM matched
    )`, allArgs
}

// getAllComicsSeriesPage queries only lightweight sort keys before LIMIT/OFFSET.
// Full books, tags, categories and user summaries are hydrated for this page only.
func getAllComicsSeriesPage(opts ComicListOptions) (*ComicListResult, error) {
	cte, args := shelfKeysSQL(opts)
	var total int
	if err := db.QueryRow(cte+` SELECT COUNT(*) FROM shelf_keys`, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count logical shelf: %w", err)
	}
	page := opts.Page
	if page < 1 {
		page = 1
	}
	result := &ComicListResult{Comics: []ComicListItem{}, Total: total, Page: page, PageSize: opts.PageSize, TotalPages: 1}
	if opts.PageSize > 0 && total > 0 {
		result.TotalPages = (total + opts.PageSize - 1) / opts.PageSize
	}
	if opts.PageSize <= 0 {
		result.PageSize = total
	}
	if total == 0 || (opts.PageSize > 0 && (page-1)*opts.PageSize >= total) {
		return result, nil
	}

	userJoin, _, userArgs, _ := comicListFilter(ComicListOptions{UserID: opts.UserID})
	lastRead, rating := `c."lastReadAt"`, `c."rating"`
	if opts.UserID != "" {
		lastRead, rating = `ucs."lastReadAt"`, `ucs."rating"`
	}
	// Only sorts based on member aggregates need to visit all matched works'
	// members. Title/added/custom sorts can read the work row directly.
	seriesJoin, seriesRead, seriesSize := "", "''", "0"
	if opts.SortBy == "lastReadAt" || opts.SortBy == "fileSize" || opts.SortBy == "pageCount" {
		seriesJoin = ` JOIN "ComicSeriesItem" si ON si."seriesId" = s."id"
            CROSS JOIN "Comic" c ON c."id" = si."comicId" AND c."libraryId" = s."libraryId" ` + userJoin
		seriesRead, seriesSize = `MAX(`+lastRead+`)`, `SUM(c."fileSize")`
	}
	seriesPages := "0"
	if seriesJoin != "" {
		seriesPages = `COUNT(*)`
	}
	cte += fmt.Sprintf(`, logical AS (
        SELECT k."id", k."seriesId", c."title", COALESCE(NULLIF(c."titleSortKey", ''), title_sort_key(c."title")) AS "titleSortKey",
            c."addedAt", c."updatedAt", COALESCE(%s, '') AS "lastReadAt", COALESCE(%s, -1) AS "rating",
            c."sortOrder", c."fileSize", c."metadataSource", c."pageCount"
        FROM shelf_keys k JOIN "Comic" c ON c."id" = k."id" %s WHERE k."seriesId" IS NULL
        UNION ALL
        SELECT k."id", k."seriesId", s."title", COALESCE(NULLIF(s."sortTitle", ''), title_sort_key(s."title")),
            s."createdAt", s."updatedAt", COALESCE(%s, ''), -1, 0, %s, '', %s
        FROM shelf_keys k JOIN "ComicSeries" s ON s."id" = k."seriesId" %s GROUP BY s."id"
    )`, lastRead, rating, userJoin, seriesRead, seriesSize, seriesPages, seriesJoin)
	args = append(args, userArgs...)
	if seriesJoin != "" {
		args = append(args, userArgs...)
	}
	direction := "ASC"
	if strings.EqualFold(opts.SortOrder, "desc") {
		direction = "DESC"
	}
	primary := map[string]string{"addedAt": "addedAt", "updatedAt": "updatedAt", "lastReadAt": "lastReadAt", "rating": "rating", "custom": "sortOrder", "fileSize": "fileSize", "pageCount": "pageCount", "metadataSource": "metadataSource"}[opts.SortBy]
	order := ""
	if primary != "" {
		order = fmt.Sprintf(`l."%s" %s, l."titleSortKey" %s, l."title" %s, l."id" %s`, primary, direction, direction, direction, direction)
		if primary == "addedAt" || primary == "updatedAt" || primary == "lastReadAt" {
			order = fmt.Sprintf(`shelf_time_key(l."%s") %s, l."titleSortKey" %s, l."title" %s, l."id" %s`, primary, direction, direction, direction, direction)
		}
	} else {
		cte += `, group_orders AS (
            SELECT 'series-' || cs."id" AS "id", g."id" AS "groupId",
                COALESCE(NULLIF(g."shelfSortTitle", ''), title_sort_key(g."name")) AS "blockKey",
                g."shelfSortMode" AS "mode", 0 AS "kind", cgs."sortIndex" AS "memberIndex", cs."year", cs."sortTitle" AS "memberKey"
            FROM "ComicGroup" g JOIN "ComicGroupSeries" cgs ON cgs."groupId" = g."id"
            JOIN "ComicSeries" cs ON cs."id" = cgs."seriesId" WHERE g."shelfSeries" = 1
            UNION ALL
            SELECT c."id", g."id", COALESCE(NULLIF(g."shelfSortTitle", ''), title_sort_key(g."name")),
                g."shelfSortMode", 1, gi."sortIndex", c."year", COALESCE(NULLIF(c."titleSortKey", ''), title_sort_key(c."title"))
            FROM "ComicGroup" g JOIN "ComicGroupItem" gi ON gi."groupId" = g."id"
            JOIN "Comic" c ON c."id" = gi."comicId" WHERE g."shelfSeries" = 1
        ), ranked_orders AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY "id" ORDER BY "groupId") AS rn FROM group_orders
        )`
		// A shelf group is one sort block. Descending reverses the blocks, while
		// publication/volume/manual order within each block remains ascending.
		order = fmt.Sprintf(`COALESCE(g."blockKey", l."titleSortKey") %s,
            CASE WHEN g."groupId" IS NULL THEN 'item:' || l."id" ELSE printf('group:%%020d', g."groupId") END %s,
            CASE WHEN g."mode" = 'publication' THEN COALESCE(g."year", 4611686018427387904) ELSE 0 END ASC,
            CASE WHEN g."mode" = 'volume' THEN g."memberKey" ELSE '' END ASC,
            CASE WHEN g."mode" NOT IN ('publication', 'volume') THEN g."kind" ELSE 0 END ASC,
            g."memberIndex" ASC, l."titleSortKey" ASC, l."id" ASC`, direction, direction)
	}
	if opts.SortBy == "pageCount" {
		order = fmt.Sprintf(`l."pageCount" %s, l."titleSortKey" ASC, l."id" ASC`, direction)
	}
	query := cte + ` SELECT l."id", l."seriesId" FROM logical l`
	if primary == "" {
		query += ` LEFT JOIN ranked_orders g ON g."id" = l."id" AND g.rn = 1`
	}
	query += ` ORDER BY ` + order
	if opts.PageSize > 0 {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, opts.PageSize, (page-1)*opts.PageSize)
	}
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("page logical shelf: %w", err)
	}
	keys, comicIDs, seriesIDs := []string{}, []string{}, []string{}
	for rows.Next() {
		var id string
		var seriesID sql.NullString
		if err := rows.Scan(&id, &seriesID); err != nil {
			rows.Close()
			return nil, err
		}
		keys = append(keys, id)
		if seriesID.Valid {
			seriesIDs = append(seriesIDs, seriesID.String)
		} else {
			comicIDs = append(comicIDs, id)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	items := make(map[string]ComicListItem, len(keys))
	// Unpaginated callers are supported without exceeding SQLite's variable cap.
	for start := 0; start < len(comicIDs); start += seriesMembershipBatchSize {
		end := start + seriesMembershipBatchSize
		if end > len(comicIDs) {
			end = len(comicIDs)
		}
		flat, err := GetAllComics(ComicListOptions{UserID: opts.UserID, comicIDs: comicIDs[start:end]})
		if err != nil {
			return nil, err
		}
		for _, item := range flat.Comics {
			items[item.ID] = item
		}
	}
	summaries, err := seriesSummariesByIDs(seriesIDs, opts.UserID)
	if err != nil {
		return nil, err
	}
	for _, summary := range summaries {
		item := seriesShelfItem(summary)
		items[item.ID] = item
	}
	for _, key := range keys {
		if item, ok := items[key]; ok {
			result.Comics = append(result.Comics, item)
		}
	}
	_ = hydrateComicEditionSummaries(result.Comics, opts)
	for i := range result.Comics {
		if !strings.HasPrefix(result.Comics[i].ID, SeriesShelfIDPrefix) && result.Comics[i].EditionCount >= 2 && result.Comics[i].PreferredComicID == "" {
			result.Comics[i].PreferredComicID = result.Comics[i].ID
		}
	}
	return result, nil
}

func seriesShelfItem(summary SeriesSummary) ComicListItem {
	tags := []ComicTagInfo{{Name: fmt.Sprintf("%d 项", summary.ItemCount), Color: ""}}
	if summary.SectionCount > 0 {
		tags = append(tags, ComicTagInfo{Name: fmt.Sprintf("%d 季/篇", summary.SectionCount), Color: ""})
	}
	for _, tag := range summary.Tags {
		tags = append(tags, ComicTagInfo{Name: tag.Name, Color: tag.Color})
	}
	return ComicListItem{
		ID: SeriesShelfIDPrefix + summary.ID, Filename: "__series__.cbz", Title: summary.Title, TitleSortKey: BuildTitleSortKey(summary.Title),
		PageCount: summary.ItemCount, ComicCount: summary.ItemCount, FileSize: summary.FileSize, AddedAt: summary.CreatedAt, UpdatedAt: summary.UpdatedAt,
		LastReadPage: summary.CompletedItemCount, LastReadAt: summary.LastReadAt, IsFavorite: summary.IsFavorite, TotalReadTime: summary.TotalReadTime,
		CoverURL: summary.CoverURL, ComicType: "comic", LibraryID: summary.LibraryID, Tags: tags, Categories: summary.Categories,
	}
}
