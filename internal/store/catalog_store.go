package store

import (
	"database/sql"
	"fmt"
	"strings"
)

const (
	CatalogItemComic  = "comic"
	CatalogItemSeries = "series"
)

// CatalogItem is a logical item that can be selected for a collection. A
// directory series occupies one row; publications outside a valid series are
// returned as ordinary comic rows.
type CatalogItem struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	CoverURL  string `json:"coverUrl"`
	ItemCount int    `json:"itemCount"`
	LibraryID string `json:"libraryId"`
}

type CatalogItemQueryOptions struct {
	Search           string
	ContentType      string
	SortOrder        string
	Page             int
	PageSize         int
	FilterLibraryIDs bool
	LibraryIDs       []string
}

type CatalogItemResult struct {
	Items      []CatalogItem `json:"items"`
	Page       int           `json:"page"`
	PageSize   int           `json:"pageSize"`
	Total      int           `json:"total"`
	TotalPages int           `json:"totalPages"`
}

// GetCatalogItems returns a database-paginated logical shelf for collection
// pickers. Comic directory members are represented by one series row, while
// novels and standalone comics remain individual rows.
func GetCatalogItems(opts CatalogItemQueryOptions) (*CatalogItemResult, error) {
	page := opts.Page
	if page < 1 {
		page = 1
	}
	pageSize := opts.PageSize
	if pageSize < 1 {
		pageSize = 24
	}
	if pageSize > 100 {
		pageSize = 100
	}
	if opts.ContentType != "novel" {
		opts.ContentType = "comic"
	}
	sortOrder := "ASC"
	if strings.EqualFold(opts.SortOrder, "desc") {
		sortOrder = "DESC"
	}

	if opts.FilterLibraryIDs && len(opts.LibraryIDs) == 0 {
		return emptyCatalogItemResult(page, pageSize), nil
	}
	if opts.ContentType == "novel" {
		return getNovelCatalogItems(opts, page, pageSize, sortOrder)
	}
	return getComicCatalogItems(opts, page, pageSize, sortOrder)
}

func getComicCatalogItems(opts CatalogItemQueryOptions, page, pageSize int, sortOrder string) (*CatalogItemResult, error) {
	seriesConditions := []string{`c_series."type" = 'comic'`, `c_series."libraryId" = s."libraryId"`}
	seriesArgs := make([]interface{}, 0, len(opts.LibraryIDs))
	if len(opts.LibraryIDs) > 0 {
		seriesConditions = append(seriesConditions, `s."libraryId" IN (`+placeholders(len(opts.LibraryIDs))+`)`)
		for _, libraryID := range opts.LibraryIDs {
			seriesArgs = append(seriesArgs, libraryID)
		}
	}

	cte := `WITH "ValidSeries" AS (
		SELECT s."id", s."libraryId", s."title",
		       COALESCE(
		         NULLIF(MAX(CASE WHEN c_series."id" = s."coverComicId" THEN c_series."id" ELSE '' END), ''),
		         MIN(c_series."id")
		       ) AS "coverComicId",
		       COUNT(DISTINCT c_series."id") AS "itemCount"
		FROM "ComicSeries" s
		JOIN "ComicSeriesItem" csi_series ON csi_series."seriesId" = s."id"
		JOIN "Comic" c_series ON c_series."id" = csi_series."comicId"
		WHERE ` + strings.Join(seriesConditions, " AND ") + `
		GROUP BY s."id"
		HAVING COUNT(DISTINCT c_series."id") >= 2
	), "CatalogItems" AS (`

	catalogArgs := append([]interface{}{}, seriesArgs...)
	seriesWhere := "1 = 1"
	if search := strings.TrimSpace(opts.Search); search != "" {
		pattern := catalogSearchPattern(search)
		seriesWhere = `(vs."title" LIKE ? ESCAPE '\' COLLATE NOCASE OR EXISTS (
			SELECT 1
			FROM "ComicSeriesItem" csi_match
			JOIN "Comic" c_match ON c_match."id" = csi_match."comicId" AND c_match."libraryId" = vs."libraryId"
			WHERE csi_match."seriesId" = vs."id"
			  AND c_match."type" = 'comic'
			  AND (c_match."title" LIKE ? ESCAPE '\' COLLATE NOCASE OR c_match."filename" LIKE ? ESCAPE '\' COLLATE NOCASE)
		))`
		catalogArgs = append(catalogArgs, pattern, pattern, pattern)
	}

	cte += `
		SELECT 'series' AS "kind", vs."id", vs."title", vs."coverComicId",
		       vs."itemCount", vs."libraryId", title_sort_key(vs."title") AS "sortKey"
		FROM "ValidSeries" vs
		WHERE ` + seriesWhere + `
		UNION ALL
		SELECT 'comic' AS "kind", c."id", c."title", c."id" AS "coverComicId",
		       1 AS "itemCount", c."libraryId",
		       COALESCE(NULLIF(c."titleSortKey", ''), title_sort_key(c."title")) AS "sortKey"
		FROM "Comic" c
		WHERE c."type" = 'comic'`

	if len(opts.LibraryIDs) > 0 {
		cte += ` AND c."libraryId" IN (` + placeholders(len(opts.LibraryIDs)) + `)`
		for _, libraryID := range opts.LibraryIDs {
			catalogArgs = append(catalogArgs, libraryID)
		}
	}
	if search := strings.TrimSpace(opts.Search); search != "" {
		pattern := catalogSearchPattern(search)
		cte += ` AND (c."title" LIKE ? ESCAPE '\' COLLATE NOCASE OR c."filename" LIKE ? ESCAPE '\' COLLATE NOCASE)`
		catalogArgs = append(catalogArgs, pattern, pattern)
	}
	cte += ` AND NOT EXISTS (
		SELECT 1
		FROM "ComicSeriesItem" csi_member
		JOIN "ValidSeries" vs_member ON vs_member."id" = csi_member."seriesId" AND vs_member."libraryId" = c."libraryId"
		WHERE csi_member."comicId" = c."id"
	))`

	return queryCatalogItems(cte, catalogArgs, page, pageSize, sortOrder)
}

