package service

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// Reader cache pool (LRU, prevents re-opening same archive)
// ============================================================

type cachedReader struct {
	reader   archive.Reader
	lastUsed time.Time
}

var (
	readerPool    = make(map[string]*cachedReader)
	readerPoolMu  sync.Mutex
	readerPoolTTL = 5 * time.Minute // Increased from 60s: TXT/EPUB readers are expensive to create
	readerPoolMax = 8               // Increased from 5: allow more concurrent readers
)

func init() {
	// Periodic cleanup of expired readers
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			cleanExpiredReaders()
		}
	}()
}

func cleanExpiredReaders() {
	readerPoolMu.Lock()
	defer readerPoolMu.Unlock()

	now := time.Now()
	for fp, cached := range readerPool {
		if now.Sub(cached.lastUsed) > readerPoolTTL {
			cached.reader.Close()
			delete(readerPool, fp)
		}
	}
}

// getPooledReader returns a cached or new archive reader.
// Caller must NOT call Close() on the returned reader.
func getPooledReader(fp string) (archive.Reader, error) {
	// Fast path: check if reader is already cached
	readerPoolMu.Lock()
	if cached, ok := readerPool[fp]; ok {
		cached.lastUsed = time.Now()
		readerPoolMu.Unlock()
		return cached.reader, nil
	}
	readerPoolMu.Unlock()

	// Slow path: create reader WITHOUT holding the lock
	// (archive.NewReader can be very slow for large TXT/EPUB files)
	reader, err := archive.NewReader(fp)
	if err != nil {
		return nil, err
	}

	// Re-acquire lock to store in pool
	readerPoolMu.Lock()
	defer readerPoolMu.Unlock()

	// Double-check: another goroutine may have created the same reader
	if cached, ok := readerPool[fp]; ok {
		// Someone else created it; close ours and use theirs
		reader.Close()
		cached.lastUsed = time.Now()
		return cached.reader, nil
	}

	// Evict LRU if pool is full
	if len(readerPool) >= readerPoolMax {
		var oldestKey string
		var oldestTime time.Time
		for k, v := range readerPool {
			if oldestKey == "" || v.lastUsed.Before(oldestTime) {
				oldestKey = k
				oldestTime = v.lastUsed
			}
		}
		if oldestKey != "" {
			readerPool[oldestKey].reader.Close()
			delete(readerPool, oldestKey)
		}
	}

	readerPool[fp] = &cachedReader{reader: reader, lastUsed: time.Now()}
	return reader, nil
}

// InvalidateReaderPool closes and clears all cached readers.
func InvalidateReaderPool() {
	readerPoolMu.Lock()
	defer readerPoolMu.Unlock()

	for _, cached := range readerPool {
		cached.reader.Close()
	}
	readerPool = make(map[string]*cachedReader)
}

// ============================================================
// Page list cache
// ============================================================

type pageListCacheEntry struct {
	entries       []string
	chapterTitles []string
	isPdf         bool
	ts            time.Time
}

var (
	pageListCache    = make(map[string]*pageListCacheEntry)
	pageListCacheMu  sync.RWMutex
	pageListCacheTTL = 5 * time.Minute
)

func invalidatePageListCache() {
	pageListCacheMu.Lock()
	defer pageListCacheMu.Unlock()
	pageListCache = make(map[string]*pageListCacheEntry)
}

// InvalidateAllCaches clears all in-memory caches.
func InvalidateAllCaches() {
	InvalidateReaderPool()
	invalidatePageListCache()
}

// ============================================================
// Find comic file on disk
// ============================================================

