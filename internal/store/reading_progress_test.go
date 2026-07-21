package store

import (
	"database/sql"
	"fmt"
	"testing"
	"time"
)

func setupReadingProgressTest(t *testing.T) {
	t.Helper()
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
}

func setTestComicPageCount(t *testing.T, comicID string, pageCount int) {
	t.Helper()
	if _, err := db.Exec(`UPDATE "Comic" SET "pageCount" = ? WHERE "id" = ?`, pageCount, comicID); err != nil {
		t.Fatalf("set pageCount failed: %v", err)
	}
}

func TestUpdateReadingProgressClampsZeroBasedFinalPage(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "progress-user", "progress-user", "user")
	createTestComicWithLibrary(t, "progress-comic", "progress.cbz", "Progress", "default")
	setTestComicPageCount(t, "progress-comic", 190)

	if err := UpdateReadingProgress("progress-comic", 190, 190, "progress-user"); err != nil {
		t.Fatalf("UpdateReadingProgress failed: %v", err)
	}

	for _, query := range []string{
		`SELECT "lastReadPage", "readingStatus" FROM "Comic" WHERE "id" = 'progress-comic'`,
		`SELECT "lastReadPage", "readingStatus" FROM "UserComicState" WHERE "userId" = 'progress-user' AND "comicId" = 'progress-comic'`,
	} {
		var page int
		var status string
		if err := db.QueryRow(query).Scan(&page, &status); err != nil {
			t.Fatalf("query progress failed: %v", err)
		}
		if page != 189 || status != "finished" {
			t.Fatalf("progress = %d/%q, want 189/finished", page, status)
		}
	}
}

