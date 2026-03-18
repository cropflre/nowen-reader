package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ============================================================
// 系列分组查询
// ============================================================

// SeriesListItem 系列列表中的一项（分组聚合结果）。
type SeriesListItem struct {
	SeriesName   string  `json:"seriesName"`
	VolumeCount  int     `json:"volumeCount"`
	TotalPages   int     `json:"totalPages"`
	CoverURL     string  `json:"coverUrl"`
	CoverComicID string  `json:"coverComicId"`
	LatestReadAt *string `json:"latestReadAt"`
	Authors      string  `json:"authors"`
}

// SeriesListOptions 系列列表查询参数。
type SeriesListOptions struct {
	Search    string
	SortBy    string // "name" | "volumeCount" | "latestReadAt"
	SortOrder string // "asc" | "desc"
	Page      int
	PageSize  int
}

// SeriesListResult 系列列表分页结果。
type SeriesListResult struct {
	Series     []SeriesListItem `json:"series"`
	Total      int              `json:"total"`
	Page       int              `json:"page"`
	PageSize   int              `json:"pageSize"`
	TotalPages int              `json:"totalPages"`
}

// GetSeriesList 按 seriesName 分组聚合查询系列列表。
func GetSeriesList(opts SeriesListOptions) (*SeriesListResult, error) {
	var conditions []string
	var args []interface{}

	// 只查有 seriesName 的记录
	conditions = append(conditions, `c."seriesName" != ''`)

	if opts.Search != "" {
		conditions = append(conditions, `c."seriesName" LIKE ?`)
		args = append(args, "%"+opts.Search+"%")
	}

	whereClause := "WHERE " + strings.Join(conditions, " AND ")

	// 计算总数（不同的 seriesName 数量）
	countQuery := fmt.Sprintf(`SELECT COUNT(DISTINCT c."seriesName") FROM "Comic" c %s`, whereClause)
	var total int
	if err := db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count series: %w", err)
	}

	// 排序
	sortField := `c."seriesName"`
	switch opts.SortBy {
	case "volumeCount":
		sortField = `COUNT(*)`
	case "latestReadAt":
		sortField = `MAX(c."lastReadAt")`
	}
	sortDir := "ASC"
	if strings.ToLower(opts.SortOrder) == "desc" {
		sortDir = "DESC"
	}

	// 分页
	page := opts.Page
	pageSize := opts.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 24
	}
	offset := (page - 1) * pageSize
	totalPages := 1
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	paginationArgs := make([]interface{}, len(args))
	copy(paginationArgs, args)
	paginationArgs = append(paginationArgs, pageSize, offset)

	// 主查询：按 seriesName 分组聚合
	query := fmt.Sprintf(`
		SELECT
			c."seriesName",
			COUNT(*) as volumeCount,
			COALESCE(SUM(c."pageCount"), 0) as totalPages,
			(SELECT sub."id" FROM "Comic" sub
			 WHERE sub."seriesName" = c."seriesName" AND sub."seriesName" != ''
			 ORDER BY COALESCE(sub."seriesIndex", 999999), sub."title" ASC
			 LIMIT 1) as coverComicId,
			MAX(c."lastReadAt") as latestReadAt,
			GROUP_CONCAT(DISTINCT CASE WHEN c."author" != '' THEN c."author" END) as authors
		FROM "Comic" c
		%s
		GROUP BY c."seriesName"
		ORDER BY %s %s
		LIMIT ? OFFSET ?
	`, whereClause, sortField, sortDir)

	rows, err := db.Query(query, paginationArgs...)
	if err != nil {
		return nil, fmt.Errorf("query series: %w", err)
	}
	defer rows.Close()

	var seriesList []SeriesListItem
	for rows.Next() {
		var s SeriesListItem
		var coverComicID sql.NullString
		var latestReadAt sql.NullString
		var authors sql.NullString

		if err := rows.Scan(
			&s.SeriesName,
			&s.VolumeCount,
			&s.TotalPages,
			&coverComicID,
			&latestReadAt,
			&authors,
		); err != nil {
			return nil, fmt.Errorf("scan series: %w", err)
		}

		if coverComicID.Valid {
			s.CoverComicID = coverComicID.String
			s.CoverURL = fmt.Sprintf("/api/comics/%s/thumbnail", coverComicID.String)
		}
		if latestReadAt.Valid {
			s.LatestReadAt = &latestReadAt.String
		}
		if authors.Valid {
			s.Authors = authors.String
		}

		seriesList = append(seriesList, s)
	}

	if seriesList == nil {
		seriesList = []SeriesListItem{}
	}

	return &SeriesListResult{
		Series:     seriesList,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

// GetSeriesComics 获取某个系列下的所有漫画（按 seriesIndex 排序）。
func GetSeriesComics(seriesName string) ([]ComicListItem, error) {
	query := `
		SELECT c."id", c."filename", c."title", c."pageCount", c."fileSize",
		       c."addedAt", c."updatedAt", c."lastReadPage", c."lastReadAt",
		       c."isFavorite", c."rating", c."sortOrder", c."totalReadTime",
		       c."author", c."publisher", c."year", c."description",
		       c."language", c."seriesName", c."seriesIndex", c."genre", c."metadataSource",
		       c."readingStatus", c."type"
		FROM "Comic" c
		WHERE c."seriesName" = ? AND c."seriesName" != ''
		ORDER BY COALESCE(c."seriesIndex", 999999) ASC, c."title" ASC
	`

	rows, err := db.Query(query, seriesName)
	if err != nil {
		return nil, fmt.Errorf("query series comics: %w", err)
	}
	defer rows.Close()

	var comics []ComicListItem
	for rows.Next() {
		var c ComicListItem
		var addedAt, updatedAt time.Time
		var lastReadAt sql.NullTime
		var rating sql.NullInt64
		var year sql.NullInt64
		var seriesIndex sql.NullInt64
		var isFav int

		if err := rows.Scan(
			&c.ID, &c.Filename, &c.Title, &c.PageCount, &c.FileSize,
			&addedAt, &updatedAt, &c.LastReadPage, &lastReadAt,
			&isFav, &rating, &c.SortOrder, &c.TotalReadTime,
			&c.Author, &c.Publisher, &year, &c.Description,
			&c.Language, &c.SeriesName, &seriesIndex, &c.Genre, &c.MetadataSource,
			&c.ReadingStatus, &c.ComicType,
		); err != nil {
			return nil, fmt.Errorf("scan series comic: %w", err)
		}

		c.AddedAt = addedAt.UTC().Format(time.RFC3339Nano)
		c.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
		c.IsFavorite = isFav != 0
		if lastReadAt.Valid {
			s := lastReadAt.Time.UTC().Format(time.RFC3339Nano)
			c.LastReadAt = &s
		}
		if rating.Valid {
			v := int(rating.Int64)
			c.Rating = &v
		}
		if year.Valid {
			v := int(year.Int64)
			c.Year = &v
		}
		if seriesIndex.Valid {
			v := int(seriesIndex.Int64)
			c.SeriesIndex = &v
		}
		c.CoverURL = fmt.Sprintf("/api/comics/%s/thumbnail", c.ID)
		c.Tags = []ComicTagInfo{}
		c.Categories = []ComicCategoryInfo{}

		comics = append(comics, c)
	}

	if comics == nil {
		comics = []ComicListItem{}
	}

	// 批量加载 tags 和 categories
	if len(comics) > 0 {
		comicIDs := make([]string, len(comics))
		comicIdx := make(map[string]int, len(comics))
		for i, c := range comics {
			comicIDs[i] = c.ID
			comicIdx[c.ID] = i
		}
		_ = loadComicTags(comics, comicIDs, comicIdx)
		_ = loadComicCategories(comics, comicIDs, comicIdx)
	}

	return comics, nil
}

// GetSeriesPageMap 获取系列的跨卷页面映射（用于连续阅读）。
// 返回按 seriesIndex 排序的漫画 ID 列表和每本的页数。
type SeriesVolumeInfo struct {
	ComicID      string `json:"comicId"`
	Title        string `json:"title"`
	SeriesIndex  *int   `json:"seriesIndex"`
	PageCount    int    `json:"pageCount"`
	LastReadPage int    `json:"lastReadPage"`
}

func GetSeriesVolumeMap(seriesName string) ([]SeriesVolumeInfo, error) {
	query := `
		SELECT c."id", c."title", c."seriesIndex", c."pageCount", c."lastReadPage"
		FROM "Comic" c
		WHERE c."seriesName" = ? AND c."seriesName" != ''
		ORDER BY COALESCE(c."seriesIndex", 999999) ASC, c."title" ASC
	`

	rows, err := db.Query(query, seriesName)
	if err != nil {
		return nil, fmt.Errorf("query series volumes: %w", err)
	}
	defer rows.Close()

	var volumes []SeriesVolumeInfo
	for rows.Next() {
		var v SeriesVolumeInfo
		var seriesIndex sql.NullInt64

		if err := rows.Scan(&v.ComicID, &v.Title, &seriesIndex, &v.PageCount, &v.LastReadPage); err != nil {
			return nil, fmt.Errorf("scan series volume: %w", err)
		}
		if seriesIndex.Valid {
			idx := int(seriesIndex.Int64)
			v.SeriesIndex = &idx
		}
		volumes = append(volumes, v)
	}

	if volumes == nil {
		volumes = []SeriesVolumeInfo{}
	}

	return volumes, nil
}

// UpdateSeriesInfo 手动设置漫画的系列信息。
func UpdateSeriesInfo(comicID string, seriesName string, seriesIndex *int) error {
	fields := map[string]interface{}{
		"seriesName": seriesName,
	}
	if seriesIndex != nil {
		fields["seriesIndex"] = *seriesIndex
	} else {
		fields["seriesIndex"] = nil
	}
	return UpdateComicFields(comicID, fields)
}
