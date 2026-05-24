package handler

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// DataAdminHandler 数据管理模块（缓存 / 数据库 / 磁盘 / 阈值）。
type DataAdminHandler struct{}

// NewDataAdminHandler creates a new DataAdminHandler.
func NewDataAdminHandler() *DataAdminHandler {
	return &DataAdminHandler{}
}

// ============================================================
// 数据结构
// ============================================================

type cacheBucketInfo struct {
	Key       string `json:"key"`       // thumbnails / pages / converted / other / data
	Label     string `json:"label"`     // 中文展示名
	Path      string `json:"path"`      // 绝对路径
	SizeBytes int64  `json:"sizeBytes"` // 总占用字节
	FileCount int    `json:"fileCount"` // 文件数量
	DirCount  int    `json:"dirCount"`  // 子目录数量
	OldestAt  int64  `json:"oldestAt"`  // 最早 mtime（unix 秒），无文件为 0
	NewestAt  int64  `json:"newestAt"`  // 最新 mtime
	Exists    bool   `json:"exists"`
}

type tableSizeInfo struct {
	Name      string `json:"name"`
	RowCount  int64  `json:"rowCount"`
	SizeBytes int64  `json:"sizeBytes"` // 估算
}

type dbInfo struct {
	Path          string          `json:"path"`
	MainBytes     int64           `json:"mainBytes"`     // .db 文件大小
	WalBytes      int64           `json:"walBytes"`      // -wal
	ShmBytes      int64           `json:"shmBytes"`      // -shm
	TotalBytes    int64           `json:"totalBytes"`    // 三者之和
	PageSize      int64           `json:"pageSize"`      // PRAGMA page_size
	PageCount     int64           `json:"pageCount"`     // PRAGMA page_count
	FreelistCount int64           `json:"freelistCount"` // PRAGMA freelist_count
	ReclaimableMB float64         `json:"reclaimableMB"` // freelist * page_size
	JournalMode   string          `json:"journalMode"`   // wal/delete/...
	IntegrityOK   bool            `json:"integrityOK"`   // 仅 GET 概览不跑 integrity，固定 true
	Tables        []tableSizeInfo `json:"tables"`
}

type diskInfo struct {
	Path        string `json:"path"`
	TotalBytes  int64  `json:"totalBytes"`
	FreeBytes   int64  `json:"freeBytes"`
	UsedBytes   int64  `json:"usedBytes"`
	Available   bool   `json:"available"` // 平台是否可获取
	UsedPercent int    `json:"usedPercent"`
}

type storageOverview struct {
	GeneratedAt int64  `json:"generatedAt"`
	DataDir     string `json:"dataDir"`
	Cache       struct {
		TotalBytes int64             `json:"totalBytes"`
		FileCount  int               `json:"fileCount"`
		Buckets    []cacheBucketInfo `json:"buckets"`
	} `json:"cache"`
	Database  dbInfo                         `json:"database"`
	Disk      diskInfo                       `json:"disk"`
	Threshold *config.StorageThresholdConfig `json:"threshold,omitempty"`
	Warnings  []string                       `json:"warnings,omitempty"`
}

// ============================================================
// 互斥锁（防止并发清理 / VACUUM 时打架）
// ============================================================

var (
	dataAdminMu        sync.Mutex // 串行化所有"写"操作
	overviewCache      *storageOverview
	overviewCacheTime  time.Time
	overviewCacheTTL   = 30 * time.Second
	overviewCacheMutex sync.RWMutex
)

func invalidateOverviewCache() {
	overviewCacheMutex.Lock()
	overviewCache = nil
	overviewCacheMutex.Unlock()
}

// ============================================================
// GET /api/admin/storage  存储总览
// ============================================================

