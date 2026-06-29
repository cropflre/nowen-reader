package service

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
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
	isNovel       bool
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

	// 图片文件夹漫画：filename 以 "/" 结尾
	isFolder := strings.HasSuffix(comic.Filename, "/")

	// Search all directories for the file
	for _, dir := range config.GetAllScanDirs() {
		fp := filepath.Join(dir, comic.Filename)
		if isFolder {
			// 文件夹类型：去掉尾部斜杠后检查目录是否存在
			fp = filepath.Join(dir, strings.TrimSuffix(comic.Filename, "/"))
			if info, err := os.Stat(fp); err == nil && info.IsDir() {
				return fp, comic.Filename, nil
			}
		} else {
			if _, err := os.Stat(fp); err == nil {
				return fp, comic.Filename, nil
			}
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

	// 优先使用数据库中的 type 字段判断是否为小说
	// 这样可以正确处理被标记为漫画的 epub 文件（图片为主的 epub）
	isNovel := archive.IsNovelType(archiveType)
	if archive.IsEbookType(archiveType) {
		comic, dbErr := store.GetComicByID(comicID)
		if dbErr == nil && comic != nil {
			if comic.ComicType == "comic" {
				isNovel = false // 数据库中标记为漫画，覆盖默认的小说判断
			} else if comic.ComicType == "novel" && (archiveType == archive.TypeMobi || archiveType == archive.TypeAzw3) {
				// MOBI/AZW3 文件默认被标记为 novel，但可能实际是图片为主的漫画
				// 在首次打开时进行实时检测，如果是图片为主则自动修正类型（纯 Go，无需 Calibre）
				if archive.IsMobiImageHeavy(fp) {
					log.Printf("[pages] Auto-detected image-heavy %s, reclassifying as comic: %s", archiveType, comic.Filename)
					_ = store.UpdateComicType(comicID, "comic")
					// Recalculate page count: novel mode counts chapters,
					// comic mode needs image count
					if imgCount, err := GetArchivePageCount(fp, true); err == nil && imgCount > 0 {
						_ = store.UpdateComicPageCount(comicID, imgCount)
					}
					isNovel = false
				}
			}
		}
	}

	// Check cache for entries
	pageListCacheMu.RLock()
	if cached, ok := pageListCache[comicID]; ok && time.Since(cached.ts) < pageListCacheTTL && cached.isNovel == isNovel {
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
		// E-book archives in comic mode: treat embedded images as pages
		// (epub/mobi/azw3 readers return chapter entries, not image files)
		if archive.IsEbookType(archiveType) && !isNovel {
			switch archiveType {
			case archive.TypeMobi, archive.TypeAzw3:
				entries = archive.ListMobiEmbeddedImages(reader)
			default:
				entries = archive.ListEpubEmbeddedImages(reader)
			}
		} else {
			entries = archive.GetImageEntries(reader)
		}
	}

	// Update cache
	pageListCacheMu.Lock()
	pageListCache[comicID] = &pageListCacheEntry{entries: entries, chapterTitles: chapterTitles, isPdf: isPdf, isNovel: isNovel, ts: time.Now()}
	pageListCacheMu.Unlock()

	// Invalidate disk cache if page order changed (e.g. zip→spine order fix)
	invalidatePageImageCacheIfNeeded(comicID, entries)

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
	case archive.TypeEpub:
		return archive.GetEpubChapterTitles(r)
	case archive.TypeMobi, archive.TypeAzw3:
		// 优先尝试 MOBI 原生解析器的章节标题
		if titles := archive.GetMobiChapterTitles(r); titles != nil {
			return titles
		}
		// 回退到 EPUB 解析器（Calibre 转换后的情况）
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
	archiveType := archive.DetectType(fp)
	isImageFolder := archiveType == archive.TypeImageFolder

	// 图片文件夹漫画不使用磁盘缓存（图片本身就在磁盘上，无需复制）
	if !isImageFolder {
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
	}

	// Extract from archive
	reader, err := getPooledReader(fp)
	if err != nil {
		return nil, err
	}

	// For e-book archives, use embedded image extraction
	// (epub/mobi/azw3 readers list chapter entries, not image files)
	var images []string
	if archive.IsEbookType(archiveType) {
		switch archiveType {
		case archive.TypeMobi, archive.TypeAzw3:
			images = archive.ListMobiEmbeddedImages(reader)
		default:
			images = archive.ListEpubEmbeddedImages(reader)
		}
	} else {
		images = archive.GetImageEntries(reader)
	}
	if pageIndex < 0 || pageIndex >= len(images) {
		return nil, fmt.Errorf("page index %d out of range (0-%d)", pageIndex, len(images)-1)
	}

	entryName := images[pageIndex]

	var data []byte
	var mimeType string

	if archive.IsEbookType(archiveType) {
		switch archiveType {
		case archive.TypeMobi, archive.TypeAzw3:
			imgData, imgMime, err := archive.GetMobiEmbeddedImageData(reader, pageIndex)
			if err != nil {
				return nil, fmt.Errorf("extract page %d: %w", pageIndex, err)
			}
			data = imgData
			mimeType = imgMime
		default:
			imgData, imgMime, err := archive.GetEpubEmbeddedImageData(reader, entryName)
			if err != nil {
				return nil, fmt.Errorf("extract page %d: %w", pageIndex, err)
			}
			data = imgData
			mimeType = imgMime
		}
	} else {
		data, err = reader.ExtractEntry(entryName)
		if err != nil {
			return nil, fmt.Errorf("extract page %d: %w", pageIndex, err)
		}
		mimeType = archive.GetMimeType(entryName)
	}

	ext := strings.ToLower(filepath.Ext(entryName))
	if ext == "" && archive.IsEbookType(archiveType) {
		ext = ".jpg" // MOBI/AZW3 entries have no file extension; use .jpg as default
	}

	// Write to disk cache (fire-and-forget) — 图片文件夹漫画跳过缓存
	if !isImageFolder {
		go func() {
			if err := os.MkdirAll(cacheDir, 0755); err != nil {
				return
			}
			cachePath := filepath.Join(cacheDir, fmt.Sprintf("%d%s", pageIndex, ext))
			tmpPath := cachePath + fmt.Sprintf(".%d.tmp", time.Now().UnixNano())
			defer os.Remove(tmpPath) // Ensures cleanup regardless of panics or early exits
			if err := os.WriteFile(tmpPath, data, 0644); err == nil {
				_ = os.Rename(tmpPath, cachePath)
			}
		}()
	}

	return &PageImage{Data: data, MimeType: mimeType}, nil
}

// getPdfPageImage renders a PDF page dynamically to JPEG or PNG.
func getPdfPageImage(comicID, fp string, pageIndex int) (*PageImage, error) {
	cacheDir := filepath.Join(config.GetPagesCacheDir(), comicID)

	// Check disk cache for JPEG first
	jpgPath := filepath.Join(cacheDir, fmt.Sprintf("%d.jpg", pageIndex))
	if data, err := os.ReadFile(jpgPath); err == nil {
		return &PageImage{Data: data, MimeType: "image/jpeg"}, nil
	}

	// Check disk cache for PNG fallback
	pngPath := filepath.Join(cacheDir, fmt.Sprintf("%d.png", pageIndex))
	if data, err := os.ReadFile(pngPath); err == nil {
		return &PageImage{Data: data, MimeType: "image/png"}, nil
	}

	// 动态计算用于阅读的最佳 DPI
	targetDPI := 200 // 默认值
	if w, _, err := archive.GetPdfPageSize(fp, pageIndex); err == nil && w > 0 {
		// 目标宽度定为 1920 像素，确保在现代高分屏上足够清晰
		targetDPI = archive.CalcReadingDPI(w, 1920)
	}

	// Render from PDF (returns data, ext, error)
	data, ext, err := archive.RenderPdfPage(fp, pageIndex, targetDPI)
	if err != nil {
		return nil, fmt.Errorf("render PDF page %d: %w", pageIndex, err)
	}

	mimeType := "image/jpeg"
	if ext == ".png" {
		mimeType = "image/png"
	}

	cachePath := filepath.Join(cacheDir, fmt.Sprintf("%d%s", pageIndex, ext))

	// Cache to disk (fire-and-forget)
	go func() {
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			return
		}
		tmpPath := cachePath + fmt.Sprintf(".%d.tmp", time.Now().UnixNano())
		defer os.Remove(tmpPath) // Ensures cleanup regardless of panics or early exits
		if err := os.WriteFile(tmpPath, data, 0644); err == nil {
			_ = os.Rename(tmpPath, cachePath)
		}
	}()

	return &PageImage{Data: data, MimeType: mimeType}, nil
}

