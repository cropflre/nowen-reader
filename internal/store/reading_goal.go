package store

import (
	"database/sql"
	"time"
)

// ============================================================
// 阅读目标系统
// ============================================================

// ReadingGoal 表示一个阅读目标。
type ReadingGoal struct {
	ID          int    `json:"id"`
	GoalType    string `json:"goalType"`    // "daily" 或 "weekly"
	TargetMins  int    `json:"targetMins"`  // 目标阅读时长（分钟）
	TargetBooks int    `json:"targetBooks"` // 目标阅读本数（0=不限制）
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// ReadingGoalProgress 表示目标进度。
type ReadingGoalProgress struct {
	Goal            ReadingGoal `json:"goal"`
	CurrentMins     int         `json:"currentMins"`     // 当前周期内已阅读分钟数
	CurrentBooks    int         `json:"currentBooks"`    // 当前周期内已阅读本数
	ProgressPct     int         `json:"progressPct"`     // 时间进度百分比
	BookProgressPct int         `json:"bookProgressPct"` // 本数进度百分比
	PeriodStart     string      `json:"periodStart"`     // 当前周期起始日期
	PeriodEnd       string      `json:"periodEnd"`       // 当前周期结束日期
	Achieved        bool        `json:"achieved"`        // 是否已达成
}

// GetReadingGoal 获取当前阅读目标（只保留一个目标 per goalType）。
func GetReadingGoal(goalType string) (*ReadingGoal, error) {
	var goal ReadingGoal
	err := db.QueryRow(`
		SELECT "id", "goalType", "targetMins", "targetBooks", "createdAt", "updatedAt"
		FROM "ReadingGoal"
		WHERE "goalType" = ?
		LIMIT 1
	`, goalType).Scan(&goal.ID, &goal.GoalType, &goal.TargetMins, &goal.TargetBooks, &goal.CreatedAt, &goal.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &goal, nil
}

// SetReadingGoal 创建或更新阅读目标（upsert）。
func SetReadingGoal(goalType string, targetMins int, targetBooks int) (*ReadingGoal, error) {
	now := time.Now().UTC().Format(time.RFC3339)

	_, err := db.Exec(`
		INSERT INTO "ReadingGoal" ("goalType", "targetMins", "targetBooks", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT("goalType") DO UPDATE SET
			"targetMins" = ?, "targetBooks" = ?, "updatedAt" = ?
	`, goalType, targetMins, targetBooks, now, now, targetMins, targetBooks, now)
	if err != nil {
		return nil, err
	}

	return GetReadingGoal(goalType)
}

// DeleteReadingGoal 删除指定类型的阅读目标。
func DeleteReadingGoal(goalType string) error {
	_, err := db.Exec(`DELETE FROM "ReadingGoal" WHERE "goalType" = ?`, goalType)
	return err
}

// GetReadingGoalProgress 获取阅读目标及其当前进度。
func GetReadingGoalProgress(goalType string) (*ReadingGoalProgress, error) {
	goal, err := GetReadingGoal(goalType)
	if err != nil {
		return nil, err
	}
	if goal == nil {
		return nil, nil
	}

	now := time.Now().UTC()
	var periodStart, periodEnd time.Time

	switch goalType {
	case "daily":
		periodStart = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		periodEnd = periodStart.AddDate(0, 0, 1)
	case "weekly":
		// 本周一开始
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		periodStart = time.Date(now.Year(), now.Month(), now.Day()-(weekday-1), 0, 0, 0, 0, time.UTC)
		periodEnd = periodStart.AddDate(0, 0, 7)
	default:
		return nil, nil
	}

	// 查询当前周期内的阅读时长
	var totalDuration int
	err = db.QueryRow(`
		SELECT COALESCE(SUM("duration"), 0) FROM "ReadingSession"
		WHERE "startedAt" >= ? AND "startedAt" < ?
	`, periodStart.Format("2006-01-02 15:04:05"), periodEnd.Format("2006-01-02 15:04:05")).Scan(&totalDuration)
	if err != nil {
		return nil, err
	}

	// 查询当前周期内的阅读本数
	var bookCount int
	err = db.QueryRow(`
		SELECT COUNT(DISTINCT "comicId") FROM "ReadingSession"
		WHERE "startedAt" >= ? AND "startedAt" < ?
	`, periodStart.Format("2006-01-02 15:04:05"), periodEnd.Format("2006-01-02 15:04:05")).Scan(&bookCount)
	if err != nil {
		return nil, err
	}

	currentMins := totalDuration / 60

	// 计算进度
	progressPct := 0
	if goal.TargetMins > 0 {
		progressPct = currentMins * 100 / goal.TargetMins
		if progressPct > 100 {
			progressPct = 100
		}
	}

	bookProgressPct := 0
	if goal.TargetBooks > 0 {
		bookProgressPct = bookCount * 100 / goal.TargetBooks
		if bookProgressPct > 100 {
			bookProgressPct = 100
		}
	}

	achieved := false
	if goal.TargetMins > 0 && currentMins >= goal.TargetMins {
		achieved = true
	}
	if goal.TargetBooks > 0 && bookCount >= goal.TargetBooks {
		achieved = true
	}

	return &ReadingGoalProgress{
		Goal:            *goal,
		CurrentMins:     currentMins,
		CurrentBooks:    bookCount,
		ProgressPct:     progressPct,
		BookProgressPct: bookProgressPct,
		PeriodStart:     periodStart.Format("2006-01-02"),
		PeriodEnd:       periodEnd.Format("2006-01-02"),
		Achieved:        achieved,
	}, nil
}

// GetAllGoalProgress 获取所有类型的目标进度。
func GetAllGoalProgress() ([]ReadingGoalProgress, error) {
	var results []ReadingGoalProgress

	for _, goalType := range []string{"daily", "weekly"} {
		progress, err := GetReadingGoalProgress(goalType)
		if err != nil {
			continue
		}
		if progress != nil {
			results = append(results, *progress)
		}
	}

	if results == nil {
		results = []ReadingGoalProgress{}
	}
	return results, nil
}