// GetOverview 返回缓存 + 数据库 + 磁盘的整体快照。
// 通过 ?fresh=1 强制刷新（默认带 30 秒缓存以减少 WalkDir 压力）。
func (h *DataAdminHandler) GetOverview(c *gin.Context) {
	fresh := c.Query("fresh") == "1"

	if !fresh {
		overviewCacheMutex.RLock()
		if overviewCache != nil && time.Since(overviewCacheTime) < overviewCacheTTL {
			cached := *overviewCache
			overviewCacheMutex.RUnlock()
			c.JSON(http.StatusOK, cached)
			return
		}
		overviewCacheMutex.RUnlock()
	}

	ov := buildOverview()

	overviewCacheMutex.Lock()
	overviewCache = ov
	overviewCacheTime = time.Now()
	overviewCacheMutex.Unlock()

	c.JSON(http.StatusOK, ov)
}

func buildOverview() *storageOverview {
	ov := &storageOverview{
		GeneratedAt: time.Now().Unix(),
		DataDir:     config.DataDir(),
	}

	// 缓存细分
	buckets := scanCacheBuckets()
	var totalBytes int64
	var totalFiles int
	for _, b := range buckets {
		totalBytes += b.SizeBytes
		totalFiles += b.FileCount
	}
	ov.Cache.Buckets = buckets
	ov.Cache.TotalBytes = totalBytes
	ov.Cache.FileCount = totalFiles

	// 数据库
	ov.Database = collectDBInfo(false)

	// 磁盘
	ov.Disk = collectDiskInfo(config.DataDir())

	// 阈值 + 预警
	cfg := config.GetSiteConfig()
	if cfg.StorageThreshold != nil {
		thr := *cfg.StorageThreshold
		ov.Threshold = &thr
		var warnings []string
		if thr.CacheMaxMB > 0 && totalBytes > thr.CacheMaxMB*1024*1024 {
			warnings = append(warnings, fmt.Sprintf(
				"缓存占用 %s 已超过阈值 %d MB", humanBytes(totalBytes), thr.CacheMaxMB))
		}
		if thr.DBMaxMB > 0 && ov.Database.TotalBytes > thr.DBMaxMB*1024*1024 {
			warnings = append(warnings, fmt.Sprintf(
				"数据库 %s 已超过阈值 %d MB", humanBytes(ov.Database.TotalBytes), thr.DBMaxMB))
		}
		if thr.DiskFreeMinMB > 0 && ov.Disk.Available && ov.Disk.FreeBytes < thr.DiskFreeMinMB*1024*1024 {
			warnings = append(warnings, fmt.Sprintf(
				"磁盘剩余 %s 低于阈值 %d MB", humanBytes(ov.Disk.FreeBytes), thr.DiskFreeMinMB))
		}
		ov.Warnings = warnings
	}

	return ov
}

// ============================================================
// 缓存：扫描 + 清理
// ============================================================

// scanCacheBuckets 把 DataDir 下的内容拆成几个桶并统计大小。
func scanCacheBuckets() []cacheBucketInfo {
	dataDir := config.DataDir()
	thumbDir := config.GetThumbnailsDir()
	pagesDir := config.GetPagesCacheDir()
	convertedDir := filepath.Join(dataDir, "converted")

	knownDirs := map[string]string{
		"thumbnails": thumbDir,
		"pages":      pagesDir,
		"converted":  convertedDir,
	}
	labels := map[string]string{
		"thumbnails": "缩略图缓存",
		"pages":      "阅读页缓存",
		"converted":  "格式转换缓存",
		"other":      "其他缓存文件",
	}

	out := make([]cacheBucketInfo, 0, 4)
	for key, p := range knownDirs {
		out = append(out, scanDirBucket(key, labels[key], p))
	}

	// other：DataDir 下除上述 + 配置文件之外的剩余内容
	preserve := map[string]bool{
		"thumbnails": true,
		"pages":      true,
		"converted":  true,
	}
	other := cacheBucketInfo{Key: "other", Label: labels["other"], Path: dataDir, Exists: true}
	if entries, err := os.ReadDir(dataDir); err == nil {
		var oldest, newest int64
		for _, e := range entries {
			name := e.Name()
			if preserve[name] {
				continue
			}
			full := filepath.Join(dataDir, name)
			if e.IsDir() {
				other.DirCount++
				sz, fc, ot, nt := walkDirStats(full)
				other.SizeBytes += sz
				other.FileCount += fc
				oldest = mergeOldest(oldest, ot)
				newest = mergeNewest(newest, nt)
			} else {
				if info, err := e.Info(); err == nil {
					other.SizeBytes += info.Size()
					other.FileCount++
					ts := info.ModTime().Unix()
					oldest = mergeOldest(oldest, ts)
					newest = mergeNewest(newest, ts)
				}
			}
		}
		other.OldestAt = oldest
		other.NewestAt = newest
	}
	out = append(out, other)

	// 稳定顺序
	order := map[string]int{"thumbnails": 1, "pages": 2, "converted": 3, "other": 4}
	sort.SliceStable(out, func(i, j int) bool { return order[out[i].Key] < order[out[j].Key] })
	return out
}

