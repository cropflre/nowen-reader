package service

import (
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
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

	lastDirMtimes   = make(map[string]time.Time)
	lastDirMtimesMu sync.RWMutex

	bgSyncStarted bool
	bgSyncMu      sync.Mutex

	// Configurable batch sizes
	statBatchSize = 100
	dbBatchSize   = 500

	// fsnotify watcher
	fsWatcher   *fsnotify.Watcher
	fsWatcherMu sync.Mutex

	// 防抖：文件变更后延迟触发同步
	fsDebounceTicker *time.Timer
	fsDebounceMu     sync.Mutex
)

// 从配置文件读取可配置参数
func getScannerCooldown() time.Duration {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig != nil && cfg.ScannerConfig.SyncCooldownSec > 0 {
		return time.Duration(cfg.ScannerConfig.SyncCooldownSec) * time.Second
	}
	return 30 * time.Second
}

func getFSDebounceDelay() time.Duration {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig != nil && cfg.ScannerConfig.FSDebounceMs > 0 {
		return time.Duration(cfg.ScannerConfig.FSDebounceMs) * time.Millisecond
	}
	return 2 * time.Second
}

func getFullSyncBatchSize() int {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig != nil && cfg.ScannerConfig.FullSyncBatchSize > 0 {
		return cfg.ScannerConfig.FullSyncBatchSize
	}
	return 50
}

func getQuickSyncInterval() time.Duration {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig != nil && cfg.ScannerConfig.QuickSyncIntervalSec > 0 {
		return time.Duration(cfg.ScannerConfig.QuickSyncIntervalSec) * time.Second
	}
	return 60 * time.Second
}

func getFullSyncInterval() time.Duration {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig != nil && cfg.ScannerConfig.FullSyncIntervalSec > 0 {
		return time.Duration(cfg.ScannerConfig.FullSyncIntervalSec) * time.Second
	}
	return 120 * time.Second
}

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
// 递归扫描目录
// ============================================================

type diskFile struct {
	ID       string
	Filename string
	Title    string
	FileSize int64
}

// walkDirRecursive 递归遍历目录中的所有支持文件。
func walkDirRecursive(root string) []diskFile {
	var files []diskFile

	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 跳过不可访问的目录
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if !config.IsSupportedFile(name) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		// 使用相对于 root 的路径作为文件名（保留子目录结构）
		relPath, err := filepath.Rel(root, path)
		if err != nil {
			relPath = name
		}
		// 统一使用正斜杠
		relPath = filepath.ToSlash(relPath)

		files = append(files, diskFile{
			ID:       store.FilenameToID(relPath),
			Filename: relPath,
			Title:    store.FilenameToTitle(name),
			FileSize: info.Size(),
		})
		return nil
	})

	return files
}

// ============================================================
// Quick Sync: scan directories, add new comics, remove stale
// ============================================================

func quickSync() (added, removed int) {
	allDirs := config.GetAllComicsDirs()
	var filesOnDisk []diskFile

	for _, dir := range allDirs {
		// 递归扫描子目录
		files := walkDirRecursive(dir)
		filesOnDisk = append(filesOnDisk, files...)
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

	// 对新增的漫画自动检测系列信息
	if len(toAdd) > 0 {
		go autoDetectSeries(toAdd)
	}

	return len(toAdd), len(toRemove)
}

// ============================================================
// Full Sync: process archives for actual page counts
// ============================================================

func fullSync() {
	comics, err := store.GetComicsNeedingPageCount(getFullSyncBatchSize())
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
	if now.Sub(lastSyncTime) < getScannerCooldown() {
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
// fsnotify 文件系统监控
// ============================================================

// triggerDebouncedSync 防抖触发同步，避免短时间内大量文件变更触发多次同步。
func triggerDebouncedSync() {
	fsDebounceMu.Lock()
	defer fsDebounceMu.Unlock()

	if fsDebounceTicker != nil {
		fsDebounceTicker.Stop()
	}
	fsDebounceTicker = time.AfterFunc(getFSDebounceDelay(), func() {
		log.Println("[fsnotify] File change detected, triggering sync...")
		// 重置冷却时间以允许立即同步
		syncMu.Lock()
		lastSyncTime = time.Time{}
		syncMu.Unlock()

		SyncComicsToDatabase()
	})
}

// watchDirectoriesRecursive 递归添加目录到 watcher。
func watchDirectoriesRecursive(watcher *fsnotify.Watcher, root string) {
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if err := watcher.Add(path); err != nil {
				log.Printf("[fsnotify] Failed to watch %s: %v", path, err)
			}
		}
		return nil
	})
}

