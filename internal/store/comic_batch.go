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

// BatchRemoveTags 批量移除漫画上的标签（幂等：标签不存在时跳过）。
func BatchRemoveTags(comicIDs []string, tagNames []string) error {
	if len(comicIDs) == 0 || len(tagNames) == 0 {
		return nil
	}

	// 构建 comic ID IN 子句
	cph := make([]string, len(comicIDs))
	cargs := make([]interface{}, len(comicIDs))
	for i, id := range comicIDs {
		cph[i] = "?"
		cargs[i] = id
	}
	cidIn := strings.Join(cph, ",")

	// 构建 tag name IN 子句
	tph := make([]string, len(tagNames))
	targs := make([]interface{}, len(tagNames))
	for i, name := range tagNames {
		tph[i] = "?"
		targs[i] = name
	}
	tnameIn := strings.Join(tph, ",")

	// 删除匹配的 ComicTag 记录
	_, err := db.Exec(
		fmt.Sprintf(`DELETE FROM "ComicTag" WHERE "comicId" IN (%s) AND "tagId" IN (SELECT "id" FROM "Tag" WHERE "name" IN (%s))`, cidIn, tnameIn),
		append(cargs, targs...)...,
	)
	if err != nil {
		return err
	}

	// 注意：故意不清理孤立 Tag 记录。Tag 本身可能被管理页面使用，不应因移除关联而被删除。

	return nil
}

// BatchSetReadingStatus 批量设置用户级阅读状态（幂等）。
// 仅写入 UserComicState.readingStatus，不修改 lastReadPage / totalReadTime。
func BatchSetReadingStatus(userID string, comicIDs []string, status string) error {
	if len(comicIDs) == 0 {
		return nil
	}

	// 校验合法状态
	validStatuses := map[string]bool{
		"":        true, // 清空状态
		"want":    true,
		"reading": true,
		"finished": true,
		"shelved": true,
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
		_, err := tx.Exec(`
			INSERT INTO "UserComicState" ("userId", "comicId", "readingStatus")
			VALUES (?, ?, ?)
			ON CONFLICT("userId", "comicId") DO UPDATE SET "readingStatus" = ?
		`, userID, comicID, status, status)
		if err != nil {
			return err
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
	// 图片文件夹漫画：filename 以 "/" 结尾
	if strings.HasSuffix(filename, "/") {
		return "comic"
	}
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".txt") || strings.HasSuffix(lower, ".epub") ||
		strings.HasSuffix(lower, ".mobi") ||
		strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") {
		return "novel"
	}
	// .azw3 不再硬编码为 novel，由扫描器根据内容检测自动分类
	return "comic"
}

