package store

import (
	"log"
	"path"
	"sort"
	"strings"
)

// ============================================================
// 按目录自动分组 — 扫描后自动将同文件夹下的小说归为合集
// 漫画目录由 ComicSeries / ComicSeriesSection 层级模型接管，避免同一目录同时
// 生成“作品”和旧式扁平 ComicGroup。
// 同目录多格式（同 editionStemKey）的文件属于同一本书的不同格式，不再误建为合集。
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
// 读取/分桶阶段不占用写入门；只有实际创建/追加合集时按批次进入统一 SQLite writer，
// 避免十万级书库产生海量独立写事务锁死 SQLite。
func AutoGroupByDirectory() (int, error) {
	grouped, err := GetGroupedComicIDs()
	if err != nil {
		return 0, err
	}

	rows, err := db.Query(`
		SELECT c."id", c."title", c."filename", COALESCE(NULLIF(c."relativePath", ''), c."filename")
		FROM "Comic" c
		JOIN "Library" l ON l."id" = c."libraryId"
		WHERE l."type" = 'novel' AND c."type" = 'novel'
	` + TitleSortOrderSQL("c", "ASC"))
	if err != nil {
		return 0, err
	}

	type comicRef struct {
		ID      string
		Title   string
		RelPath string
		StemKey string
	}

	dirMap := make(map[string][]comicRef)
	for rows.Next() {
		var id, title, filename, relPath string
		if rows.Scan(&id, &title, &filename, &relPath) != nil {
			continue
		}
		if _, ok := grouped[id]; ok {
			continue
		}
		if relPath == "" {
			relPath = filename
		}
		dir := path.Dir(strings.ReplaceAll(relPath, "\\", "/"))
		if dir == "." || dir == "/" || dir == "" {
			continue
		}
		dirMap[dir] = append(dirMap[dir], comicRef{
			ID:      id,
			Title:   title,
			RelPath: relPath,
			StemKey: BuildEditionStemKey(relPath),
		})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	type dirBatchItem struct {
		groupName string
		ids       []string
	}
	var candidates []dirBatchItem
	for dir, refs := range dirMap {
		if len(refs) < 2 {
			continue
		}
		distinctStems := make(map[string]struct{}, len(refs))
		for _, ref := range refs {
			key := ref.StemKey
			if key == "" {
				key = ref.ID
			}
			distinctStems[key] = struct{}{}
		}
		// 同目录下全部是同一本书的多格式版本（如 三体.epub + 三体.mobi + 三体.pdf），
		// 交由 BookEditionGroup 折叠，不误建冗余合集。
		if len(distinctStems) < 2 {
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
		candidates = append(candidates, dirBatchItem{groupName: groupName, ids: ids})
	}

	if len(candidates) == 0 {
		return 0, nil
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].groupName < candidates[j].groupName
	})

	created := 0
	const dirBatchSize = 100
	for start := 0; start < len(candidates); start += dirBatchSize {
		end := start + dirBatchSize
		if end > len(candidates) {
			end = len(candidates)
		}
		batch := candidates[start:end]
		batchCreated := 0
		var newlyCreatedIDs []int

		err := runSerializedDBWrite("scanner-auto-group-directory", func() error {
			tx, err := db.Begin()
			if err != nil {
				return err
			}
			defer tx.Rollback()

			for _, item := range batch {
				var existingID int
				findErr := tx.QueryRow(`SELECT "id" FROM "ComicGroup" WHERE "name" = ?`, item.groupName).Scan(&existingID)
				var targetID int
				isNew := false
				if findErr == nil {
					targetID = existingID
				} else {
					res, createErr := tx.Exec(`
						INSERT INTO "ComicGroup" ("name", "autoCreated", "classifyMode", "createdAt", "updatedAt")
						VALUES (?, 1, 'directory', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
					`, item.groupName)
					if createErr != nil {
						log.Printf("[auto-group] 创建小说合集 %s 失败: %v", item.groupName, createErr)
						continue
					}
					lastID, idErr := res.LastInsertId()
					if idErr != nil {
						continue
					}
					targetID = int(lastID)
					isNew = true
				}

				var maxSort int
				_ = tx.QueryRow(`SELECT COALESCE(MAX("sortIndex"), -1) FROM "ComicGroupItem" WHERE "groupId" = ?`, targetID).Scan(&maxSort)
				for idx, comicID := range item.ids {
					if _, insErr := tx.Exec(`
						INSERT OR IGNORE INTO "ComicGroupItem" ("groupId", "comicId", "sortIndex")
						VALUES (?, ?, ?)
					`, targetID, comicID, maxSort+1+idx); insErr != nil {
						log.Printf("[auto-group] 添加成员到 %s 失败: %v", item.groupName, insErr)
					}
				}
				if isNew {
					newlyCreatedIDs = append(newlyCreatedIDs, targetID)
				}
				batchCreated++
			}

			return tx.Commit()
		})
		if err != nil {
			log.Printf("[auto-group] 批量处理小说合集失败: %v", err)
			continue
		}
		for _, newID := range newlyCreatedIDs {
			if inheritErr := InheritGroupMetadataFromFirstComic(newID); inheritErr != nil {
				log.Printf("[auto-group] 继承元数据失败 groupId=%d: %v", newID, inheritErr)
			}
		}
		created += batchCreated
	}

	return created, nil
}

type Tag struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}
