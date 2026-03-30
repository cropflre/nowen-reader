package service

import (
	"crypto/md5"
	"fmt"
	"io"
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

	// 阅读时暂停扫描：当有活跃阅读会话时，暂停后台扫描以减少 IO 竞争
	activeReaders   int
	activeReadersMu sync.Mutex
)

// 从配置文件读取可配置参数
func getScannerCooldown() time.Duration {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig != nil && cfg.ScannerConfig.SyncCooldownSec > 0 {
		return time.Duration(cfg.ScannerConfig.SyncCooldownSec) * time.Second
	}
	return 30 * time.Second
}

// AcquireReadingLock 在开始阅读时调用，暂停后台扫描以减少 IO 竞争。
func AcquireReadingLock() {
	activeReadersMu.Lock()
	activeReaders++
	activeReadersMu.Unlock()
}

// ReleaseReadingLock 在结束阅读时调用，恢复后台扫描。
func ReleaseReadingLock() {
	activeReadersMu.Lock()
	if activeReaders > 0 {
		activeReaders--
	}
	activeReadersMu.Unlock()
}

// isReadingActive 判断是否有活跃的阅读会话。
func isReadingActive() bool {
	activeReadersMu.Lock()
	defer activeReadersMu.Unlock()
	return activeReaders > 0
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

// directoriesChanged 递归检查所有扫描目录及其子目录的 mtime 变更。
// 这解决了在子目录中添加文件时，父目录 mtime 不变导致无法检测到变更的问题。
// 特别适用于 NAS/NFS/CIFS 等文件系统，这些系统上 fsnotify 可能不工作。
func directoriesChanged() bool {
	lastDirMtimesMu.RLock()
	defer lastDirMtimesMu.RUnlock()

	for _, dir := range config.GetAllScanDirs() {
		changed := false
		filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil // 跳过不可访问的目录
			}
			if !d.IsDir() {
				return nil // 只检查目录
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			mtime := info.ModTime()
			lastMtime, ok := lastDirMtimes[path]
			if !ok || !lastMtime.Equal(mtime) {
				changed = true
				return filepath.SkipAll // 发现变更，立即停止遍历
			}
			return nil
		})
		if changed {
			return true
		}
	}
	return false
}

