package service

import (
	"fmt"
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
	readerPoolTTL = 60 * time.Second
	readerPoolMax = 5
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
	readerPoolMu.Lock()
	defer readerPoolMu.Unlock()

	if cached, ok := readerPool[fp]; ok {
		cached.lastUsed = time.Now()
		return cached.reader, nil
	}

	reader, err := archive.NewReader(fp)
	if err != nil {
		return nil, err
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
	entries []string
	ts      time.Time
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
	for _, dir := range config.GetAllComicsDirs() {
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

// GetComicPages returns the sorted list of page entry names for a comic.
func GetComicPages(comicID string) ([]string, error) {
	// Check cache
	pageListCacheMu.RLock()
	if cached, ok := pageListCache[comicID]; ok && time.Since(cached.ts) < pageListCacheTTL {
		pageListCacheMu.RUnlock()
		return cached.entries, nil
	}
	pageListCacheMu.RUnlock()

	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}

	archiveType := archive.DetectType(fp)
	var entries []string

	if archiveType == archive.TypePdf {
		count, err := archive.GetPdfPageCount(fp)
		if err != nil {
			return nil, err
		}
		entries = make([]string, count)
		for i := 0; i < count; i++ {
			entries[i] = fmt.Sprintf("page-%04d.png", i+1)
		}
	} else {
		reader, err := getPooledReader(fp)
		if err != nil {
			return nil, err
		}
		entries = archive.GetImageEntries(reader)
	}

	// Update cache
	pageListCacheMu.Lock()
	pageListCache[comicID] = &pageListCacheEntry{entries: entries, ts: time.Now()}
	pageListCacheMu.Unlock()

	return entries, nil
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

// GetComicThumbnail returns the thumbnail for a comic.
func GetComicThumbnail(comicID string) ([]byte, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}
	return archive.GenerateThumbnail(fp, comicID)
}

// ============================================================
// Get page count from archive (used by fullSync)
// ============================================================

// GetArchivePageCount opens an archive and counts image entries.
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

	images := archive.GetImageEntries(reader)
	return len(images), nil
}
