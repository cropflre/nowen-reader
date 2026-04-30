package service

import (
	"crypto/md5"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/nowen-reader/nowen-reader/internal/archive"
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
// 当 enableImageFolder=true 时，会识别"图片文件夹漫画"：如果某个子目录直接包含
// 多张图片，则将整个目录作为一个漫画入库。novels 目录应当传入 false，避免把
// "全是 .txt 但混入封面图"的小说目录折叠成单条漫画。
func walkDirRecursive(root string, enableImageFolder bool) []diskFile {
	var files []diskFile
	// 记录已被识别为图片文件夹漫画的目录，避免其子文件被重复处理
	imageFolderDirs := make(map[string]bool)

	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 跳过不可访问的目录
		}

		// 对于目录：检查是否为图片文件夹漫画
		if d.IsDir() {
			// 跳过根目录本身
			if path == root {
				return nil
			}
			// 如果父目录已经是图片文件夹漫画，跳过子目录
			parent := filepath.Dir(path)
			if imageFolderDirs[parent] {
				return filepath.SkipDir
			}
			// 仅当启用了"图片文件夹漫画"识别时才检查
			if enableImageFolder && isImageFolderDirect(path) {
				imageFolderDirs[path] = true
				// 将该目录作为一个漫画入库
				relPath, err := filepath.Rel(root, path)
				if err != nil {
					relPath = d.Name()
				}
				relPath = filepath.ToSlash(relPath)
				// 图片文件夹的 filename 以 "/" 结尾，标识其为文件夹类型
				folderFilename := relPath + "/"
				// 计算文件夹总大小
				folderSize := calcDirSize(path)
				files = append(files, diskFile{
					ID:       store.FilenameToID(folderFilename),
					Filename: folderFilename,
					Title:    d.Name(),
					FileSize: folderSize,
				})
				return filepath.SkipDir // 不再递归进入该目录
			}
			return nil
		}

		// 如果当前文件所在目录已被识别为图片文件夹漫画，跳过
		dir := filepath.Dir(path)
		if imageFolderDirs[dir] {
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

// isImageFolderDirect 检查目录是否直接包含图片文件（不递归子目录）。
// 条件：
//  1. 目录中没有任何归档文件（.zip/.cbz/.rar/.pdf/...）
//  2. 目录中没有任何小说文件（.txt/.epub/.mobi/.azw3/.html/...）—— 这些应被视为
//     独立小说，不应折叠成一个文件夹漫画
//  3. 目录中至少存在一个图片文件
//
// 注意：第 2 条非常重要——如果不加这个判定，一个全是 .txt 的小说文件夹只要混入
// 一张封面图，就会被错误折叠成"文件夹漫画"，导致里面的 .txt 全部消失。
func isImageFolderDirect(dirPath string) bool {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return false
	}

	hasImage := false
	imageCount := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		// 跳过隐藏文件
		if strings.HasPrefix(name, ".") {
			continue
		}
		// 如果目录中有归档文件或小说文件，则不视为图片文件夹漫画
		if config.IsSupportedArchive(name) {
			return false
		}
		if config.IsNovelFile(name) {
			return false
		}
		if config.IsImageFile(name) {
			hasImage = true
			imageCount++
		}
	}
	// 至少要有 2 张图片才算漫画文件夹（避免单张封面图就吞掉一个普通目录）
	if imageCount < 2 {
		return false
	}
	return hasImage
}

