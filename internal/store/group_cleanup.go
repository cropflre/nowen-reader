package store

import (
	"fmt"
	"log"
	"strings"
	"time"
	"unicode"
)

// ============================================================
// 系列脏数据检测与清理
// ============================================================

// GroupDirtyIssue 描述一个脏数据问题。
type GroupDirtyIssue struct {
	Type        string `json:"type"`        // 问题类型: empty_group, orphan_link, dirty_name, duplicate_name
	GroupID     int    `json:"groupId"`     // 相关系列ID
	GroupName   string `json:"groupName"`   // 系列名称
	Description string `json:"description"` // 问题描述
	Suggestion  string `json:"suggestion"`  // 修复建议
	AutoFixable bool   `json:"autoFixable"` // 是否可自动修复
	// 仅 dirty_name 类型使用
	CleanedName string `json:"cleanedName,omitempty"` // 清理后的名称
	// 仅 duplicate_name 类型使用
	DuplicateIDs []int `json:"duplicateIds,omitempty"` // 重复的系列ID列表
}

// GroupCleanupResult 清理结果。
type GroupCleanupResult struct {
	EmptyGroupsDeleted int `json:"emptyGroupsDeleted"`
	OrphanLinksRemoved int `json:"orphanLinksRemoved"`
	DirtyNamesFixed    int `json:"dirtyNamesFixed"`
	DuplicatesMerged   int `json:"duplicatesMerged"`
}

// DetectGroupDirtyData 检测系列中的脏数据问题。
func DetectGroupDirtyData() ([]GroupDirtyIssue, error) {
	var issues []GroupDirtyIssue

	// 1. 检测空系列（0卷）
	rows, err := db.Query(`
		SELECT g."id", g."name",
		       (SELECT COUNT(*) FROM "ComicGroupItem" gi WHERE gi."groupId" = g."id") as totalLinks,
		       (SELECT COUNT(*) FROM "ComicGroupItem" gi
		        JOIN "Comic" c ON c."id" = gi."comicId"
		        WHERE gi."groupId" = g."id") as validLinks
		FROM "ComicGroup" g
		ORDER BY g."name"
	`)
	if err != nil {
		return nil, fmt.Errorf("检测空系列失败: %w", err)
	}
	defer rows.Close()

	type groupInfo struct {
		id         int
		name       string
		totalLinks int
		validLinks int
	}
	var allGroups []groupInfo

	for rows.Next() {
		var g groupInfo
		if err := rows.Scan(&g.id, &g.name, &g.totalLinks, &g.validLinks); err != nil {
			continue
		}
		allGroups = append(allGroups, g)

		// 完全空的系列（没有任何关联记录）
		if g.totalLinks == 0 {
			issues = append(issues, GroupDirtyIssue{
				Type:        "empty_group",
				GroupID:     g.id,
				GroupName:   g.name,
				Description: fmt.Sprintf("系列「%s」没有包含任何漫画", g.name),
				Suggestion:  "删除此空系列",
				AutoFixable: true,
			})
		} else if g.validLinks == 0 {
			// 有关联记录但全部指向已删除的漫画
			issues = append(issues, GroupDirtyIssue{
				Type:        "empty_group",
				GroupID:     g.id,
				GroupName:   g.name,
				Description: fmt.Sprintf("系列「%s」包含 %d 条关联记录，但对应的漫画已全部被删除", g.name, g.totalLinks),
				Suggestion:  "清理无效关联并删除此空系列",
				AutoFixable: true,
			})
		} else if g.validLinks < g.totalLinks {
			// 部分关联记录指向已删除的漫画
			orphanCount := g.totalLinks - g.validLinks
			issues = append(issues, GroupDirtyIssue{
				Type:        "orphan_link",
				GroupID:     g.id,
				GroupName:   g.name,
				Description: fmt.Sprintf("系列「%s」中有 %d 条孤立关联（指向已删除的漫画）", g.name, orphanCount),
				Suggestion:  fmt.Sprintf("清理 %d 条无效关联记录", orphanCount),
				AutoFixable: true,
			})
		}
	}

	// 2. 检测名称脏数据（包含作者信息、书名号等格式问题）
	for _, g := range allGroups {
		cleaned := cleanGroupName(g.name)
		if cleaned != g.name {
			issues = append(issues, GroupDirtyIssue{
				Type:        "dirty_name",
				GroupID:     g.id,
				GroupName:   g.name,
				Description: fmt.Sprintf("系列名称格式不规范：「%s」", g.name),
				Suggestion:  fmt.Sprintf("建议修正为：「%s」", cleaned),
				CleanedName: cleaned,
				AutoFixable: true,
			})
		}
	}

	// 3. 检测重复系列（名称相同或高度相似）
	nameMap := make(map[string][]groupInfo) // normalizedName → groups
	for _, g := range allGroups {
		key := normalizeGroupName(g.name)
		nameMap[key] = append(nameMap[key], g)
	}
	for _, groups := range nameMap {
		if len(groups) < 2 {
			continue
		}
		var ids []int
		var names []string
		for _, g := range groups {
			ids = append(ids, g.id)
			names = append(names, g.name)
		}
		issues = append(issues, GroupDirtyIssue{
			Type:         "duplicate_name",
			GroupID:      ids[0],
			GroupName:    groups[0].name,
			Description:  fmt.Sprintf("发现 %d 个疑似重复系列：%s", len(groups), strings.Join(names, "、")),
			Suggestion:   "建议合并为一个系列",
			DuplicateIDs: ids,
			AutoFixable:  false, // 重复系列需要人工确认
		})
	}

	return issues, nil
}