// FindComicFilePath finds the file path for a comic by looking up its filename in DB,
// then searching all comic directories.
func FindComicFilePath(comicID string) (string, string, error) {
	// Get filename from DB
	comic, err := store.GetComicByID(comicID)
	if err != nil || comic == nil {
		return "", "", fmt.Errorf("comic not found: %s", comicID)
	}

	// Search all directories for the file
	for _, dir := range config.GetAllScanDirs() {
		fp := filepath.Join(dir, comic.Filename)
		if _, err := os.Stat(fp); err == nil {
			return fp, comic.Filename, nil
		}
	}

	return "", "", fmt.Errorf("file not found on disk for comic %s (%s)", comicID, comic.Filename)
}

// ============================================================
// Get comic pages (list of page entry names)
// ============================================================

// PagesResult holds page list data with optional chapter info for novels.
type PagesResult struct {
	Entries       []string
	ChapterTitles []string // non-nil only for novel formats
	IsNovel       bool
	IsPdf         bool
}

// GetComicPagesEx returns pages with extended info (chapter titles for novels).
func GetComicPagesEx(comicID string) (*PagesResult, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}

	archiveType := archive.DetectType(fp)
	isNovel := archive.IsNovelType(archiveType)

	// Check cache for entries
	pageListCacheMu.RLock()
	if cached, ok := pageListCache[comicID]; ok && time.Since(cached.ts) < pageListCacheTTL {
		pageListCacheMu.RUnlock()
		result := &PagesResult{Entries: cached.entries, IsNovel: isNovel, IsPdf: cached.isPdf}
		if isNovel {
			result.ChapterTitles = cached.chapterTitles
		}
		return result, nil
	}
	pageListCacheMu.RUnlock()

	var entries []string
	var chapterTitles []string
	var isPdf bool

	switch {
	case archiveType == archive.TypePdf:
		count, err := archive.GetPdfPageCount(fp)
		if err != nil {
			return nil, err
		}
		entries = make([]string, count)
		for i := 0; i < count; i++ {
			entries[i] = fmt.Sprintf("page-%04d.png", i+1)
		}
		isPdf = true

	case isNovel:
		reader, err := getPooledReader(fp)
		if err != nil {
			return nil, err
		}
		// Set comic ID for EPUB image URL rewriting
		if archiveType == archive.TypeEpub || archiveType == archive.TypeMobi || archiveType == archive.TypeAzw3 {
			archive.SetEpubComicID(reader, comicID)
		}
		// For novels, list entries directly (they are virtual chapter files)
		for _, e := range reader.ListEntries() {
			if !e.IsDirectory {
				entries = append(entries, e.Name)
			}
		}
		chapterTitles = getChapterTitles(reader, archiveType)

	default:
		reader, err := getPooledReader(fp)
		if err != nil {
			return nil, err
		}
		entries = archive.GetImageEntries(reader)
	}

	// Update cache
	pageListCacheMu.Lock()
	pageListCache[comicID] = &pageListCacheEntry{entries: entries, chapterTitles: chapterTitles, isPdf: isPdf, ts: time.Now()}
	pageListCacheMu.Unlock()

	return &PagesResult{
		Entries:       entries,
		ChapterTitles: chapterTitles,
		IsNovel:       isNovel,
		IsPdf:         isPdf,
	}, nil
}

// GetComicPages returns the sorted list of page entry names (backward compatible).
func GetComicPages(comicID string) ([]string, error) {
	result, err := GetComicPagesEx(comicID)
	if err != nil {
		return nil, err
	}
	return result.Entries, nil
}

// getChapterTitles extracts chapter titles from a novel reader.
func getChapterTitles(r archive.Reader, archiveType archive.ArchiveType) []string {
	switch archiveType {
	case archive.TypeTxt:
		return archive.GetTxtChapterTitles(r)
	case archive.TypeEpub, archive.TypeMobi, archive.TypeAzw3:
		return archive.GetEpubChapterTitles(r)
	case archive.TypeHtml:
		return archive.GetHtmlChapterTitles(r)
	}
	return nil
}

// ============================================================
// Get chapter content (text for novel formats)
// ============================================================

