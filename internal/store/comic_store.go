package store

import (
	"crypto/md5"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ============================================================
// ID Generation (matches Node.js: md5(filename).substring(0,12))
// ============================================================

// FilenameToID generates a stable 12-char hex ID from a filename.
func FilenameToID(filename string) string {
	h := md5.Sum([]byte(filename))
	return fmt.Sprintf("%x", h)[:12]
}

// FilenameToTitle derives a clean title from filename (strip extension).
func FilenameToTitle(filename string) string {
	ext := filepath.Ext(filename)
	return strings.TrimSuffix(filename, ext)
}

// ============================================================
// Comic CRUD
// ============================================================

// ComicListOptions holds query parameters for listing comics.
type ComicListOptions struct {
	Search        string
	Tags          []string
	FavoritesOnly bool
	SortBy        string // "title" | "addedAt" | "lastReadAt" | "rating" | "custom"
	SortOrder     string // "asc" | "desc"
	Page          int
	PageSize      int
	Category      string
}

// ComicListItem is the serialized representation of a comic in list results.
type ComicListItem struct {
	ID             string                `json:"id"`
	Filename       string                `json:"filename"`
	Title          string                `json:"title"`
	PageCount      int                   `json:"pageCount"`
	FileSize       int64                 `json:"fileSize"`
	AddedAt        string                `json:"addedAt"`
	UpdatedAt      string                `json:"updatedAt"`
	LastReadPage   int                   `json:"lastReadPage"`
	LastReadAt     *string               `json:"lastReadAt"`
	IsFavorite     bool                  `json:"isFavorite"`
	Rating         *int                  `json:"rating"`
	SortOrder      int                   `json:"sortOrder"`
	TotalReadTime  int                   `json:"totalReadTime"`
	CoverURL       string                `json:"coverUrl"`
	Author         string                `json:"author"`
	Publisher      string                `json:"publisher"`
	Year           *int                  `json:"year"`
	Description    string                `json:"description"`
	Language       string                `json:"language"`
	SeriesName     string                `json:"seriesName"`
	SeriesIndex    *int                  `json:"seriesIndex"`
	Genre          string                `json:"genre"`
	MetadataSource string                `json:"metadataSource"`
	Tags           []ComicTagInfo        `json:"tags"`
	Categories     []ComicCategoryInfo   `json:"categories"`
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

// ComicListResult is the paginated result returned by GetAllComics.
type ComicListResult struct {
	Comics     []ComicListItem `json:"comics"`
	Total      int             `json:"total"`
	Page       int             `json:"page"`
	PageSize   int             `json:"pageSize"`
	TotalPages int             `json:"totalPages"`
}

// GetAllComics retrieves comics with filtering, sorting, and pagination.
func GetAllComics(opts ComicListOptions) (*ComicListResult, error) {
	// Build WHERE clause
	var conditions []string
	var args []interface{}

	if opts.Search != "" {
		searchPattern := "%" + opts.Search + "%"
		conditions = append(conditions, `(c."title" LIKE ? OR c."author" LIKE ? OR c."filename" LIKE ?)`)
		args = append(args, searchPattern, searchPattern, searchPattern)
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
		       c."language", c."seriesName", c."seriesIndex", c."genre", c."metadataSource"
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

// loadComicTags batch-loads tags for a set of comics.
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

// loadComicCategories batch-loads categories for a set of comics.
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

// GetComicByID retrieves a single comic with its tags and categories.
func GetComicByID(id string) (*ComicListItem, error) {
	query := `
		SELECT c."id", c."filename", c."title", c."pageCount", c."fileSize",
		       c."addedAt", c."updatedAt", c."lastReadPage", c."lastReadAt",
		       c."isFavorite", c."rating", c."sortOrder", c."totalReadTime",
		       c."author", c."publisher", c."year", c."description",
		       c."language", c."seriesName", c."seriesIndex", c."genre", c."metadataSource"
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
// Comic mutations
// ============================================================

// UpdateReadingProgress updates the last read page and timestamp.
func UpdateReadingProgress(comicID string, page int) error {
	_, err := db.Exec(`
		UPDATE "Comic" SET "lastReadPage" = ?, "lastReadAt" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, page, time.Now().UTC(), time.Now().UTC(), comicID)
	return err
}

// ToggleFavorite flips the isFavorite flag. Returns the new state.
func ToggleFavorite(comicID string) (bool, error) {
	var current int
	err := db.QueryRow(`SELECT "isFavorite" FROM "Comic" WHERE "id" = ?`, comicID).Scan(&current)
	if err != nil {
		return false, err
	}
	newVal := 0
	if current == 0 {
		newVal = 1
	}
	_, err = db.Exec(`UPDATE "Comic" SET "isFavorite" = ?, "updatedAt" = ? WHERE "id" = ?`,
		newVal, time.Now().UTC(), comicID)
	return newVal == 1, err
}

// UpdateRating sets the rating (1-5 or nil to clear).
func UpdateRating(comicID string, rating *int) error {
	_, err := db.Exec(`UPDATE "Comic" SET "rating" = ?, "updatedAt" = ? WHERE "id" = ?`,
		rating, time.Now().UTC(), comicID)
	return err
}

// DeleteComic removes a comic from DB and optionally from disk.
func DeleteComic(comicID string, comicsDirs []string) error {
	// Get filename before deleting
	var filename string
	err := db.QueryRow(`SELECT "filename" FROM "Comic" WHERE "id" = ?`, comicID).Scan(&filename)
	if err != nil {
		return err
	}

	// Delete from DB (CASCADE handles relations)
	_, err = db.Exec(`DELETE FROM "Comic" WHERE "id" = ?`, comicID)
	if err != nil {
		return err
	}

	// Try to delete file from disk
	for _, dir := range comicsDirs {
		fp := filepath.Join(dir, filename)
		if _, err := os.Stat(fp); err == nil {
			_ = os.Remove(fp)
			break
		}
	}
	return nil
}

// ============================================================
// Tag operations
// ============================================================

type TagWithCount struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Count int    `json:"count"`
}

// GetAllTags returns all tags with their comic counts.
func GetAllTags() ([]TagWithCount, error) {
	rows, err := db.Query(`
		SELECT t."id", t."name", t."color", COUNT(ct."comicId") as cnt
		FROM "Tag" t
		LEFT JOIN "ComicTag" ct ON ct."tagId" = t."id"
		GROUP BY t."id"
		ORDER BY t."name" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []TagWithCount
	for rows.Next() {
		var t TagWithCount
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.Count); err != nil {
			continue
		}
		tags = append(tags, t)
	}
	if tags == nil {
		tags = []TagWithCount{}
	}
	return tags, nil
}

// AddTagsToComic adds tags to a comic (upsert).
func AddTagsToComic(comicID string, tagNames []string) error {
	for _, name := range tagNames {
		// Upsert tag
		_, err := db.Exec(`INSERT INTO "Tag" ("name") VALUES (?) ON CONFLICT("name") DO NOTHING`, name)
		if err != nil {
			return err
		}

		var tagID int
		err = db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, name).Scan(&tagID)
		if err != nil {
			return err
		}

		// Link to comic
		_, err = db.Exec(`INSERT INTO "ComicTag" ("comicId", "tagId") VALUES (?, ?) ON CONFLICT DO NOTHING`,
			comicID, tagID)
		if err != nil {
			return err
		}
	}
	return nil
}

// RemoveTagFromComic removes a tag from a comic, cleaning up orphan tags.
func RemoveTagFromComic(comicID string, tagName string) error {
	var tagID int
	err := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, tagName).Scan(&tagID)
	if err == sql.ErrNoRows {
		return nil // tag doesn't exist
	}
	if err != nil {
		return err
	}

	_, err = db.Exec(`DELETE FROM "ComicTag" WHERE "comicId" = ? AND "tagId" = ?`, comicID, tagID)
	if err != nil {
		return err
	}

	// Clean up orphan tag
	var count int
	_ = db.QueryRow(`SELECT COUNT(*) FROM "ComicTag" WHERE "tagId" = ?`, tagID).Scan(&count)
	if count == 0 {
		_, _ = db.Exec(`DELETE FROM "Tag" WHERE "id" = ?`, tagID)
	}
	return nil
}

// UpdateTagColor updates a tag's color by name.
func UpdateTagColor(tagName, color string) error {
	_, err := db.Exec(`UPDATE "Tag" SET "color" = ? WHERE "name" = ?`, color, tagName)
	return err
}

// ============================================================
// Category operations
// ============================================================

type CategoryWithCount struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Icon  string `json:"icon"`
	Count int    `json:"count"`
}

// GetAllCategories returns all categories with comic counts.
func GetAllCategories() ([]CategoryWithCount, error) {
	rows, err := db.Query(`
		SELECT cat."id", cat."name", cat."slug", cat."icon", COUNT(cc."comicId") as cnt
		FROM "Category" cat
		LEFT JOIN "ComicCategory" cc ON cc."categoryId" = cat."id"
		GROUP BY cat."id"
		ORDER BY cat."sortOrder" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cats []CategoryWithCount
	for rows.Next() {
		var c CategoryWithCount
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.Icon, &c.Count); err != nil {
			continue
		}
		cats = append(cats, c)
	}
	if cats == nil {
		cats = []CategoryWithCount{}
	}
	return cats, nil
}

// PredefinedCategory represents a predefined category.
type PredefinedCategory struct {
	Slug  string
	Icon  string
	NameZH string
	NameEN string
}

// PredefinedCategories is the list of 24 predefined categories.
var PredefinedCategories = []PredefinedCategory{
	{Slug: "romance", Icon: "💕", NameZH: "恋爱", NameEN: "Romance"},
	{Slug: "action", Icon: "⚔️", NameZH: "动作", NameEN: "Action"},
	{Slug: "fantasy", Icon: "🔮", NameZH: "奇幻", NameEN: "Fantasy"},
	{Slug: "comedy", Icon: "😂", NameZH: "搞笑", NameEN: "Comedy"},
	{Slug: "drama", Icon: "🎭", NameZH: "剧情", NameEN: "Drama"},
	{Slug: "horror", Icon: "👻", NameZH: "恐怖", NameEN: "Horror"},
	{Slug: "thriller", Icon: "😱", NameZH: "惊悚", NameEN: "Thriller"},
	{Slug: "mystery", Icon: "🔍", NameZH: "悬疑", NameEN: "Mystery"},
	{Slug: "slice-of-life", Icon: "☀️", NameZH: "日常", NameEN: "Slice of Life"},
	{Slug: "school", Icon: "🏫", NameZH: "校园", NameEN: "School"},
	{Slug: "sci-fi", Icon: "🚀", NameZH: "科幻", NameEN: "Sci-Fi"},
	{Slug: "sports", Icon: "⚽", NameZH: "运动", NameEN: "Sports"},
	{Slug: "historical", Icon: "📜", NameZH: "历史", NameEN: "Historical"},
	{Slug: "isekai", Icon: "🌀", NameZH: "异世界", NameEN: "Isekai"},
	{Slug: "mecha", Icon: "🤖", NameZH: "机甲", NameEN: "Mecha"},
	{Slug: "supernatural", Icon: "✨", NameZH: "超自然", NameEN: "Supernatural"},
	{Slug: "martial-arts", Icon: "🥋", NameZH: "武侠", NameEN: "Martial Arts"},
	{Slug: "shounen", Icon: "👦", NameZH: "少年", NameEN: "Shounen"},
	{Slug: "shoujo", Icon: "👧", NameZH: "少女", NameEN: "Shoujo"},
	{Slug: "seinen", Icon: "🧑", NameZH: "青年", NameEN: "Seinen"},
	{Slug: "josei", Icon: "👩", NameZH: "女性", NameEN: "Josei"},
	{Slug: "adventure", Icon: "🗺️", NameZH: "冒险", NameEN: "Adventure"},
	{Slug: "psychological", Icon: "🧠", NameZH: "心理", NameEN: "Psychological"},
	{Slug: "gourmet", Icon: "🍜", NameZH: "美食", NameEN: "Gourmet"},
}

// InitCategories upserts all predefined categories.
func InitCategories(lang string) error {
	isZH := strings.HasPrefix(lang, "zh")
	for i, cat := range PredefinedCategories {
		name := cat.NameEN
		if isZH {
			name = cat.NameZH
		}
		_, err := db.Exec(`
			INSERT INTO "Category" ("name", "slug", "icon", "sortOrder")
			VALUES (?, ?, ?, ?)
			ON CONFLICT("slug") DO UPDATE SET "icon" = ?, "sortOrder" = ?
		`, name, cat.Slug, cat.Icon, i, cat.Icon, i)
		if err != nil {
			return err
		}
	}
	return nil
}

// AddCategoriesToComic adds categories to a comic by slug.
func AddCategoriesToComic(comicID string, categorySlugs []string) error {
	for _, slug := range categorySlugs {
		// Try to find existing category
		var catID int
		err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, slug).Scan(&catID)
		if err == sql.ErrNoRows {
			// Auto-create from predefined or use slug as name
			name := slug
			icon := "📚"
			sortOrder := 999
			for _, pc := range PredefinedCategories {
				if pc.Slug == slug {
					name = pc.NameZH
					icon = pc.Icon
					break
				}
			}
			res, err := db.Exec(`INSERT INTO "Category" ("name", "slug", "icon", "sortOrder") VALUES (?, ?, ?, ?)`,
				name, slug, icon, sortOrder)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			catID = int(id)
		} else if err != nil {
			return err
		}

		// Link
		_, err = db.Exec(`INSERT INTO "ComicCategory" ("comicId", "categoryId") VALUES (?, ?) ON CONFLICT DO NOTHING`,
			comicID, catID)
		if err != nil {
			return err
		}
	}
	return nil
}

// RemoveCategoryFromComic removes a category from a comic.
func RemoveCategoryFromComic(comicID, categorySlug string) error {
	var catID int
	err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, categorySlug).Scan(&catID)
	if err != nil {
		return nil // category doesn't exist, nothing to do
	}
	_, err = db.Exec(`DELETE FROM "ComicCategory" WHERE "comicId" = ? AND "categoryId" = ?`, comicID, catID)
	return err
}