func getNovelCatalogItems(opts CatalogItemQueryOptions, page, pageSize int, sortOrder string) (*CatalogItemResult, error) {
	conditions := []string{`c."type" = 'novel'`}
	args := make([]interface{}, 0, len(opts.LibraryIDs)+2)
	if len(opts.LibraryIDs) > 0 {
		conditions = append(conditions, `c."libraryId" IN (`+placeholders(len(opts.LibraryIDs))+`)`)
		for _, libraryID := range opts.LibraryIDs {
			args = append(args, libraryID)
		}
	}
	if search := strings.TrimSpace(opts.Search); search != "" {
		pattern := catalogSearchPattern(search)
		conditions = append(conditions, `(c."title" LIKE ? ESCAPE '\' COLLATE NOCASE OR c."filename" LIKE ? ESCAPE '\' COLLATE NOCASE)`)
		args = append(args, pattern, pattern)
	}

	cte := `WITH "CatalogItems" AS (
		SELECT 'comic' AS "kind", c."id", c."title", c."id" AS "coverComicId",
		       1 AS "itemCount", c."libraryId",
		       COALESCE(NULLIF(c."titleSortKey", ''), title_sort_key(c."title")) AS "sortKey"
		FROM "Comic" c
		WHERE ` + strings.Join(conditions, " AND ") + `
	)`
	return queryCatalogItems(cte, args, page, pageSize, sortOrder)
}

func queryCatalogItems(cte string, args []interface{}, page, pageSize int, sortOrder string) (*CatalogItemResult, error) {
	var total int
	if err := db.QueryRow(cte+` SELECT COUNT(*) FROM "CatalogItems"`, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count catalog items: %w", err)
	}

	queryArgs := append([]interface{}{}, args...)
	queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	rows, err := db.Query(cte+`
		SELECT "kind", "id", "title", "coverComicId", "itemCount", "libraryId"
		FROM "CatalogItems"
		ORDER BY "sortKey" `+sortOrder+`, "title" COLLATE NOCASE `+sortOrder+`, "id" ASC
		LIMIT ? OFFSET ?
	`, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("list catalog items: %w", err)
	}
	defer rows.Close()

	items := make([]CatalogItem, 0, pageSize)
	for rows.Next() {
		var item CatalogItem
		var coverComicID sql.NullString
		if err := rows.Scan(&item.Kind, &item.ID, &item.Title, &coverComicID, &item.ItemCount, &item.LibraryID); err != nil {
			return nil, err
		}
		if coverComicID.Valid && coverComicID.String != "" {
			item.CoverURL = BuildComicCoverURL(coverComicID.String)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	totalPages := 1
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return &CatalogItemResult{
		Items:      items,
		Page:       page,
		PageSize:   pageSize,
		Total:      total,
		TotalPages: totalPages,
	}, nil
}

func emptyCatalogItemResult(page, pageSize int) *CatalogItemResult {
	return &CatalogItemResult{
		Items:      []CatalogItem{},
		Page:       page,
		PageSize:   pageSize,
		TotalPages: 1,
	}
}

func catalogSearchPattern(search string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + replacer.Replace(strings.TrimSpace(search)) + "%"
}
