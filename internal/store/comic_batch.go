package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ============================================================
// 批量操作
// ============================================================

// BatchDeleteComics 批量删除漫画及其关联数据（仅删除数据库记录）。
func BatchDeleteComics(comicIDs []string) (int64, error) {
	if len(comicIDs) == 0 {
		return 0, nil
	}

	var rowsAffected int64
	err := runSerializedDBWrite("batch-delete-comics", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		rowsAffected, err = deleteComicsByIDBatches(tx, comicIDs)
		if err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		return 0, err
	}

	_, _ = CleanupEmptyGroups()
	return rowsAffected, nil
}

// BatchSetFavorite 批量设置用户个人的收藏状态。
func BatchSetFavorite(userID string, comicIDs []string, isFavorite bool) (int64, error) {
	if len(comicIDs) == 0 || userID == "" {
		return 0, nil
	}
	val := 0
	if isFavorite {
		val = 1
	}

	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var rowsAffected int64
	for _, id := range comicIDs {
		res, err := tx.Exec(`
			INSERT INTO "UserComicState" ("userId", "comicId", "isFavorite")
			VALUES (?, ?, ?)
			ON CONFLICT("userId", "comicId") DO UPDATE SET "isFavorite" = ?
		`, userID, id, val, val)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		rowsAffected += n
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowsAffected, nil
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

// BatchRemoveTags 批量移除漫画上的标签（幂等：标签不存在时跳过）。
func BatchRemoveTags(comicIDs []string, tagNames []string) error {
	if len(comicIDs) == 0 || len(tagNames) == 0 {
		return nil
	}

	cph := make([]string, len(comicIDs))
	cargs := make([]interface{}, len(comicIDs))
	for i, id := range comicIDs {
		cph[i] = "?"
		cargs[i] = id
	}
	cidIn := strings.Join(cph, ",")

	tph := make([]string, len(tagNames))
	targs := make([]interface{}, len(tagNames))
	for i, name := range tagNames {
		tph[i] = "?"
		targs[i] = name
	}
	tnameIn := strings.Join(tph, ",")

	_, err := db.Exec(
		fmt.Sprintf(`DELETE FROM "ComicTag" WHERE "comicId" IN (%s) AND "tagId" IN (SELECT "id" FROM "Tag" WHERE "name" IN (%s))`, cidIn, tnameIn),
		append(cargs, targs...)...,
	)
	if err != nil {
		return err
	}
	return nil
}

// BatchSetReadingStatus 批量设置用户级阅读状态（幂等）。
// 标记完成时同步将用户进度移到最后一页，不修改全局 Comic 阅读状态。
func BatchSetReadingStatus(userID string, comicIDs []string, status string) error {
	if len(comicIDs) == 0 {
		return nil
	}

	validStatuses := map[string]bool{
		"":         true,
		"want":     true,
		"reading":  true,
		"finished": true,
		"shelved":  true,
	}
	if !validStatuses[status] {
		return fmt.Errorf("invalid reading status: %s", status)
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, comicID := range comicIDs {
		if status == "finished" {
			var pageCount int
			if err := tx.QueryRow(`SELECT "pageCount" FROM "Comic" WHERE "id" = ?`, comicID).Scan(&pageCount); err != nil {
				return err
			}
			if pageCount > 0 {
				now := time.Now().UTC()
				lastPage := pageCount - 1
				if _, err := tx.Exec(`
					INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt", "readingStatus")
					VALUES (?, ?, ?, ?, ?)
					ON CONFLICT("userId", "comicId") DO UPDATE SET
						"lastReadPage" = ?, "lastReadAt" = ?, "readingStatus" = ?
				`, userID, comicID, lastPage, now, status, lastPage, now, status); err != nil {
					return err
				}
				continue
			}
		}
		if status == "" {
			if userID != "" {
				if _, err := tx.Exec(`
					INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt", "readingStatus")
					VALUES (?, ?, 0, NULL, '')
					ON CONFLICT("userId", "comicId") DO UPDATE SET "lastReadPage" = 0, "lastReadAt" = NULL, "readingStatus" = ''
				`, userID, comicID); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(`UPDATE "Comic" SET "lastReadPage" = 0, "lastReadAt" = NULL, "readingStatus" = '' WHERE "id" = ?`, comicID); err != nil {
				return err
			}
			continue
		}

		if userID != "" {
			_, err := tx.Exec(`
				INSERT INTO "UserComicState" ("userId", "comicId", "readingStatus")
				VALUES (?, ?, ?)
				ON CONFLICT("userId", "comicId") DO UPDATE SET "readingStatus" = ?
			`, userID, comicID, status, status)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit()
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

// UpdateLibraryComicsType 强制修正某个书库下所有文件的类型（用于书库类型更改后的单库扫描同步）。
func UpdateLibraryComicsType(libraryID, libType string) error {
	if libType == "mixed" {
		return nil
	}
	targetType := "comic"
	if libType == "novel" {
		targetType = "novel"
	}
	return runSerializedDBWrite("scanner-update-library-content-type", func() error {
		_, err := db.Exec(`UPDATE "Comic" SET "type" = ? WHERE "libraryId" = ? AND "type" != ?`, targetType, libraryID, targetType)
		return err
	})
}

// ============================================================
// 快速同步辅助函数 (scanner 使用)
// ============================================================

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
	return runSerializedDBWrite("scanner-bulk-create", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		now := time.Now().UTC()
		stmt, err := tx.Prepare(`
			INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "pageCount", "fileSize", "type", "addedAt", "updatedAt")
			VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
			ON CONFLICT("id") DO NOTHING
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for _, c := range comics {
			comicType := detectComicType(c.Filename)
			if _, err := stmt.Exec(c.ID, c.Filename, c.Title, BuildTitleSortKey(c.Title), c.FileSize, comicType, now, now); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

func detectComicType(filename string) string {
	if strings.HasSuffix(filename, "/") {
		return "comic"
	}
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".txt") || strings.HasSuffix(lower, ".epub") ||
		strings.HasSuffix(lower, ".mobi") ||
		strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") {
		return "novel"
	}
	return "comic"
}

// BulkCreateComicsWithSource 在单个事务中批量插入漫画/电子书，根据来源目录智能识别类型。
// fileSourceMap: map[fileID] => "comics" | "novels"
// fileLibraryMap 必须为每一个待插入项目提供真实书库 ID；禁止再回退到历史
// "default"，否则删除默认书库后会制造 libraryId 指向不存在书库的孤儿数据。
func BulkCreateComicsWithSource(comics []struct {
	ID       string
	Filename string
	Title    string
	FileSize int64
}, fileSourceMap map[string]string, fileLibraryMap map[string]string) error {
	if len(comics) == 0 {
		return nil
	}
	return runSerializedDBWrite("scanner-bulk-create-with-source", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		now := time.Now().UTC()
		stmt, err := tx.Prepare(`
			INSERT INTO "Comic" ("id", "filename", "title", "titleSortKey", "pageCount", "fileSize", "type", "libraryId", "relativePath", "addedAt", "updatedAt")
			VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
			ON CONFLICT("id") DO NOTHING
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for _, c := range comics {
			comicType := detectComicType(c.Filename)
			if source, ok := fileSourceMap[c.ID]; ok {
				if source == "novels" {
					comicType = "novel"
				} else if source == "comics" {
					comicType = "comic"
				}
			}
			libID := strings.TrimSpace(fileLibraryMap[c.ID])
			if libID == "" {
				return fmt.Errorf("missing library assignment for %s (%s)", c.Filename, c.ID)
			}
			relPath := c.Filename
			if _, err := stmt.Exec(c.ID, c.Filename, c.Title, BuildTitleSortKey(c.Title), c.FileSize, comicType, libID, relPath, now, now); err != nil {
				return fmt.Errorf("insert %s into library %s: %w", c.Filename, libID, err)
			}
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit scanned contents: %w", err)
		}
		return nil
	})
}

// BulkDeleteComicsByIDs 批量删除指定ID的漫画及其关联数据。
func BulkDeleteComicsByIDs(ids []string) error {
	if len(ids) == 0 {
		return nil
	}

	err := runSerializedDBWrite("scanner-bulk-delete", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		if _, err := deleteComicsByIDBatches(tx, ids); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		return err
	}
	_, _ = CleanupEmptyGroups()
	return nil
}

func deleteComicsByIDBatches(tx *sql.Tx, ids []string) (int64, error) {
	relatedTables, err := existingTables(tx, []string{
		"ComicTag",
		"ComicCategory",
		"ReadingSession",
		"ComicGroupItem",
		"UserComicState",
		"MetadataSyncLog",
	})
	if err != nil {
		return 0, err
	}

	var rowsAffected int64
	for i := 0; i < len(ids); i += batchSize {
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]
		placeholders := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for j, id := range batch {
			placeholders[j] = "?"
			args[j] = id
		}
		in := strings.Join(placeholders, ",")

		for _, table := range relatedTables {
			if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM "%s" WHERE "comicId" IN (%s)`, table, in), args...); err != nil {
				return rowsAffected, fmt.Errorf("delete %s records: %w", table, err)
			}
		}

		res, err := tx.Exec(fmt.Sprintf(`DELETE FROM "Comic" WHERE "id" IN (%s)`, in), args...)
		if err != nil {
			return rowsAffected, fmt.Errorf("delete Comic records: %w", err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return rowsAffected, err
		}
		rowsAffected += n
	}
	return rowsAffected, nil
}

func existingTables(tx *sql.Tx, names []string) ([]string, error) {
	existing := make([]string, 0, len(names))
	for _, name := range names {
		var found string
		err := tx.QueryRow(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = ?`, name).Scan(&found)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		existing = append(existing, name)
	}
	return existing, nil
}

// BulkUpdateComicLibraryID 批量更新漫画的书库ID和类型（用于将已有漫画移动到新书库）。
func BulkUpdateComicLibraryID(ids []string, libraryID string, comicType string) error {
	if len(ids) == 0 {
		return nil
	}
	return runSerializedDBWrite("scanner-move-library-content", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		stmt, err := tx.Prepare(`UPDATE "Comic" SET "libraryId" = ?, "type" = ?, "updatedAt" = ? WHERE "id" = ?`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		now := time.Now().UTC()
		for _, id := range ids {
			if _, err := stmt.Exec(libraryID, comicType, now, id); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

// GetComicsNeedingPageCount 返回 pageCount=0 或 -1 的漫画（需要全量同步）。
// pageCount=-1 表示上次同步失败，需要重试。
func GetComicsNeedingPageCount(limit int) ([]struct {
	ID       string
	Filename string
}, error) {
	rows, err := db.Query(`
		SELECT "id", "filename" FROM "Comic" WHERE "pageCount" = 0 OR "pageCount" = -1 LIMIT ?
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

type ComicIDFilename struct {
	ID       string
	Filename string
	Title    string
}

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

func GetAllComicIDsAndLibraryIDs() (map[string]string, error) {
	rows, err := db.Query(`SELECT "id", COALESCE("libraryId", '') FROM "Comic"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var id, libraryID string
		if rows.Scan(&id, &libraryID) == nil {
			result[id] = libraryID
		}
	}
	return result, nil
}

func GetComicsLibraryIDsByIDs(ids []string) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	result := make(map[string]string, len(ids))
	const batchSize = 500
	for i := 0; i < len(ids); i += batchSize {
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]
		placeholders := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for j, id := range batch {
			placeholders[j] = "?"
			args[j] = id
		}
		rows, err := db.Query(
			fmt.Sprintf(`SELECT "id", COALESCE("libraryId", '') FROM "Comic" WHERE "id" IN (%s)`, strings.Join(placeholders, ",")),
			args...,
		)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, libraryID string
			if rows.Scan(&id, &libraryID) == nil {
				result[id] = libraryID
			}
		}
		rows.Close()
	}
	return result, nil
}

// UpdateComicPageCount 更新单个漫画的页数。full-sync 的解析可并行，但这里保证落库单写。
func UpdateComicPageCount(comicID string, pageCount int) error {
	return runSerializedDBWrite("scanner-update-page-count", func() error {
		_, err := db.Exec(`UPDATE "Comic" SET "pageCount" = ? WHERE "id" = ?`, pageCount, comicID)
		return err
	})
}

func UpdateComicPageCountIfStale(comicID string, pageCount int) error {
	if pageCount <= 0 {
		return nil
	}
	return runSerializedDBWrite("update-stale-page-count", func() error {
		_, err := db.Exec(`UPDATE "Comic" SET "pageCount" = ? WHERE "id" = ? AND ("pageCount" <= 0 OR "pageCount" IS NULL)`, pageCount, comicID)
		return err
	})
}

func UpdateComicType(comicID string, comicType string) error {
	return runSerializedDBWrite("scanner-update-content-type", func() error {
		_, err := db.Exec(`UPDATE "Comic" SET "type" = ? WHERE "id" = ?`, comicType, comicID)
		return err
	})
}

func UpdateComicMD5Hash(comicID string, md5Hash string) error {
	return runSerializedDBWrite("scanner-update-md5", func() error {
		_, err := db.Exec(`UPDATE "Comic" SET "md5Hash" = ? WHERE "id" = ?`, md5Hash, comicID)
		return err
	})
}

func ComicRelativePathExists(libraryID, relativePath, excludeID string) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM "Comic"
		WHERE COALESCE("libraryId", '') = ?
		  AND COALESCE(NULLIF("relativePath", ''), "filename") = ?
		  AND "id" <> ?
	`, libraryID, relativePath, excludeID).Scan(&count)
	return count > 0, err
}

func GetComicIDsByLibraryID(libraryID string) (map[string]struct{}, error) {
	rows, err := db.Query(`SELECT "id" FROM "Comic" WHERE "libraryId" = ?`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]struct{})
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			result[id] = struct{}{}
		}
	}
	return result, rows.Err()
}

func UpdateComicIdentityAfterMove(oldID, newID, newFilename, newTitle string) error {
	fields := []string{`"id" = ?`, `"filename" = ?`, `"relativePath" = ?`, `"updatedAt" = ?`}
	args := []interface{}{newID, newFilename, newFilename, time.Now().UTC()}
	if strings.TrimSpace(newTitle) != "" {
		fields = append(fields, `"title" = ?`)
		args = append(args, newTitle)
		fields = append(fields, `"titleSortKey" = ?`)
		args = append(args, BuildTitleSortKey(newTitle))
	}
	args = append(args, oldID)
	return runSerializedDBWrite("scanner-update-content-identity", func() error {
		_, err := db.Exec(fmt.Sprintf(`UPDATE "Comic" SET %s WHERE "id" = ?`, strings.Join(fields, ", ")), args...)
		return err
	})
}

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

func GetNovelsNeedingTypeRedetect() ([]struct {
	ID       string
	Filename string
}, error) {
	rows, err := db.Query(`
		SELECT "id", "filename" FROM "Comic"
		WHERE "type" = 'novel'
		AND (LOWER("filename") LIKE '%.mobi' OR LOWER("filename") LIKE '%.azw3')
	`)
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

func GetEbookComicsByType(comicType string) ([]struct {
	ID       string
	Filename string
}, error) {
	rows, err := db.Query(`
		SELECT "id", "filename" FROM "Comic"
		WHERE "type" = ?
		AND (LOWER("filename") LIKE '%.epub'
			OR LOWER("filename") LIKE '%.mobi'
			OR LOWER("filename") LIKE '%.azw3')
	`, comicType)
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

func GetFolderComics() ([]struct {
	ID       string
	Filename string
}, error) {
	rows, err := db.Query(`
		SELECT "id", "filename" FROM "Comic"
		WHERE "filename" LIKE '%/'
	`)
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

// FixComicTypesBySource reads in parallel with the rest of the app, then funnels
// only the mutation phase through the single SQLite writer.
func FixComicTypesBySource(fileSourceMap map[string]string) {
	if len(fileSourceMap) == 0 {
		return
	}

	var toComic []string
	var toNovel []string
	rows, err := db.Query(`SELECT "id", "type" FROM "Comic"`)
	if err != nil {
		return
	}
	for rows.Next() {
		var id, comicType string
		if rows.Scan(&id, &comicType) != nil {
			continue
		}
		source, ok := fileSourceMap[id]
		if !ok {
			continue
		}
		if source == "comics" && comicType != "comic" {
			toComic = append(toComic, id)
		} else if source == "novels" && comicType != "novel" {
			toNovel = append(toNovel, id)
		}
	}
	rows.Close()

	_ = runSerializedDBWrite("scanner-fix-content-types", func() error {
		if err := batchUpdateType(toComic, "comic"); err != nil {
			return err
		}
		return batchUpdateType(toNovel, "novel")
	})
}

func batchUpdateType(ids []string, newType string) error {
	const batchSize = 500
	for i := 0; i < len(ids); i += batchSize {
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]
		placeholders := make([]string, len(batch))
		args := make([]interface{}, 0, len(batch)+1)
		args = append(args, newType)
		for j, id := range batch {
			placeholders[j] = "?"
			args = append(args, id)
		}
		query := fmt.Sprintf(`UPDATE "Comic" SET "type" = ? WHERE "id" IN (%s)`, strings.Join(placeholders, ","))
		if _, err := db.Exec(query, args...); err != nil {
			return err
		}
	}
	return nil
}

func FixComicLibraryAssignments(fileLibraryMap map[string]string, fileSourceMap map[string]string, fileRelPathMap map[string]string) (moved int, typeFixed int) {
	if len(fileLibraryMap) == 0 {
		return 0, 0
	}

	rows, err := db.Query(`SELECT "id", COALESCE("libraryId", ''), COALESCE("relativePath", ''), COALESCE("type", '') FROM "Comic"`)
	if err != nil {
		return 0, 0
	}

	type comicUpdate struct {
		ID           string
		NewLibID     string
		NewRelPath   string
		NewType      string
		Moved        bool
		TypeFixed    bool
	}
	var toUpdate []comicUpdate

	for rows.Next() {
		var id, libID, relPath, comicType string
		if rows.Scan(&id, &libID, &relPath, &comicType) != nil {
			continue
		}
		diskLibID, hasDisk := fileLibraryMap[id]
		if !hasDisk {
			continue
		}

		needsUpdate := false
		newLibID := libID
		newRelPath := relPath
		newType := comicType
		wasMoved := false
		wasTypeFixed := false
		if diskLibID != "" && libID != diskLibID {
			newLibID = diskLibID
			needsUpdate = true
			wasMoved = true
		}
		if diskRelPath, ok := fileRelPathMap[id]; ok && diskRelPath != "" && relPath != diskRelPath {
			newRelPath = diskRelPath
			needsUpdate = true
		}
		if source, ok := fileSourceMap[id]; ok {
			if source == "comics" && comicType != "comic" {
				newType = "comic"
				needsUpdate = true
				wasTypeFixed = true
			} else if source == "novels" && comicType != "novel" {
				newType = "novel"
				needsUpdate = true
				wasTypeFixed = true
			}
		}
		if needsUpdate {
			toUpdate = append(toUpdate, comicUpdate{
				ID: id, NewLibID: newLibID, NewRelPath: newRelPath, NewType: newType,
				Moved: wasMoved, TypeFixed: wasTypeFixed,
			})
		}
	}
	rows.Close()

	if len(toUpdate) == 0 {
		return 0, 0
	}

	const assignmentBatchSize = 500
	now := time.Now().UTC()
	committedMoved := 0
	committedTypeFixed := 0
	for i := 0; i < len(toUpdate); i += assignmentBatchSize {
		end := i + assignmentBatchSize
		if end > len(toUpdate) {
			end = len(toUpdate)
		}
		batch := toUpdate[i:end]

		err := runSerializedDBWrite("scanner-fix-library-assignments", func() error {
			tx, err := db.Begin()
			if err != nil {
				return err
			}
			defer tx.Rollback()
			stmt, err := tx.Prepare(`UPDATE "Comic" SET "libraryId" = ?, "relativePath" = ?, "type" = ?, "updatedAt" = ? WHERE "id" = ?`)
			if err != nil {
				return err
			}
			defer stmt.Close()
			for _, u := range batch {
				if _, err := stmt.Exec(u.NewLibID, u.NewRelPath, u.NewType, now, u.ID); err != nil {
					return err
				}
			}
			return tx.Commit()
		})
		if err != nil {
			return committedMoved, committedTypeFixed
		}

		for _, u := range batch {
			if u.Moved {
				committedMoved++
			}
			if u.TypeFixed {
				committedTypeFixed++
			}
		}
	}

	return committedMoved, committedTypeFixed
}

func MarkComicsAsMissing(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	now := time.Now().UTC()
	return runSerializedDBWrite("scanner-mark-missing", func() error {
		for i := 0; i < len(ids); i += batchSize {
			end := i + batchSize
			if end > len(ids) {
				end = len(ids)
			}
			batch := ids[i:end]
			placeholders := make([]string, len(batch))
			args := []interface{}{now}
			for j, id := range batch {
				placeholders[j] = "?"
				args = append(args, id)
			}
			if _, err := db.Exec(
				fmt.Sprintf(`UPDATE "Comic" SET "missingSince" = ? WHERE "id" IN (%s) AND "missingSince" IS NULL`, strings.Join(placeholders, ",")),
				args...,
			); err != nil {
				return err
			}
		}
		return nil
	})
}

func UnmarkComicsAsMissing(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	return runSerializedDBWrite("scanner-unmark-missing", func() error {
		for i := 0; i < len(ids); i += batchSize {
			end := i + batchSize
			if end > len(ids) {
				end = len(ids)
			}
			batch := ids[i:end]
			placeholders := make([]string, len(batch))
			args := make([]interface{}, len(batch))
			for j, id := range batch {
				placeholders[j] = "?"
				args[j] = id
			}
			if _, err := db.Exec(
				fmt.Sprintf(`UPDATE "Comic" SET "missingSince" = NULL WHERE "id" IN (%s)`, strings.Join(placeholders, ",")),
				args...,
			); err != nil {
				return err
			}
		}
		return nil
	})
}

func GetMissingComicIDsOlderThan(olderThan time.Duration) ([]string, error) {
	cutoff := time.Now().UTC().Add(-olderThan)
	rows, err := db.Query(`SELECT "id" FROM "Comic" WHERE "missingSince" IS NOT NULL AND "missingSince" < ?`, cutoff)
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