func scanDirBucket(key, label, dir string) cacheBucketInfo {
	b := cacheBucketInfo{Key: key, Label: label, Path: dir}
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return b
	}
	b.Exists = true
	sz, fc, ot, nt := walkDirStats(dir)
	b.SizeBytes = sz
	b.FileCount = fc
	b.OldestAt = ot
	b.NewestAt = nt
	// 顶层目录数
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				b.DirCount++
			}
		}
	}
	return b
}

// walkDirStats 递归统计：(总字节, 文件数, oldest_mtime, newest_mtime)。
func walkDirStats(root string) (int64, int, int64, int64) {
	var size int64
	var files int
	var oldest, newest int64
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 忽略个别失败
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		size += info.Size()
		files++
		ts := info.ModTime().Unix()
		oldest = mergeOldest(oldest, ts)
		newest = mergeNewest(newest, ts)
		return nil
	})
	return size, files, oldest, newest
}

func mergeOldest(curr, ts int64) int64 {
	if ts == 0 {
		return curr
	}
	if curr == 0 || ts < curr {
		return ts
	}
	return curr
}
func mergeNewest(curr, ts int64) int64 {
	if ts > curr {
		return ts
	}
	return curr
}

// POST /api/admin/storage/cache/clear
// body: {"target":"thumbnails|pages|converted|other|all", "olderThanDays":0, "largerThanMB":0, "orphanOnly":false}
func (h *DataAdminHandler) ClearCache(c *gin.Context) {
	var body struct {
		Target        string `json:"target"`
		OlderThanDays int    `json:"olderThanDays"`
		LargerThanMB  int    `json:"largerThanMB"`
		OrphanOnly    bool   `json:"orphanOnly"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	dataAdminMu.Lock()
	defer dataAdminMu.Unlock()
	defer invalidateOverviewCache()

	// 失效内存缓存（缩略图等）
	service.InvalidateAllCaches()

	dataDir := config.DataDir()
	thumbDir := config.GetThumbnailsDir()
	pagesDir := config.GetPagesCacheDir()
	convertedDir := filepath.Join(dataDir, "converted")

	var targets []string
	switch body.Target {
	case "thumbnails":
		targets = []string{thumbDir}
	case "pages":
		targets = []string{pagesDir}
	case "converted":
		targets = []string{convertedDir}
	case "other":
		targets = []string{}
		preserve := map[string]bool{
			"thumbnails": true, "pages": true, "converted": true,
		}
		if entries, err := os.ReadDir(dataDir); err == nil {
			for _, e := range entries {
				name := e.Name()
				if preserve[name] || strings.HasSuffix(name, ".json") {
					continue // 保留配置 JSON
				}
				targets = append(targets, filepath.Join(dataDir, name))
			}
		}
	case "all":
		targets = []string{thumbDir, pagesDir, convertedDir}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid target"})
		return
	}

	var deleted int
	var freed int64
	cutoff := time.Time{}
	if body.OlderThanDays > 0 {
		cutoff = time.Now().AddDate(0, 0, -body.OlderThanDays)
	}
	minSize := int64(body.LargerThanMB) * 1024 * 1024

	// 孤儿清理：仅对 thumbnails / pages 生效（按 comicID 命名）
	var validIDs map[string]struct{}
	if body.OrphanOnly {
		validIDs = loadValidComicIDs()
	}

	for _, root := range targets {
		st, err := os.Stat(root)
		if err != nil {
			continue
		}
		if !st.IsDir() {
			// 单文件
			if shouldDeleteFile(root, st, cutoff, minSize, body.OrphanOnly, validIDs) {
				if os.Remove(root) == nil {
					deleted++
					freed += st.Size()
				}
			}
			continue
		}

		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			if shouldDeleteFile(p, info, cutoff, minSize, body.OrphanOnly, validIDs) {
				if os.Remove(p) == nil {
					deleted++
					freed += info.Size()
				}
			}
			return nil
		})

		// 仅在无条件清理时尝试删除空子目录
		if cutoff.IsZero() && minSize == 0 && !body.OrphanOnly {
			removeEmptyDirs(root)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"deleted":    deleted,
		"freedBytes": freed,
	})
}

func shouldDeleteFile(p string, info os.FileInfo, cutoff time.Time, minSize int64, orphanOnly bool, validIDs map[string]struct{}) bool {
	if !cutoff.IsZero() && !info.ModTime().Before(cutoff) {
		return false
	}
	if minSize > 0 && info.Size() < minSize {
		return false
	}
	if orphanOnly {
		if validIDs == nil {
			return false
		}
		// 文件名前 12 位为 comic id（缩略图）；目录名为 comic id（pages）
		base := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
		// thumbnails: <id>.jpg ；pages: <id>/<page>.webp
		parts := strings.Split(filepath.ToSlash(p), "/")
		var id string
		// 优先用倒数第二段（pages 子目录）
		if len(parts) >= 2 {
			parent := parts[len(parts)-2]
			if _, ok := validIDs[parent]; ok {
				return false
			}
			// 检查 base 自身（thumbnails 文件名）
			if _, ok := validIDs[base]; ok {
				return false
			}
			// 父目录像 id（12 hex）则视为孤儿
			if looksLikeComicID(parent) {
				id = parent
			}
		}
		if id == "" && looksLikeComicID(base) {
			id = base
		}
		if id == "" {
			return false // 无法识别就保守不删
		}
		_, ok := validIDs[id]
		return !ok
	}
	return true
}

func looksLikeComicID(s string) bool {
	if len(s) != 12 {
		return false
	}
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

// loadValidComicIDs 拉取所有合法 Comic.id，用于孤儿清理。
func loadValidComicIDs() map[string]struct{} {
	out := make(map[string]struct{})
	db := store.DB()
	if db == nil {
		return out
	}
	rows, err := db.Query(`SELECT "id" FROM "Comic"`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			out[id] = struct{}{}
		}
	}
	return out
}

// removeEmptyDirs 自底向上移除空目录。
func removeEmptyDirs(root string) {
	type entry struct{ path string }
	var dirs []entry
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && p != root {
			dirs = append(dirs, entry{p})
		}
		return nil
	})
	// 按路径长度倒序，保证子目录先删
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i].path) > len(dirs[j].path) })
	for _, d := range dirs {
		_ = os.Remove(d.path) // 非空会失败，忽略
	}
}

// ============================================================
// 数据库
// ============================================================

// 只统计常用的业务表（不包含 sqlite_* 系统表与 FTS 影子表）。
var dbStatTables = []string{
	"User", "UserSession", "Comic", "Tag", "ComicTag",
	"Category", "ComicCategory", "ReadingSession", "ReadingGoal",
	"ComicGroup", "ComicGroupItem", "GroupCategory", "UserComicState",
	"ComicFTS",
}

func collectDBInfo(deep bool) dbInfo {
	info := dbInfo{Path: config.DatabaseURL(), IntegrityOK: true}

	if st, err := os.Stat(info.Path); err == nil {
		info.MainBytes = st.Size()
	}
	if st, err := os.Stat(info.Path + "-wal"); err == nil {
		info.WalBytes = st.Size()
	}
	if st, err := os.Stat(info.Path + "-shm"); err == nil {
		info.ShmBytes = st.Size()
	}
	info.TotalBytes = info.MainBytes + info.WalBytes + info.ShmBytes

	db := store.DB()
	if db == nil {
		return info
	}

	queryInt := func(q string) int64 {
		var v int64
		if err := db.QueryRow(q).Scan(&v); err == nil {
			return v
		}
		return 0
	}
	queryString := func(q string) string {
		var v string
		_ = db.QueryRow(q).Scan(&v)
		return v
	}

	info.PageSize = queryInt("PRAGMA page_size")
	info.PageCount = queryInt("PRAGMA page_count")
	info.FreelistCount = queryInt("PRAGMA freelist_count")
	if info.PageSize > 0 {
		info.ReclaimableMB = float64(info.FreelistCount*info.PageSize) / (1024 * 1024)
	}
	info.JournalMode = queryString("PRAGMA journal_mode")

	// 表统计
	totalRows := int64(0)
	tables := make([]tableSizeInfo, 0, len(dbStatTables))
	for _, t := range dbStatTables {
		var rc int64
		// 注意：表名拼接已硬编码为白名单，无 SQL 注入风险
		_ = db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM "%s"`, t)).Scan(&rc)
		tables = append(tables, tableSizeInfo{Name: t, RowCount: rc})
		totalRows += rc
	}
	// 估算每表占用：按行数比例分摊主库大小（去掉 freelist）
	usable := info.MainBytes - info.FreelistCount*info.PageSize
	if usable < 0 {
		usable = info.MainBytes
	}
	if totalRows > 0 && usable > 0 {
		for i := range tables {
			tables[i].SizeBytes = int64(float64(usable) * float64(tables[i].RowCount) / float64(totalRows))
		}
	}
	sort.SliceStable(tables, func(i, j int) bool { return tables[i].RowCount > tables[j].RowCount })
	info.Tables = tables

	if deep {
		var result string
		_ = db.QueryRow("PRAGMA integrity_check(1)").Scan(&result)
		info.IntegrityOK = result == "ok"
	}

	return info
}

