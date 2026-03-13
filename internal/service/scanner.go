package service

import (
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// GetArchivePageCount is imported from comic_parser.go in the same package.

// ============================================================
// Scanner state
// ============================================================

var (
	syncInProgress bool
	syncMu         sync.Mutex
	lastSyncTime   time.Time
	syncCooldown   = 30 * time.Second

	lastDirMtimes   = make(map[string]time.Time)
	lastDirMtimesMu sync.RWMutex

	bgSyncStarted bool
	bgSyncMu       sync.Mutex

	// Configurable batch sizes
	statBatchSize     = 100
	dbBatchSize       = 500
	fullSyncBatchSize = 50
)

// ============================================================
// Directory change detection
// ============================================================

func directoriesChanged() bool {
	lastDirMtimesMu.RLock()
	defer lastDirMtimesMu.RUnlock()

	for _, dir := range config.GetAllComicsDirs() {
		info, err := os.Stat(dir)
		if err != nil {
			continue
		}
		mtime := info.ModTime()
		lastMtime, ok := lastDirMtimes[dir]
		if !ok || !lastMtime.Equal(mtime) {
			return true
		}
	}
	return false
}

func updateDirMtimes() {
	lastDirMtimesMu.Lock()
	defer lastDirMtimesMu.Unlock()

	newMap := make(map[string]time.Time)
	for _, dir := range config.GetAllComicsDirs() {
		info, err := os.Stat(dir)
		if err != nil {
			continue
		}
		newMap[dir] = info.ModTime()
	}
	lastDirMtimes = newMap
}

// ============================================================
// Quick Sync: scan directories, add new comics, remove stale
// ============================================================

type diskFile struct {
	ID       string
	Filename string
	Title    string
	FileSize int64
}

func quickSync() (added, removed int) {
	allDirs := config.GetAllComicsDirs()
	var filesOnDisk []diskFile

	for _, dir := range allDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}

		// Process entries in batches for stat
		for i := 0; i < len(entries); i += statBatchSize {
			end := i + statBatchSize
			if end > len(entries) {
				end = len(entries)
			}
			batch := entries[i:end]

			for _, entry := range batch {
				if entry.IsDir() {
					continue
				}
				name := entry.Name()
				if !config.IsSupportedArchive(name) {
					continue
				}

				info, err := entry.Info()
				if err != nil {
					continue
				}

				filesOnDisk = append(filesOnDisk, diskFile{
					ID:       store.FilenameToID(name),
					Filename: name,
					Title:    store.FilenameToTitle(name),
					FileSize: info.Size(),
				})
			}
		}
	}

	// Get existing IDs from DB
	dbIDs, err := store.GetAllComicIDs()
	if err != nil {
		log.Printf("[quick-sync] Failed to get DB IDs: %v", err)
		return 0, 0
	}
	dbSet := make(map[string]bool, len(dbIDs))
	for _, id := range dbIDs {
		dbSet[id] = true
	}

	// Find new comics
	fileSet := make(map[string]bool, len(filesOnDisk))
	var toAdd []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}
	for _, f := range filesOnDisk {
		fileSet[f.ID] = true
		if !dbSet[f.ID] {
			toAdd = append(toAdd, struct {
				ID       string
				Filename string
				Title    string
				FileSize int64
			}{f.ID, f.Filename, f.Title, f.FileSize})
		}
	}

	// Batch insert new comics
	if len(toAdd) > 0 {
		for i := 0; i < len(toAdd); i += dbBatchSize {
			end := i + dbBatchSize
			if end > len(toAdd) {
				end = len(toAdd)
			}
			if err := store.BulkCreateComics(toAdd[i:end]); err != nil {
				log.Printf("[quick-sync] Failed to bulk create: %v", err)
			}
		}
	}

	// Find stale comics to remove
	var toRemove []string
	for _, id := range dbIDs {
		if !fileSet[id] {
			toRemove = append(toRemove, id)
		}
	}

	// Batch delete stale comics
	if len(toRemove) > 0 {
		for i := 0; i < len(toRemove); i += dbBatchSize {
			end := i + dbBatchSize
			if end > len(toRemove) {
				end = len(toRemove)
			}
			if err := store.BulkDeleteComicsByIDs(toRemove[i:end]); err != nil {
				log.Printf("[quick-sync] Failed to bulk delete: %v", err)
			}
		}
	}

	if len(toAdd) > 0 || len(toRemove) > 0 {
		log.Printf("[quick-sync] Added %d, removed %d", len(toAdd), len(toRemove))
	}
	return len(toAdd), len(toRemove)
}