func TestFinishedStatusUsesFinalPageWithoutChangingGlobalProgress(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "finished-user", "finished-user", "user")
	createTestComicWithLibrary(t, "finished-comic", "finished.cbz", "Finished", "default")
	setTestComicPageCount(t, "finished-comic", 190)

	if err := SetUserReadingStatus("finished-user", "finished-comic", "finished"); err != nil {
		t.Fatalf("SetUserReadingStatus failed: %v", err)
	}

	var userPage, globalPage int
	if err := db.QueryRow(`SELECT "lastReadPage" FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, "finished-user", "finished-comic").Scan(&userPage); err != nil {
		t.Fatalf("query user progress failed: %v", err)
	}
	if err := db.QueryRow(`SELECT "lastReadPage" FROM "Comic" WHERE "id" = ?`, "finished-comic").Scan(&globalPage); err != nil {
		t.Fatalf("query global progress failed: %v", err)
	}
	if userPage != 189 {
		t.Fatalf("user lastReadPage = %d, want 189", userPage)
	}
	if globalPage != 0 {
		t.Fatalf("global lastReadPage = %d, want unchanged 0", globalPage)
	}
}

func TestUserComicStateDoesNotFallBackToGlobalState(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "isolated-user", "isolated-user", "user")
	createTestComicWithLibrary(t, "isolated-comic", "isolated.cbz", "Isolated", "default")
	setTestComicPageCount(t, "isolated-comic", 20)
	if _, err := db.Exec(`
		UPDATE "Comic" SET "lastReadPage" = 12, "lastReadAt" = ?, "isFavorite" = 1,
			"rating" = 5, "totalReadTime" = 600, "readingStatus" = 'finished'
		WHERE "id" = ?
	`, time.Now().UTC(), "isolated-comic"); err != nil {
		t.Fatalf("seed global state failed: %v", err)
	}

	comic, err := GetComicByIDForUser("isolated-comic", "isolated-user")
	if err != nil {
		t.Fatalf("GetComicByIDForUser failed: %v", err)
	}
	if comic.LastReadPage != 0 || comic.LastReadAt != nil || comic.IsFavorite || comic.Rating != nil || comic.TotalReadTime != 0 || comic.ReadingStatus != "" {
		t.Fatalf("global state leaked into user state: %+v", comic)
	}
}

func TestEndReadingSessionIsClampedAndIdempotent(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "session-user", "session-user", "user")
	createTestComicWithLibrary(t, "session-comic", "session.cbz", "Session", "default")
	setTestComicPageCount(t, "session-comic", 190)

	sessionID, err := StartReadingSession("session-comic", 190, "session-user")
	if err != nil {
		t.Fatalf("StartReadingSession failed: %v", err)
	}
	if err := EndReadingSession(int(sessionID), 999, 60, "session-user"); err != nil {
		t.Fatalf("EndReadingSession failed: %v", err)
	}
	if err := EndReadingSession(int(sessionID), 50, 120, "session-user"); err != nil {
		t.Fatalf("repeated EndReadingSession failed: %v", err)
	}

	var startPage, endPage, duration, globalTime, userTime int
	if err := db.QueryRow(`SELECT "startPage", "endPage", "duration" FROM "ReadingSession" WHERE "id" = ?`, sessionID).Scan(&startPage, &endPage, &duration); err != nil {
		t.Fatalf("query session failed: %v", err)
	}
	if err := db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = ?`, "session-comic").Scan(&globalTime); err != nil {
		t.Fatalf("query global read time failed: %v", err)
	}
	if err := db.QueryRow(`SELECT "totalReadTime" FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, "session-user", "session-comic").Scan(&userTime); err != nil {
		t.Fatalf("query user read time failed: %v", err)
	}
	if startPage != 189 || endPage != 189 || duration != 60 || globalTime != 60 || userTime != 60 {
		t.Fatalf("session values = start:%d end:%d duration:%d global:%d user:%d", startPage, endPage, duration, globalTime, userTime)
	}
}

func TestRecordReadingActivityIsCumulativeAndSequenceSafe(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "activity-user", "activity-user", "user")
	createTestComicWithLibrary(t, "activity-comic", "activity.cbz", "Activity", "default")
	setTestComicPageCount(t, "activity-comic", 190)

	requests := []struct {
		page          int
		activeSeconds int
		sequence      int
		finalize      bool
	}{
		{page: 19, activeSeconds: 10, sequence: 1},
		{page: 24, activeSeconds: 20, sequence: 2},
		// 重放相同序号以及迟到的旧请求，均不得让页码倒退或重复累计。
		{page: 0, activeSeconds: 20, sequence: 2},
		// 时长独立取累计最大值；即使异常旧请求秒数更大，也只补差值且不改页码。
		{page: 1, activeSeconds: 25, sequence: 1, finalize: true},
	}
	for _, request := range requests {
		if err := RecordReadingActivity(
			"activity-comic", "activity-user", "client-session", request.page, 999,
			request.activeSeconds, request.sequence, request.finalize, true,
		); err != nil {
			t.Fatalf("RecordReadingActivity failed: %v", err)
		}
	}

	var sessionCount, startPage, endPage, duration, lastSequence int
	var endedAt sql.NullString
	if err := db.QueryRow(`
		SELECT COUNT(*), MIN("startPage"), MAX("endPage"), MAX("duration"), MAX("lastSequence"), MAX("endedAt")
		FROM "ReadingSession" WHERE "userId" = ? AND "clientSessionId" = ?
	`, "activity-user", "client-session").Scan(&sessionCount, &startPage, &endPage, &duration, &lastSequence, &endedAt); err != nil {
		t.Fatalf("query activity session failed: %v", err)
	}
	var userPage, userTime, globalTime int
	if err := db.QueryRow(`SELECT "lastReadPage", "totalReadTime" FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, "activity-user", "activity-comic").Scan(&userPage, &userTime); err != nil {
		t.Fatalf("query activity progress failed: %v", err)
	}
	if err := db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = ?`, "activity-comic").Scan(&globalTime); err != nil {
		t.Fatalf("query activity total failed: %v", err)
	}
	if sessionCount != 1 || startPage != 19 || endPage != 24 || duration != 25 || lastSequence != 2 || !endedAt.Valid {
		t.Fatalf("session = count:%d page:%d-%d duration:%d sequence:%d ended:%v", sessionCount, startPage, endPage, duration, lastSequence, endedAt.Valid)
	}
	if userPage != 24 || userTime != 25 || globalTime != 25 {
		t.Fatalf("activity totals = page:%d user:%d global:%d", userPage, userTime, globalTime)
	}
}

func TestReadingStatsHandleMixedSQLiteTimestampFormats(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "mixed-time-user", "mixed-time-user", "user")
	createTestComicWithLibrary(t, "mixed-time-comic", "mixed-time.cbz", "Mixed Time", "default")

	dayStart := localDayStart(time.Now())
	timestamps := []string{
		dayStart.Add(time.Hour).UTC().String(),
		dayStart.Add(2 * time.Hour).UTC().Format(time.RFC3339),
		dayStart.Add(3 * time.Hour).UTC().Format(sqliteDateTimeLayout),
	}
	durations := []int{60, 120, 180}
	for index := range timestamps {
		if _, err := db.Exec(`
			INSERT INTO "ReadingSession"
				("comicId", "userId", "clientSessionId", "startedAt", "endedAt", "duration", "startPage", "endPage")
			VALUES (?, ?, ?, ?, ?, ?, 0, 1)
		`, "mixed-time-comic", "mixed-time-user", fmt.Sprintf("mixed-time-%d", index), timestamps[index], timestamps[index], durations[index]); err != nil {
			t.Fatalf("insert mixed timestamp session failed: %v", err)
		}
	}
	if err := RecordReadingActivity(
		"mixed-time-comic", "mixed-time-user", "current-driver-time", 1, 10,
		240, 1, true, true,
	); err != nil {
		t.Fatalf("RecordReadingActivity with current driver format failed: %v", err)
	}

	enhanced, err := GetEnhancedReadingStats("mixed-time-user")
	if err != nil {
		t.Fatalf("GetEnhancedReadingStats failed: %v", err)
	}
	if enhanced["todayReadTime"] != 600 || enhanced["weekReadTime"] != 600 {
		t.Fatalf("enhanced period totals = today:%v week:%v, want 600/600", enhanced["todayReadTime"], enhanced["weekReadTime"])
	}

	daily, ok := enhanced["dailyStats"].([]map[string]interface{})
	if !ok || len(daily) != 1 || daily[0]["date"] != dayStart.Format("2006-01-02") || daily[0]["duration"] != 600 {
		t.Fatalf("enhanced daily stats = %#v", enhanced["dailyStats"])
	}

	basic, err := GetReadingStats("mixed-time-user")
	if err != nil {
		t.Fatalf("GetReadingStats failed: %v", err)
	}
	if len(basic.DailyStats) != 1 || basic.DailyStats[0].Date != dayStart.Format("2006-01-02") || basic.DailyStats[0].Duration != 600 {
		t.Fatalf("basic daily stats = %#v", basic.DailyStats)
	}

	if _, err := SetReadingGoal("daily", 1, 0, "mixed-time-user"); err != nil {
		t.Fatalf("SetReadingGoal failed: %v", err)
	}
	goal, err := GetReadingGoalProgress("daily", "mixed-time-user")
	if err != nil {
		t.Fatalf("GetReadingGoalProgress failed: %v", err)
	}
	if goal == nil || goal.CurrentMins != 10 {
		t.Fatalf("daily goal = %#v, want 10 minutes", goal)
	}

	report, err := GetYearlyReadingReport(dayStart.Year(), "mixed-time-user")
	if err != nil {
		t.Fatalf("GetYearlyReadingReport failed: %v", err)
	}
	if report.TotalReadTime != 600 || report.TotalSessions != 4 {
		t.Fatalf("yearly report = time:%d sessions:%d", report.TotalReadTime, report.TotalSessions)
	}
}

func TestRecordReadingActivityRejectsSessionReuseAcrossComics(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "reuse-user", "reuse-user", "user")
	createTestComicWithLibrary(t, "reuse-comic-a", "a.cbz", "A", "default")
	createTestComicWithLibrary(t, "reuse-comic-b", "b.cbz", "B", "default")
	setTestComicPageCount(t, "reuse-comic-a", 10)
	setTestComicPageCount(t, "reuse-comic-b", 10)

	if err := RecordReadingActivity("reuse-comic-a", "reuse-user", "reused-session", 2, 10, 5, 1, false, true); err != nil {
		t.Fatalf("initial activity failed: %v", err)
	}
	if err := RecordReadingActivity("reuse-comic-b", "reuse-user", "reused-session", 8, 10, 10, 2, false, true); err == nil {
		t.Fatal("cross-comic clientSessionId reuse should fail")
	}

	var stateCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, "reuse-user", "reuse-comic-b").Scan(&stateCount); err != nil {
		t.Fatal(err)
	}
	if stateCount != 0 {
		t.Fatalf("second comic received progress from reused session: %d rows", stateCount)
	}
}

func TestRecordReadingActivityCanSkipProgressTracking(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "time-only-user", "time-only-user", "user")
	createTestComicWithLibrary(t, "time-only-comic", "time-only.cbz", "Time Only", "default")
	setTestComicPageCount(t, "time-only-comic", 20)

	if err := RecordReadingActivity("time-only-comic", "time-only-user", "time-only-session", 12, 20, 15, 1, true, false); err != nil {
		t.Fatalf("RecordReadingActivity failed: %v", err)
	}

	var page, totalTime int
	var lastReadAt sql.NullTime
	if err := db.QueryRow(`SELECT "lastReadPage", "lastReadAt", "totalReadTime" FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, "time-only-user", "time-only-comic").Scan(&page, &lastReadAt, &totalTime); err != nil {
		t.Fatalf("query time-only state failed: %v", err)
	}
	if page != 0 || lastReadAt.Valid || totalTime != 15 {
		t.Fatalf("time-only state = page:%d lastRead:%v time:%d", page, lastReadAt.Valid, totalTime)
	}
}

