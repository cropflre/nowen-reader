package store

import (
	"crypto/md5"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ============================================================
// ID 生成 (与 Node.js 保持一致: md5(filename).substring(0,12))
// ============================================================

// FilenameToID 从文件名生成稳定的 12 字符十六进制 ID。
func FilenameToID(filename string) string {
	h := md5.Sum([]byte(filename))
	return fmt.Sprintf("%x", h)[:12]
}

// FilenameToTitle 从文件名推导出标题（去掉扩展名）。
func FilenameToTitle(filename string) string {
	ext := filepath.Ext(filename)
	return strings.TrimSuffix(filename, ext)
}

// ============================================================
// Comic 变更操作
// ============================================================

// UpdateReadingProgress 更新最后阅读页码和时间戳。
func UpdateReadingProgress(comicID string, page int) error {
	_, err := db.Exec(`
		UPDATE "Comic" SET "lastReadPage" = ?, "lastReadAt" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, page, time.Now().UTC(), time.Now().UTC(), comicID)
	return err
}

// ToggleFavorite 切换收藏状态，返回新状态。
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

// UpdateRating 设置评分 (1-5 或 nil 清除)。
func UpdateRating(comicID string, rating *int) error {
	_, err := db.Exec(`UPDATE "Comic" SET "rating" = ?, "updatedAt" = ? WHERE "id" = ?`,
		rating, time.Now().UTC(), comicID)
	return err
}

// DeleteComic 从数据库和磁盘删除漫画。
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
// 标签操作
// ============================================================

type TagWithCount struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Count int    `json:"count"`
}

// GetAllTags 返回所有标签及其漫画计数。
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

// AddTagsToComic 为漫画添加标签（upsert）。
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

// RemoveTagFromComic 从漫画移除标签，清理孤立标签。
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

// UpdateTagColor 更新标签颜色。
func UpdateTagColor(tagName, color string) error {
	_, err := db.Exec(`UPDATE "Tag" SET "color" = ? WHERE "name" = ?`, color, tagName)
	return err
}

// RenameTag 重命名标签，目标标签已存在时自动合并。
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
	_, _ = db.Exec(`
		UPDATE OR IGNORE "ComicTag" SET "tagId" = ? WHERE "tagId" = ?
	`, existingID, oldID)
	_, _ = db.Exec(`DELETE FROM "ComicTag" WHERE "tagId" = ?`, oldID)
	_, _ = db.Exec(`DELETE FROM "Tag" WHERE "id" = ?`, oldID)
	return nil
}

// ============================================================
// 分类操作
// ============================================================

type CategoryWithCount struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Icon  string `json:"icon"`
	Count int    `json:"count"`
}

// GetAllCategories 返回所有分类及其漫画计数。
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

// PredefinedCategory 表示一个预定义分类。
type PredefinedCategory struct {
	Slug   string
	Icon   string
	NameZH string
	NameEN string
}

// PredefinedCategories 是 24 个预定义分类列表。
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

// InitCategories 初始化所有预定义分类（upsert）。
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

// AddCategoriesToComic 通过 slug 为漫画添加分类。
func AddCategoriesToComic(comicID string, categorySlugs []string) error {
	for _, slug := range categorySlugs {
		var catID int
		err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, slug).Scan(&catID)
		if err == sql.ErrNoRows {
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

		_, err = db.Exec(`INSERT INTO "ComicCategory" ("comicId", "categoryId") VALUES (?, ?) ON CONFLICT DO NOTHING`,
			comicID, catID)
		if err != nil {
			return err
		}
	}
	return nil
}

// RemoveCategoryFromComic 从漫画移除分类。
func RemoveCategoryFromComic(comicID, categorySlug string) error {
	var catID int
	err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, categorySlug).Scan(&catID)
	if err != nil {
		return nil
	}
	_, err = db.Exec(`DELETE FROM "ComicCategory" WHERE "comicId" = ? AND "categoryId" = ?`, comicID, catID)
	return err
}

// SetComicCategories 替换漫画的所有分类。
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
// 辅助函数
// ============================================================

// normalizeTitle 标准化标题用于比较。
func normalizeTitle(title string) string {
	s := strings.ToLower(title)
	replacer := strings.NewReplacer(" ", "", "_", "", "-", "", ".", "")
	s = replacer.Replace(s)
	for _, ch := range []string{"(", ")", "[", "]", "{", "}", "【", "】", "（", "）", "「", "」", "『", "』"} {
		s = strings.ReplaceAll(s, ch, "")
	}
	s = strings.TrimRight(s, "0123456789")
	return strings.TrimSpace(s)
}
