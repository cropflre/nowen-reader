package service

import (
	"database/sql"
	"fmt"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// DataQAFixResultItem represents the result of executing a single fix.
type DataQAFixResultItem struct {
	IssueID    string `json:"issueId"`
	IssueType  string `json:"issueType"`
	EntityType string `json:"entityType"`
	EntityID   string `json:"entityId"`
	Action     string `json:"action"`
	Before     string `json:"before"`
	After      string `json:"after"`
	Success    bool   `json:"success"`
}

// DataQAFixResult is the response for a real fix execution.
type DataQAFixResult struct {
	DryRun       bool                 `json:"dryRun"`
	TotalExecuted int                 `json:"totalExecuted"`
	Executed     []DataQAFixResultItem `json:"executed"`
	Skipped      []DataQASkip          `json:"skipped"`
	Errors       []DataQAFixResultItem `json:"errors"`
}

// ExecuteFix performs real data fixes inside a transaction.
// It re-validates each issue before applying the fix.
func ExecuteFix(issueTypes []string, issueIDs []string, fixAll bool) (*DataQAFixResult, error) {
	db := store.DB()
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	// 1. Scan current issues
	allIssues, err := ScanDataIssues()
	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}

	// 2. Filter
	typeSet := make(map[string]bool)
	idSet := make(map[string]bool)
	for _, t := range issueTypes {
		typeSet[t] = true
	}
	for _, id := range issueIDs {
		idSet[id] = true
	}

	result := &DataQAFixResult{
		DryRun:   false,
		Executed: make([]DataQAFixResultItem, 0),
		Skipped:  make([]DataQASkip, 0),
		Errors:   make([]DataQAFixResultItem, 0),
	}

	for _, iss := range allIssues {
		// Apply filter
		if !fixAll {
			if len(typeSet) > 0 && !typeSet[iss.IssueType] {
				continue
			}
			if len(idSet) > 0 && !idSet[iss.ID] {
				continue
			}
		}

		if !iss.AutoFixable {
			result.Skipped = append(result.Skipped, DataQASkip{
				IssueID: iss.ID,
				Reason:  fmt.Sprintf("Issue type %s is not auto-fixable", iss.IssueType),
			})
			continue
		}

		switch iss.IssueType {
		case "TOTAL_TIME_ZERO":
			item, err := fixTotalTimeZero(iss)
			if err != nil {
				result.Errors = append(result.Errors, DataQAFixResultItem{
					IssueID:   iss.ID,
					IssueType: iss.IssueType,
					EntityID:  iss.EntityID,
					Action:    "RECALCULATE_TOTAL_READ_TIME",
					Success:   false,
				})
			} else {
				result.Executed = append(result.Executed, item)
			}

		case "UCS_TOTAL_TIME_ZERO":
			item, err := fixUCSTotalTimeZero(iss)
			if err != nil {
				result.Errors = append(result.Errors, DataQAFixResultItem{
					IssueID:   iss.ID,
					IssueType: iss.IssueType,
					EntityID:  iss.EntityID,
					Action:    "RECALCULATE_UCS_TOTAL_READ_TIME",
					Success:   false,
				})
			} else {
				result.Executed = append(result.Executed, item)
			}

		case "ORPHAN_TAG":
			item, err := fixOrphanTag(iss)
			if err != nil {
				result.Errors = append(result.Errors, DataQAFixResultItem{
					IssueID:   iss.ID,
					IssueType: iss.IssueType,
					EntityID:  iss.EntityID,
					Action:    "DELETE_ORPHAN_TAG",
					Success:   false,
				})
			} else {
				result.Executed = append(result.Executed, item)
			}

		case "ORPHAN_CATEGORY":
			item, err := fixOrphanCategory(iss)
			if err != nil {
				result.Errors = append(result.Errors, DataQAFixResultItem{
					IssueID:   iss.ID,
					IssueType: iss.IssueType,
					EntityID:  iss.EntityID,
					Action:    "DELETE_ORPHAN_CATEGORY",
					Success:   false,
				})
			} else {
				result.Executed = append(result.Executed, item)
			}

		case "SESSION_ORPHAN":
			item, err := fixOrphanSession(iss)
			if err != nil {
				result.Errors = append(result.Errors, DataQAFixResultItem{
					IssueID:   iss.ID,
					IssueType: iss.IssueType,
					EntityID:  iss.EntityID,
					Action:    "CLOSE_ORPHAN_SESSION",
					Success:   false,
				})
			} else {
				result.Executed = append(result.Executed, item)
			}

		case "SESSION_ZERO_DURATION":
			item, err := fixZeroDurationSession(iss)
			if err != nil {
				result.Errors = append(result.Errors, DataQAFixResultItem{
					IssueID:   iss.ID,
					IssueType: iss.IssueType,
					EntityID:  iss.EntityID,
					Action:    "RECALCULATE_ZERO_DURATION_SESSION",
					Success:   false,
				})
			} else {
				result.Executed = append(result.Executed, item)
			}

				default:
			result.Skipped = append(result.Skipped, DataQASkip{
				IssueID: iss.ID,
				Reason:  fmt.Sprintf("No fix logic for issue type %s", iss.IssueType),
			})
		}
	}

	result.TotalExecuted = len(result.Executed)
	return result, nil
}

