package store

import (
	"log"
	"strings"
)

// ============================================================
// P5: 系列级分类管理
// ============================================================

// GetGroupCategoryStats 返回所有分类及其关联的系列数量（用于系列视图的分类筛选）。
// 可选按 contentType 过滤：只统计包含指定类型漫画的系列。
func GetGroupCategoryStats(contentType string, userIDs ...string) ([]CategoryWithCount, error) {
	conditions := []string{"1=1"}
	args := []interface{}{}
	if contentType == "comic" || contentType == "novel" {
		conditions = append(conditions, `c."type" = ?`)
		args = append(args, contentType)
	}
	if uid := firstString(userIDs); uid != "" {
		user, err := GetUserByID(uid)
		if err != nil {
			return nil, err
		}
		if user == nil || user.Role != "admin" {
			ids, err := GetUserAccessibleLibraryIDs(uid)
			if err != nil {
				return nil, err
			}
			if len(ids) == 0 {
				conditions = append(conditions, "1=0")
			} else {
				conditions = append(conditions, `c."libraryId" IN (`+placeholders(len(ids))+`)`)
				for _, id := range ids {
					args = append(args, id)
				}
			}
		}
	}
	rows, err := db.Query(`WITH "VisibleComic" AS (
  SELECT c."id", c."libraryId" FROM "Comic" c WHERE `+strings.Join(conditions, " AND ")+`
 ), "VisibleSeries" AS (
  SELECT DISTINCT s."id" FROM "ComicSeries" s
  JOIN "ComicSeriesItem" si ON si."seriesId" = s."id"
  JOIN "VisibleComic" c ON c."id" = si."comicId" AND c."libraryId" = s."libraryId"
 ), "GroupMember" AS (
  SELECT gi."groupId", c."id" AS "comicId" FROM "ComicGroupItem" gi JOIN "VisibleComic" c ON c."id" = gi."comicId"
  UNION
  SELECT gs."groupId", c."id" FROM "ComicGroupSeries" gs
  JOIN "ComicSeries" s ON s."id" = gs."seriesId"
  JOIN "ComicSeriesItem" si ON si."seriesId" = s."id"
  JOIN "VisibleComic" c ON c."id" = si."comicId" AND c."libraryId" = s."libraryId"
 ), "GroupCategories" AS (
  SELECT gc."groupId", gc."categoryId" FROM "GroupCategory" gc
  WHERE EXISTS (SELECT 1 FROM "GroupMember" gm WHERE gm."groupId" = gc."groupId")
  UNION
  SELECT gm."groupId", cc."categoryId" FROM "GroupMember" gm JOIN "ComicCategory" cc ON cc."comicId" = gm."comicId"
  UNION
  SELECT gs."groupId", sc."categoryId" FROM "ComicGroupSeries" gs
  JOIN "VisibleSeries" s ON s."id" = gs."seriesId"
  JOIN "ComicSeriesCategory" sc ON sc."seriesId" = s."id"
 )
 SELECT cat."id", cat."name", cat."slug", cat."icon", COUNT(DISTINCT gc."groupId")
 FROM "Category" cat LEFT JOIN "GroupCategories" gc ON gc."categoryId" = cat."id"
 GROUP BY cat."id" ORDER BY cat."sortOrder", cat."id"`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cats := []CategoryWithCount{}
	for rows.Next() {
		var cat CategoryWithCount
		if err := rows.Scan(&cat.ID, &cat.Name, &cat.Slug, &cat.Icon, &cat.Count); err != nil {
			return nil, err
		}
		cats = append(cats, cat)
	}
	return cats, rows.Err()
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
			return nil, err
		}
		cats = append(cats, c)
	}
	if cats == nil {
		cats = []CategoryWithCount{}
	}
	return cats, rows.Err()
}

// SetGroupCategories 设置系列的分类（替换所有现有分类）。
// categorySlugs: 分类 slug 列表。
func SetGroupCategories(groupID int, categorySlugs []string) error {
	return setWorkCategories("GroupCategory", "groupId", groupID, categorySlugs)
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