// ChapterContent holds the extracted chapter text.
type ChapterContent struct {
	Content  string `json:"content"`
	Title    string `json:"title"`
	MimeType string `json:"mimeType"`
}

// GetChapterContent extracts a single chapter's text content.
func GetChapterContent(comicID string, chapterIndex int) (*ChapterContent, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}

	archiveType := archive.DetectType(fp)
	if !archive.IsNovelType(archiveType) {
		return nil, fmt.Errorf("not a novel format: %s", fp)
	}

	reader, err := getPooledReader(fp)
	if err != nil {
		return nil, err
	}

	// Set comic ID on EPUB reader for image URL rewriting
	if archiveType == archive.TypeEpub || archiveType == archive.TypeMobi || archiveType == archive.TypeAzw3 {
		archive.SetEpubComicID(reader, comicID)
	}

	allEntries := reader.ListEntries()
	var chapters []string
	for _, e := range allEntries {
		if !e.IsDirectory {
			chapters = append(chapters, e.Name)
		}
	}

	if chapterIndex < 0 || chapterIndex >= len(chapters) {
		return nil, fmt.Errorf("chapter index %d out of range (0-%d)", chapterIndex, len(chapters)-1)
	}

	entryName := chapters[chapterIndex]
	data, err := reader.ExtractEntry(entryName)
	if err != nil {
		return nil, fmt.Errorf("extract chapter %d: %w", chapterIndex, err)
	}

	// Get chapter title — prefer cache to avoid re-computing
	title := ""
	pageListCacheMu.RLock()
	if cached, ok := pageListCache[comicID]; ok && cached.chapterTitles != nil && chapterIndex < len(cached.chapterTitles) {
		title = cached.chapterTitles[chapterIndex]
	}
	pageListCacheMu.RUnlock()
	if title == "" {
		titles := getChapterTitles(reader, archiveType)
		if titles != nil && chapterIndex < len(titles) {
			title = titles[chapterIndex]
		}
	}

	mimeType := "text/plain; charset=utf-8"
	if archiveType == archive.TypeEpub || archiveType == archive.TypeMobi || archiveType == archive.TypeAzw3 || archiveType == archive.TypeHtml {
		mimeType = "text/html; charset=utf-8" // EPUB/HTML returns sanitized HTML for rich rendering
	}

	return &ChapterContent{
		Content:  string(data),
		Title:    title,
		MimeType: mimeType,
	}, nil
}

// ============================================================
// Get EPUB resource (images, etc.)
// ============================================================

// EpubResource holds the extracted resource data from an EPUB.
type EpubResource struct {
	Data     []byte
	MimeType string
}

// GetEpubResource extracts a resource (image, etc.) from an EPUB file.
func GetEpubResource(comicID string, resourcePath string) (*EpubResource, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}

	archiveType := archive.DetectType(fp)
	if archiveType != archive.TypeEpub && archiveType != archive.TypeMobi && archiveType != archive.TypeAzw3 {
		return nil, fmt.Errorf("not an EPUB file: %s", fp)
	}

	reader, err := getPooledReader(fp)
	if err != nil {
		return nil, err
	}

	data, mimeType, err := archive.GetEpubResourceData(reader, resourcePath)
	if err != nil {
		return nil, err
	}

	return &EpubResource{Data: data, MimeType: mimeType}, nil
}

// ============================================================
// Get page image (with disk cache)
// ============================================================

// PageImage holds the extracted page data.
type PageImage struct {
	Data     []byte
	MimeType string
}

// GetPageImage extracts a single page from the archive.
// Uses disk cache to avoid re-extracting.
func GetPageImage(comicID string, pageIndex int) (*PageImage, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}

	archiveType := archive.DetectType(fp)

	// PDF: use special rendering path
	if archiveType == archive.TypePdf {
		return getPdfPageImage(comicID, fp, pageIndex)
	}

	return getArchivePageImage(comicID, fp, pageIndex)
}