// BulkCreateComicsWithSource 在单个事务中批量插入漫画/电子书，根据来源目录智能识别类型。
// fileSourceMap: map[fileID] => "comics" | "novels"
func BulkCreateComicsWithSource(comics []struct {
	ID       string
	Filename string
	Title    string
	FileSize int64
}, fileSourceMap map[string]string, fileLibraryMap map[string]string) error {
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
		INSERT INTO "Comic" ("id", "filename", "title", "pageCount", "fileSize", "type", "libraryId", "relativePath", "addedAt", "updatedAt")
		VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
		ON CONFLICT("id") DO NOTHING
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, c := range comics {
		// 严格按来源目录决定类型：
		// - 来自漫画库目录的文件 → 强制标记为 comic
		// - 来自电子书目录的文件 → 强制标记为 novel
		// - 无法确定来源时 → 根据文件后缀判断（兜底）
		comicType := detectComicType(c.Filename)
		if source, ok := fileSourceMap[c.ID]; ok {
			if source == "novels" {
				comicType = "novel"
			} else if source == "comics" {
				comicType = "comic"
			}
		}
		libID := fileLibraryMap[c.ID]
		relPath := c.Filename
		if libID == "" { libID = "default" }
		if _, err := stmt.Exec(c.ID, c.Filename, c.Title, c.FileSize, comicType, libID, relPath, now, now); err != nil {
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

// BulkUpdateComicLibraryID 批量更新漫画的书库ID和类型（用于将已有漫画移动到新书库）。
func BulkUpdateComicLibraryID(ids []string, libraryID string, comicType string) error {
	if len(ids) == 0 {
		return nil
	}
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

// GetAllComicIDsAndLibraryIDs 返回所有漫画的ID和所属书库ID。
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

// UpdateComicPageCount 更新单个漫画的页数。
func UpdateComicPageCount(comicID string, pageCount int) error {
	_, err := db.Exec(`UPDATE "Comic" SET "pageCount" = ? WHERE "id" = ?`, pageCount, comicID)
	return err
}

// UpdateComicPageCountIfStale only updates pageCount when the current value is 0 or -1.
// Used for lazy backfill from the reader/progress endpoints.
func UpdateComicPageCountIfStale(comicID string, pageCount int) error {
	if pageCount <= 0 {
		return nil
	}
	_, err := db.Exec(`UPDATE "Comic" SET "pageCount" = ? WHERE "id" = ? AND ("pageCount" <= 0 OR "pageCount" IS NULL)`, pageCount, comicID)
	return err
}

// UpdateComicType 更新单个漫画的内容类型（comic/novel）。
func UpdateComicType(comicID string, comicType string) error {
	_, err := db.Exec(`UPDATE "Comic" SET "type" = ? WHERE "id" = ?`, comicType, comicID)
	return err
}

// UpdateComicMD5Hash 更新单个漫画的 MD5 哈希值。
func UpdateComicMD5Hash(comicID string, md5Hash string) error {
	_, err := db.Exec(`UPDATE "Comic" SET "md5Hash" = ? WHERE "id" = ?`, md5Hash, comicID)
	return err
}

// ComicFilenameExists 判断指定 filename 是否已被其他漫画占用。
func ComicFilenameExists(filename, excludeID string) (bool, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "filename" = ? AND "id" <> ?`, filename, excludeID).Scan(&count)
	return count > 0, err
}

// GetComicIDsByLibraryID 返回指定书库下所有漫画ID集合。
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

// UpdateComicIdentityAfterMove 在物理文件移动/重命名后同步更新 Comic 主键与 filename。
// Comic.id 由 filename 生成；相关外键依赖 ON UPDATE CASCADE 自动级联。
func UpdateComicIdentityAfterMove(oldID, newID, newFilename, newTitle string) error {
	fields := []string{`"id" = ?`, `"filename" = ?`, `"updatedAt" = ?`}
	args := []interface{}{newID, newFilename, time.Now().UTC()}
	if strings.TrimSpace(newTitle) != "" {
		fields = append(fields, `"title" = ?`)
		args = append(args, newTitle)
	}
	args = append(args, oldID)
	_, err := db.Exec(fmt.Sprintf(`UPDATE "Comic" SET %s WHERE "id" = ?`, strings.Join(fields, ", ")), args...)
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

// GetNovelsNeedingTypeRedetect 获取所有 type="novel" 且文件名以 .mobi/.azw3 结尾的漫画记录。
// 这些文件可能是图片密集型的漫画，需要通过内容检测来重新分类。
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

// GetEbookComicsByType 返回所有 type 等于指定值的电子书记录（epub/mobi/azw3）。
// 用于按文件实际目录回滚被错误识别的电子书类型（例如把放在小说目录里、
// 但因 image-heavy 检测被标为 comic 的教材回滚为 novel）。
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

// GetFolderComics 返回所有"图片文件夹漫画"记录（filename 以 "/" 结尾）。
// 用于排查并修复被错误折叠为文件夹漫画的目录（例如全是 .txt 的小说目录混入封面图）。
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

// 漫画库目录的文件强制为 "comic"，电子书目录的文件强制为 "novel"。
// 只修正类型不匹配的记录，避免不必要的写入。
func FixComicTypesBySource(fileSourceMap map[string]string) {
	if len(fileSourceMap) == 0 {
		return
	}

	// 分两批：需要改为 comic 的和需要改为 novel 的
	var toComic []string
	var toNovel []string

	// 查询所有记录的 id 和 type
	rows, err := db.Query(`SELECT "id", "type" FROM "Comic"`)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, comicType string
		if rows.Scan(&id, &comicType) != nil {
			continue
		}
		source, ok := fileSourceMap[id]
		if !ok {
			continue
		}
		// 严格按来源目录决定类型
		if source == "comics" && comicType != "comic" {
			toComic = append(toComic, id)
		} else if source == "novels" && comicType != "novel" {
			toNovel = append(toNovel, id)
		}
	}

	// 批量更新
	if len(toComic) > 0 {
		batchUpdateType(toComic, "comic")
	}
	if len(toNovel) > 0 {
		batchUpdateType(toNovel, "novel")
	}
}

// batchUpdateType 批量更新漫画的 type 字段。
func batchUpdateType(ids []string, newType string) {
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
		db.Exec(query, args...)
	}
}

// MarkComicsAsMissing sets missingSince to now for the given comic IDs.
// If missingSince is already set, it is left unchanged.
func MarkComicsAsMissing(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	now := time.Now().UTC()
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
		_, err := db.Exec(
			fmt.Sprintf(`UPDATE "Comic" SET "missingSince" = ? WHERE "id" IN (%s) AND "missingSince" IS NULL`, strings.Join(placeholders, ",")),
			args...,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

// UnmarkComicsAsMissing clears missingSince for the given comic IDs
// (files reappeared on disk).
func UnmarkComicsAsMissing(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
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
		_, err := db.Exec(
			fmt.Sprintf(`UPDATE "Comic" SET "missingSince" = NULL WHERE "id" IN (%s)`, strings.Join(placeholders, ",")),
			args...,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

// GetMissingComicIDsOlderThan returns comic IDs whose missingSince is older than the given duration.
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