// calcDirSize 计算目录中所有文件的总大小。
func calcDirSize(dirPath string) int64 {
	var total int64
	filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			total += info.Size()
		}
		return nil
	})
	return total
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

	// 扫描漫画目录（启用图片文件夹漫画识别）
	for _, dir := range allDirs {
		files := walkDirRecursive(dir, true)
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
		// 电子书目录禁用图片文件夹漫画识别——避免全是 .txt 的小说子目录
		// 因为混入了一张封面图就被错误折叠成"文件夹漫画"
		files := walkDirRecursive(dir, false)
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

	// 修正已有记录的类型：严格按来源目录决定类型
	// 漫画库目录的文件 → comic，电子书目录的文件 → novel
	{
		fileSourceMap := make(map[string]string, len(filesOnDisk))
		for _, f := range filesOnDisk {
			fileSourceMap[f.ID] = f.Source
		}
		store.FixComicTypesBySource(fileSourceMap)
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
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[full-sync] PANIC processing %s: %v", item.Filename, r)
							_ = store.UpdateComicPageCount(item.ID, -1)
						}
					}()
					pageCount, err := GetArchivePageCount(item.Path)
					if err != nil || pageCount <= 0 {
						log.Printf("[full-sync] Failed to parse %s: %v", item.Filename, err)
						_ = store.UpdateComicPageCount(item.ID, -1)
						return
					}
					if err := store.UpdateComicPageCount(item.ID, pageCount); err != nil {
						log.Printf("[full-sync] Failed to update %s: %v", item.Filename, err)
						_ = store.UpdateComicPageCount(item.ID, -1)
					} else {
						mu.Lock()
						processed++
						mu.Unlock()
					}

					// 对 epub/mobi/azw3 文件检测内容类型：如果以图片为主则标记为漫画
					// 注意：默认仅对"漫画目录"中的电子书做该检测，避免图文混排教材
					// 被错误识别为漫画。可通过 ScannerConfig.EbookTypeAutoDetect 调整。
					archiveType := archive.DetectType(item.Path)
					if archive.IsEbookType(archiveType) && shouldAutoDetectEbookType(item.Path) {
						if archiveType == archive.TypeEpub {
							if archive.IsImageHeavyEpub(item.Path) {
								log.Printf("[full-sync] Detected image-heavy EPUB, marking as comic: %s", item.Filename)
								_ = store.UpdateComicType(item.ID, "comic")
							}
						} else if archiveType == archive.TypeMobi || archiveType == archive.TypeAzw3 {
							// mobi/azw3 使用纯 Go 解析器直接检测内容类型（无需 Calibre）
							if archive.IsMobiImageHeavy(item.Path) {
								log.Printf("[full-sync] Detected image-heavy %s, marking as comic: %s", archiveType, item.Filename)
								_ = store.UpdateComicType(item.ID, "comic")
							}
						}
					}
				}()
			}
		}()
	}

	// 分发任务
	for _, c := range comics {
		var foundPath string
		for _, dir := range allDirs {
			// 图片文件夹漫画：filename 以 "/" 结尾
			if strings.HasSuffix(c.Filename, "/") {
				candidate := filepath.Join(dir, strings.TrimSuffix(c.Filename, "/"))
				if info, err := os.Stat(candidate); err == nil && info.IsDir() {
					foundPath = candidate
					break
				}
			} else {
				candidate := filepath.Join(dir, c.Filename)
				if _, err := os.Stat(candidate); err == nil {
					foundPath = candidate
					break
				}
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
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[md5-sync] PANIC processing %s: %v", item.Filename, r)
						}
					}()
					// 如果阅读开始了，立即停止 MD5 计算
					if isReadingActive() {
						log.Println("[md5-sync] Paused: active reading session detected")
						return
					}
					f, err := os.Open(item.Path)
					if err != nil {
						log.Printf("[md5-sync] Failed to open %s: %v", item.Filename, err)
						return
					}
					h := md5.New()
					if _, err := io.Copy(h, f); err != nil {
						f.Close()
						log.Printf("[md5-sync] Failed to hash %s: %v", item.Filename, err)
						return
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
				}()
			}
		}()
	}

	for _, c := range comics {
		var foundPath string
		for _, dir := range allDirs {
			// 图片文件夹漫画：filename 以 "/" 结尾，跳过 MD5 计算
			if strings.HasSuffix(c.Filename, "/") {
				candidate := filepath.Join(dir, strings.TrimSuffix(c.Filename, "/"))
				if info, err := os.Stat(candidate); err == nil && info.IsDir() {
					foundPath = candidate
					break
				}
			} else {
				candidate := filepath.Join(dir, c.Filename)
				if _, err := os.Stat(candidate); err == nil {
					foundPath = candidate
					break
				}
			}
		}
		if foundPath == "" {
			continue
		}
		// 图片文件夹不计算 MD5（文件夹没有单一文件哈希的意义）
		if strings.HasSuffix(c.Filename, "/") {
			// 标记为特殊值，表示不需要 MD5
			_ = store.UpdateComicMD5Hash(c.ID, "folder")
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
// 重新检测 mobi/azw3 文件的内容类型
// ============================================================

// shouldAutoDetectEbookType 根据 ScannerConfig.EbookTypeAutoDetect 与文件实际所在目录，
// 决定是否对该电子书做"image-heavy → comic"的自动识别。
//
//	mode = "off"     永远不做（严格按目录决定类型）
//	mode = "comics"  仅对位于"漫画目录"中的文件做（默认；保护小说目录里的图文教材不被误判）
//	mode = "all"     对所有电子书都做（旧版行为，可能误把图文教材当漫画）
func shouldAutoDetectEbookType(absPath string) bool {
	mode := config.GetSiteConfig().ScannerConfig.EbookAutoDetectMode()
	switch mode {
	case "off":
		return false
	case "all":
		return true
	default: // "comics"
		return config.ClassifyPathSource(absPath) == "comics"
	}
}

// repairMisclassifiedFolderComics 修复历史上被错误折叠为"图片文件夹漫画"
// 的目录条目。判定为"误折叠"的条件（满足任一即删除该目录条目）：
//  1. 目录实际位于"电子书目录"中——这类目录下的 .txt/.epub 应作为独立小说入库
//  2. 目录在磁盘上不再存在
//  3. 目录里实际包含 novel 文件（.txt/.epub/.mobi/.azw3/.html）——
//     说明里面是小说而非图片漫画，被早期版本错误吞并
//
// 删除的只是数据库条目，不会触碰磁盘文件。删除后下次 quickSync 会把目录里的
// 小说文件重新加回来（每个 .txt 一条记录）。
func repairMisclassifiedFolderComics() {
	folders, err := store.GetFolderComics()
	if err != nil {
		log.Printf("[repair-folder] 查询文件夹漫画失败: %v", err)
		return
	}
	if len(folders) == 0 {
		return
	}

	allDirs := config.GetAllScanDirs()
	deleted := 0

	for _, c := range folders {
		// 还原磁盘路径：filename 形如 "TXT格式/1/"，需要拼接到某个根目录下
		rel := strings.TrimSuffix(c.Filename, "/")
		var foundPath string
		for _, dir := range allDirs {
			candidate := filepath.Join(dir, rel)
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				foundPath = candidate
				break
			}
		}

		shouldDelete := false
		reason := ""
		if foundPath == "" {
			// 磁盘上找不到——可能用户已经移走或重命名，旧记录无意义
			shouldDelete = true
			reason = "directory not found on disk"
		} else if config.ClassifyPathSource(foundPath) == "novels" {
			// 位于电子书目录——绝不应该是"图片文件夹漫画"
			shouldDelete = true
			reason = "directory is in novels source"
		} else if dirContainsNovelFiles(foundPath) {
			// 目录里实际包含小说文件——之前被错误吞并
			shouldDelete = true
			reason = "directory contains novel files"
		}

		if shouldDelete {
			if err := store.DeleteComic(c.ID, allDirs, false); err == nil {
				deleted++
				log.Printf("[repair-folder] 删除误折叠目录条目: %s (%s)", c.Filename, reason)
			}
		}
	}

	if deleted > 0 {
		log.Printf("[repair-folder] 共修复 %d 个误折叠的目录条目，下次同步将重新展开里面的小说文件", deleted)
	}
}

// dirContainsNovelFiles 检查目录顶层是否直接包含小说文件（.txt/.epub/.mobi/...）。
// 不递归子目录。
func dirContainsNovelFiles(dirPath string) bool {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if config.IsNovelFile(name) {
			return true
		}
	}
	return false
}

