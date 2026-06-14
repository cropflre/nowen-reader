package service

import (
	"database/sql"
	"fmt"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// DataQAFixPlan describes a single dry-run fix action.
type DataQAFixPlan struct {
	IssueID     string `json:"issueId"`
	IssueType   string `json:"issueType"`
	EntityType  string `json:"entityType"`
	EntityID    string `json:"entityId"`
	Action      string `json:"action"`
	Safe        bool   `json:"safe"`
	CurrentVal  string `json:"currentVal,omitempty"`
	ExpectedVal string `json:"expectedVal,omitempty"`
	Message     string `json:"message"`
}

// DataQASkip describes an issue that was skipped during fix preview.
type DataQASkip struct {
	IssueID string `json:"issueId"`
	Reason  string `json:"reason"`
}

// DataQAFixPreviewResult is the dry-run fix preview response.
type DataQAFixPreviewResult struct {
	DryRun       bool            `json:"dryRun"`
	TotalPlanned int             `json:"totalPlanned"`
	Plans        []DataQAFixPlan `json:"plans"`
	Skipped      []DataQASkip    `json:"skipped"`
}

// BuildFixPreview produces a dry-run fix preview. It only runs SELECT queries
// and never modifies the database.
func BuildFixPreview(issueTypes []string, issueIDs []string, fixAll bool) (*DataQAFixPreviewResult, error) {
	db := store.DB()
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	allIssues, err := ScanDataIssues()
	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}

	typeSet := make(map[string]bool)
	idSet := make(map[string]bool)
	for _, t := range issueTypes {
		typeSet[t] = true
	}
	for _, id := range issueIDs {
		idSet[id] = true
	}

	result := &DataQAFixPreviewResult{
		DryRun:  true,
		Plans:   make([]DataQAFixPlan, 0),
		Skipped: make([]DataQASkip, 0),
	}

	for _, iss := range allIssues {
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
			plan, err := buildTotalTimeZeroPlan(db, iss)
			if err != nil {
				result.Skipped = append(result.Skipped, DataQASkip{
					IssueID: iss.ID,
					Reason:  fmt.Sprintf("Failed to compute fix: %v", err),
				})
				continue
			}
			result.Plans = append(result.Plans, plan)

		case "UCS_TOTAL_TIME_ZERO":
			plan, err := buildUCSTotalTimeZeroPlan(db, iss)
			if err != nil {
				result.Skipped = append(result.Skipped, DataQASkip{
					IssueID: iss.ID,
					Reason:  fmt.Sprintf("Failed to compute fix: %v", err),
				})
				continue
			}
			result.Plans = append(result.Plans, plan)

		case "ORPHAN_TAG":
			result.Plans = append(result.Plans, DataQAFixPlan{
				IssueID:    iss.ID,
				IssueType:  iss.IssueType,
				EntityType: iss.EntityType,
				EntityID:   iss.EntityID,
				Action:     "DELETE_ORPHAN_TAG",
				Safe:       true,
				Message:    "Would delete orphan ComicTag row",
			})

		case "ORPHAN_CATEGORY":
			result.Plans = append(result.Plans, DataQAFixPlan{
				IssueID:    iss.ID,
				IssueType:  iss.IssueType,
				EntityType: iss.EntityType,
				EntityID:   iss.EntityID,
				Action:     "DELETE_ORPHAN_CATEGORY",
				Safe:       true,
				Message:    "Would delete orphan ComicCategory row",
			})

		case "SESSION_ORPHAN":
			result.Plans = append(result.Plans, DataQAFixPlan{
				IssueID:    iss.ID,
				IssueType:  iss.IssueType,
				EntityType: iss.EntityType,
				EntityID:   iss.EntityID,
				Action:     "CLOSE_ORPHAN_SESSION",
				Safe:       true,
				Message:    "Would mark orphan session as closed (endedAt=startedAt, duration=0)",
			})

		case "SESSION_ZERO_DURATION":
			result.Plans = append(result.Plans, DataQAFixPlan{
				IssueID:    iss.ID,
				IssueType:  iss.IssueType,
				EntityType: iss.EntityType,
				EntityID:   iss.EntityID,
				Action:     "RECALCULATE_ZERO_DURATION_SESSION",
				Safe:       true,
				Message:    "Would recalculate duration from timestamps and re-aggregate totalReadTime",
			})

				default:
			result.Skipped = append(result.Skipped, DataQASkip{
				IssueID: iss.ID,
				Reason:  fmt.Sprintf("No dry-run logic for issue type %s", iss.IssueType),
			})
		}
	}

	result.TotalPlanned = len(result.Plans)
	return result, nil
}

func buildTotalTimeZeroPlan(db *sql.DB, iss DataQAIssue) (DataQAFixPlan, error) {
	var sumDuration int
	err := db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0)
		FROM "ReadingSession"
		WHERE "comicId" = ? AND "duration" > 0
	`, iss.EntityID).Scan(&sumDuration)
	if err != nil {
		return DataQAFixPlan{}, fmt.Errorf("query sum duration: %w", err)
	}

	return DataQAFixPlan{
		IssueID:     iss.ID,
		IssueType:   iss.IssueType,
		EntityType:  iss.EntityType,
		EntityID:    iss.EntityID,
		Action:      "RECALCULATE_TOTAL_READ_TIME",
		Safe:        true,
		CurrentVal:  iss.CurrentVal,
		ExpectedVal: fmt.Sprintf("%d", sumDuration),
		Message:     fmt.Sprintf("Would update Comic.totalReadTime from %s to %d (SUM of ReadingSession.duration)", iss.CurrentVal, sumDuration),
	}, nil
}

func buildUCSTotalTimeZeroPlan(db *sql.DB, iss DataQAIssue) (DataQAFixPlan, error) {
	parts := splitEntityID(iss.EntityID)
	if len(parts) != 2 {
		return DataQAFixPlan{}, fmt.Errorf("invalid UCS entity ID: %s", iss.EntityID)
	}
	userID, comicID := parts[0], parts[1]

	var sumDuration int
	err := db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0)
		FROM "ReadingSession"
		WHERE "userId" = ? AND "comicId" = ? AND "duration" > 0
	`, userID, comicID).Scan(&sumDuration)
	if err != nil {
		return DataQAFixPlan{}, fmt.Errorf("query sum duration: %w", err)
	}

	return DataQAFixPlan{
		IssueID:     iss.ID,
		IssueType:   iss.IssueType,
		EntityType:  iss.EntityType,
		EntityID:    iss.EntityID,
		Action:      "RECALCULATE_UCS_TOTAL_READ_TIME",
		Safe:        true,
		CurrentVal:  iss.CurrentVal,
		ExpectedVal: fmt.Sprintf("%d", sumDuration),
		Message:     fmt.Sprintf("Would update UserComicState.totalReadTime from %s to %d (SUM of ReadingSession.duration)", iss.CurrentVal, sumDuration),
	}, nil
}

func splitEntityID(id string) []string {
	for i := 0; i < len(id); i++ {
		if id[i] == '/' {
			return []string{id[:i], id[i+1:]}
		}
	}
	return []string{id}
}