// GetPageImageData extracts the raw image bytes for a page (used for cover selection).
func GetPageImageData(comicID string, pageIndex int) ([]byte, error) {
	img, err := GetPageImage(comicID, pageIndex)
	if err != nil {
		return nil, err
	}
	return img.Data, nil
}

// getArchivePageImage extracts a page from a non-PDF archive.
func getArchivePageImage(comicID, fp string, pageIndex int) (*PageImage, error) {
	cacheDir := filepath.Join(config.GetPagesCacheDir(), comicID)

	// Check disk cache
	if entries, err := os.ReadDir(cacheDir); err == nil {
		prefix := fmt.Sprintf("%d.", pageIndex)
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), prefix) {
				data, err := os.ReadFile(filepath.Join(cacheDir, e.Name()))
				if err == nil {
					return &PageImage{
						Data:     data,
						MimeType: archive.GetMimeType(e.Name()),
					}, nil
				}
			}
		}
	}

	// Extract from archive
	reader, err := getPooledReader(fp)
	if err != nil {
		return nil, err
	}

	images := archive.GetImageEntries(reader)
	if pageIndex < 0 || pageIndex >= len(images) {
		return nil, fmt.Errorf("page index %d out of range (0-%d)", pageIndex, len(images)-1)
	}

	entryName := images[pageIndex]
	data, err := reader.ExtractEntry(entryName)
	if err != nil {
		return nil, fmt.Errorf("extract page %d: %w", pageIndex, err)
	}

	ext := strings.ToLower(filepath.Ext(entryName))
	mimeType := archive.GetMimeType(entryName)

	// Write to disk cache (fire-and-forget)
	go func() {
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			return
		}
		cachePath := filepath.Join(cacheDir, fmt.Sprintf("%d%s", pageIndex, ext))
		_ = os.WriteFile(cachePath, data, 0644)
	}()

	return &PageImage{Data: data, MimeType: mimeType}, nil
}

// getPdfPageImage renders a PDF page to PNG.
func getPdfPageImage(comicID, fp string, pageIndex int) (*PageImage, error) {
	cacheDir := filepath.Join(config.GetPagesCacheDir(), comicID)
	cachePath := filepath.Join(cacheDir, fmt.Sprintf("%d.png", pageIndex))

	// Check disk cache
	if data, err := os.ReadFile(cachePath); err == nil {
		return &PageImage{Data: data, MimeType: "image/png"}, nil
	}

	// Render from PDF
	data, err := archive.RenderPdfPage(fp, pageIndex)
	if err != nil {
		return nil, fmt.Errorf("render PDF page %d: %w", pageIndex, err)
	}

	// Cache to disk (fire-and-forget)
	go func() {
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			return
		}
		_ = os.WriteFile(cachePath, data, 0644)
	}()

	return &PageImage{Data: data, MimeType: "image/png"}, nil
}

// ============================================================
// Get comic thumbnail
// ============================================================

// GetComicThumbnail returns the thumbnail and cover aspect ratio for a comic.
func GetComicThumbnail(comicID string) ([]byte, float64, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, 0, err
	}
	return archive.GenerateThumbnail(fp, comicID)
}

// ============================================================
// Warmup: 批量预提取页面到磁盘缓存（方案 B）
// ============================================================

