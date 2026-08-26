package service

import (
	"log"
	"runtime"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

const (
	seriesMaintenancePollInterval = 2 * time.Minute
	seriesMaintenanceInitialDelay = 20 * time.Second
	// Until directory-series construction is fully streaming, never feed more
	// than this many source rows into the legacy DetectComicSeries function.
	// Large libraries remain readable as flat items instead of risking OOM.
	seriesAutoRebuildItemLimit = 5000
)

var (
	seriesMaintenanceOnce sync.Once
	seriesRebuildQueue     = make(chan string, 32)
	seriesPendingMu        sync.Mutex
	seriesPending          = map[string]bool{}
)

// StartSeriesMaintenance starts one serial background worker. Shelf GET
// requests never rebuild Series; scanner/manual changes only enqueue work.
func StartSeriesMaintenance() {
	seriesMaintenanceOnce.Do(func() {
		go seriesRebuildWorker()
		go seriesMaintenancePoller()
	})
}

// ScheduleComicSeriesRebuild enqueues a library rebuild and coalesces repeated
// notifications for the same library. An empty library ID means "inspect all
// changed libraries", not "rebuild everything synchronously".
func ScheduleComicSeriesRebuild(libraryID string) {
	StartSeriesMaintenance()
	if libraryID == "" {
		go scheduleChangedSeriesLibraries(true)
		return
	}

	seriesPendingMu.Lock()
	if seriesPending[libraryID] {
		seriesPendingMu.Unlock()
		return
	}
	seriesPending[libraryID] = true
	seriesPendingMu.Unlock()

	select {
	case seriesRebuildQueue <- libraryID:
	default:
		seriesPendingMu.Lock()
		delete(seriesPending, libraryID)
		seriesPendingMu.Unlock()
		log.Printf("[series-maintenance] queue full; deferred library=%s until next poll", libraryID)
	}
}

func seriesRebuildWorker() {
	for libraryID := range seriesRebuildQueue {
		func() {
			defer func() {
				seriesPendingMu.Lock()
				delete(seriesPending, libraryID)
				seriesPendingMu.Unlock()
			}()

			fingerprints, err := store.ListComicSeriesLibraryFingerprints()
			if err != nil {
				log.Printf("[series-maintenance] inspect library=%s failed: %v", libraryID, err)
				return
			}
			itemCount := -1
			for _, fp := range fingerprints {
				if fp.LibraryID == libraryID {
					itemCount = fp.ItemCount
					break
				}
			}
			if itemCount < 0 {
				return // library was deleted/disabled or is no longer a comic library
			}
			if itemCount > seriesAutoRebuildItemLimit {
				log.Printf("[series-maintenance] skip automatic rebuild library=%s items=%d limit=%d; shelf stays available without forcing a full in-memory rebuild", libraryID, itemCount, seriesAutoRebuildItemLimit)
				return
			}

			before := readSeriesMemorySnapshot()
			started := time.Now()
			log.Printf("[series-maintenance] rebuild start library=%s items=%d heap=%dMB sys=%dMB", libraryID, itemCount, before.heapMB, before.sysMB)
			if err := RebuildComicSeriesForLibrary(libraryID); err != nil {
				log.Printf("[series-maintenance] rebuild failed library=%s after=%s: %v", libraryID, time.Since(started).Round(time.Millisecond), err)
				return
			}
			after := readSeriesMemorySnapshot()
			log.Printf("[series-maintenance] rebuild complete library=%s items=%d duration=%s heap=%dMB sys=%dMB", libraryID, itemCount, time.Since(started).Round(time.Millisecond), after.heapMB, after.sysMB)
		}()
	}
}

type seriesMemorySnapshot struct {
	heapMB uint64
	sysMB  uint64
}

func readSeriesMemorySnapshot() seriesMemorySnapshot {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return seriesMemorySnapshot{heapMB: m.HeapAlloc / 1024 / 1024, sysMB: m.Sys / 1024 / 1024}
}

func seriesMaintenancePoller() {
	time.Sleep(seriesMaintenanceInitialDelay)
	last := map[string]string{}

	for {
		fingerprints, err := store.ListComicSeriesLibraryFingerprints()
		if err != nil {
			log.Printf("[series-maintenance] fingerprint poll failed: %v", err)
		} else {
			for _, fp := range fingerprints {
				previous, seen := last[fp.LibraryID]
				// On first observation, only bootstrap a small library that has no
				// projection yet. Existing projections are trusted until content changes.
				if (!seen && fp.ItemCount >= 2 && fp.SeriesCount == 0) || (seen && previous != fp.Fingerprint) {
					ScheduleComicSeriesRebuild(fp.LibraryID)
				}
				last[fp.LibraryID] = fp.Fingerprint
			}
			for id := range last {
				found := false
				for _, fp := range fingerprints {
					if fp.LibraryID == id {
						found = true
						break
					}
				}
				if !found {
					delete(last, id)
				}
			}
		}
		time.Sleep(seriesMaintenancePollInterval)
	}
}

// scheduleChangedSeriesLibraries is used by global/manual scan notifications.
// force schedules every bounded comic library; otherwise the periodic poller
// remains responsible for change detection.
func scheduleChangedSeriesLibraries(force bool) {
	if !force {
		return
	}
	fingerprints, err := store.ListComicSeriesLibraryFingerprints()
	if err != nil {
		log.Printf("[series-maintenance] schedule all failed: %v", err)
		return
	}
	for _, fp := range fingerprints {
		if fp.ItemCount >= 2 {
			ScheduleComicSeriesRebuild(fp.LibraryID)
		}
	}
}