// SetComicCategories replaces all categories for a comic.
func SetComicCategories(comicID string, categorySlugs []string) error {
	_, err := db.Exec(`DELETE FROM "ComicCategory" WHERE "comicId" = ?`, comicID)
	if err != nil {
		return err
	}
	if len(categorySlugs) > 0 {
		return AddCategoriesToComic(comicID, categorySlugs)
	}
	return nil
}

// ============================================================
// Batch operations
// ============================================================

// BatchDeleteComics deletes multiple comics and their relations.
func BatchDeleteComics(comicIDs []string) (int64, error) {
	if len(comicIDs) == 0 {
		return 0, nil
	}
	placeholders := make([]string, len(comicIDs))
	args := make([]interface{}, len(comicIDs))
	for i, id := range comicIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	in := strings.Join(placeholders, ",")

	// Delete related data first (explicit, even though CASCADE should handle it)
	db.Exec(fmt.Sprintf(`DELETE FROM "ComicTag" WHERE "comicId" IN (%s)`, in), args...)
	db.Exec(fmt.Sprintf(`DELETE FROM "ComicCategory" WHERE "comicId" IN (%s)`, in), args...)
	db.Exec(fmt.Sprintf(`DELETE FROM "ReadingSession" WHERE "comicId" IN (%s)`, in), args...)

	res, err := db.Exec(fmt.Sprintf(`DELETE FROM "Comic" WHERE "id" IN (%s)`, in), args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// BatchSetFavorite sets the isFavorite flag for multiple comics.
func BatchSetFavorite(comicIDs []string, isFavorite bool) (int64, error) {
	if len(comicIDs) == 0 {
		return 0, nil
	}
	val := 0
	if isFavorite {
		val = 1
	}
	placeholders := make([]string, len(comicIDs))
	args := []interface{}{val, time.Now().UTC()}
	for i, id := range comicIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	in := strings.Join(placeholders, ",")

	res, err := db.Exec(
		fmt.Sprintf(`UPDATE "Comic" SET "isFavorite" = ?, "updatedAt" = ? WHERE "id" IN (%s)`, in),
		args...,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// BatchAddTags adds tags to multiple comics.
func BatchAddTags(comicIDs []string, tagNames []string) error {
	for _, comicID := range comicIDs {
		if err := AddTagsToComic(comicID, tagNames); err != nil {
			return err
		}
	}
	return nil
}

// BatchSetCategory adds categories to multiple comics.
func BatchSetCategory(comicIDs []string, categorySlugs []string) error {
	for _, comicID := range comicIDs {
		if err := AddCategoriesToComic(comicID, categorySlugs); err != nil {
			return err
		}
	}
	return nil
}

// ============================================================
// Sort order
// ============================================================

// UpdateSortOrders updates sort order for multiple comics in a transaction.
func UpdateSortOrders(orders []struct {
	ID        string `json:"id"`
	SortOrder int    `json:"sortOrder"`
}) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE "Comic" SET "sortOrder" = ? WHERE "id" = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, o := range orders {
		if _, err := stmt.Exec(o.SortOrder, o.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ============================================================
// Reading sessions
// ============================================================

// StartReadingSession creates a new reading session.
func StartReadingSession(comicID string, startPage int) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO "ReadingSession" ("comicId", "startPage", "startedAt")
		VALUES (?, ?, ?)
	`, comicID, startPage, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// EndReadingSession completes a reading session and updates comic's total read time.
func EndReadingSession(sessionID int, endPage int, duration int) error {
	// Get the comicId from the session
	var comicID string
	err := db.QueryRow(`SELECT "comicId" FROM "ReadingSession" WHERE "id" = ?`, sessionID).Scan(&comicID)
	if err != nil {
		return err
	}

	// Update session
	_, err = db.Exec(`
		UPDATE "ReadingSession" SET "endedAt" = ?, "endPage" = ?, "duration" = ?
		WHERE "id" = ?
	`, time.Now().UTC(), endPage, duration, sessionID)
	if err != nil {
		return err
	}

	// Increment comic's total read time
	_, err = db.Exec(`
		UPDATE "Comic" SET "totalReadTime" = "totalReadTime" + ? WHERE "id" = ?
	`, duration, comicID)
	return err
}

// ReadingStatsResult holds aggregated reading statistics.
type ReadingStatsResult struct {
	TotalReadTime   int                  `json:"totalReadTime"`
	TotalSessions   int                  `json:"totalSessions"`
	TotalComicsRead int                  `json:"totalComicsRead"`
	RecentSessions  []RecentSessionItem  `json:"recentSessions"`
	DailyStats      []DailyStatItem      `json:"dailyStats"`
}

type RecentSessionItem struct {
	ID         int     `json:"id"`
	ComicID    string  `json:"comicId"`
	ComicTitle string  `json:"comicTitle"`
	StartedAt  string  `json:"startedAt"`
	EndedAt    *string `json:"endedAt"`
	Duration   int     `json:"duration"`
	StartPage  int     `json:"startPage"`
	EndPage    int     `json:"endPage"`
}

type DailyStatItem struct {
	Date     string `json:"date"`
	Duration int    `json:"duration"`
	Sessions int    `json:"sessions"`
}

// GetReadingStats returns aggregated reading statistics.
func GetReadingStats() (*ReadingStatsResult, error) {
	result := &ReadingStatsResult{
		RecentSessions: []RecentSessionItem{},
		DailyStats:     []DailyStatItem{},
	}

	// Recent 50 sessions
	rows, err := db.Query(`
		SELECT rs."id", rs."comicId", c."title", rs."startedAt", rs."endedAt",
		       rs."duration", rs."startPage", rs."endPage"
		FROM "ReadingSession" rs
		JOIN "Comic" c ON rs."comicId" = c."id"
		ORDER BY rs."startedAt" DESC
		LIMIT 50
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var s RecentSessionItem
		var startedAt time.Time
		var endedAt sql.NullTime
		if err := rows.Scan(&s.ID, &s.ComicID, &s.ComicTitle, &startedAt, &endedAt, &s.Duration, &s.StartPage, &s.EndPage); err != nil {
			continue
		}
		s.StartedAt = startedAt.UTC().Format(time.RFC3339Nano)
		if endedAt.Valid {
			e := endedAt.Time.UTC().Format(time.RFC3339Nano)
			s.EndedAt = &e
		}
		result.RecentSessions = append(result.RecentSessions, s)
	}

	// Aggregates
	db.QueryRow(`SELECT COALESCE(SUM("duration"), 0), COUNT(*) FROM "ReadingSession"`).
		Scan(&result.TotalReadTime, &result.TotalSessions)

	db.QueryRow(`SELECT COUNT(DISTINCT "comicId") FROM "ReadingSession"`).
		Scan(&result.TotalComicsRead)

	// Daily stats (last 30 days)
	thirtyDaysAgo := time.Now().AddDate(0, 0, -30).UTC().Format(time.RFC3339)
	dailyRows, err := db.Query(`
		SELECT DATE(rs."startedAt") as d, SUM(rs."duration"), COUNT(*)
		FROM "ReadingSession" rs
		WHERE rs."startedAt" >= ?
		GROUP BY d
		ORDER BY d ASC
	`, thirtyDaysAgo)
	if err == nil {
		defer dailyRows.Close()
		for dailyRows.Next() {
			var ds DailyStatItem
			if dailyRows.Scan(&ds.Date, &ds.Duration, &ds.Sessions) == nil {
				result.DailyStats = append(result.DailyStats, ds)
			}
		}
	}

	return result, nil
}

// GetComicReadingHistory returns the last 20 reading sessions for a comic.
func GetComicReadingHistory(comicID string) ([]RecentSessionItem, error) {
	rows, err := db.Query(`
		SELECT rs."id", rs."comicId", '' as title, rs."startedAt", rs."endedAt",
		       rs."duration", rs."startPage", rs."endPage"
		FROM "ReadingSession" rs
		WHERE rs."comicId" = ?
		ORDER BY rs."startedAt" DESC
		LIMIT 20
	`, comicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []RecentSessionItem
	for rows.Next() {
		var s RecentSessionItem
		var startedAt time.Time
		var endedAt sql.NullTime
		if err := rows.Scan(&s.ID, &s.ComicID, &s.ComicTitle, &startedAt, &endedAt, &s.Duration, &s.StartPage, &s.EndPage); err != nil {
			continue
		}
		s.StartedAt = startedAt.UTC().Format(time.RFC3339Nano)
		if endedAt.Valid {
			e := endedAt.Time.UTC().Format(time.RFC3339Nano)
			s.EndedAt = &e
		}
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []RecentSessionItem{}
	}
	return sessions, nil
}

// ============================================================
// Quick Sync helpers (used by comic_service)
// ============================================================

// GetAllComicIDs returns all comic IDs from the database.
func GetAllComicIDs() ([]string, error) {
	rows, err := db.Query(`SELECT "id" FROM "Comic"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// BulkCreateComics inserts multiple comics in a single transaction.
func BulkCreateComics(comics []struct {
	ID       string
	Filename string
	Title    string
	FileSize int64
}) error {
	if len(comics) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize")
		VALUES (?, ?, ?, 0, ?)
		ON CONFLICT("id") DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, c := range comics {
		if _, err := stmt.Exec(c.ID, c.Filename, c.Title, c.FileSize); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// BulkDeleteComicsByIDs deletes comics with the given IDs.
func BulkDeleteComicsByIDs(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	_, err := db.Exec(
		fmt.Sprintf(`DELETE FROM "Comic" WHERE "id" IN (%s)`, strings.Join(placeholders, ",")),
		args...,
	)
	return err
}

// GetComicsNeedingPageCount returns comics with pageCount = 0 (need fullSync).
func GetComicsNeedingPageCount(limit int) ([]struct {
	ID       string
	Filename string
}, error) {
	rows, err := db.Query(`
		SELECT "id", "filename" FROM "Comic" WHERE "pageCount" = 0 LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []struct {
		ID       string
		Filename string
	}
	for rows.Next() {
		var c struct {
			ID       string
			Filename string
		}
		if rows.Scan(&c.ID, &c.Filename) == nil {
			result = append(result, c)
		}
	}
	return result, nil
}

// ComicIDFilename holds minimal comic info for thumbnail management.
type ComicIDFilename struct {
	ID       string
	Filename string
}

// GetAllComicIDsAndFilenames returns all comics' IDs and filenames.
func GetAllComicIDsAndFilenames() ([]ComicIDFilename, error) {
	rows, err := db.Query(`SELECT "id", "filename" FROM "Comic"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ComicIDFilename
	for rows.Next() {
		var c ComicIDFilename
		if rows.Scan(&c.ID, &c.Filename) == nil {
			result = append(result, c)
		}
	}
	return result, nil
}

// UpdateComicPageCount updates the page count for a single comic.
func UpdateComicPageCount(comicID string, pageCount int) error {
	_, err := db.Exec(`UPDATE "Comic" SET "pageCount" = ? WHERE "id" = ?`, pageCount, comicID)
	return err
}

// ============================================================
// Duplicate detection
// ============================================================

// DuplicateGroup represents a group of duplicate comics.
type DuplicateGroup struct {
	Reason string              `json:"reason"`
	Comics []DuplicateComicInfo `json:"comics"`
}

type DuplicateComicInfo struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	Title     string `json:"title"`
	FileSize  int64  `json:"fileSize"`
	PageCount int    `json:"pageCount"`
	AddedAt   string `json:"addedAt"`
	CoverURL  string `json:"coverUrl"`
}

// DetectDuplicates finds duplicate comics by hash, size+pageCount, and normalized title.
func DetectDuplicates(comicsDir string) ([]DuplicateGroup, error) {
	rows, err := db.Query(`
		SELECT "id", "filename", "title", "fileSize", "pageCount", "addedAt"
		FROM "Comic" ORDER BY "title" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type comicInfo struct {
		ID        string
		Filename  string
		Title     string
		FileSize  int64
		PageCount int
		AddedAt   time.Time
	}

	var comics []comicInfo
	for rows.Next() {
		var c comicInfo
		if rows.Scan(&c.ID, &c.Filename, &c.Title, &c.FileSize, &c.PageCount, &c.AddedAt) == nil {
			comics = append(comics, c)
		}
	}

	toInfo := func(c comicInfo) DuplicateComicInfo {
		return DuplicateComicInfo{
			ID:        c.ID,
			Filename:  c.Filename,
			Title:     c.Title,
			FileSize:  c.FileSize,
			PageCount: c.PageCount,
			AddedAt:   c.AddedAt.UTC().Format(time.RFC3339Nano),
			CoverURL:  fmt.Sprintf("/api/comics/%s/thumbnail", c.ID),
		}
	}

	var groups []DuplicateGroup
	usedIDs := make(map[string]bool)

	// Pass 1: Exact content hash (SHA-256)
	hashMap := make(map[string][]comicInfo)
	for _, c := range comics {
		fp := filepath.Join(comicsDir, c.Filename)
		f, err := os.Open(fp)
		if err != nil {
			continue
		}
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			f.Close()
			continue
		}
		f.Close()
		hash := fmt.Sprintf("%x", h.Sum(nil))
		hashMap[hash] = append(hashMap[hash], c)
	}
	for _, arr := range hashMap {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			for _, c := range arr {
				usedIDs[c.ID] = true
				infos = append(infos, toInfo(c))
			}
			groups = append(groups, DuplicateGroup{Reason: "sameFile", Comics: infos})
		}
	}

	// Pass 2: Same fileSize + pageCount
	sizePageMap := make(map[string][]comicInfo)
	for _, c := range comics {
		if usedIDs[c.ID] {
			continue
		}
		key := fmt.Sprintf("%d_%d", c.FileSize, c.PageCount)
		sizePageMap[key] = append(sizePageMap[key], c)
	}
	for _, arr := range sizePageMap {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			for _, c := range arr {
				usedIDs[c.ID] = true
				infos = append(infos, toInfo(c))
			}
			groups = append(groups, DuplicateGroup{Reason: "sameSize", Comics: infos})
		}
	}

	// Pass 3: Normalized title
	titleMap := make(map[string][]comicInfo)
	for _, c := range comics {
		if usedIDs[c.ID] {
			continue
		}
		normalized := normalizeTitle(c.Title)
		if normalized == "" {
			continue
		}
		titleMap[normalized] = append(titleMap[normalized], c)
	}
	for _, arr := range titleMap {
		if len(arr) > 1 {
			var infos []DuplicateComicInfo
			for _, c := range arr {
				infos = append(infos, toInfo(c))
			}
			groups = append(groups, DuplicateGroup{Reason: "sameName", Comics: infos})
		}
	}

	if groups == nil {
		groups = []DuplicateGroup{}
	}
	return groups, nil
}

// ============================================================
// Phase 4: Additional store functions
// ============================================================

// UpdateComicFields updates arbitrary comic fields.
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

// RecommendationComic holds comic data needed for recommendation.
type RecommendationComic struct {
	ID            string
	Title         string
	Author        string
	Genre         string
	SeriesName    string
	PageCount     int
	LastReadPage  int
	LastReadAt    *time.Time
	IsFavorite    bool
	Rating        *int
	TotalReadTime int
	Tags          []ComicTagInfo
	Categories    []ComicCategoryInfo
}

// GetAllComicsForRecommendation returns all comics with data needed for recommendation.
func GetAllComicsForRecommendation() ([]RecommendationComic, error) {
	rows, err := db.Query(`
		SELECT "id", "title", "author", "genre", "seriesName",
		       "pageCount", "lastReadPage", "lastReadAt", "isFavorite",
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
			&c.PageCount, &c.LastReadPage, &lastReadAt, &isFav,
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

// SyncComic holds minimal comic data for sync.
type SyncComic struct {
	ID           string
	Filename     string
	LastReadPage int
	LastReadAt   *time.Time
	IsFavorite   bool
	Rating       *int
	Tags         []string
}

// GetAllComicsForSync returns all comics with data needed for cloud sync.
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

// GetSyncComic returns a single comic's sync data.
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

// UpdateComicSync updates comic fields for sync.
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

// GetOPDSComics returns comics formatted for OPDS feed generation.
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

// OPDSComicRow is used for OPDS queries.
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

// RenameTag renames a tag and handles merging if the target name already exists.
func RenameTag(oldName, newName string) error {
	// Check if target tag exists
	var existingID int
	err := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, newName).Scan(&existingID)

	var oldID int
	err2 := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, oldName).Scan(&oldID)
	if err2 != nil {
		return nil // old tag doesn't exist
	}

	if err == sql.ErrNoRows {
		// Simple rename
		_, err = db.Exec(`UPDATE "Tag" SET "name" = ? WHERE "id" = ?`, newName, oldID)
		return err
	}

	// Target exists: merge
	// Move comic associations from old to new (ignore conflicts)
	_, _ = db.Exec(`
		UPDATE OR IGNORE "ComicTag" SET "tagId" = ? WHERE "tagId" = ?
	`, existingID, oldID)
	// Delete remaining (conflicting) associations
	_, _ = db.Exec(`DELETE FROM "ComicTag" WHERE "tagId" = ?`, oldID)
	// Delete old tag
	_, _ = db.Exec(`DELETE FROM "Tag" WHERE "id" = ?`, oldID)
	return nil
}

// normalizeTitle normalizes a title for comparison.
func normalizeTitle(title string) string {
	s := strings.ToLower(title)
	// Remove spaces, underscores, hyphens, dots
	replacer := strings.NewReplacer(" ", "", "_", "", "-", "", ".", "")
	s = replacer.Replace(s)
	// Remove brackets
	for _, ch := range []string{"(", ")", "[", "]", "{", "}", "【", "】", "（", "）", "「", "」", "『", "』"} {
		s = strings.ReplaceAll(s, ch, "")
	}
	// Remove trailing digits
	s = strings.TrimRight(s, "0123456789")
	return strings.TrimSpace(s)
}
