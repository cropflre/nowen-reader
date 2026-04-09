package store

import (
	"log"
	"path"
	"strings"
)

// ============================================================
// P3: 按话/卷分类模式 — 扫描后自动分组
// ============================================================

// chapterPatterns 话级关键词正则
var chapterKeywords = []string{
	"第", "话", "話", "回", "chapter", "ch.", "ch ", "ep", "episode", "#",
}

// IsChapterNaming 判断文件名是否符合按话命名模式。
func IsChapterNaming(filename string) bool {
	lower := strings.ToLower(filename)
	for _, kw := range chapterKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// AutoGroupByDirectory 按文件夹自动创建分组（用于按话分类模式）。
// 扫描指定目录下的所有漫画，将同一文件夹下的漫画自动归为一组。
// 仅处理尚未分组的漫画。
func AutoGroupByDirectory() (int, error) {
	grouped, err := GetGroupedComicIDs()
	if err != nil {
		return 0, err
	}

	// 查询所有未分组的漫画
	rows, err := db.Query(`SELECT "id", "title", "filename" FROM "Comic" ORDER BY "title" ASC`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type comicRef struct {
		ID       string
		Title    string
		Filename string
	}

	dirMap := make(map[string][]comicRef)
	for rows.Next() {
		var id, title, filename string
		if rows.Scan(&id, &title, &filename) != nil {
			continue
		}
		if _, ok := grouped[id]; ok {
			continue
		}
		dir := path.Dir(filename)
		if dir == "." || dir == "/" || dir == "" {
			continue
		}
		dirMap[dir] = append(dirMap[dir], comicRef{ID: id, Title: title, Filename: filename})
	}

	created := 0
	for dir, refs := range dirMap {
		if len(refs) < 2 {
			continue
		}

		// 检查是否有话级命名特征
		hasChapterNaming := false
		for _, ref := range refs {
			if IsChapterNaming(ref.Title) || IsChapterNaming(ref.Filename) {
				hasChapterNaming = true
				break
			}
		}
		if !hasChapterNaming {
			continue
		}

		groupName := cleanDirName(path.Base(dir))
		if groupName == "" {
			continue
		}

		// 检查是否已存在同名分组
		var existingID int
		err := db.QueryRow(`SELECT "id" FROM "ComicGroup" WHERE "name" = ?`, groupName).Scan(&existingID)
		if err == nil {
			// 已存在，添加漫画到现有分组
			var ids []string
			for _, ref := range refs {
				ids = append(ids, ref.ID)
			}
			_ = AddComicsToGroup(existingID, ids)
			created++
			continue
		}

		// 创建新分组
		id, err := CreateGroup(groupName)
		if err != nil {
			continue
		}

		// 标记为自动创建 + 按话分类
		db.Exec(`UPDATE "ComicGroup" SET "autoCreated" = 1, "classifyMode" = 'chapter' WHERE "id" = ?`, id)

		var ids []string
		for _, ref := range refs {
			ids = append(ids, ref.ID)
		}
		if err := AddComicsToGroup(int(id), ids); err != nil {
			continue
		}

		// 自动继承元数据
		_ = InheritGroupMetadataFromFirstComic(int(id))
		created++
		log.Printf("[auto-group] 按话自动创建系列: %s (%d 话)", groupName, len(refs))
	}

	return created, nil
}

// Tag 是从 model 包复制的简化版本，避免循环依赖。
type Tag struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}