// startFSWatcher 初始化并启动文件系统监控。
func startFSWatcher() {
	fsWatcherMu.Lock()
	defer fsWatcherMu.Unlock()

	if fsWatcher != nil {
		return // 已启动
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("[fsnotify] Failed to create watcher: %v (falling back to polling)", err)
		return
	}
	fsWatcher = watcher

	// 递归添加所有漫画目录
	for _, dir := range config.GetAllComicsDirs() {
		if _, err := os.Stat(dir); err == nil {
			watchDirectoriesRecursive(watcher, dir)
			log.Printf("[fsnotify] Watching directory: %s (recursive)", dir)
		}
	}

	// 事件处理协程
	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}

				// 只关注文件创建、删除和重命名事件
				if event.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) != 0 {
					name := filepath.Base(event.Name)

					// 新建子目录时也需要监控
					if event.Op&fsnotify.Create != 0 {
						if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
							watchDirectoriesRecursive(watcher, event.Name)
							log.Printf("[fsnotify] New subdirectory detected, watching: %s", event.Name)
						}
					}

					// 支持的文件类型变更触发同步
					if config.IsSupportedFile(name) {
						triggerDebouncedSync()
					}
				}

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("[fsnotify] Watcher error: %v", err)
			}
		}
	}()

	log.Println("[fsnotify] File system watcher started ✅")
}

// ============================================================
// Background sync scheduler
// ============================================================

const (
	bgQuickSyncInterval_deprecated = 0 // 已不使用，改为从配置读取
	bgFullSyncInterval_deprecated  = 0
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

	// 启动 fsnotify 文件监控（实时响应文件变更）
	go startFSWatcher()

	// Periodic quick sync (作为 fsnotify 的兜底保障)
	go func() {
		ticker := time.NewTicker(getQuickSyncInterval())
		defer ticker.Stop()
		for range ticker.C {
			SyncComicsToDatabase()
		}
	}()

	// Periodic full sync (process page counts)
	go func() {
		// Wait a bit for initial quick sync to finish
		time.Sleep(5 * time.Second)

		ticker := time.NewTicker(getFullSyncInterval())
		defer ticker.Stop()
		for range ticker.C {
			fullSync()
		}
	}()

	log.Println("[bg-sync] Background sync scheduler started (fsnotify + polling fallback)")
}

// autoDetectSeries 对新增的漫画自动检测系列信息（在后台运行）。
func autoDetectSeries(comics []struct {
	ID       string
	Filename string
	Title    string
	FileSize int64
}) {
	updated := 0
	for _, c := range comics {
		info := DetectSeries(c.Filename)
		if info != nil {
			fields := map[string]interface{}{
				"seriesName":  info.SeriesName,
				"seriesIndex": info.SeriesIndex,
			}
			if err := store.UpdateComicFields(c.ID, fields); err == nil {
				updated++
			}
		}
	}
	if updated > 0 {
		log.Printf("[series-detect] Auto-detected series info for %d/%d comics", updated, len(comics))
	}
}

// ============================================================
// 清理无效漫画（文件已不存在的数据库记录）
// ============================================================

// CleanupInvalidComics 检查数据库中所有漫画记录，删除磁盘上文件已不存在的记录。
// 返回被删除的漫画数量。
func CleanupInvalidComics() (int, error) {
	allComics, err := store.GetAllComicIDsAndFilenames()
	if err != nil {
		return 0, err
	}

	allDirs := config.GetAllComicsDirs()
	var invalidIDs []string

	for _, c := range allComics {
		found := false
		for _, dir := range allDirs {
			fp := filepath.Join(dir, c.Filename)
			if _, err := os.Stat(fp); err == nil {
				found = true
				break
			}
		}
		if !found {
			invalidIDs = append(invalidIDs, c.ID)
		}
	}

	if len(invalidIDs) == 0 {
		return 0, nil
	}

	// 批量删除无效记录
	for i := 0; i < len(invalidIDs); i += dbBatchSize {
		end := i + dbBatchSize
		if end > len(invalidIDs) {
			end = len(invalidIDs)
		}
		if err := store.BulkDeleteComicsByIDs(invalidIDs[i:end]); err != nil {
			log.Printf("[cleanup] Failed to bulk delete invalid comics: %v", err)
			return 0, err
		}
	}

	log.Printf("[cleanup] Removed %d invalid comics (files not found on disk)", len(invalidIDs))
	return len(invalidIDs), nil
}