func TestRecordReadingActivityFinalMarkerAbsorbsLateInitialHeartbeat(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "late-user", "late-user", "user")
	createTestComicWithLibrary(t, "late-comic", "late.cbz", "Late", "default")
	setTestComicPageCount(t, "late-comic", 10)

	if err := RecordReadingActivity("late-comic", "late-user", "late-session", 4, 10, 0, 2, true, true); err != nil {
		t.Fatalf("final marker failed: %v", err)
	}
	if err := RecordReadingActivity("late-comic", "late-user", "late-session", 0, 10, 0, 1, false, true); err != nil {
		t.Fatalf("late initial heartbeat failed: %v", err)
	}

	var count, duration, endPage, lastSequence int
	var endedAt sql.NullString
	if err := db.QueryRow(`
		SELECT COUNT(*), MAX("duration"), MAX("endPage"), MAX("lastSequence"), MAX("endedAt")
		FROM "ReadingSession" WHERE "userId" = ? AND "clientSessionId" = ?
	`, "late-user", "late-session").Scan(&count, &duration, &endPage, &lastSequence, &endedAt); err != nil {
		t.Fatalf("query final marker failed: %v", err)
	}
	if count != 1 || duration != 0 || endPage != 4 || lastSequence != 2 || !endedAt.Valid {
		t.Fatalf("final marker = count:%d duration:%d page:%d sequence:%d ended:%v", count, duration, endPage, lastSequence, endedAt.Valid)
	}
	stats, err := GetReadingStats("late-user")
	if err != nil {
		t.Fatal(err)
	}
	if stats.TotalSessions != 0 || len(stats.RecentSessions) != 0 {
		t.Fatalf("zero-duration final marker leaked into stats: %+v", stats)
	}
}

