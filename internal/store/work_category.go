package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var ErrCategoryNotFound = errors.New("category not found")

func GetSeriesCategories(seriesID string) ([]ComicCategoryInfo, error) {
	rows, err := db.Query(`SELECT cat."id", cat."name", cat."slug", cat."icon"
		FROM "Category" cat JOIN "ComicSeriesCategory" sc ON sc."categoryId" = cat."id"
		WHERE sc."seriesId" = ? ORDER BY cat."sortOrder", cat."id"`, seriesID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	categories := []ComicCategoryInfo{}
	for rows.Next() {
		var category ComicCategoryInfo
		if err := rows.Scan(&category.ID, &category.Name, &category.Slug, &category.Icon); err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

func SetSeriesCategories(seriesID string, slugs []string) error {
	return setWorkCategories("ComicSeriesCategory", "seriesId", seriesID, slugs)
}

// The table and column are internal constants supplied by the two work setters.
func setWorkCategories(table, column string, workID interface{}, slugs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM "%s" WHERE "%s" = ?`, table, column), workID); err != nil {
		return err
	}
	for _, rawSlug := range slugs {
		slug := strings.TrimSpace(rawSlug)
		if slug == "" {
			continue
		}
		var id int
		if err := tx.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, slug).Scan(&id); err == sql.ErrNoRows {
			return fmt.Errorf("%w: %s", ErrCategoryNotFound, slug)
		} else if err != nil {
			return err
		}
		if _, err := tx.Exec(fmt.Sprintf(`INSERT OR IGNORE INTO "%s" ("%s", "categoryId") VALUES (?, ?)`, table, column), workID, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
