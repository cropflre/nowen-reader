package store

import (
	"database/sql"
	"time"
)

// ScanRuleOpLog 表示一条扫描规则操作日志。
type ScanRuleOpLog struct {
	ID        int64     `json:"id"`
	BatchID   string    `json:"batchId"`
	ComicID   string    `json:"comicId,omitempty"`
	GroupID   int       `json:"groupId,omitempty"`
	Action    string    `json:"action"`              // ai_infer | auto_group | metadata_apply
	Status    string    `json:"status"`              // success | failed | skipped | dryRun
	FromValue string    `json:"fromValue,omitempty"` // JSON 旧值
	ToValue   string    `json:"toValue,omitempty"`   // JSON 新值
	Message   string    `json:"message,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// InsertScanRuleOpLog 插入一条规则操作日志（失败时仅记录，不阻塞主流程）。
func InsertScanRuleOpLog(log ScanRuleOpLog) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(
		`INSERT INTO "ScanRuleOpLog" ("batchId","comicId","groupId","action","status","fromValue","toValue","message","createdAt")
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		log.BatchID, log.ComicID, log.GroupID, log.Action, log.Status,
		log.FromValue, log.ToValue, log.Message,
		time.Now().UTC(),
	)
	return err
}

// ListScanRuleOpLogs 查询最近的规则操作日志。
// batchID 为空时返回最新 limit 条；否则筛选指定批次。
func ListScanRuleOpLogs(batchID string, limit int) ([]ScanRuleOpLog, error) {
	if db == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	var rows *sql.Rows
	var err error
	if batchID != "" {
		rows, err = db.Query(
			`SELECT "id","batchId","comicId","groupId","action","status","fromValue","toValue","message","createdAt"
			 FROM "ScanRuleOpLog" WHERE "batchId" = ? ORDER BY "id" DESC LIMIT ?`,
			batchID, limit,
		)
	} else {
		rows, err = db.Query(
			`SELECT "id","batchId","comicId","groupId","action","status","fromValue","toValue","message","createdAt"
			 FROM "ScanRuleOpLog" ORDER BY "id" DESC LIMIT ?`,
			limit,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ScanRuleOpLog
	for rows.Next() {
		var l ScanRuleOpLog
		if err := rows.Scan(&l.ID, &l.BatchID, &l.ComicID, &l.GroupID,
			&l.Action, &l.Status, &l.FromValue, &l.ToValue, &l.Message, &l.CreatedAt); err != nil {
			continue
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// CountScanRuleOpLogs 返回操作日志总数（用于前端分页/概览）。
func CountScanRuleOpLogs() (int, error) {
	if db == nil {
		return 0, nil
	}
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM "ScanRuleOpLog"`).Scan(&n)
	return n, err
}

// GetRecentlyAddedComicIDs 返回最近 sinceMinutes 分钟内新加入库的漫画 ID 列表。
// 用于扫描后规则引擎只对新文件运行（避免每次扫描都扫全库）。
func GetRecentlyAddedComicIDs(sinceMinutes int, max int) ([]string, error) {
	if db == nil {
		return nil, nil
	}
	if sinceMinutes <= 0 {
		sinceMinutes = 10
	}
	if max <= 0 {
		max = 500
	}
	cutoff := time.Now().UTC().Add(-time.Duration(sinceMinutes) * time.Minute)
	rows, err := db.Query(
		`SELECT "id" FROM "Comic" WHERE "addedAt" >= ? ORDER BY "addedAt" DESC LIMIT ?`,
		cutoff, max,
	)
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
	return ids, rows.Err()
}
