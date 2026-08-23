package store

import (
	"log"
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

// runSerializedDBWrite is the single writer gate for scanner/background store
// mutations. Expensive file parsing/hashing remains parallel; only the short
// SQLite mutation phase is serialized. This avoids several scanner workers
// competing for SQLite's single write lock while preserving concurrent reads.
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

	err := fn()
	if err != nil {
		log.Printf("[db-writer] %s failed: %v", name, err)
	}
	return err
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
