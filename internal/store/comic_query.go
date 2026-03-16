package store

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"
)

// ============================================================
// 列表查询类型定义
// ============================================================

// ComicListOptions 保存列表查询参数。
type ComicListOptions struct {
	Search        string
	Tags          []string
	FavoritesOnly bool
	SortBy        string // "title" | "addedAt" | "lastReadAt" | "rating" | "custom"
	SortOrder     string // "asc" | "desc"
	Page          int
	PageSize      int
	Category      string
	ContentType   string // "comic" | "novel" | "" (全部)
	ReadingStatus string // "want" | "reading" | "finished" | "shelved" | "" (全部)
}

// ComicListItem 是漫画在列表结果中的序列化表示。
type ComicListItem struct {
	ID             string              `json:"id"`
	Filename       string              `json:"filename"`
	Title          string              `json:"title"`
	PageCount      int                 `json:"pageCount"`
	FileSize       int64               `json:"fileSize"`
	AddedAt        string              `json:"addedAt"`
	UpdatedAt      string              `json:"updatedAt"`
	LastReadPage   int                 `json:"lastReadPage"`
	LastReadAt     *string             `json:"lastReadAt"`
	IsFavorite     bool                `json:"isFavorite"`
	Rating         *int                `json:"rating"`
	SortOrder      int                 `json:"sortOrder"`
	TotalReadTime  int                 `json:"totalReadTime"`
	CoverURL       string              `json:"coverUrl"`
	Author         string              `json:"author"`
	Publisher      string              `json:"publisher"`
	Year           *int                `json:"year"`
	Description    string              `json:"description"`
	Language       string              `json:"language"`
	SeriesName     string              `json:"seriesName"`
	SeriesIndex    *int                `json:"seriesIndex"`
	Genre          string              `json:"genre"`
	MetadataSource string              `json:"metadataSource"`
	ReadingStatus  string              `json:"readingStatus"`
	ComicType      string              `json:"type"`
	Tags           []ComicTagInfo      `json:"tags"`
	Categories     []ComicCategoryInfo `json:"categories"`
}

type ComicTagInfo struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type ComicCategoryInfo struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	Icon string `json:"icon"`
}

// ComicListResult 是分页查询的返回结果。
type ComicListResult struct {
	Comics     []ComicListItem `json:"comics"`
	Total      int             `json:"total"`
	Page       int             `json:"page"`
	PageSize   int             `json:"pageSize"`
	TotalPages int             `json:"totalPages"`
}

// ============================================================
// 列表查询
// ============================================================