// updateDirMtimes 递归记录所有扫描目录及其子目录的 mtime。
func updateDirMtimes() {
	lastDirMtimesMu.Lock()
	defer lastDirMtimesMu.Unlock()

	newMap := make(map[string]time.Time)
	for _, dir := range config.GetAllScanDirs() {
		filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if !d.IsDir() {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			newMap[path] = info.ModTime()
			return nil
		})
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
	Source   string // "comics" or "novels" — 来源目录类型
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
	novelDirs := config.GetAllNovelsDirs()
	// 构建电子书目录集合，用于判断文件来源
	novelDirSet := make(map[string]bool, len(novelDirs))
	for _, d := range novelDirs {
		novelDirSet[d] = true
	}
	var filesOnDisk []diskFile

	// 扫描漫画目录
	for _, dir := range allDirs {
		files := walkDirRecursive(dir)
		for i := range files {
			files[i].Source = "comics"
		}
		filesOnDisk = append(filesOnDisk, files...)
	}

	// 扫描电子书目录（跳过与漫画目录重复的目录）
	for _, dir := range novelDirs {
		// 如果电子书目录已经在漫画目录中，跳过以避免重复扫描
		alreadyScanned := false
		for _, cd := range allDirs {
			if cd == dir {
				alreadyScanned = true
				break
			}
		}
		if alreadyScanned {
			continue
		}
		files := walkDirRecursive(dir)
		for i := range files {
			files[i].Source = "novels"
		}
		filesOnDisk = append(filesOnDisk, files...)
	}

	if len(filesOnDisk) == 0 {
		return 0, 0
	}

	// ============================================================
	// 使用 SQLite 临时表做差异对比（替代内存中两个 map 对比）
	// 优势：万级记录时避免在 Go 中构建两个大 map（省约 20MB 内存）
	// ============================================================
	tx, err := store.DB().Begin()
	if err != nil {
		log.Printf("[quick-sync] Failed to begin transaction: %v", err)
		return 0, 0
	}
	defer tx.Rollback()

	// 创建临时表（仅在本连接/事务中存在）
	if _, err := tx.Exec(`CREATE TEMP TABLE IF NOT EXISTS "_DiskFiles" ("id" TEXT PRIMARY KEY, "filename" TEXT, "title" TEXT, "fileSize" INTEGER)`); err != nil {
		log.Printf("[quick-sync] Failed to create temp table: %v", err)
		return 0, 0
	}
	// 清空临时表（防止上次残留）
	tx.Exec(`DELETE FROM "_DiskFiles"`)

	// 批量插入磁盘文件到临时表
	insertStmt, err := tx.Prepare(`INSERT OR IGNORE INTO "_DiskFiles" ("id", "filename", "title", "fileSize") VALUES (?, ?, ?, ?)`)
	if err != nil {
		log.Printf("[quick-sync] Failed to prepare insert: %v", err)
		return 0, 0
	}
	defer insertStmt.Close()

	for _, f := range filesOnDisk {
		if _, err := insertStmt.Exec(f.ID, f.Filename, f.Title, f.FileSize); err != nil {
			log.Printf("[quick-sync] Failed to insert temp file: %v", err)
		}
	}

	// SQL JOIN: 找出磁盘有但数据库没有的文件（新增）
	rows, err := tx.Query(`SELECT d."id", d."filename", d."title", d."fileSize" FROM "_DiskFiles" d LEFT JOIN "Comic" c ON d."id" = c."id" WHERE c."id" IS NULL`)
	if err != nil {
		log.Printf("[quick-sync] Failed to query new comics: %v", err)
		return 0, 0
	}
	var toAdd []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}
	for rows.Next() {
		var item struct {
			ID       string
			Filename string
			Title    string
			FileSize int64
		}
		if rows.Scan(&item.ID, &item.Filename, &item.Title, &item.FileSize) == nil {
			toAdd = append(toAdd, item)
		}
	}
	rows.Close()

	// SQL JOIN: 找出数据库有但磁盘没有的文件（过期待删除）
	rows2, err := tx.Query(`SELECT c."id" FROM "Comic" c LEFT JOIN "_DiskFiles" d ON c."id" = d."id" WHERE d."id" IS NULL`)
	if err != nil {
		log.Printf("[quick-sync] Failed to query stale comics: %v", err)
		return 0, 0
	}
	var toRemove []string
	for rows2.Next() {
		var id string
		if rows2.Scan(&id) == nil {
			toRemove = append(toRemove, id)
		}
	}
	rows2.Close()

	// 清理临时表并提交事务
	tx.Exec(`DROP TABLE IF EXISTS "_DiskFiles"`)
	tx.Commit()

	// Batch insert new comics
	if len(toAdd) > 0 {
		// 构建文件 ID 到来源的映射
		fileSourceMap := make(map[string]string, len(filesOnDisk))
		for _, f := range filesOnDisk {
			fileSourceMap[f.ID] = f.Source
		}

		for i := 0; i < len(toAdd); i += dbBatchSize {
			end := i + dbBatchSize
			if end > len(toAdd) {
				end = len(toAdd)
			}
			if err := store.BulkCreateComicsWithSource(toAdd[i:end], fileSourceMap); err != nil {
				log.Printf("[quick-sync] Failed to bulk create: %v", err)
			}
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
	comics, err := store.GetComicsNeedingPageCount(getFullSyncBatchSize())
	if err != nil || len(comics) == 0 {
		return
	}

	allDirs := config.GetAllScanDirs()

	// 使用 worker pool 并发处理（默认 4 个并发 worker）
	const numWorkers = 4
	type workItem struct {
		ID       string
		Filename string
		Path     string
	}

	jobs := make(chan workItem, len(comics))
	var wg sync.WaitGroup
	var processed int64
	var mu sync.Mutex

	// 启动 worker
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				pageCount, err := GetArchivePageCount(item.Path)
				if err != nil || pageCount <= 0 {
					log.Printf("[full-sync] Failed to parse %s: %v", item.Filename, err)
					_ = store.UpdateComicPageCount(item.ID, -1)
					continue
				}
				if err := store.UpdateComicPageCount(item.ID, pageCount); err != nil {
					log.Printf("[full-sync] Failed to update %s: %v", item.Filename, err)
					_ = store.UpdateComicPageCount(item.ID, -1)
				} else {
					mu.Lock()
					processed++
					mu.Unlock()
				}
			}
		}()
	}

	// 分发任务
	for _, c := range comics {
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
		jobs <- workItem{ID: c.ID, Filename: c.Filename, Path: foundPath}
	}
	close(jobs)
	wg.Wait()

	if processed > 0 {
		log.Printf("[full-sync] Processed %d/%d archives (workers: %d)", processed, len(comics), numWorkers)
	}
}

