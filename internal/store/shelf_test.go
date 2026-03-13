package store

import (
	"testing"
)

func TestShelfCRUD(t *testing.T) {
	setupTestDB(t)

	// 创建书架
	shelf, err := CreateShelf("我的收藏", "❤️")
	if err != nil {
		t.Fatalf("CreateShelf failed: %v", err)
	}
	if shelf.Name != "我的收藏" || shelf.Icon != "❤️" {
		t.Errorf("Shelf mismatch: name=%q icon=%q", shelf.Name, shelf.Icon)
	}

	// 列出所有书架
	shelves, err := GetAllShelves()
	if err != nil {
		t.Fatalf("GetAllShelves failed: %v", err)
	}
	if len(shelves) != 1 {
		t.Errorf("Expected 1 shelf, got %d", len(shelves))
	}

	// 更新书架
	if err := UpdateShelf(shelf.ID, "最爱", "💕"); err != nil {
		t.Fatalf("UpdateShelf failed: %v", err)
	}
	updatedShelves, _ := GetAllShelves()
	if len(updatedShelves) != 1 || updatedShelves[0].Name != "最爱" {
		t.Errorf("Expected updated name '最爱', got '%v'", updatedShelves)
	}

	// 添加漫画到书架
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"shelf-comic-1", "shelf-comic1.cbz", "Shelf Comic 1", 1000},
		{"shelf-comic-2", "shelf-comic2.cbz", "Shelf Comic 2", 2000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	if err := AddComicToShelf("shelf-comic-1", shelf.ID); err != nil {
		t.Fatalf("AddComicToShelf failed: %v", err)
	}
	if err := AddComicToShelf("shelf-comic-2", shelf.ID); err != nil {
		t.Fatalf("AddComicToShelf second failed: %v", err)
	}

	// 获取书架漫画ID
	ids, err := GetShelfComicIDs(shelf.ID)
	if err != nil {
		t.Fatalf("GetShelfComicIDs failed: %v", err)
	}
	if len(ids) != 2 {
		t.Errorf("Expected 2 comic IDs in shelf, got %d", len(ids))
	}

	// 获取漫画的书架归属
	comicShelves, err := GetComicShelves("shelf-comic-1")
	if err != nil {
		t.Fatalf("GetComicShelves failed: %v", err)
	}
	if len(comicShelves) != 1 {
		t.Errorf("Expected comic in 1 shelf, got %d", len(comicShelves))
	}

	// 从书架移除漫画
	if err := RemoveComicFromShelf("shelf-comic-1", shelf.ID); err != nil {
		t.Fatalf("RemoveComicFromShelf failed: %v", err)
	}
	ids, _ = GetShelfComicIDs(shelf.ID)
	if len(ids) != 1 {
		t.Errorf("Expected 1 comic after remove, got %d", len(ids))
	}

	// 删除书架
	if err := DeleteShelf(shelf.ID); err != nil {
		t.Fatalf("DeleteShelf failed: %v", err)
	}
	shelves, _ = GetAllShelves()
	if len(shelves) != 0 {
		t.Errorf("Expected 0 shelves after delete, got %d", len(shelves))
	}
}

