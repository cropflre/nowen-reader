package store

import (
	"fmt"
	"strings"
)

// ============================================================
// 批量操作
// ============================================================

// BatchDeleteGroups 批量删除多个分组。
func BatchDeleteGroups(groupIDs []int) (int, error) {
	deleted := 0
	for _, id := range groupIDs {
		if err := DeleteGroup(id); err != nil {
			continue
		}
		deleted++
	}
	return deleted, nil
}

// MergeGroups 将多个分组合并为一个新分组。
// 取第一个分组的封面，合并所有成员漫画并去重。
func MergeGroups(groupIDs []int, newName string, userID string) (int64, error) {
	if len(groupIDs) < 2 {
		return 0, fmt.Errorf("至少需要两个分组才能合并")
	}

	// 1. 收集所有漫画 ID（去重）
	seen := make(map[string]bool)
	var allComicIDs []string
	var coverURL string
	for i, gid := range groupIDs {
		detail, err := GetGroupByID(gid)
		if err != nil || detail == nil {
			continue
		}
		// 使用第一个有封面的分组的封面
		if i == 0 || (coverURL == "" && detail.CoverURL != "") {
			coverURL = detail.CoverURL
		}
		for _, c := range detail.Comics {
			if !seen[c.ComicID] {
				seen[c.ComicID] = true
				allComicIDs = append(allComicIDs, c.ComicID)
			}
		}
	}

	// 2. 创建新分组
	uid := userID
	newID, err := CreateGroup(newName, uid)
	if err != nil {
		return 0, fmt.Errorf("创建合并分组失败: %w", err)
	}

	// 3. 设置封面
	if coverURL != "" {
		UpdateGroup(int(newID), newName, coverURL)
	}

	// 4. 添加所有漫画到新分组
	if len(allComicIDs) > 0 {
		if err := AddComicsToGroup(int(newID), allComicIDs); err != nil {
			return newID, fmt.Errorf("添加漫画到合并分组失败: %w", err)
		}
	}

	// 5. 删除旧分组
	for _, gid := range groupIDs {
		DeleteGroup(gid)
	}

	return newID, nil
}

// GroupExportItem 分组导出数据条目。
type GroupExportItem struct {
	ID         int               `json:"id"`
	Name       string            `json:"name"`
	CoverURL   string            `json:"coverUrl"`
	ComicCount int               `json:"comicCount"`
	CreatedAt  string            `json:"createdAt"`
	UpdatedAt  string            `json:"updatedAt"`
	Comics     []GroupComicBrief `json:"comics"`
}

// GroupComicBrief 分组导出中的漫画简要信息。
type GroupComicBrief struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Filename string `json:"filename"`
}

// ExportGroupsData 导出指定分组的数据。
func ExportGroupsData(groupIDs []int) ([]GroupExportItem, error) {
	var items []GroupExportItem
	for _, gid := range groupIDs {
		detail, err := GetGroupByID(gid)
		if err != nil || detail == nil {
			continue
		}
		item := GroupExportItem{
			ID:         detail.ID,
			Name:       detail.Name,
			CoverURL:   detail.CoverURL,
			ComicCount: detail.ComicCount,
			CreatedAt:  detail.CreatedAt,
			UpdatedAt:  detail.UpdatedAt,
		}
		for _, c := range detail.Comics {
			item.Comics = append(item.Comics, GroupComicBrief{
				ID:       c.ComicID,
				Title:    c.Title,
				Filename: c.Filename,
			})
		}
		if item.Comics == nil {
			item.Comics = []GroupComicBrief{}
		}
		items = append(items, item)
	}
	if items == nil {
		items = []GroupExportItem{}
	}
	return items, nil
}

// BatchCreateGroups 批量创建分组并添加漫画（用于自动检测后一键创建）。
// 如果已存在同名分组，则将漫画添加到现有分组而不是创建新分组。
// autoInherit: 为 true 时，创建分组后自动从首卷继承元数据到系列。
func BatchCreateGroups(groups []AutoDetectGroup, autoInherit bool, userID ...string) (int, error) {
	// 预加载所有已有分组名 → ID 的映射
	existingGroups, err := GetAllGroups()
	if err != nil {
		return 0, err
	}
	nameToID := make(map[string]int)
	for _, g := range existingGroups {
		nameToID[strings.ToLower(g.Name)] = g.ID
	}

	created := 0
	for _, g := range groups {
		key := strings.ToLower(g.Name)
		if existingID, ok := nameToID[key]; ok {
			// 同名分组已存在，将漫画添加到现有分组
			if err := AddComicsToGroup(existingID, g.ComicIDs); err != nil {
				continue
			}
			// 自动继承元数据到系列
			if autoInherit {
				_ = InheritGroupMetadataFromFirstComic(existingID)
			}
			created++
			continue
		}
		id, err := CreateGroup(g.Name, userID...)
		if err != nil {
			continue
		}
		if err := AddComicsToGroup(int(id), g.ComicIDs); err != nil {
			continue
		}
		nameToID[key] = int(id)
		// 自动继承元数据到系列
		if autoInherit {
			_ = InheritGroupMetadataFromFirstComic(int(id))
		}
		created++
	}
	return created, nil
}