// ============================================================
// MD5 Sync: 为缺少 MD5 哈希的漫画计算文件 MD5
// ============================================================

func getMD5Workers() int {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig != nil && cfg.ScannerConfig.MD5Workers > 0 {
		return cfg.ScannerConfig.MD5Workers
	}
	return 2 // 默认 2 个并发，对网盘映射更友好
}

func md5Sync() {
	// 有活跃阅读会话时跳过 MD5 计算，避免 IO 竞争
	if isReadingActive() {
		log.Println("[md5-sync] Skipped: active reading session")
		return
	}

	comics, err := store.GetComicsNeedingMD5(getFullSyncBatchSize())
	if err != nil || len(comics) == 0 {
		return
	}

	allDirs := config.GetAllScanDirs()

	numWorkers := getMD5Workers()
	type workItem struct {
		ID       string
		Filename string
		Path     string
	}

	jobs := make(chan workItem, len(comics))
	var wg sync.WaitGroup
	var processed int64
	var mu sync.Mutex

	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				// 如果阅读开始了，立即停止 MD5 计算
				if isReadingActive() {
					log.Println("[md5-sync] Paused: active reading session detected")
					return
				}
				f, err := os.Open(item.Path)
				if err != nil {
					log.Printf("[md5-sync] Failed to open %s: %v", item.Filename, err)
					continue
				}
				h := md5.New()
				if _, err := io.Copy(h, f); err != nil {
					f.Close()
					log.Printf("[md5-sync] Failed to hash %s: %v", item.Filename, err)
					continue
				}
				f.Close()
				hash := fmt.Sprintf("%x", h.Sum(nil))
				if err := store.UpdateComicMD5Hash(item.ID, hash); err != nil {
					log.Printf("[md5-sync] Failed to update %s: %v", item.Filename, err)
				} else {
					mu.Lock()
					processed++
					mu.Unlock()
				}
			}
		}()
	}

	for _, c := range comics {
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
		jobs <- workItem{ID: c.ID, Filename: c.Filename, Path: foundPath}
	}
	close(jobs)
	wg.Wait()

	if processed > 0 {
		log.Printf("[md5-sync] Computed MD5 for %d/%d files (workers: %d)", processed, len(comics), numWorkers)
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

	// 递归添加所有目录（漫画 + 电子书）
	for _, dir := range config.GetAllScanDirs() {
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
			// 有活跃阅读会话时跳过 fullSync，避免 IO 竞争
			if isReadingActive() {
				log.Println("[bg-sync] Skipped full sync: active reading session")
				continue
			}
			fullSync()
			md5Sync() // 在 full sync 之后计算 MD5
		}
	}()

	log.Println("[bg-sync] Background sync scheduler started (fsnotify + polling fallback)")
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

	allDirs := config.GetAllScanDirs()
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