// ============================================================
// Get comic thumbnail
// ============================================================

// GetComicThumbnail returns the thumbnail and cover aspect ratio for a comic.
func GetComicThumbnail(comicID string) ([]byte, string, float64, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, "", 0, err
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
		// 仅对漫画格式预热（小说、PDF和图片文件夹不需要）
		if archive.IsNovelType(archiveType) || archiveType == archive.TypePdf || archiveType == archive.TypeImageFolder {
			return
		}

		reader, err := getPooledReader(fp)
		if err != nil {
			return
		}

		var images []string
		if archive.IsEbookType(archiveType) {
			switch archiveType {
			case archive.TypeMobi, archive.TypeAzw3:
				images = archive.ListMobiEmbeddedImages(reader)
			default:
				images = archive.ListEpubEmbeddedImages(reader)
			}
		} else {
			images = archive.GetImageEntries(reader)
		}
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

		// E-book archives in comic mode: use dedicated warmup (different extraction path)
		isEbookComic := archive.IsEbookType(archiveType)

		if isEbookComic {
			warmupEbookComic(comicID, archiveType, reader, images, startPage, end, cacheDir)
		} else if archiveType == archive.TypeRar {
			// 方案 C: RAR 批量解压优化
			warmupRarBatch(fp, comicID, images, startPage, end, cacheDir)
		} else {
			// ZIP/7z 等格式逐页解压（支持随机访问，性能好）
			warmupNormal(reader, comicID, images, startPage, end, cacheDir)
		}
	}()
}

