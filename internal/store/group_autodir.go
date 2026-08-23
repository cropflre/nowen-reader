package store

import (
	"log"
	"path"
	"strings"
)

// ============================================================
// 按目录自动分组 — 扫描后自动将同文件夹下的小说归为合集
// 漫画目录由 ComicSeries / ComicSeriesSection 层级模型接管，避免同一目录同时
// 生成“作品”和旧式扁平 ComicGroup。
// ============================================================

var chapterKeywords = []string{
	"第", "话", "話", "回", "chapter", "ch.", "ch ", "ep", "episode", "#",
}

func IsChapterNaming(filename string) bool {
	lower := strings.ToLower(filename)
	for _, kw := range chapterKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// AutoGroupByDirectory 按文件夹自动创建目录合集。
// 读取/分桶阶段不占用写入门；只有实际创建/追加合集时进入统一 SQLite writer，
// 避免它与 full-sync、MD5、单库扫描同时抢写锁。
func AutoGroupByDirectory() (int, error) {
	grouped, err := GetGroupedComicIDs()
	if err != nil {
		return 0, err
	}

	rows, err := db.Query(`
		SELECT c."id", c."title", c."filename"
		FROM "Comic" c
		JOIN "Library" l ON l."id" = c."libraryId"
		WHERE l."type" = 'novel' AND c."type" = 'novel'
	` + TitleSortOrderSQL("c", "ASC"))
	if err != nil {
		return 0, err
	}

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
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	created := 0
	for dir, refs := range dirMap {
		if len(refs) < 2 {
			continue
		}

		groupName := cleanDirName(path.Base(dir))
		if groupName == "" {
			continue
		}

		ids := make([]string, 0, len(refs))
		for _, ref := range refs {
			ids = append(ids, ref.ID)
		}

		createdThisGroup := false
		err := runSerializedDBWrite("scanner-auto-group-directory", func() error {
			var existingID int
			err := db.QueryRow(`SELECT "id" FROM "ComicGroup" WHERE "name" = ?`, groupName).Scan(&existingID)
			if err == nil {
				if addErr := AddComicsToGroup(existingID, ids); addErr != nil {
					return addErr
				}
				createdThisGroup = true
				return nil
			}

			id, createErr := CreateGroup(groupName)
			if createErr != nil {
				return createErr
			}
			if _, execErr := db.Exec(`UPDATE "ComicGroup" SET "autoCreated" = 1, "classifyMode" = 'directory' WHERE "id" = ?`, id); execErr != nil {
				return execErr
			}
			if addErr := AddComicsToGroup(int(id), ids); addErr != nil {
				return addErr
			}
			if inheritErr := InheritGroupMetadataFromFirstComic(int(id)); inheritErr != nil {
				log.Printf("[auto-group] 继承元数据失败 %s: %v", groupName, inheritErr)
			}
			createdThisGroup = true
			return nil
		})
		if err != nil {
			log.Printf("[auto-group] 处理小说合集 %s 失败: %v", groupName, err)
			continue
		}
		if createdThisGroup {
			created++
			log.Printf("[auto-group] 按目录自动创建/更新小说合集: %s (%d 本)", groupName, len(refs))
		}
	}

	return created, nil
}

type Tag struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}
