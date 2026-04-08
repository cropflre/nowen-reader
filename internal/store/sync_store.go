package store

import (
	"encoding/json"
	"fmt"
	"time"
)

// SyncLogEntry 表示一条同步日志记录。
type SyncLogEntry struct {
	ID         int                    `json:"id"`
	ComicID    string                 `json:"comicId"`
	Action     string                 `json:"action"`     // "scrape_apply" | "manual_edit" | "tag_add" | "tag_remove" | "category_add" | "category_remove" | "clear_metadata" | "ai_complete"
	Source     string                 `json:"source"`     // 操作来源页面: "detail" | "scraper" | "batch" | "api"
	Fields     map[string]interface{} `json:"fields"`     // 修改的字段和新值
	PrevValues map[string]interface{} `json:"prevValues"` // 修改前的旧值（用于回滚）
	UserID     string                 `json:"userId"`
	CreatedAt  string                 `json:"createdAt"`
}

// InsertSyncLog 插入一条同步日志。
func InsertSyncLog(comicID, action, source, userID string, fields, prevValues map[string]interface{}) error {
	fieldsJSON, _ := json.Marshal(fields)
	prevJSON, _ := json.Marshal(prevValues)

	_, err := db.Exec(
		`INSERT INTO "MetadataSyncLog" ("comicId", "action", "source", "fields", "prevValues", "userId", "createdAt")
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		comicID, action, source, string(fieldsJSON), string(prevJSON), userID, time.Now().Format(time.RFC3339),
	)
	return err
}

// GetSyncLogsByComic 获取指定漫画的同步日志（按时间倒序）。
func GetSyncLogsByComic(comicID string, limit int) ([]SyncLogEntry, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := db.Query(
		`SELECT "id", "comicId", "action", "source", "fields", "prevValues", "userId", "createdAt"
		 FROM "MetadataSyncLog" WHERE "comicId" = ? ORDER BY "createdAt" DESC LIMIT ?`,
		comicID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanSyncLogs(rows)
}

// GetRecentSyncLogs 获取最近的同步日志（全局）。
func GetRecentSyncLogs(limit int) ([]SyncLogEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := db.Query(
		`SELECT "id", "comicId", "action", "source", "fields", "prevValues", "userId", "createdAt"
		 FROM "MetadataSyncLog" ORDER BY "createdAt" DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanSyncLogs(rows)
}

// GetSyncStats 获取同步统计信息。
func GetSyncStats() (map[string]interface{}, error) {
	var total int
	_ = db.QueryRow(`SELECT COUNT(*) FROM "MetadataSyncLog"`).Scan(&total)

	var lastSync string
	_ = db.QueryRow(`SELECT "createdAt" FROM "MetadataSyncLog" ORDER BY "createdAt" DESC LIMIT 1`).Scan(&lastSync)

	// 按 action 统计
	actionCounts := map[string]int{}
	rows, err := db.Query(`SELECT "action", COUNT(*) FROM "MetadataSyncLog" GROUP BY "action"`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var action string
			var count int
			if rows.Scan(&action, &count) == nil {
				actionCounts[action] = count
			}
		}
	}

	// 最近 24 小时的操作数
	var recent24h int
	_ = db.QueryRow(
		`SELECT COUNT(*) FROM "MetadataSyncLog" WHERE "createdAt" > datetime('now', '-24 hours')`,
	).Scan(&recent24h)

	return map[string]interface{}{
		"totalLogs":    total,
		"lastSync":     lastSync,
		"actionCounts": actionCounts,
		"recent24h":    recent24h,
	}, nil
}

// RevertSyncLog 回滚指定的同步日志（恢复旧值）。
func RevertSyncLog(logID int) error {
	var comicID, fieldsStr, prevStr string
	err := db.QueryRow(
		`SELECT "comicId", "fields", "prevValues" FROM "MetadataSyncLog" WHERE "id" = ?`,
		logID,
	).Scan(&comicID, &fieldsStr, &prevStr)
	if err != nil {
		return fmt.Errorf("sync log not found: %d", logID)
	}

	var prevValues map[string]interface{}
	if err := json.Unmarshal([]byte(prevStr), &prevValues); err != nil {
		return fmt.Errorf("invalid prevValues JSON: %w", err)
	}

	if len(prevValues) == 0 {
		return fmt.Errorf("no previous values to revert")
	}

	// 应用旧值
	if err := UpdateComicFields(comicID, prevValues); err != nil {
		return fmt.Errorf("failed to revert fields: %w", err)
	}

	// 记录回滚操作本身
	_ = InsertSyncLog(comicID, "revert", "api", "", prevValues, nil)

	return nil
}

// scanSyncLogs 从 rows 中扫描同步日志。
func scanSyncLogs(rows interface {
	Next() bool
	Scan(...interface{}) error
}) ([]SyncLogEntry, error) {
	var logs []SyncLogEntry
	for rows.Next() {
		var entry SyncLogEntry
		var fieldsStr, prevStr string
		if err := rows.Scan(&entry.ID, &entry.ComicID, &entry.Action, &entry.Source,
			&fieldsStr, &prevStr, &entry.UserID, &entry.CreatedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(fieldsStr), &entry.Fields)
		_ = json.Unmarshal([]byte(prevStr), &entry.PrevValues)
		if entry.Fields == nil {
			entry.Fields = map[string]interface{}{}
		}
		if entry.PrevValues == nil {
			entry.PrevValues = map[string]interface{}{}
		}
		logs = append(logs, entry)
	}
	if logs == nil {
		logs = []SyncLogEntry{}
	}
	return logs, nil
}
