package store

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ============================================================
// 批量操作
// ============================================================

// BatchDeleteComics 批量删除漫画及其关联数据（仅删除数据库记录）。
func BatchDeleteComics(comicIDs []string) (int64, error) {
	return BatchDeleteComicsWithFiles(comicIDs, nil, false)
}

// BatchDeleteComicsWithFiles 批量删除漫画及其关联数据，可选删除磁盘文件。
func BatchDeleteComicsWithFiles(comicIDs []string, comicsDirs []string, deleteFiles bool) (int64, error) {
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

	// If deleteFiles requested, get filenames first
	var filenames []string
	if deleteFiles && len(comicsDirs) > 0 {
		rows, err := db.Query(fmt.Sprintf(`SELECT "filename" FROM "Comic" WHERE "id" IN (%s)`, in), args...)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var fn string
				if rows.Scan(&fn) == nil {
					filenames = append(filenames, fn)
				}
			}
		}
	}

	// Delete related data first (explicit, even though CASCADE should handle it)
	db.Exec(fmt.Sprintf(`DELETE FROM "ComicTag" WHERE "comicId" IN (%s)`, in), args...)
	db.Exec(fmt.Sprintf(`DELETE FROM "ComicCategory" WHERE "comicId" IN (%s)`, in), args...)
	db.Exec(fmt.Sprintf(`DELETE FROM "ReadingSession" WHERE "comicId" IN (%s)`, in), args...)

	res, err := db.Exec(fmt.Sprintf(`DELETE FROM "Comic" WHERE "id" IN (%s)`, in), args...)
	if err != nil {
		return 0, err
	}

	// Delete files from disk
	if deleteFiles && len(filenames) > 0 {
		for _, fn := range filenames {
			for _, dir := range comicsDirs {
				fp := filepath.Join(dir, fn)
				if _, err := os.Stat(fp); err == nil {
					_ = os.Remove(fp)
					break
				}
			}
		}
	}

	return res.RowsAffected()
}

// BatchSetFavorite 批量设置漫画的收藏状态。
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

// BatchAddTags 批量为漫画添加标签。
func BatchAddTags(comicIDs []string, tagNames []string) error {
	for _, comicID := range comicIDs {
		if err := AddTagsToComic(comicID, tagNames); err != nil {
			return err
		}
	}
	return nil
}

// BatchSetCategory 批量为漫画添加分类。
func BatchSetCategory(comicIDs []string, categorySlugs []string) error {
	for _, comicID := range comicIDs {
		if err := AddCategoriesToComic(comicID, categorySlugs); err != nil {
			return err
		}
	}
	return nil
}

// ============================================================
// 排序操作
// ============================================================

// UpdateSortOrders 在事务中批量更新漫画排序。
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
// 快速同步辅助函数 (scanner 使用)
// ============================================================

// GetAllComicIDs 返回数据库中所有漫画的ID。
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

// BulkCreateComics 在单个事务中批量插入漫画。
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

	now := time.Now().UTC()
	stmt, err := tx.Prepare(`
		INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "addedAt", "updatedAt")
		VALUES (?, ?, ?, 0, ?, ?, ?, ?)
		ON CONFLICT("id") DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, c := range comics {
		comicType := detectComicType(c.Filename)
		if _, err := stmt.Exec(c.ID, c.Filename, c.Title, c.FileSize, comicType, now, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// detectComicType 根据文件名后缀判断内容类型。
func detectComicType(filename string) string {
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".txt") || strings.HasSuffix(lower, ".epub") ||
		strings.HasSuffix(lower, ".mobi") || strings.HasSuffix(lower, ".azw3") ||
		strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") {
		return "novel"
	}
	return "comic"
}

// BulkCreateComicsWithSource 在单个事务中批量插入漫画/电子书，根据来源目录智能识别类型。
// fileSourceMap: map[fileID] => "comics" | "novels"
func BulkCreateComicsWithSource(comics []struct {
	ID       string
	Filename string
	Title    string
	FileSize int64
}, fileSourceMap map[string]string) error {
	if len(comics) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	stmt, err := tx.Prepare(`
		INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "addedAt", "updatedAt")
		VALUES (?, ?, ?, 0, ?, ?, ?, ?)
		ON CONFLICT("id") DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, c := range comics {
		// 来自电子书目录的文件强制标记为 novel，否则根据文件后缀判断
		comicType := detectComicType(c.Filename)
		if source, ok := fileSourceMap[c.ID]; ok && source == "novels" {
			comicType = "novel"
		}
		if _, err := stmt.Exec(c.ID, c.Filename, c.Title, c.FileSize, comicType, now, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// BulkDeleteComicsByIDs 批量删除指定ID的漫画。
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

// GetComicsNeedingPageCount 返回 pageCount=0 的漫画（需要全量同步）。
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

// ComicIDFilename 保存缩略图管理所需的最小漫画信息。
type ComicIDFilename struct {
	ID       string
	Filename string
	Title    string
}

// GetAllComicIDsAndFilenames 返回所有漫画的ID、文件名和标题。
func GetAllComicIDsAndFilenames() ([]ComicIDFilename, error) {
	rows, err := db.Query(`SELECT "id", "filename", COALESCE("title", '') FROM "Comic"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ComicIDFilename
	for rows.Next() {
		var c ComicIDFilename
		if rows.Scan(&c.ID, &c.Filename, &c.Title) == nil {
			result = append(result, c)
		}
	}
	return result, nil
}

// UpdateComicPageCount 更新单个漫画的页数。
func UpdateComicPageCount(comicID string, pageCount int) error {
	_, err := db.Exec(`UPDATE "Comic" SET "pageCount" = ? WHERE "id" = ?`, pageCount, comicID)
	return err
}

// UpdateComicMD5Hash 更新单个漫画的 MD5 哈希值。
func UpdateComicMD5Hash(comicID string, md5Hash string) error {
	_, err := db.Exec(`UPDATE "Comic" SET "md5Hash" = ? WHERE "id" = ?`, md5Hash, comicID)
	return err
}

// GetComicsNeedingMD5 返回 md5Hash 为空的漫画（需要计算 MD5）。
func GetComicsNeedingMD5(limit int) ([]struct {
	ID       string
	Filename string
}, error) {
	rows, err := db.Query(`
		SELECT "id", "filename" FROM "Comic" WHERE "md5Hash" = '' LIMIT ?
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