// warmupEbookComic 对电子书漫画格式（EPUB/MOBI/AZW3）逐页预热缓存。
// 与普通漫画不同，电子书漫画使用专用的图片提取接口（按索引而非按路径）。
func warmupEbookComic(comicID string, archiveType archive.ArchiveType, reader archive.Reader, images []string, start, end int, cacheDir string) {
	warmed := 0
	cacheSet := buildCacheSet(cacheDir)
	for i := start; i < end; i++ {
		if cacheSetHas(cacheSet, i) {
			continue
		}

		var data []byte
		var mimeType string
		var err error

		switch archiveType {
		case archive.TypeMobi, archive.TypeAzw3:
			data, mimeType, err = archive.GetMobiEmbeddedImageData(reader, i)
		default: // EPUB
			data, mimeType, err = archive.GetEpubEmbeddedImageData(reader, images[i])
		}

		if err != nil {
			log.Printf("[warmup] Failed to extract page %d for %s: %v", i, comicID, err)
			continue
		}

		ext := ".jpg"
		switch mimeType {
		case "image/png":
			ext = ".png"
		case "image/gif":
			ext = ".gif"
		case "image/webp":
			ext = ".webp"
		}

		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			return
		}
		cachePath := filepath.Join(cacheDir, fmt.Sprintf("%d%s", i, ext))
		_ = os.WriteFile(cachePath, data, 0644)
		warmed++
	}
	if warmed > 0 {
		log.Printf("[warmup] Ebook pre-cached %d pages for %s (pages %d-%d)", warmed, comicID, start, end-1)
	}
}