// WarmupPages 后台异步预提取指定漫画的 N 页到磁盘缓存。
// startPage: 起始页码（0-based），count: 预提取页数。
// 该函数立即返回，实际解压在后台 goroutine 中执行。
func WarmupPages(comicID string, startPage, count int) {
	go func() {
		fp, _, err := FindComicFilePath(comicID)
		if err != nil {
			return
		}

		archiveType := archive.DetectType(fp)
		// 仅对漫画格式预热（小说和PDF不需要）
		if archive.IsNovelType(archiveType) || archiveType == archive.TypePdf {
			return
		}

		reader, err := getPooledReader(fp)
		if err != nil {
			return
		}

		images := archive.GetImageEntries(reader)
		if len(images) == 0 {
			return
		}

		cacheDir := filepath.Join(config.GetPagesCacheDir(), comicID)

		// 计算需要预热的页面范围
		end := startPage + count
		if end > len(images) {
			end = len(images)
		}
		if startPage < 0 {
			startPage = 0
		}

		// 检查是否为 RAR 格式，RAR 使用批量解压优化
		isRar := archiveType == archive.TypeRar

		if isRar {
			// 方案 C: RAR 批量解压优化
			// RAR 每次 ExtractEntry 都要从头扫描，所以一次性批量解压多页
			warmupRarBatch(fp, comicID, images, startPage, end, cacheDir)
		} else {
			// ZIP/7z 等格式逐页解压（支持随机访问，性能好）
			warmupNormal(reader, comicID, images, startPage, end, cacheDir)
		}
	}()
}

// warmupNormal 对 ZIP/7z 等支持随机访问的格式逐页预热。
func warmupNormal(reader archive.Reader, comicID string, images []string, start, end int, cacheDir string) {
	warmed := 0
	for i := start; i < end; i++ {
		// 检查磁盘缓存是否已存在
		if pageExistsInCache(cacheDir, i) {
			continue
		}

		entryName := images[i]
		data, err := reader.ExtractEntry(entryName)
		if err != nil {
			continue
		}

		ext := strings.ToLower(filepath.Ext(entryName))
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			return
		}
		cachePath := filepath.Join(cacheDir, fmt.Sprintf("%d%s", i, ext))
		_ = os.WriteFile(cachePath, data, 0644)
		warmed++
	}
	if warmed > 0 {
		log.Printf("[warmup] Pre-cached %d pages for %s (pages %d-%d)", warmed, comicID, start, end-1)
	}
}

// warmupRarBatch 对 RAR 格式使用流式批量解压，避免每页都从头扫描。
func warmupRarBatch(fp, comicID string, images []string, start, end int, cacheDir string) {
	// 构建需要提取的 entry 名称集合
	needExtract := make(map[string]int) // entryName -> pageIndex
	for i := start; i < end; i++ {
		if !pageExistsInCache(cacheDir, i) {
			needExtract[images[i]] = i
		}
	}
	if len(needExtract) == 0 {
		return
	}

	// 确保缓存目录存在
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return
	}

	// 一次性流式扫描 RAR，遇到需要的 entry 就提取
	warmed, err := archive.BatchExtractRarEntries(fp, needExtract, cacheDir)
	if err != nil {
		log.Printf("[warmup] RAR batch extract failed for %s: %v", comicID, err)
		return
	}
	if warmed > 0 {
		log.Printf("[warmup] RAR batch pre-cached %d pages for %s (pages %d-%d)", warmed, comicID, start, end-1)
	}
}

// pageExistsInCache 检查某页是否已在磁盘缓存中。
func pageExistsInCache(cacheDir string, pageIndex int) bool {
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		return false
	}
	prefix := fmt.Sprintf("%d.", pageIndex)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix) {
			return true
		}
	}
	return false
}

// ============================================================
// Get page count from archive (used by fullSync)
// ============================================================

// GetArchivePageCount opens an archive and counts image entries (or chapters for novels).
func GetArchivePageCount(fp string) (int, error) {
	archiveType := archive.DetectType(fp)

	if archiveType == archive.TypePdf {
		return archive.GetPdfPageCount(fp)
	}

	reader, err := archive.NewReader(fp)
	if err != nil {
		return 0, err
	}
	defer reader.Close()

	// For novel formats, count chapters (non-directory entries)
	if archive.IsNovelType(archiveType) {
		count := 0
		for _, e := range reader.ListEntries() {
			if !e.IsDirectory {
				count++
			}
		}
		return count, nil
	}

	images := archive.GetImageEntries(reader)
	return len(images), nil
}
