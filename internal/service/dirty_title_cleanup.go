package service

import (
	"log"
	"path"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// cleanupDirtyTitlesImpl 修复 Comic 表中残留 {N}/{NN}/{NNN} 占位符的脏标题。
//
// 处理逻辑：
//  1. SELECT title, filename FROM Comic WHERE title LIKE '%{N%}%'
//  2. 用 renderVolumeTitle(title, fallback?, filename) 尝试用真实卷号替换
//     - 由于此处没有"干净作品名"作 fallback，使用 sanitizeTitle(title) 作 fallback
//  3. UpdateComicFields 写回
//
// 返回受影响行数。
func cleanupDirtyTitlesImpl() (int, error) {
	dbConn := store.DB()
	if dbConn == nil {
		return 0, nil
	}
	rows, err := dbConn.Query(
		`SELECT "id", "title", "filename" FROM "Comic" WHERE "title" LIKE '%{N%}%'`,
	)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type item struct{ id, title, filename string }
	var todo []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.title, &it.filename); err != nil {
			continue
		}
		todo = append(todo, it)
	}

	updated := 0
	for _, it := range todo {
		filenameOnly := path.Base(strings.ReplaceAll(it.filename, "\\", "/"))
		// fallback: 把脏 title 里的占位符整段抹掉，作为最坏情况下的退路
		fallback := sanitizeTitle(it.title)
		newTitle := renderVolumeTitle(it.title, fallback, filenameOnly)
		newTitle = sanitizeTitle(newTitle)
		if newTitle == "" || newTitle == it.title {
			continue
		}
		if err := store.UpdateComicFields(it.id, map[string]interface{}{
			"title": newTitle,
		}); err != nil {
			continue
		}
		updated++
	}
	if updated > 0 {
		log.Printf("[scan-rules] cleanup dirty titles: fixed %d rows", updated)
	}
	return updated, nil
}