// GET /api/admin/storage/database
func (h *DataAdminHandler) GetDatabaseInfo(c *gin.Context) {
	c.JSON(http.StatusOK, collectDBInfo(false))
}

// POST /api/admin/storage/db/checkpoint   WAL 截断
func (h *DataAdminHandler) DBCheckpoint(c *gin.Context) {
	dataAdminMu.Lock()
	defer dataAdminMu.Unlock()
	defer invalidateOverviewCache()

	db := store.DB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "DB not ready"})
		return
	}
	start := time.Now()
	if _, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"durationMs": time.Since(start).Milliseconds(),
	})
}

// POST /api/admin/storage/db/analyze
func (h *DataAdminHandler) DBAnalyze(c *gin.Context) {
	dataAdminMu.Lock()
	defer dataAdminMu.Unlock()
	defer invalidateOverviewCache()

	db := store.DB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "DB not ready"})
		return
	}
	start := time.Now()
	if _, err := db.Exec("ANALYZE"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"durationMs": time.Since(start).Milliseconds(),
	})
}

// POST /api/admin/storage/db/vacuum
//
// VACUUM 会重建数据库，期间禁止写入；通过同步执行（管理员主动触发，前端会显示加载态）。
func (h *DataAdminHandler) DBVacuum(c *gin.Context) {
	dataAdminMu.Lock()
	defer dataAdminMu.Unlock()
	defer invalidateOverviewCache()

	db := store.DB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "DB not ready"})
		return
	}
	beforeMain := int64(0)
	if st, err := os.Stat(config.DatabaseURL()); err == nil {
		beforeMain = st.Size()
	}
	start := time.Now()
	log.Println("[DataAdmin] VACUUM 开始")
	if _, err := db.Exec("VACUUM"); err != nil {
		log.Printf("[DataAdmin] VACUUM 失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	dur := time.Since(start)
	afterMain := int64(0)
	if st, err := os.Stat(config.DatabaseURL()); err == nil {
		afterMain = st.Size()
	}
	log.Printf("[DataAdmin] VACUUM 完成: %s -> %s (耗时 %s)", humanBytes(beforeMain), humanBytes(afterMain), dur)

	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"durationMs":  dur.Milliseconds(),
		"beforeBytes": beforeMain,
		"afterBytes":  afterMain,
		"freedBytes":  beforeMain - afterMain,
	})
}

