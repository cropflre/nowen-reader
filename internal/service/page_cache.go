package service

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
)

// PageFile can be served directly after the handler has checked permissions.
type PageFile struct {
	Path     string
	MimeType string
	ETag     string
	ModTime  time.Time
	Size     int64
}

type pageDiskIndex struct {
	once  sync.Once
	mu    sync.Mutex
	paths map[int]string
	used  time.Time
}

var pageIndexes = struct {
	sync.Mutex
	dirs map[string]*pageDiskIndex
}{dirs: make(map[string]*pageDiskIndex)}

func readerCacheDir(comicID, source string, info os.FileInfo) string {
	signature := sha256.Sum256([]byte(fmt.Sprintf("reader-v1|%s|%d|%d", source, info.Size(), info.ModTime().UnixNano())))
	return filepath.Join(config.GetPagesCacheDir(), comicID, "reader", fmt.Sprintf("%x", signature[:12]))
}

func diskIndex(dir string) *pageDiskIndex {
	pageIndexes.Lock()
	index := pageIndexes.dirs[dir]
	if index == nil {
		if len(pageIndexes.dirs) >= 64 {
			oldest := ""
			for key, value := range pageIndexes.dirs {
				if oldest == "" || value.used.Before(pageIndexes.dirs[oldest].used) {
					oldest = key
				}
			}
			delete(pageIndexes.dirs, oldest)
		}
		index = &pageDiskIndex{paths: make(map[int]string)}
		pageIndexes.dirs[dir] = index
	}
	index.used = time.Now()
	pageIndexes.Unlock()
	index.once.Do(func() {
		entries, _ := os.ReadDir(dir)
		index.mu.Lock()
		defer index.mu.Unlock()
		for _, entry := range entries {
			if entry.IsDir() || !config.IsImageFile(entry.Name()) {
				continue
			}
			ext := filepath.Ext(entry.Name())
			page, err := strconv.Atoi(strings.TrimSuffix(entry.Name(), ext))
			if err == nil && page >= 0 {
				index.paths[page] = filepath.Join(dir, entry.Name())
			}
		}
	})
	return index
}

func describePageFile(path string) (*PageFile, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return nil, fmt.Errorf("empty or non-regular page file: %s", path)
	}
	// Metadata-based validation avoids reading and hashing the entire image.
	signature := sha256.Sum256([]byte(path))
	return &PageFile{
		Path: path, MimeType: archive.GetMimeType(path), Size: info.Size(), ModTime: info.ModTime(),
		ETag: fmt.Sprintf(`W/"%x-%x-%x"`, signature[:8], info.Size(), info.ModTime().UnixNano()),
	}, nil
}

func cachedPageFile(dir string, page int) *PageFile {
	index := diskIndex(dir)
	index.mu.Lock()
	path := index.paths[page]
	index.mu.Unlock()
	if path == "" {
		return nil
	}
	file, err := describePageFile(path)
	if err != nil {
		index.mu.Lock()
		delete(index.paths, page)
		index.mu.Unlock()
		return nil
	}
	return file
}

func writePageFile(dir string, page int, ext string, data []byte) (*PageFile, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty page %d", page)
	}
	index := diskIndex(dir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(dir, ".page-*.tmp")
	if err != nil {
		return nil, err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	_, err = file.Write(data)
	closeErr := file.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	path := filepath.Join(dir, strconv.Itoa(page)+ext)
	if err := os.Rename(tmp, path); err != nil {
		return nil, err
	}
	index.mu.Lock()
	index.paths[page] = path
	index.mu.Unlock()
	return describePageFile(path)
}

func invalidatePageIndexes() {
	pageIndexes.Lock()
	pageIndexes.dirs = make(map[string]*pageDiskIndex)
	pageIndexes.Unlock()
}

type pageFileCall struct {
	done chan struct{}
	file *PageFile
	err  error
}

var pageFileCalls = struct {
	sync.Mutex
	calls map[string]*pageFileCall
}{calls: make(map[string]*pageFileCall)}

// Background work occupies at most one of the two extraction slots, leaving
// capacity for a foreground request for another page or book.
var pageExtractSlots = make(chan struct{}, 2)

func reservePageFile(key string) (*pageFileCall, bool) {
	pageFileCalls.Lock()
	defer pageFileCalls.Unlock()
	if existing := pageFileCalls.calls[key]; existing != nil {
		return existing, false
	}
	call := &pageFileCall{done: make(chan struct{})}
	pageFileCalls.calls[key] = call
	return call, true
}

func finishPageFile(key string, call *pageFileCall, file *PageFile, err error) {
	pageFileCalls.Lock()
	defer pageFileCalls.Unlock()
	call.file, call.err = file, err
	delete(pageFileCalls.calls, key)
	close(call.done)
}

func pageFileKey(dir string, page int) string { return filepath.Join(dir, strconv.Itoa(page)) }