func TestYearlyReadingReportIsUserScoped(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "report-user-a", "report-user-a", "user")
	createTestUser(t, "report-user-b", "report-user-b", "user")
	createTestComicWithLibrary(t, "report-comic", "report.cbz", "Report", "default")
	setTestComicPageCount(t, "report-comic", 10)

	for _, item := range []struct {
		userID   string
		duration int
	}{{"report-user-a", 60}, {"report-user-b", 120}} {
		sessionID, err := StartReadingSession("report-comic", 0, item.userID)
		if err != nil {
			t.Fatalf("StartReadingSession(%s) failed: %v", item.userID, err)
		}
		if err := EndReadingSession(int(sessionID), 2, item.duration, item.userID); err != nil {
			t.Fatalf("EndReadingSession(%s) failed: %v", item.userID, err)
		}
	}

	report, err := GetYearlyReadingReport(time.Now().Year(), "report-user-a")
	if err != nil {
		t.Fatalf("GetYearlyReadingReport failed: %v", err)
	}
	if report.TotalReadTime != 60 || report.TotalSessions != 1 || report.TotalComicsRead != 1 {
		t.Fatalf("user report = time:%d sessions:%d comics:%d", report.TotalReadTime, report.TotalSessions, report.TotalComicsRead)
	}
}

