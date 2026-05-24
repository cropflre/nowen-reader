package service

import (
	"fmt"
	"log"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// 紧急还原工具：把被 AI 错误覆盖的 Title 重新基于 filename 派生。
//
// 触发场景：扫描期统一规则 + AI 推断 + OverwriteTitle=true 时，
// 偶发把整桶 N 本 comic 都写成同一个标题（AI 模板字段误用）。
// 此函数提供一键还原入口，不依赖 AI，只用本地的 FilenameToSmartTitle。
// ============================================================

// RestoreTitlesOptions 控制还原行为。
type RestoreTitlesOptions struct {
	BatchID         string   // 批次 ID（写到 op_log）
	DryRun          bool     // 试运行：不写库，仅返回 diff
	OnlyDuplicates  bool     // 只处理"同一标题出现 ≥2 次"的污染数据（默认推荐）
	MetadataSources []string // 仅处理这些 metadataSource 的数据（如 ["ai_scan_rules"]，空=不限）
	ComicIDs        []string // 指定 comic（为空则全表扫描）
}

// RestoreTitlesResult 还原结果摘要。
type RestoreTitlesResult struct {
	BatchID  string             `json:"batchId"`
	DryRun   bool               `json:"dryRun"`
	Total    int                `json:"total"`    // 检测到的可还原数量
	Restored int                `json:"restored"` // 实际写库（DryRun=true 时为 0）
	Skipped  int                `json:"skipped"`  // 派生结果与现有相同 / 文件名为空
	Samples  []TitleRestoreDiff `json:"samples"`  // 前 50 条 old→new 预览
}

// TitleRestoreDiff 单条还原差异。
type TitleRestoreDiff struct {
	ID       string `json:"id"`
	OldTitle string `json:"oldTitle"`
	NewTitle string `json:"newTitle"`
	Filename string `json:"filename"`
}

// RestoreTitlesFromFilename 把 Title 字段重置为基于 Filename 的智能派生。
//
// 行为：
//   - OnlyDuplicates=true：只挑选"同一 Title 被多本 comic 共用"的污染数据；
//     单本独占的标题（即便错了）不会被改动，避免误伤刮削结果。
//   - DryRun=true：只返回预览，不写库。
//   - 每条还原都写一条 ScanRuleOpLog（action=restore_title），
//     fromValue=旧标题，toValue=新标题，message="reason"。
func RestoreTitlesFromFilename(opts RestoreTitlesOptions) (*RestoreTitlesResult, error) {
	dbConn := store.DB()
	if dbConn == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	if opts.BatchID == "" {
		opts.BatchID = genBatchID()
	}

	// 1) 拉数据
	type row struct{ id, title, filename, source string }
	var all []row

	if len(opts.ComicIDs) > 0 {
		// 指定 ID 列表
		for _, id := range opts.ComicIDs {
			c, err := store.GetComicByID(id)
			if err != nil || c == nil {
				continue
			}
			all = append(all, row{id: c.ID, title: c.Title, filename: c.Filename, source: c.MetadataSource})
		}
	} else {
		rows, err := dbConn.Query(`SELECT "id","title","filename",COALESCE("metadataSource",'') FROM "Comic"`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.title, &r.filename, &r.source); err != nil {
				continue
			}
			all = append(all, r)
		}
	}

	// 1.5) MetadataSource 过滤（如指定）
	if len(opts.MetadataSources) > 0 {
		allowed := make(map[string]bool, len(opts.MetadataSources))
		for _, s := range opts.MetadataSources {
			allowed[strings.TrimSpace(s)] = true
		}
		filtered := make([]row, 0, len(all))
		for _, r := range all {
			if allowed[r.source] {
				filtered = append(filtered, r)
			}
		}
		all = filtered
	}

	// 2) OnlyDuplicates 过滤：统计每个 title 的出现次数，只保留 ≥2 的
	candidates := all
	if opts.OnlyDuplicates {
		count := make(map[string]int, len(all))
		for _, r := range all {
			t := strings.TrimSpace(r.title)
			if t == "" {
				continue
			}
			count[t]++
		}
		filtered := make([]row, 0, len(all))
		for _, r := range all {
			t := strings.TrimSpace(r.title)
			if t == "" {
				continue
			}
			if count[t] >= 2 {
				filtered = append(filtered, r)
			}
		}
		candidates = filtered
	}

	result := &RestoreTitlesResult{
		BatchID: opts.BatchID,
		DryRun:  opts.DryRun,
	}

	// 3) 派生新标题、写库
	for _, r := range candidates {
		fn := strings.TrimSpace(r.filename)
		if fn == "" {
			result.Skipped++
			continue
		}
		newTitle := store.FilenameToSmartTitle(fn)
		newTitle = sanitizeTitle(newTitle)
		if newTitle == "" || newTitle == r.title {
			result.Skipped++
			continue
		}

		result.Total++
		if len(result.Samples) < 50 {
			result.Samples = append(result.Samples, TitleRestoreDiff{
				ID: r.id, OldTitle: r.title, NewTitle: newTitle, Filename: fn,
			})
		}

		if opts.DryRun {
			continue
		}

		err := store.UpdateComicFields(r.id, map[string]interface{}{
			"title": newTitle,
		})
		if err != nil {
			_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
				BatchID: opts.BatchID, Action: "restore_title", Status: "failed",
				ComicID: r.id, FromValue: r.title, ToValue: newTitle,
				Message: err.Error(),
			})
			continue
		}
		result.Restored++
		_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
			BatchID: opts.BatchID, Action: "restore_title", Status: "success",
			ComicID: r.id, FromValue: r.title, ToValue: newTitle,
			Message: "restored from filename",
		})
	}

	log.Printf("[scan-rules] restore titles: batch=%s total=%d restored=%d skipped=%d dryRun=%v",
		opts.BatchID, result.Total, result.Restored, result.Skipped, opts.DryRun)
	return result, nil
}