// ============================================================
// Full Sync: process archives for actual page counts
// ============================================================

func fullSync() {
	comics, err := store.GetComicsNeedingPageCount(fullSyncBatchSize)
	if err != nil || len(comics) == 0 {
		return
	}

	allDirs := config.GetAllComicsDirs()
	processed := 0

	for _, c := range comics {
		// Find file on disk
		var foundPath string
		for _, dir := range allDirs {
			candidate := filepath.Join(dir, c.Filename)
			if _, err := os.Stat(candidate); err == nil {
				foundPath = candidate
				break
			}
		}

		if foundPath == "" {
			continue
		}

		// Open archive and count image entries
		pageCount, err := GetArchivePageCount(foundPath)
		if err != nil || pageCount <= 0 {
			log.Printf("[full-sync] Failed to parse %s: %v", c.Filename, err)
			_ = store.UpdateComicPageCount(c.ID, -1) // -1 = failed, avoids infinite retry
			continue
		}

		if err := store.UpdateComicPageCount(c.ID, pageCount); err != nil {
			log.Printf("[full-sync] Failed to update %s: %v", c.Filename, err)
			_ = store.UpdateComicPageCount(c.ID, -1)
		} else {
			processed++
		}

		// Yield between archives to limit CPU burst
		time.Sleep(10 * time.Millisecond)
	}

	if processed > 0 {
		log.Printf("[full-sync] Processed %d/%d archives", processed, len(comics))
	}
}

// ============================================================
// Main sync orchestrator
// ============================================================

// SyncComicsToDatabase runs a quick sync if conditions are met.
func SyncComicsToDatabase() {
	syncMu.Lock()
	now := time.Now()

	// Cooldown check
	if now.Sub(lastSyncTime) < syncCooldown {
		syncMu.Unlock()
		return
	}

	// Already running check
	if syncInProgress {
		syncMu.Unlock()
		return
	}

	// Directory change check (skip if no changes after first sync)
	if !lastSyncTime.IsZero() && !directoriesChanged() {
		lastSyncTime = now
		syncMu.Unlock()
		return
	}

	syncInProgress = true
	lastSyncTime = now
	syncMu.Unlock()

	defer func() {
		syncMu.Lock()
		syncInProgress = false
		syncMu.Unlock()
	}()

	quickSync()
	updateDirMtimes()
}

// ============================================================
// Background sync scheduler
// ============================================================

const (
	bgQuickSyncInterval = 60 * time.Second
	bgFullSyncInterval  = 10 * time.Second
)

// StartBackgroundSync starts the background sync goroutines.
// Safe to call multiple times — only starts once.
func StartBackgroundSync() {
	bgSyncMu.Lock()
	defer bgSyncMu.Unlock()

	if bgSyncStarted {
		return
	}
	bgSyncStarted = true

	// Initial quick sync on startup
	go func() {
		SyncComicsToDatabase()
	}()

	// Periodic quick sync
	go func() {
		ticker := time.NewTicker(bgQuickSyncInterval)
		defer ticker.Stop()
		for range ticker.C {
			SyncComicsToDatabase()
		}
	}()

	// Periodic full sync (process page counts)
	go func() {
		// Wait a bit for initial quick sync to finish
		time.Sleep(5 * time.Second)

		ticker := time.NewTicker(bgFullSyncInterval)
		defer ticker.Stop()
		for range ticker.C {
			fullSync()
		}
	}()

	log.Println("[bg-sync] Background sync scheduler started")
}
