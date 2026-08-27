package store

import (
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// DBWriteCoordinatorStats exposes lightweight diagnostics for the serialized
// write gate used by scanner/background maintenance jobs.
type DBWriteCoordinatorStats struct {
	Waiting  int64 `json:"waiting"`
	Active   int64 `json:"active"`
	Executed int64 `json:"executed"`
	PeakWait int64 `json:"peakWait"`
}

var (
	dbWriteCoordinatorMu       sync.Mutex
	dbWriteCoordinatorWaiting  atomic.Int64
	dbWriteCoordinatorActive   atomic.Int64
	dbWriteCoordinatorExecuted atomic.Int64
	dbWriteCoordinatorPeakWait atomic.Int64
)

const (
	dbWriteRetryAttempts = 6
	dbWriteRetryBaseDelay = 20 * time.Millisecond
)

// runSerializedDBWrite is the single writer gate for scanner/background store
// mutations. Expensive file parsing/hashing remains parallel; only the short
// SQLite mutation phase is serialized. This avoids several scanner workers
// competing for SQLite's single write lock while preserving concurrent reads.
//
// SQLITE_BUSY_SNAPSHOT (extended code 517) cannot be fixed by busy_timeout on
// the current transaction: SQLite requires the transaction to be restarted.
// All callers of this coordinator use short/idempotent writes or transactions
// that roll back on error, so retrying the whole callback is the correct
// recovery strategy for transient BUSY/LOCKED failures.
func runSerializedDBWrite(name string, fn func() error) error {
	if fn == nil {
		return nil
	}

	queuedAt := time.Now()
	waiting := dbWriteCoordinatorWaiting.Add(1)
	for {
		peak := dbWriteCoordinatorPeakWait.Load()
		if waiting <= peak || dbWriteCoordinatorPeakWait.CompareAndSwap(peak, waiting) {
			break
		}
	}

	dbWriteCoordinatorMu.Lock()
	dbWriteCoordinatorWaiting.Add(-1)
	dbWriteCoordinatorActive.Add(1)
	waited := time.Since(queuedAt)

	defer func() {
		dbWriteCoordinatorActive.Add(-1)
		dbWriteCoordinatorExecuted.Add(1)
		dbWriteCoordinatorMu.Unlock()
	}()

	if waited >= 500*time.Millisecond {
		log.Printf("[db-writer] %s waited %s for serialized SQLite writer", name, waited.Round(time.Millisecond))
	}

	var err error
	for attempt := 1; attempt <= dbWriteRetryAttempts; attempt++ {
		err = fn()
		if err == nil {
			return nil
		}
		if !isRetryableSQLiteWriteError(err) || attempt == dbWriteRetryAttempts {
			break
		}

		delay := dbWriteRetryBaseDelay << (attempt - 1)
		if delay > 500*time.Millisecond {
			delay = 500 * time.Millisecond
		}
		log.Printf("[db-writer] %s hit transient SQLite contention (attempt %d/%d): %v; retrying in %s",
			name, attempt, dbWriteRetryAttempts, err, delay)
		time.Sleep(delay)
	}

	log.Printf("[db-writer] %s failed after retries: %v", name, err)
	return err
}

func isRetryableSQLiteWriteError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "sqlite_busy") ||
		strings.Contains(msg, "sqlite_locked") ||
		strings.Contains(msg, "database is locked") ||
		strings.Contains(msg, "database table is locked") ||
		strings.Contains(msg, "(517)")
}

// GetDBWriteCoordinatorStats returns a point-in-time diagnostic snapshot.
func GetDBWriteCoordinatorStats() DBWriteCoordinatorStats {
	return DBWriteCoordinatorStats{
		Waiting:  dbWriteCoordinatorWaiting.Load(),
		Active:   dbWriteCoordinatorActive.Load(),
		Executed: dbWriteCoordinatorExecuted.Load(),
		PeakWait: dbWriteCoordinatorPeakWait.Load(),
	}
}