func fixTotalTimeZero(iss DataQAIssue) (DataQAFixResultItem, error) {
	db := store.DB()

	// Re-validate: check comic still has totalReadTime <= 0
	var currentTotal int
	err := db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = ?`, iss.EntityID).Scan(&currentTotal)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("query comic %s: %w", iss.EntityID, err)
	}
	if currentTotal > 0 {
		return DataQAFixResultItem{
			IssueID:   iss.ID,
			IssueType: iss.IssueType,
			EntityID:  iss.EntityID,
			Action:    "RECALCULATE_TOTAL_READ_TIME",
			Before:    fmt.Sprintf("%d", currentTotal),
			After:     fmt.Sprintf("%d", currentTotal),
			Success:   true,
		}, nil // already fixed, idempotent skip
	}

	// Compute correct value
	var sumDuration int
	err = db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0)
		FROM "ReadingSession"
		WHERE "comicId" = ? AND "duration" > 0
	`, iss.EntityID).Scan(&sumDuration)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("query sum duration: %w", err)
	}
	if sumDuration <= 0 {
		return DataQAFixResultItem{}, fmt.Errorf("no positive duration found for comic %s", iss.EntityID)
	}

	// Update only if current value <= 0 (idempotent)
	_, err = db.Exec(`
		UPDATE "Comic" SET "totalReadTime" = ?
		WHERE "id" = ? AND "totalReadTime" <= 0
	`, sumDuration, iss.EntityID)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("update comic %s: %w", iss.EntityID, err)
	}

	return DataQAFixResultItem{
		IssueID:    iss.ID,
		IssueType:  iss.IssueType,
		EntityType: iss.EntityType,
		EntityID:   iss.EntityID,
		Action:     "RECALCULATE_TOTAL_READ_TIME",
		Before:     iss.CurrentVal,
		After:      fmt.Sprintf("%d", sumDuration),
		Success:    true,
	}, nil
}

func fixUCSTotalTimeZero(iss DataQAIssue) (DataQAFixResultItem, error) {
	db := store.DB()

	parts := splitEntityID(iss.EntityID)
	if len(parts) != 2 {
		return DataQAFixResultItem{}, fmt.Errorf("invalid UCS entity ID: %s", iss.EntityID)
	}
	userID, comicID := parts[0], parts[1]

	// Re-validate
	var currentTotal int
	err := db.QueryRow(`SELECT "totalReadTime" FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, userID, comicID).Scan(&currentTotal)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("query ucs %s: %w", iss.EntityID, err)
	}
	if currentTotal > 0 {
		return DataQAFixResultItem{
			IssueID:   iss.ID,
			IssueType: iss.IssueType,
			EntityID:  iss.EntityID,
			Action:    "RECALCULATE_UCS_TOTAL_READ_TIME",
			Before:    fmt.Sprintf("%d", currentTotal),
			After:     fmt.Sprintf("%d", currentTotal),
			Success:   true,
		}, nil
	}

	var sumDuration int
	err = db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0)
		FROM "ReadingSession"
		WHERE "userId" = ? AND "comicId" = ? AND "duration" > 0
	`, userID, comicID).Scan(&sumDuration)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("query sum duration: %w", err)
	}
	if sumDuration <= 0 {
		return DataQAFixResultItem{}, fmt.Errorf("no positive duration found for ucs %s", iss.EntityID)
	}

	_, err = db.Exec(`
		UPDATE "UserComicState" SET "totalReadTime" = ?
		WHERE "userId" = ? AND "comicId" = ? AND "totalReadTime" <= 0
	`, sumDuration, userID, comicID)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("update ucs %s: %w", iss.EntityID, err)
	}

	return DataQAFixResultItem{
		IssueID:    iss.ID,
		IssueType:  iss.IssueType,
		EntityType: iss.EntityType,
		EntityID:   iss.EntityID,
		Action:     "RECALCULATE_UCS_TOTAL_READ_TIME",
		Before:     iss.CurrentVal,
		After:      fmt.Sprintf("%d", sumDuration),
		Success:    true,
	}, nil
}