// POST /api/admin/storage/db/integrity
func (h *DataAdminHandler) DBIntegrity(c *gin.Context) {
	dataAdminMu.Lock()
	defer dataAdminMu.Unlock()

	db := store.DB()
	if db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "DB not ready"})
		return
	}
	start := time.Now()
	rows, err := db.Query("PRAGMA integrity_check")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var msgs []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err == nil {
			msgs = append(msgs, s)
		}
	}
	ok := len(msgs) == 1 && msgs[0] == "ok"
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"ok":         ok,
		"messages":   msgs,
		"durationMs": time.Since(start).Milliseconds(),
	})
}

// ============================================================
// 阈值
// ============================================================

// PUT /api/admin/storage/threshold
// body: {"cacheMaxMB":5000,"dbMaxMB":500,"diskFreeMinMB":1024}
func (h *DataAdminHandler) UpdateThreshold(c *gin.Context) {
	var body config.StorageThresholdConfig
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	cfg := config.GetSiteConfig()
	cfg.StorageThreshold = &body
	if err := config.SaveSiteConfig(&cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	invalidateOverviewCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "threshold": body})
}

// ============================================================
// 工具
// ============================================================

func humanBytes(n int64) string {
	const k = 1024.0
	if n < int64(k) {
		return fmt.Sprintf("%d B", n)
	}
	x := float64(n)
	units := []string{"KB", "MB", "GB", "TB"}
	idx := -1
	for x >= k && idx < len(units)-1 {
		x /= k
		idx++
	}
	return fmt.Sprintf("%.2f %s", x, units[idx])
}