// RedetectEbookTypes 重新核对已入库的电子书（EPUB/MOBI/AZW3）类型：
//  1. 把"位于小说目录但被标记为 comic"的电子书回滚为 novel —— 解决历史上图文教材
//     被 image-heavy 检测误识别为漫画的问题（自愈）。
//  2. 在配置允许的范围内，对位于漫画目录的 mobi/azw3 重新做内容检测，
//     若图片占比高则升级为 comic。
//
// 返回总共修正的记录数。
func RedetectEbookTypes() int {
	mode := config.GetSiteConfig().ScannerConfig.EbookAutoDetectMode()
	allDirs := config.GetAllScanDirs()
	fixed := 0

	// ---------------------------------------------------------
	// 阶段 1：回滚误判 —— 把"在小说目录里却被标为 comic"的电子书改回 novel
	// 该阶段在所有 mode 下都执行（包括 off / all），以"目录"作为最高权威修正历史脏数据。
	// ---------------------------------------------------------
	comicEbooks, err := store.GetEbookComicsByType("comic")
	if err != nil {
		log.Printf("[redetect] Error querying comic ebooks: %v", err)
	} else if len(comicEbooks) > 0 {
		for _, c := range comicEbooks {
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
			if config.ClassifyPathSource(foundPath) == "novels" {
				log.Printf("[redetect] ↩ Reverting ebook in novels dir back to novel: %s", c.Filename)
				if err := store.UpdateComicType(c.ID, "novel"); err == nil {
					fixed++
				}
			}
		}
	}

	// ---------------------------------------------------------
	// 阶段 2：把"小说目录的电子书 type=novel，但 mode=all 时仍可升级"——
	// 仅在 mode != "off" 时进行，并且每个文件还要通过 shouldAutoDetectEbookType 二次校验。
	// ---------------------------------------------------------
	if mode == "off" {
		if fixed > 0 {
			log.Printf("[redetect] mode=off, only reverted %d misclassified ebook(s)", fixed)
		}
		return fixed
	}

	novelMobi, err := store.GetNovelsNeedingTypeRedetect()
	if err != nil {
		log.Printf("[redetect] Error querying novels: %v", err)
		return fixed
	}
	if len(novelMobi) == 0 {
		return fixed
	}

	log.Printf("[redetect] Found %d mobi/azw3 files with type=novel, checking content (mode=%s)...", len(novelMobi), mode)

	reclassified := 0
	for _, c := range novelMobi {
		// 查找文件路径
		var foundPath string
		for _, dir := range allDirs {
			candidate := filepath.Join(dir, c.Filename)
			if _, err := os.Stat(candidate); err == nil {
				foundPath = candidate
				break
			}
		}
		if foundPath == "" {
			log.Printf("[redetect] File not found on disk: %s", c.Filename)
			continue
		}

		// 跟随用户配置：默认仅对漫画目录里的电子书升级为 comic
		if !shouldAutoDetectEbookType(foundPath) {
			continue
		}

		archiveType := archive.DetectType(foundPath)
		if archiveType != archive.TypeMobi && archiveType != archive.TypeAzw3 {
			log.Printf("[redetect] Skipping %s: detected as %s, not mobi/azw3", c.Filename, archiveType)
			continue
		}

		// 使用纯 Go 解析器直接检测内容类型（无需 Calibre）
		log.Printf("[redetect] Checking mobi/azw3 content type: %s", c.Filename)
		if archive.IsMobiImageHeavy(foundPath) {
			log.Printf("[redetect] ✓ Detected image-heavy %s, reclassifying as comic: %s", archiveType, c.Filename)
			_ = store.UpdateComicType(c.ID, "comic")
			reclassified++
		} else {
			log.Printf("[redetect] ✗ Not image-heavy, keeping as novel: %s", c.Filename)
		}
	}

	if reclassified > 0 {
		log.Printf("[redetect] Reclassified %d/%d mobi/azw3 files from novel to comic", reclassified, len(novelMobi))
	} else {
		log.Printf("[redetect] No files reclassified (checked %d files)", len(novelMobi))
	}
	return fixed + reclassified
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

	// 修复历史脏数据：把被错误折叠为"图片文件夹漫画"的小说目录条目删除，
	// 让紧接着的 quickSync 重新把里面的 .txt/.epub 等小说文件作为独立条目加回来。
	repairMisclassifiedFolderComics()

	added, _ := quickSync()
	updateDirMtimes()

	// P3: 扫描新增文件后，自动按文件夹分组（仅在有新增时执行）
	if added > 0 {
		go func() {
			created, err := store.AutoGroupByDirectory()
			if err != nil {
				log.Printf("[auto-group] 自动分组失败: %v", err)
			} else if created > 0 {
				log.Printf("[auto-group] 自动创建了 %d 个系列", created)
			}
		}()
	}

	// 重新检测已入库的 mobi/azw3 文件的内容类型（修正错误分类）
	go RedetectEbookTypes()
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
					if config.IsSupportedFile(name) || config.IsImageFile(name) {
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
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[bg-sync] PANIC in initial sync: %v", r)
			}
		}()
		SyncComicsToDatabase()
	}()

	// 启动 fsnotify 文件监控（实时响应文件变更）
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[bg-sync] PANIC in fsnotify watcher: %v", r)
			}
		}()
		startFSWatcher()
	}()

	// Periodic quick sync (作为 fsnotify 的兜底保障)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[bg-sync] PANIC in periodic quick sync: %v", r)
			}
		}()
		ticker := time.NewTicker(getQuickSyncInterval())
		defer ticker.Stop()
		for range ticker.C {
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[bg-sync] PANIC during quick sync tick: %v", r)
					}
				}()
				SyncComicsToDatabase()
			}()
		}
	}()

	// Periodic full sync (process page counts)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[bg-sync] PANIC in periodic full sync: %v", r)
			}
		}()
		// Wait a bit for initial quick sync to finish
		time.Sleep(5 * time.Second)

		ticker := time.NewTicker(getFullSyncInterval())
		defer ticker.Stop()
		for range ticker.C {
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[bg-sync] PANIC during full sync tick: %v", r)
					}
				}()
				// 有活跃阅读会话时跳过 fullSync，避免 IO 竞争
				if isReadingActive() {
					log.Println("[bg-sync] Skipped full sync: active reading session")
					return
				}
				fullSync()
				md5Sync() // 在 full sync 之后计算 MD5
			}()
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
			// 图片文件夹漫画：filename 以 "/" 结尾
			if strings.HasSuffix(c.Filename, "/") {
				fp := filepath.Join(dir, strings.TrimSuffix(c.Filename, "/"))
				if info, err := os.Stat(fp); err == nil && info.IsDir() {
					found = true
					break
				}
			} else {
				fp := filepath.Join(dir, c.Filename)
				if _, err := os.Stat(fp); err == nil {
					found = true
					break
				}
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