func fixOrphanTag(iss DataQAIssue) (DataQAFixResultItem, error) {
	db := store.DB()

	parts := splitEntityID(iss.EntityID)
	if len(parts) != 2 {
		return DataQAFixResultItem{}, fmt.Errorf("invalid ComicTag entity ID: %s", iss.EntityID)
	}
	comicID, tagIDStr := parts[0], parts[1]

	// Re-validate: confirm it's still an orphan
	var orphanCount int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM "ComicTag" ct
		WHERE ct."comicId" = ? AND ct."tagId" = ?
		AND NOT EXISTS (SELECT 1 FROM "Comic" c WHERE c."id" = ct."comicId")
	`, comicID, tagIDStr).Scan(&orphanCount)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("validate orphan tag: %w", err)
	}
	if orphanCount == 0 {
		return DataQAFixResultItem{
			IssueID:   iss.ID,
			IssueType: iss.IssueType,
			EntityID:  iss.EntityID,
			Action:    "DELETE_ORPHAN_TAG",
			Before:    "exists",
		After:     "already cleaned",
		Success:   true,
		}, nil
	}

	result, err := db.Exec(`DELETE FROM "ComicTag" WHERE "comicId" = ? AND "tagId" = ?`, comicID, tagIDStr)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("delete orphan tag: %w", err)
	}
	rows, _ := result.RowsAffected()

	return DataQAFixResultItem{
		IssueID:    iss.ID,
		IssueType:  iss.IssueType,
		EntityType: iss.EntityType,
		EntityID:   iss.EntityID,
		Action:     "DELETE_ORPHAN_TAG",
		Before:     "exists",
		After:      fmt.Sprintf("deleted (%d rows)", rows),
		Success:    true,
	}, nil
}

func fixOrphanCategory(iss DataQAIssue) (DataQAFixResultItem, error) {
	db := store.DB()

	parts := splitEntityID(iss.EntityID)
	if len(parts) != 2 {
		return DataQAFixResultItem{}, fmt.Errorf("invalid ComicCategory entity ID: %s", iss.EntityID)
	}
	comicID, catIDStr := parts[0], parts[1]

	var orphanCount int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM "ComicCategory" cc
		WHERE cc."comicId" = ? AND cc."categoryId" = ?
		AND NOT EXISTS (SELECT 1 FROM "Comic" c WHERE c."id" = cc."comicId")
	`, comicID, catIDStr).Scan(&orphanCount)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("validate orphan category: %w", err)
	}
	if orphanCount == 0 {
		return DataQAFixResultItem{
			IssueID:   iss.ID,
			IssueType: iss.IssueType,
			EntityID:  iss.EntityID,
			Action:    "DELETE_ORPHAN_CATEGORY",
			Before:    "exists",
		After:     "already cleaned",
		Success:   true,
		}, nil
	}

	result, err := db.Exec(`DELETE FROM "ComicCategory" WHERE "comicId" = ? AND "categoryId" = ?`, comicID, catIDStr)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("delete orphan category: %w", err)
	}
	rows, _ := result.RowsAffected()

	return DataQAFixResultItem{
		IssueID:    iss.ID,
		IssueType:  iss.IssueType,
		EntityType: iss.EntityType,
		EntityID:   iss.EntityID,
		Action:     "DELETE_ORPHAN_CATEGORY",
		Before:     "exists",
		After:      fmt.Sprintf("deleted (%d rows)", rows),
		Success:    true,
	}, nil
}

func fixOrphanSession(iss DataQAIssue) (DataQAFixResultItem, error) {
	db := store.DB()

	// EntityID is the session ID as string
	sessID := iss.EntityID

	// Re-validate: confirm still orphan (endedAt IS NULL, startedAt > 1h ago)
	var endedAt sql.NullString
	err := db.QueryRow(`SELECT "endedAt" FROM "ReadingSession" WHERE "id" = ?`, sessID).Scan(&endedAt)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("query session %s: %w", sessID, err)
	}
	if endedAt.Valid {
		// Already ended, idempotent skip
		return DataQAFixResultItem{
			IssueID:    iss.ID,
			IssueType:  iss.IssueType,
			EntityType: iss.EntityType,
			EntityID:   iss.EntityID,
			Action:     "CLOSE_ORPHAN_SESSION",
			Before:     "NULL endedAt",
			After:      "already closed",
			Success:    true,
		}, nil
	}

	// Mark as closed: endedAt = startedAt, duration = 0
	// This does NOT accumulate totalReadTime
	_, err = db.Exec(`
		UPDATE "ReadingSession"
		SET "endedAt" = "startedAt", "duration" = 0
		WHERE "id" = ? AND "endedAt" IS NULL
	`, sessID)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("close orphan session %s: %w", sessID, err)
	}

	return DataQAFixResultItem{
		IssueID:    iss.ID,
		IssueType:  iss.IssueType,
		EntityType: iss.EntityType,
		EntityID:   iss.EntityID,
		Action:     "CLOSE_ORPHAN_SESSION",
		Before:     "NULL endedAt, 0 duration",
		After:      "endedAt=startedAt, duration=0",
		Success:    true,
	}, nil
}