func TestReadingProgressMigrationRepairsExistingOverflow(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "migration-user", "migration-user", "user")
	createTestComicWithLibrary(t, "migration-comic", "migration.cbz", "Migration", "default")
	setTestComicPageCount(t, "migration-comic", 190)
	now := time.Now().UTC()
	if _, err := db.Exec(`UPDATE "Comic" SET "lastReadPage" = 190, "lastReadAt" = ?, "readingStatus" = 'reading', "totalReadTime" = 999 WHERE "id" = ?`, now, "migration-comic"); err != nil {
		t.Fatalf("seed comic progress failed: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt", "readingStatus", "totalReadTime") VALUES (?, ?, 191, ?, 'reading', 999)`, "migration-user", "migration-comic", now); err != nil {
		t.Fatalf("seed user progress failed: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO "ReadingSession" ("comicId", "userId", "startPage", "endPage", "duration") VALUES (?, ?, 190, 191, 60)`, "migration-comic", "migration-user"); err != nil {
		t.Fatalf("seed session failed: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM "_migrations" WHERE "version" = 35`); err != nil {
		t.Fatalf("reset progress migration failed: %v", err)
	}
	if err := RunMigrations(); err != nil {
		t.Fatalf("rerun progress migration failed: %v", err)
	}

	var comicPage, userPage, startPage, endPage, comicTime, userTime int
	var comicStatus, userStatus string
	if err := db.QueryRow(`SELECT "lastReadPage", "readingStatus" FROM "Comic" WHERE "id" = ?`, "migration-comic").Scan(&comicPage, &comicStatus); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT "lastReadPage", "readingStatus" FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, "migration-user", "migration-comic").Scan(&userPage, &userStatus); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT "startPage", "endPage" FROM "ReadingSession" WHERE "comicId" = ?`, "migration-comic").Scan(&startPage, &endPage); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT "totalReadTime" FROM "Comic" WHERE "id" = ?`, "migration-comic").Scan(&comicTime); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT "totalReadTime" FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, "migration-user", "migration-comic").Scan(&userTime); err != nil {
		t.Fatal(err)
	}
	if comicPage != 189 || userPage != 189 || startPage != 189 || endPage != 189 || comicStatus != "finished" || userStatus != "finished" || comicTime != 60 || userTime != 60 {
		t.Fatalf("migration result = comic:%d/%s/%ds user:%d/%s/%ds session:%d-%d", comicPage, comicStatus, comicTime, userPage, userStatus, userTime, startPage, endPage)
	}
}

func TestReadingActivityMigrationCleansLegacyBrokenSessions(t *testing.T) {
	setupReadingProgressTest(t)
	createTestUser(t, "legacy-session-user", "legacy-session-user", "user")
	createTestComicWithLibrary(t, "legacy-session-comic", "legacy.cbz", "Legacy", "default")
	setTestComicPageCount(t, "legacy-session-comic", 30)
	now := time.Now().UTC()
	if _, err := db.Exec(`
		INSERT INTO "ReadingSession" ("comicId", "userId", "startedAt", "endedAt", "startPage", "endPage", "duration")
		VALUES (?, ?, ?, ?, 19, 0, 60), (?, ?, ?, NULL, 0, 0, 0)
	`, "legacy-session-comic", "legacy-session-user", now, now, "legacy-session-comic", "legacy-session-user", now); err != nil {
		t.Fatalf("seed legacy sessions failed: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM "_migrations" WHERE "version" = 36`); err != nil {
		t.Fatalf("reset activity migration failed: %v", err)
	}
	if err := RunMigrations(); err != nil {
		t.Fatalf("rerun activity migration failed: %v", err)
	}

	var count, startPage, endPage int
	if err := db.QueryRow(`SELECT COUNT(*), MIN("startPage"), MIN("endPage") FROM "ReadingSession" WHERE "comicId" = ?`, "legacy-session-comic").Scan(&count, &startPage, &endPage); err != nil {
		t.Fatalf("query migrated sessions failed: %v", err)
	}
	if count != 1 || startPage != 19 || endPage != 19 {
		t.Fatalf("migrated sessions = count:%d page:%d-%d", count, startPage, endPage)
	}
}
