package store

import (
	"database/sql"
	"log"
	"strings"
)

// ============================================================
// P2: 系列级标签管理
// ============================================================

// GetGroupTags 获取系列的所有标签。
func GetGroupTags(groupID int) ([]Tag, error) {
	rows, err := db.Query(`
		SELECT t."id", t."name", t."color"
		FROM "Tag" t
		INNER JOIN "ComicGroupTag" cgt ON cgt."tagId" = t."id"
		WHERE cgt."groupId" = ?
		ORDER BY t."name" ASC
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			continue
		}
		tags = append(tags, t)
	}
	if tags == nil {
		tags = []Tag{}
	}
	return tags, nil
}

// SetGroupTags 设置系列的标签（替换所有现有标签）。
// tagNames: 标签名称列表，不存在的标签会自动创建。
func SetGroupTags(groupID int, tagNames []string) error {
	// 先删除现有关联
	if _, err := db.Exec(`DELETE FROM "ComicGroupTag" WHERE "groupId" = ?`, groupID); err != nil {
		return err
	}

	if len(tagNames) == 0 {
		return nil
	}

	// 确保标签存在并获取 ID
	for _, name := range tagNames {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		// 查找或创建标签
		var tagID int
		err := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, name).Scan(&tagID)
		if err == sql.ErrNoRows {
			// 创建新标签
			res, err := db.Exec(`INSERT INTO "Tag" ("name", "color") VALUES (?, '')`, name)
			if err != nil {
				continue
			}
			id, _ := res.LastInsertId()
			tagID = int(id)
		} else if err != nil {
			continue
		}
		// 添加关联
		db.Exec(`INSERT OR IGNORE INTO "ComicGroupTag" ("groupId", "tagId") VALUES (?, ?)`, groupID, tagID)
	}

	return nil
}

// SyncGroupTagsToVolumes 将系列级标签同步到系列内所有卷。
// 仅添加卷中缺少的标签，不删除卷已有的标签。
func SyncGroupTagsToVolumes(groupID int) (totalVolumes, syncedVolumes, tagsCount int, err error) {
	group, e := GetGroupByID(groupID)
	if e != nil {
		err = e
		return
	}
	if group == nil || len(group.Comics) == 0 {
		return
	}

	// 获取系列级标签名称
	groupTags, e := GetGroupTags(groupID)
	if e != nil {
		err = e
		return
	}

	var tagNames []string
	for _, t := range groupTags {
		tagNames = append(tagNames, t.Name)
	}

	totalVolumes = len(group.Comics)
	tagsCount = len(tagNames)

	// 为每本漫画添加缺少的标签
	for _, comic := range group.Comics {
		if e := AddTagsToComic(comic.ComicID, tagNames); e != nil {
			log.Printf("[SyncGroupTags] 同步漫画 %s 标签失败: %v", comic.ComicID, e)
			continue
		}
		syncedVolumes++
	}

	return
}

// OverrideGroupTagsToVolumes 将系列级标签覆盖到系列内所有卷。
// 先清除卷的所有标签，再设置为系列标签，返回处理统计信息。
func OverrideGroupTagsToVolumes(groupID int) (totalVolumes, syncedVolumes, tagsSet int, err error) {
	group, e := GetGroupByID(groupID)
	if e != nil {
		err = e
		return
	}
	if group == nil || len(group.Comics) == 0 {
		return
	}

	// 获取系列级标签名称
	groupTags, e := GetGroupTags(groupID)
	if e != nil {
		err = e
		return
	}

	var tagNames []string
	for _, t := range groupTags {
		tagNames = append(tagNames, t.Name)
	}

	totalVolumes = len(group.Comics)

	// 对每本漫画：先清除所有标签，再添加系列标签
	for _, comic := range group.Comics {
		if e := ClearAllTagsFromComic(comic.ComicID); e != nil {
			log.Printf("[OverrideGroupTags] 清除漫画 %s 标签失败: %v", comic.ComicID, e)
			continue
		}
		if len(tagNames) > 0 {
			if e := AddTagsToComic(comic.ComicID, tagNames); e != nil {
				log.Printf("[OverrideGroupTags] 设置漫画 %s 标签失败: %v", comic.ComicID, e)
				continue
			}
		}
		syncedVolumes++
	}
	tagsSet = len(tagNames)

	return
}