// cleanGroupName 清理系列名称中的脏数据。
func cleanGroupName(name string) string {
	cleaned := name

	// 移除书名号 《》
	cleaned = strings.TrimPrefix(cleaned, "《")
	if idx := strings.Index(cleaned, "》"); idx >= 0 {
		// 如果》后面还有内容（如"作者：xxx"），只保留》前面的部分
		cleaned = cleaned[:idx]
	}

	// 移除名称中混入的"作者：xxx"信息
	for _, sep := range []string{" 作者：", " 作者:", "作者：", "作者:", " by ", " By "} {
		if idx := strings.Index(cleaned, sep); idx >= 0 {
			cleaned = strings.TrimSpace(cleaned[:idx])
		}
	}

	// 移除名称中混入的"作者 xxx"（中文冒号后跟内容）
	for _, sep := range []string{" 著", " 编", " 画"} {
		if strings.HasSuffix(cleaned, sep) || strings.Contains(cleaned, sep+"：") || strings.Contains(cleaned, sep+":") {
			if idx := strings.Index(cleaned, sep); idx >= 0 {
				cleaned = strings.TrimSpace(cleaned[:idx])
			}
		}
	}

	// 去除首尾空白
	cleaned = strings.TrimSpace(cleaned)

	// 如果清理后为空，返回原名称
	if cleaned == "" {
		return name
	}

	return cleaned
}

// normalizeGroupName 标准化系列名称用于重复检测。
func normalizeGroupName(name string) string {
	// 先清理名称
	n := cleanGroupName(name)
	// 转小写
	n = strings.ToLower(n)
	// 移除所有空白字符
	var buf strings.Builder
	for _, r := range n {
		if !unicode.IsSpace(r) {
			buf.WriteRune(r)
		}
	}
	return buf.String()
}

// CleanupEmptyGroups 清理空系列（没有有效漫画关联的系列）。
func CleanupEmptyGroups() (int, error) {
	// 先清理孤立的关联记录（指向已删除漫画的）
	_, err := db.Exec(`
		DELETE FROM "ComicGroupItem"
		WHERE "comicId" NOT IN (SELECT "id" FROM "Comic")
	`)
	if err != nil {
		return 0, fmt.Errorf("清理孤立关联失败: %w", err)
	}

	// 删除没有任何漫画关联的空系列
	result, err := db.Exec(`
		DELETE FROM "ComicGroup"
		WHERE "id" NOT IN (
			SELECT DISTINCT "groupId" FROM "ComicGroupItem"
		)
	`)
	if err != nil {
		return 0, fmt.Errorf("删除空系列失败: %w", err)
	}
	affected, _ := result.RowsAffected()
	return int(affected), nil
}

// CleanupOrphanLinks 清理孤立的关联记录。
func CleanupOrphanLinks() (int, error) {
	result, err := db.Exec(`
		DELETE FROM "ComicGroupItem"
		WHERE "comicId" NOT IN (SELECT "id" FROM "Comic")
	`)
	if err != nil {
		return 0, fmt.Errorf("清理孤立关联失败: %w", err)
	}
	affected, _ := result.RowsAffected()
	return int(affected), nil
}

// FixDirtyGroupNames 修复脏名称。
func FixDirtyGroupNames() (int, error) {
	rows, err := db.Query(`SELECT "id", "name" FROM "ComicGroup"`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	fixed := 0
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			continue
		}
		cleaned := cleanGroupName(name)
		if cleaned != name {
			_, err := db.Exec(`UPDATE "ComicGroup" SET "name" = ?, "updatedAt" = ? WHERE "id" = ?`,
				cleaned, time.Now().UTC(), id)
			if err != nil {
				log.Printf("[cleanup] 修复系列名称失败 id=%d: %v", id, err)
				continue
			}
			fixed++
			log.Printf("[cleanup] 修复系列名称: 「%s」→「%s」", name, cleaned)
		}
	}
	return fixed, nil
}

// FixSingleGroupName 修复单个系列的名称。
func FixSingleGroupName(groupID int, newName string) error {
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return fmt.Errorf("名称不能为空")
	}
	_, err := db.Exec(`UPDATE "ComicGroup" SET "name" = ?, "updatedAt" = ? WHERE "id" = ?`,
		newName, time.Now().UTC(), groupID)
	return err
}

// RunFullGroupCleanup 执行完整的系列数据清理。
func RunFullGroupCleanup() (*GroupCleanupResult, error) {
	result := &GroupCleanupResult{}

	// 1. 清理孤立关联
	orphans, err := CleanupOrphanLinks()
	if err != nil {
		return result, fmt.Errorf("清理孤立关联失败: %w", err)
	}
	result.OrphanLinksRemoved = orphans
	log.Printf("[cleanup] 清理孤立关联: %d 条", orphans)

	// 2. 删除空系列
	empty, err := CleanupEmptyGroups()
	if err != nil {
		return result, fmt.Errorf("删除空系列失败: %w", err)
	}
	result.EmptyGroupsDeleted = empty
	log.Printf("[cleanup] 删除空系列: %d 个", empty)

	// 3. 修复脏名称
	names, err := FixDirtyGroupNames()
	if err != nil {
		return result, fmt.Errorf("修复脏名称失败: %w", err)
	}
	result.DirtyNamesFixed = names
	log.Printf("[cleanup] 修复脏名称: %d 个", names)

	return result, nil
}
