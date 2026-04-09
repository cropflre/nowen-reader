package store

import (
	"log"
)

// ============================================================
// P5: 系列级分类管理
// ============================================================

// GetGroupCategoryStats 返回所有分类及其关联的系列数量（用于系列视图的分类筛选）。
// 可选按 contentType 过滤：只统计包含指定类型漫画的系列。
func GetGroupCategoryStats(contentType string) ([]CategoryWithCount, error) {
	var query string
	var args []interface{}

	if contentType == "comic" || contentType == "novel" {
		// 只统计包含指定类型漫画的系列
		query = `
			SELECT cat."id", cat."name", cat."slug", cat."icon",
			       COUNT(DISTINCT gc."groupId") as cnt
			FROM "Category" cat
			LEFT JOIN "GroupCategory" gc ON gc."categoryId" = cat."id"
			    AND gc."groupId" IN (
			        SELECT DISTINCT gi."groupId" FROM "ComicGroupItem" gi
			        JOIN "Comic" c ON c."id" = gi."comicId"
			        WHERE c."type" = ?
			    )
			GROUP BY cat."id"
			ORDER BY cat."sortOrder" ASC
		`
		args = append(args, contentType)
	} else {
		query = `
			SELECT cat."id", cat."name", cat."slug", cat."icon",
			       COUNT(DISTINCT gc."groupId") as cnt
			FROM "Category" cat
			LEFT JOIN "GroupCategory" gc ON gc."categoryId" = cat."id"
			GROUP BY cat."id"
			ORDER BY cat."sortOrder" ASC
		`
	}

	rows, err := db.Query(query, args...)
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

// GetGroupCategories 获取系列的所有分类。
func GetGroupCategories(groupID int) ([]CategoryWithCount, error) {
	rows, err := db.Query(`
		SELECT cat."id", cat."name", cat."slug", cat."icon", 0 as cnt
		FROM "Category" cat
		INNER JOIN "GroupCategory" gc ON gc."categoryId" = cat."id"
		WHERE gc."groupId" = ?
		ORDER BY cat."sortOrder" ASC
	`, groupID)
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

// SetGroupCategories 设置系列的分类（替换所有现有分类）。
// categorySlugs: 分类 slug 列表。
func SetGroupCategories(groupID int, categorySlugs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 清除现有分类
	if _, err := tx.Exec(`DELETE FROM "GroupCategory" WHERE "groupId" = ?`, groupID); err != nil {
		return err
	}

	// 添加新分类
	for _, slug := range categorySlugs {
		var catID int
		err := tx.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, slug).Scan(&catID)
		if err != nil {
			// slug 不存在，跳过
			log.Printf("[SetGroupCategories] 分类 slug=%s 不存在，跳过", slug)
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO "GroupCategory" ("groupId", "categoryId") VALUES (?, ?)
			ON CONFLICT DO NOTHING
		`, groupID, catID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// AddGroupCategories 为系列添加分类（增量添加，不影响已有分类）。
func AddGroupCategories(groupID int, categorySlugs []string) error {
	for _, slug := range categorySlugs {
		var catID int
		err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, slug).Scan(&catID)
		if err != nil {
			log.Printf("[AddGroupCategories] 分类 slug=%s 不存在，跳过", slug)
			continue
		}
		if _, err := db.Exec(`
			INSERT INTO "GroupCategory" ("groupId", "categoryId") VALUES (?, ?)
			ON CONFLICT DO NOTHING
		`, groupID, catID); err != nil {
			return err
		}
	}
	return nil
}

// RemoveGroupCategory 从系列移除一个分类。
func RemoveGroupCategory(groupID int, categorySlug string) error {
	_, err := db.Exec(`
		DELETE FROM "GroupCategory"
		WHERE "groupId" = ? AND "categoryId" = (
			SELECT "id" FROM "Category" WHERE "slug" = ?
		)
	`, groupID, categorySlug)
	return err
}

// SyncGroupCategoriesToVolumes 将系列分类同步到所有卷（增量添加）。
func SyncGroupCategoriesToVolumes(groupID int) (totalVolumes, syncedVolumes int, err error) {
	group, e := GetGroupByID(groupID)
	if e != nil {
		err = e
		return
	}
	if group == nil || len(group.Comics) == 0 {
		return
	}

	// 获取系列级分类 slug
	cats, e := GetGroupCategories(groupID)
	if e != nil {
		err = e
		return
	}
	if len(cats) == 0 {
		return
	}

	var slugs []string
	for _, c := range cats {
		slugs = append(slugs, c.Slug)
	}

	totalVolumes = len(group.Comics)

	// 为每本漫画添加分类
	for _, comic := range group.Comics {
		if e := AddCategoriesToComic(comic.ComicID, slugs); e != nil {
			log.Printf("[SyncGroupCategories] 同步漫画 %s 分类失败: %v", comic.ComicID, e)
			continue
		}
		syncedVolumes++
	}

	return
}