func TestReadingGoalCRUD(t *testing.T) {
	setupTestDB(t)

	// 创建每日目标
	goal, err := SetReadingGoal("daily", 30, 0)
	if err != nil {
		t.Fatalf("SetReadingGoal failed: %v", err)
	}
	if goal == nil {
		t.Fatal("SetReadingGoal returned nil")
	}
	if goal.GoalType != "daily" || goal.TargetMins != 30 {
		t.Errorf("Goal mismatch: type=%q mins=%d", goal.GoalType, goal.TargetMins)
	}

	// 获取目标
	found, err := GetReadingGoal("daily")
	if err != nil {
		t.Fatalf("GetReadingGoal failed: %v", err)
	}
	if found == nil || found.TargetMins != 30 {
		t.Errorf("Expected targetMins=30, got %v", found)
	}

	// 更新目标（upsert）
	updated, err := SetReadingGoal("daily", 60, 2)
	if err != nil {
		t.Fatalf("SetReadingGoal update failed: %v", err)
	}
	if updated.TargetMins != 60 || updated.TargetBooks != 2 {
		t.Errorf("Updated goal mismatch: mins=%d books=%d", updated.TargetMins, updated.TargetBooks)
	}

	// 创建每周目标
	_, err = SetReadingGoal("weekly", 180, 3)
	if err != nil {
		t.Fatalf("SetReadingGoal weekly failed: %v", err)
	}

	// 获取所有目标进度
	progress, err := GetAllGoalProgress()
	if err != nil {
		t.Fatalf("GetAllGoalProgress failed: %v", err)
	}
	if len(progress) != 2 {
		t.Errorf("Expected 2 goal progress items, got %d", len(progress))
	}

	// 检查进度字段
	for _, p := range progress {
		if p.PeriodStart == "" || p.PeriodEnd == "" {
			t.Errorf("Progress period should not be empty for %s", p.Goal.GoalType)
		}
		if p.ProgressPct != 0 {
			t.Errorf("Expected 0%% progress (no sessions), got %d%%", p.ProgressPct)
		}
	}

	// 添加漫画和会话用于测试进度
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"goal-comic-1", "goal-comic1.cbz", "Goal Comic", 1000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	sessionID, err := StartReadingSession("goal-comic-1", 0)
	if err != nil {
		t.Fatalf("StartReadingSession failed: %v", err)
	}
	if err := EndReadingSession(int(sessionID), 10, 1800); err != nil { // 30分钟
		t.Fatalf("EndReadingSession failed: %v", err)
	}

	// 再次获取进度
	dailyProgress, err := GetReadingGoalProgress("daily")
	if err != nil {
		t.Fatalf("GetReadingGoalProgress failed: %v", err)
	}
	if dailyProgress == nil {
		t.Fatal("Daily progress should not be nil")
	}
	if dailyProgress.CurrentMins != 30 {
		t.Errorf("Expected currentMins=30, got %d", dailyProgress.CurrentMins)
	}
	if dailyProgress.ProgressPct != 50 {
		t.Errorf("Expected 50%% progress (30/60), got %d%%", dailyProgress.ProgressPct)
	}

	// 删除目标
	if err := DeleteReadingGoal("daily"); err != nil {
		t.Fatalf("DeleteReadingGoal failed: %v", err)
	}
	found, _ = GetReadingGoal("daily")
	if found != nil {
		t.Error("Daily goal should be deleted")
	}

	// 不存在的目标
	notFound, err := GetReadingGoal("nonexistent")
	if err != nil {
		t.Fatalf("GetReadingGoal nonexistent failed: %v", err)
	}
	if notFound != nil {
		t.Error("Expected nil for nonexistent goal")
	}
}

func TestEnhancedStats(t *testing.T) {
	setupTestDB(t)

	// 创建漫画和会话数据
	comics := []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"stats-comic-1", "stats1.cbz", "Stats Comic 1", 1000},
		{"stats-comic-2", "stats2.cbz", "Stats Comic 2", 2000},
	}
	if err := BulkCreateComics(comics); err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	// 创建会话
	id1, _ := StartReadingSession("stats-comic-1", 0)
	EndReadingSession(int(id1), 5, 600)
	id2, _ := StartReadingSession("stats-comic-2", 0)
	EndReadingSession(int(id2), 3, 300)

	// 测试增强统计
	stats, err := GetEnhancedReadingStats()
	if err != nil {
		t.Fatalf("GetEnhancedReadingStats failed: %v", err)
	}
	if stats == nil {
		t.Fatal("GetEnhancedReadingStats returned nil")
	}

	totalTime, ok := stats["totalReadTime"]
	if !ok {
		t.Error("Missing totalReadTime in stats")
	}
	if tt, ok := totalTime.(int); ok && tt != 900 {
		t.Errorf("Expected totalReadTime=900, got %d", tt)
	}
}