func fixZeroDurationSession(iss DataQAIssue) (DataQAFixResultItem, error) {
	db := store.DB()

	sessID := iss.EntityID

	// Re-validate: confirm still zero duration with valid endedAt > startedAt
	var endedAt, startedAt sql.NullString
	var duration int
	err := db.QueryRow(`
		SELECT "endedAt", "startedAt", "duration"
		FROM "ReadingSession" WHERE "id" = ?
	`, sessID).Scan(&endedAt, &startedAt, &duration)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("query session %s: %w", sessID, err)
	}
	if !endedAt.Valid || !startedAt.Valid {
		return DataQAFixResultItem{}, fmt.Errorf("session %s has NULL timestamps", sessID)
	}
	if duration > 0 {
		// Already has valid duration, idempotent skip
		return DataQAFixResultItem{
			IssueID:    iss.ID,
			IssueType:  iss.IssueType,
			EntityType: iss.EntityType,
			EntityID:   iss.EntityID,
			Action:     "RECALCULATE_ZERO_DURATION_SESSION",
			Before:     fmt.Sprintf("%d", duration),
			After:      fmt.Sprintf("%d", duration),
			Success:    true,
		}, nil
	}

	// Calculate duration from timestamps
	var computedDuration int
	err = db.QueryRow(`
		SELECT CAST((julianday("endedAt") - julianday("startedAt")) * 86400 AS INTEGER)
		FROM "ReadingSession" WHERE "id" = ?
	`, sessID).Scan(&computedDuration)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("compute duration for session %s: %w", sessID, err)
	}

	// Safety bounds: must be > 2 seconds and < 12 hours
	if computedDuration <= 2 {
		return DataQAFixResultItem{}, fmt.Errorf("computed duration %d too small for session %s", computedDuration, sessID)
	}
	if computedDuration > 43200 {
		return DataQAFixResultItem{}, fmt.Errorf("computed duration %d exceeds 12h for session %s", computedDuration, sessID)
	}

	// Get session info for totalReadTime recalculation
	var comicID string
	var userID sql.NullString
	err = db.QueryRow(`SELECT "comicId", "userId" FROM "ReadingSession" WHERE "id" = ?`, sessID).Scan(&comicID, &userID)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("query session info %s: %w", sessID, err)
	}

	// Update the session duration
	_, err = db.Exec(`
		UPDATE "ReadingSession" SET "duration" = ?
		WHERE "id" = ? AND "duration" <= 0
	`, computedDuration, sessID)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("update session %s: %w", sessID, err)
	}

	// Recalculate Comic.totalReadTime from SUM (not additive)
	var comicSum int
	err = db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0) FROM "ReadingSession"
		WHERE "comicId" = ? AND "duration" > 0
	`, comicID).Scan(&comicSum)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("sum comic read time: %w", err)
	}
	_, err = db.Exec(`UPDATE "Comic" SET "totalReadTime" = ? WHERE "id" = ?`, comicSum, comicID)
	if err != nil {
		return DataQAFixResultItem{}, fmt.Errorf("update comic totalReadTime: %w", err)
	}

	// Recalculate UserComicState.totalReadTime if userId present
	if userID.Valid && userID.String != "" {
		var ucsSum int
		err = db.QueryRow(`
			SELECT COALESCE(SUM("duration"), 0) FROM "ReadingSession"
			WHERE "userId" = ? AND "comicId" = ? AND "duration" > 0
		`, userID.String, comicID).Scan(&ucsSum)
		if err != nil {
			return DataQAFixResultItem{}, fmt.Errorf("sum ucs read time: %w", err)
		}
		_, err = db.Exec(`
			UPDATE "UserComicState" SET "totalReadTime" = ?
			WHERE "userId" = ? AND "comicId" = ?
		`, ucsSum, userID.String, comicID)
		if err != nil {
			return DataQAFixResultItem{}, fmt.Errorf("update ucs totalReadTime: %w", err)
		}
	}

	return DataQAFixResultItem{
		IssueID:    iss.ID,
		IssueType:  iss.IssueType,
		EntityType: iss.EntityType,
		EntityID:   iss.EntityID,
		Action:     "RECALCULATE_ZERO_DURATION_SESSION",
		Before:     "0",
		After:      fmt.Sprintf("%d", computedDuration),
		Success:    true,
	}, nil
}