// warmupNormal 对 ZIP/7z 等支持随机访问的格式逐页预热。
func warmupNormal(reader archive.Reader, comicID string, images []string, start, end int, cacheDir string) {
	warmed := 0
	cacheSet := buildCacheSet(cacheDir)
	for i := start; i < end; i++ {
		if cacheSetHas(cacheSet, i) {
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
	cacheSet := buildCacheSet(cacheDir)
	for i := start; i < end; i++ {
		if !cacheSetHas(cacheSet, i) {
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

// buildCacheSet reads the cache directory once and returns a set of cached page prefixes.
// This avoids O(n²) directory reads when checking many pages.
func buildCacheSet(cacheDir string) map[string]bool {
	set := make(map[string]bool)
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		return set
	}
	for _, e := range entries {
		name := e.Name()
		// Extract the page index prefix (e.g., "0." from "0.webp")
		if dot := strings.IndexByte(name, '.'); dot > 0 {
			set[name[:dot]] = true
		}
	}
	return set
}

// cacheSetHas checks if a page exists in the pre-built cache set.
func cacheSetHas(cacheSet map[string]bool, pageIndex int) bool {
	return cacheSet[strconv.Itoa(pageIndex)]
}

// ============================================================
// Get page count from archive (used by fullSync)
// ============================================================

// GetArchivePageCount opens an archive and counts image entries (or chapters for novels).
// When isComic is true for ebook formats, it counts embedded images instead of chapters.
func GetArchivePageCount(fp string, isComic ...bool) (int, error) {
	archiveType := archive.DetectType(fp)
	forceComic := len(isComic) > 0 && isComic[0]

	if archiveType == archive.TypePdf {
		return archive.GetPdfPageCount(fp)
	}

	// 图片文件夹漫画：直接使用 Reader 计算图片数量
	if archiveType == archive.TypeImageFolder {
		reader, err := archive.NewReader(fp)
		if err != nil {
			return 0, err
		}
		defer reader.Close()
		images := archive.GetImageEntries(reader)
		return len(images), nil
	}

	reader, err := archive.NewReader(fp)
	if err != nil {
		return 0, err
	}
	defer reader.Close()

	// For ebook archives marked as comic, count embedded images
	if archive.IsEbookType(archiveType) && forceComic {
		switch archiveType {
		case archive.TypeMobi, archive.TypeAzw3:
			return archive.CountMobiEmbeddedImages(reader), nil
		default:
			images := archive.ListEpubEmbeddedImages(reader)
			return len(images), nil
		}
	}

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

// invalidatePageImageCacheIfNeeded clears the disk-based page image cache
// for a comic when the page list order has changed (e.g., switching from
// zip-ordered to spine-ordered for manga EPUBs).
func invalidatePageImageCacheIfNeeded(comicID string, entries []string) {
	if len(entries) == 0 {
		return
	}

	cacheDir := filepath.Join(config.GetPagesCacheDir(), comicID)

	// Build a fingerprint from the first, middle, and last entry names + total count.
	// More robust than just first+last for detecting ordering changes.
	fingerprint := fmt.Sprintf("%s|%s|%s|%d",
		entries[0],
		entries[len(entries)/2],
		entries[len(entries)-1],
		len(entries))

	fpPath := filepath.Join(cacheDir, ".order-fp")
	existing, err := os.ReadFile(fpPath)
	if err == nil && string(existing) == fingerprint {
		return
	}

	entriesOnDisk, err := os.ReadDir(cacheDir)
	if err != nil {
		_ = os.MkdirAll(cacheDir, 0755)
		_ = os.WriteFile(fpPath, []byte(fingerprint), 0644)
		return
	}

	for _, e := range entriesOnDisk {
		if e.Name() == ".order-fp" {
			continue
		}
		_ = os.Remove(filepath.Join(cacheDir, e.Name()))
	}

	_ = os.MkdirAll(cacheDir, 0755)
	_ = os.WriteFile(fpPath, []byte(fingerprint), 0644)

	log.Printf("[cache] Invalidated page image cache for %s (order changed)", comicID)
}