// GetAllComics 根据筛选条件、排序和分页获取漫画列表。
func GetAllComics(opts ComicListOptions) (*ComicListResult, error) {
	// Build WHERE clause
	var conditions []string
	var args []interface{}

	if opts.Search != "" {
		searchPattern := "%" + opts.Search + "%"
		conditions = append(conditions, `(c."title" LIKE ? OR c."author" LIKE ? OR c."filename" LIKE ? OR c."description" LIKE ? OR c."seriesName" LIKE ? OR c."genre" LIKE ?)`)
		args = append(args, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	if opts.FavoritesOnly {
		conditions = append(conditions, `c."isFavorite" = 1`)
	}

	// Tag filtering: find comics that have ANY of the specified tags
	if len(opts.Tags) > 0 {
		placeholders := make([]string, len(opts.Tags))
		for i, t := range opts.Tags {
			placeholders[i] = "?"
			args = append(args, t)
		}
		conditions = append(conditions, fmt.Sprintf(
			`c."id" IN (SELECT ct."comicId" FROM "ComicTag" ct JOIN "Tag" t ON ct."tagId" = t."id" WHERE t."name" IN (%s))`,
			strings.Join(placeholders, ","),
		))
	}

	// Category filtering
	if opts.Category != "" {
		if opts.Category == "uncategorized" {
			conditions = append(conditions, `c."id" NOT IN (SELECT "comicId" FROM "ComicCategory")`)
		} else {
			conditions = append(conditions, `c."id" IN (SELECT cc."comicId" FROM "ComicCategory" cc JOIN "Category" cat ON cc."categoryId" = cat."id" WHERE cat."slug" = ?)`)
			args = append(args, opts.Category)
		}
	}

	// ContentType filtering: 使用 type 字段高效筛选
	if opts.ContentType == "novel" {
		conditions = append(conditions, `c."type" = 'novel'`)
	} else if opts.ContentType == "comic" {
		conditions = append(conditions, `c."type" = 'comic'`)
	}

	// ReadingStatus filtering: 阅读状态筛选
	if opts.ReadingStatus != "" {
		conditions = append(conditions, `c."readingStatus" = ?`)
		args = append(args, opts.ReadingStatus)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Sort
	sortField := "c.\"title\""
	switch opts.SortBy {
	case "addedAt":
		sortField = "c.\"addedAt\""
	case "lastReadAt":
		sortField = "c.\"lastReadAt\""
	case "rating":
		sortField = "c.\"rating\""
	case "custom":
		sortField = "c.\"sortOrder\""
	}
	sortDir := "ASC"
	if strings.ToLower(opts.SortOrder) == "desc" {
		sortDir = "DESC"
	}
	orderClause := fmt.Sprintf("ORDER BY %s %s", sortField, sortDir)

	// Count total
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM "Comic" c %s`, whereClause)
	var total int
	if err := db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count comics: %w", err)
	}

	// Pagination
	page := opts.Page
	pageSize := opts.PageSize
	if page < 1 {
		page = 1
	}

	limitClause := ""
	paginationArgs := make([]interface{}, len(args))
	copy(paginationArgs, args)
	if pageSize > 0 {
		offset := (page - 1) * pageSize
		limitClause = "LIMIT ? OFFSET ?"
		paginationArgs = append(paginationArgs, pageSize, offset)
	}

	totalPages := 1
	if pageSize > 0 && total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	if pageSize <= 0 {
		pageSize = total
	}

	// Main query
	query := fmt.Sprintf(`
		SELECT c."id", c."filename", c."title", c."pageCount", c."fileSize",
		       c."addedAt", c."updatedAt", c."lastReadPage", c."lastReadAt",
		       c."isFavorite", c."rating", c."sortOrder", c."totalReadTime",
		       c."author", c."publisher", c."year", c."description",
		       c."language", c."seriesName", c."seriesIndex", c."genre", c."metadataSource",
		       c."readingStatus", c."type"
		FROM "Comic" c
		%s %s %s
	`, whereClause, orderClause, limitClause)

	rows, err := db.Query(query, paginationArgs...)
	if err != nil {
		return nil, fmt.Errorf("query comics: %w", err)
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
			return nil, fmt.Errorf("scan comic: %w", err)
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

		// Initialize empty slices (not null in JSON)
		c.Tags = []ComicTagInfo{}
		c.Categories = []ComicCategoryInfo{}

		comics = append(comics, c)
	}

	if comics == nil {
		comics = []ComicListItem{}
	}

	// Batch load tags and categories for all comics
	if len(comics) > 0 {
		comicIDs := make([]string, len(comics))
		comicIdx := make(map[string]int, len(comics))
		for i, c := range comics {
			comicIDs[i] = c.ID
			comicIdx[c.ID] = i
		}

		// Load tags
		if err := loadComicTags(comics, comicIDs, comicIdx); err != nil {
			log.Printf("[Store] Warning: failed to load tags: %v", err)
		}

		// Load categories
		if err := loadComicCategories(comics, comicIDs, comicIdx); err != nil {
			log.Printf("[Store] Warning: failed to load categories: %v", err)
		}
	}

	return &ComicListResult{
		Comics:     comics,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

// loadComicTags 批量加载一组漫画的标签。
func loadComicTags(comics []ComicListItem, ids []string, idx map[string]int) error {
	if len(ids) == 0 {
		return nil
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT ct."comicId", t."name", t."color"
		FROM "ComicTag" ct
		JOIN "Tag" t ON ct."tagId" = t."id"
		WHERE ct."comicId" IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var comicID, name, color string
		if err := rows.Scan(&comicID, &name, &color); err != nil {
			continue
		}
		if i, ok := idx[comicID]; ok {
			comics[i].Tags = append(comics[i].Tags, ComicTagInfo{Name: name, Color: color})
		}
	}
	return nil
}

// loadComicCategories 批量加载一组漫画的分类。
func loadComicCategories(comics []ComicListItem, ids []string, idx map[string]int) error {
	if len(ids) == 0 {
		return nil
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT cc."comicId", cat."id", cat."name", cat."slug", cat."icon"
		FROM "ComicCategory" cc
		JOIN "Category" cat ON cc."categoryId" = cat."id"
		WHERE cc."comicId" IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var comicID string
		var ci ComicCategoryInfo
		if err := rows.Scan(&comicID, &ci.ID, &ci.Name, &ci.Slug, &ci.Icon); err != nil {
			continue
		}
		if i, ok := idx[comicID]; ok {
			comics[i].Categories = append(comics[i].Categories, ci)
		}
	}
	return nil
}

// GetComicByID 根据ID获取单个漫画（含标签和分类）。
func GetComicByID(id string) (*ComicListItem, error) {
	query := `
		SELECT c."id", c."filename", c."title", c."pageCount", c."fileSize",
		       c."addedAt", c."updatedAt", c."lastReadPage", c."lastReadAt",
		       c."isFavorite", c."rating", c."sortOrder", c."totalReadTime",
		       c."author", c."publisher", c."year", c."description",
		       c."language", c."seriesName", c."seriesIndex", c."genre", c."metadataSource",
		       c."readingStatus", c."type"
		FROM "Comic" c WHERE c."id" = ?
	`
	var c ComicListItem
	var addedAt, updatedAt time.Time
	var lastReadAt sql.NullTime
	var rating sql.NullInt64
	var year sql.NullInt64
	var seriesIndex sql.NullInt64
	var isFav int

	err := db.QueryRow(query, id).Scan(
		&c.ID, &c.Filename, &c.Title, &c.PageCount, &c.FileSize,
		&addedAt, &updatedAt, &c.LastReadPage, &lastReadAt,
		&isFav, &rating, &c.SortOrder, &c.TotalReadTime,
		&c.Author, &c.Publisher, &year, &c.Description,
		&c.Language, &c.SeriesName, &seriesIndex, &c.Genre, &c.MetadataSource,
		&c.ReadingStatus, &c.ComicType,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
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

	// Tags
	c.Tags = []ComicTagInfo{}
	tagRows, err := db.Query(`
		SELECT t."name", t."color"
		FROM "ComicTag" ct JOIN "Tag" t ON ct."tagId" = t."id"
		WHERE ct."comicId" = ?
	`, id)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var ti ComicTagInfo
			if tagRows.Scan(&ti.Name, &ti.Color) == nil {
				c.Tags = append(c.Tags, ti)
			}
		}
	}

	// Categories
	c.Categories = []ComicCategoryInfo{}
	catRows, err := db.Query(`
		SELECT cat."id", cat."name", cat."slug", cat."icon"
		FROM "ComicCategory" cc JOIN "Category" cat ON cc."categoryId" = cat."id"
		WHERE cc."comicId" = ?
	`, id)
	if err == nil {
		defer catRows.Close()
		for catRows.Next() {
			var ci ComicCategoryInfo
			if catRows.Scan(&ci.ID, &ci.Name, &ci.Slug, &ci.Icon) == nil {
				c.Categories = append(c.Categories, ci)
			}
		}
	}

	return &c, nil
}

// ============================================================
// 推荐系统查询
// ============================================================

// RecommendationComic 保存推荐所需的漫画数据。
type RecommendationComic struct {
	ID            string
	Title         string
	Author        string
	Genre         string
	SeriesName    string
	Filename      string
	PageCount     int
	LastReadPage  int
	LastReadAt    *time.Time
	IsFavorite    bool
	Rating        *int
	TotalReadTime int
	Tags          []ComicTagInfo
	Categories    []ComicCategoryInfo
}

// GetAllComicsForRecommendation 返回所有漫画的推荐所需数据。
func GetAllComicsForRecommendation() ([]RecommendationComic, error) {
	rows, err := db.Query(`
		SELECT "id", "title", "author", "genre", "seriesName",
		       "filename", "pageCount", "lastReadPage", "lastReadAt", "isFavorite",
		       "rating", "totalReadTime"
		FROM "Comic"
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var comics []RecommendationComic
	for rows.Next() {
		var c RecommendationComic
		var lastReadAt sql.NullTime
		var rating sql.NullInt64
		var isFav int

		if err := rows.Scan(
			&c.ID, &c.Title, &c.Author, &c.Genre, &c.SeriesName,
			&c.Filename, &c.PageCount, &c.LastReadPage, &lastReadAt, &isFav,
			&rating, &c.TotalReadTime,
		); err != nil {
			continue
		}
		c.IsFavorite = isFav != 0
		if lastReadAt.Valid {
			c.LastReadAt = &lastReadAt.Time
		}
		if rating.Valid {
			v := int(rating.Int64)
			c.Rating = &v
		}
		c.Tags = []ComicTagInfo{}
		c.Categories = []ComicCategoryInfo{}
		comics = append(comics, c)
	}

	if len(comics) == 0 {
		return comics, nil
	}

	// Batch load tags
	ids := make([]string, len(comics))
	idx := make(map[string]int, len(comics))
	for i, c := range comics {
		ids[i] = c.ID
		idx[c.ID] = i
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	tagQuery := fmt.Sprintf(`
		SELECT ct."comicId", t."name", t."color"
		FROM "ComicTag" ct JOIN "Tag" t ON ct."tagId" = t."id"
		WHERE ct."comicId" IN (%s)
	`, strings.Join(placeholders, ","))
	tagRows, err := db.Query(tagQuery, args...)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var comicID, name, color string
			if tagRows.Scan(&comicID, &name, &color) == nil {
				if i, ok := idx[comicID]; ok {
					comics[i].Tags = append(comics[i].Tags, ComicTagInfo{Name: name, Color: color})
				}
			}
		}
	}

	// Batch load categories
	catQuery := fmt.Sprintf(`
		SELECT cc."comicId", cat."id", cat."name", cat."slug", cat."icon"
		FROM "ComicCategory" cc JOIN "Category" cat ON cc."categoryId" = cat."id"
		WHERE cc."comicId" IN (%s)
	`, strings.Join(placeholders, ","))
	catRows, err := db.Query(catQuery, args...)
	if err == nil {
		defer catRows.Close()
		for catRows.Next() {
			var comicID string
			var ci ComicCategoryInfo
			if catRows.Scan(&comicID, &ci.ID, &ci.Name, &ci.Slug, &ci.Icon) == nil {
				if i, ok := idx[comicID]; ok {
					comics[i].Categories = append(comics[i].Categories, ci)
				}
			}
		}
	}

	return comics, nil
}

// ============================================================
// OPDS 查询
// ============================================================

// OPDSComicRow 用于 OPDS 查询。
type OPDSComicRow struct {
	ID          string
	Title       string
	Author      string
	Description string
	Language    string
	Genre       string
	Publisher   string
	Year        int
	PageCount   int
	AddedAt     string
	UpdatedAt   string
	Tags        []string
	Filename    string
}

// GetOPDSComics 返回适用于 OPDS feed 生成的漫画数据。
func GetOPDSComics(where string, args []interface{}, orderBy string, limit int) ([]OPDSComicRow, error) {
	query := fmt.Sprintf(`
		SELECT c."id", c."title", c."author", c."description", c."language",
		       c."genre", c."publisher", c."year", c."pageCount",
		       c."addedAt", c."updatedAt", c."filename"
		FROM "Comic" c %s %s
	`, where, orderBy)
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var comics []OPDSComicRow
	for rows.Next() {
		var c OPDSComicRow
		var addedAt, updatedAt time.Time
		var year sql.NullInt64

		if err := rows.Scan(
			&c.ID, &c.Title, &c.Author, &c.Description, &c.Language,
			&c.Genre, &c.Publisher, &year, &c.PageCount,
			&addedAt, &updatedAt, &c.Filename,
		); err != nil {
			continue
		}
		c.AddedAt = addedAt.UTC().Format(time.RFC3339)
		c.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		if year.Valid {
			c.Year = int(year.Int64)
		}
		c.Tags = []string{}
		comics = append(comics, c)
	}

	// Load tags
	if len(comics) > 0 {
		ids := make([]string, len(comics))
		idx := make(map[string]int, len(comics))
		for i, c := range comics {
			ids[i] = c.ID
			idx[c.ID] = i
		}
		ph := make([]string, len(ids))
		targs := make([]interface{}, len(ids))
		for i, id := range ids {
			ph[i] = "?"
			targs[i] = id
		}
		tagQuery := fmt.Sprintf(`
			SELECT ct."comicId", t."name"
			FROM "ComicTag" ct JOIN "Tag" t ON ct."tagId" = t."id"
			WHERE ct."comicId" IN (%s)
		`, strings.Join(ph, ","))
		tagRows, err := db.Query(tagQuery, targs...)
		if err == nil {
			defer tagRows.Close()
			for tagRows.Next() {
				var comicID, name string
				if tagRows.Scan(&comicID, &name) == nil {
					if i, ok := idx[comicID]; ok {
						comics[i].Tags = append(comics[i].Tags, name)
					}
				}
			}
		}
	}

	return comics, nil
}

// ============================================================
// 同步查询
// ============================================================

// SyncComic 保存同步所需的最小漫画数据。
type SyncComic struct {
	ID           string
	Filename     string
	LastReadPage int
	LastReadAt   *time.Time
	IsFavorite   bool
	Rating       *int
	Tags         []string
}

// GetAllComicsForSync 返回所有漫画的同步所需数据。
func GetAllComicsForSync() ([]SyncComic, error) {
	rows, err := db.Query(`
		SELECT "id", "filename", "lastReadPage", "lastReadAt", "isFavorite", "rating"
		FROM "Comic"
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var comics []SyncComic
	for rows.Next() {
		var c SyncComic
		var lastReadAt sql.NullTime
		var rating sql.NullInt64
		var isFav int

		if err := rows.Scan(&c.ID, &c.Filename, &c.LastReadPage, &lastReadAt, &isFav, &rating); err != nil {
			continue
		}
		c.IsFavorite = isFav != 0
		if lastReadAt.Valid {
			c.LastReadAt = &lastReadAt.Time
		}
		if rating.Valid {
			v := int(rating.Int64)
			c.Rating = &v
		}
		c.Tags = []string{}
		comics = append(comics, c)
	}

	if len(comics) == 0 {
		return comics, nil
	}

	// Load tags
	ids := make([]string, len(comics))
	idx := make(map[string]int, len(comics))
	for i, c := range comics {
		ids[i] = c.ID
		idx[c.ID] = i
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	tagQuery := fmt.Sprintf(`
		SELECT ct."comicId", t."name"
		FROM "ComicTag" ct JOIN "Tag" t ON ct."tagId" = t."id"
		WHERE ct."comicId" IN (%s)
	`, strings.Join(placeholders, ","))
	tagRows, err := db.Query(tagQuery, args...)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var comicID, name string
			if tagRows.Scan(&comicID, &name) == nil {
				if i, ok := idx[comicID]; ok {
					comics[i].Tags = append(comics[i].Tags, name)
				}
			}
		}
	}

	return comics, nil
}

// GetSyncComic 返回单个漫画的同步数据。
func GetSyncComic(comicID string) (*SyncComic, error) {
	var c SyncComic
	var lastReadAt sql.NullTime
	var rating sql.NullInt64
	var isFav int

	err := db.QueryRow(`
		SELECT "id", "filename", "lastReadPage", "lastReadAt", "isFavorite", "rating"
		FROM "Comic" WHERE "id" = ?
	`, comicID).Scan(&c.ID, &c.Filename, &c.LastReadPage, &lastReadAt, &isFav, &rating)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.IsFavorite = isFav != 0
	if lastReadAt.Valid {
		c.LastReadAt = &lastReadAt.Time
	}
	if rating.Valid {
		v := int(rating.Int64)
		c.Rating = &v
	}

	// Load tags
	c.Tags = []string{}
	tagRows, err := db.Query(`
		SELECT t."name" FROM "ComicTag" ct JOIN "Tag" t ON ct."tagId" = t."id"
		WHERE ct."comicId" = ?
	`, comicID)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var name string
			if tagRows.Scan(&name) == nil {
				c.Tags = append(c.Tags, name)
			}
		}
	}

	return &c, nil
}

// UpdateComicSync 更新同步状态。
func UpdateComicSync(comicID string, lastReadPage int, lastReadAt *time.Time, isFavorite bool, rating *int) error {
	isFav := 0
	if isFavorite {
		isFav = 1
	}
	_, err := db.Exec(`
		UPDATE "Comic" SET "lastReadPage" = ?, "lastReadAt" = ?, "isFavorite" = ?, "rating" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, lastReadPage, lastReadAt, isFav, rating, time.Now().UTC(), comicID)
	return err
}

// UpdateComicFields 更新漫画的任意字段。
func UpdateComicFields(comicID string, fields map[string]interface{}) error {
	if len(fields) == 0 {
		return nil
	}

	var setClauses []string
	var args []interface{}
	for k, v := range fields {
		setClauses = append(setClauses, fmt.Sprintf(`"%s" = ?`, k))
		args = append(args, v)
	}
	setClauses = append(setClauses, `"updatedAt" = ?`)
	args = append(args, time.Now().UTC())
	args = append(args, comicID)

	query := fmt.Sprintf(`UPDATE "Comic" SET %s WHERE "id" = ?`, strings.Join(setClauses, ", "))
	_, err := db.Exec(query, args...)
	return err
}