// GetHistory 返回最近 N 天的存储采样（用于趋势折线图）。
// Query 参数：
//   - days: 1~90，默认 30
//
// 返回字段：samples 数组（ts/cacheBytes/dbBytes/diskFree）。
func (h *DataAdminHandler) GetHistory(c *gin.Context) {
	days := 30
	if v := c.Query("days"); v != "" {
		// 简单解析，避免引入 strconv 之外的依赖
		var n int
		_, err := fmt.Sscanf(v, "%d", &n)
		if err == nil && n > 0 {
			if n > 90 {
				n = 90
			}
			days = n
		}
	}

	samples := service.GetStorageHistory(days)
	c.JSON(http.StatusOK, gin.H{
		"days":    days,
		"count":   len(samples),
		"samples": samples,
	})
}

// SampleStorageUsage 返回当前缓存大小、数据库大小、磁盘剩余空间，
// 供 service.StartStorageSampler 周期性采样写入历史趋势。
func SampleStorageUsage() (cacheBytes int64, dbBytes int64, diskFree uint64) {
	// 缓存：复用 scanCacheBuckets 的统计
	for _, b := range scanCacheBuckets() {
		cacheBytes += b.SizeBytes
	}
	// 数据库：collectDBInfo(false) 不做表级展开，开销小
	dbInfo := collectDBInfo(false)
	dbBytes = dbInfo.TotalBytes
	// 磁盘剩余空间
	disk := collectDiskInfo(config.DataDir())
	if disk.Available && disk.FreeBytes > 0 {
		diskFree = uint64(disk.FreeBytes)
	}
	return
}
