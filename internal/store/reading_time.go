package store

import (
	"fmt"
	"time"
)

const sqliteDateTimeLayout = "2006-01-02 15:04:05"

// normalizedSQLiteDateTimeExpr normalizes all timestamp formats historically
// written by database/sql, modernc SQLite, and explicit RFC3339 formatting.
// ReadingSession timestamps are stored in UTC, so dropping the suffix is safe.
func normalizedSQLiteDateTimeExpr(column string) string {
	return fmt.Sprintf(`replace(substr(CAST(%s AS TEXT), 1, 19), 'T', ' ')`, column)
}

func sqliteUTCDateTime(value time.Time) string {
	return value.UTC().Format(sqliteDateTimeLayout)
}

func localDayStart(value time.Time) time.Time {
	local := value.In(time.Local)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.Local)
}

func localWeekStart(value time.Time) time.Time {
	start := localDayStart(value)
	weekday := int(start.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	return start.AddDate(0, 0, -(weekday - 1))
}
