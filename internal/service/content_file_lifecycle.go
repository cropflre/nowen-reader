package service

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/archive"
)

// InvalidateContentFileCaches closes cached archive readers that keep source
// files open on Windows and clears metadata derived from the content file.
func InvalidateContentFileCaches(comicID, absolutePath string) {
	if absolutePath != "" {
		readerPoolMu.Lock()
		for cachedPath, cached := range readerPool {
			if sameContentFilePath(cachedPath, absolutePath) {
				cached.reader.Close()
				delete(readerPool, cachedPath)
			}
		}
		readerPoolMu.Unlock()

		archive.ClearPdfPageCountCache(absolutePath)
	}

	if comicID != "" {
		prefix := comicID + ":"
		pageListCacheMu.Lock()
		for cacheKey := range pageListCache {
			if cacheKey == comicID || strings.HasPrefix(cacheKey, prefix) {
				delete(pageListCache, cacheKey)
			}
		}
		pageListCacheMu.Unlock()
	}
}

// RemoveContentFile releases internal readers and retries transient Windows
// sharing violations before returning an error. A missing file is considered
// successfully removed.
func RemoveContentFile(comicID, absolutePath string) error {
	absolutePath = strings.TrimSpace(absolutePath)
	if absolutePath == "" {
		return nil
	}

	cleaned := filepath.Clean(absolutePath)
	if cleaned == "." || filepath.Dir(cleaned) == cleaned {
		return fmt.Errorf("refusing to remove unsafe content path: %s", absolutePath)
	}

	if _, err := os.Lstat(cleaned); err != nil {
		if os.IsNotExist(err) {
			InvalidateContentFileCaches(comicID, cleaned)
			return nil
		}
		return fmt.Errorf("inspect content file %s: %w", cleaned, err)
	}

	// Close the EPUB/ZIP reader pool first. zip.OpenReader keeps the source file
	// handle open, which makes os.RemoveAll fail with ERROR_SHARING_VIOLATION on
	// Windows even though the application itself is the process holding the file.
	InvalidateContentFileCaches(comicID, cleaned)

	delays := []time.Duration{
		0,
		50 * time.Millisecond,
		100 * time.Millisecond,
		200 * time.Millisecond,
		400 * time.Millisecond,
		800 * time.Millisecond,
	}
	var lastErr error
	for attempt, delay := range delays {
		if delay > 0 {
			time.Sleep(delay)
			InvalidateContentFileCaches(comicID, cleaned)
		}

		// Read-only files can also fail deletion on Windows. Making the top-level
		// file writable is safe here because it is about to be removed.
		if info, err := os.Lstat(cleaned); err == nil && !info.IsDir() {
			_ = os.Chmod(cleaned, 0666)
		}

		if err := os.RemoveAll(cleaned); err == nil || os.IsNotExist(err) {
			return nil
		} else {
			lastErr = err
		}

		if attempt == 0 && runtime.GOOS == "windows" {
			// Give finalizers from third-party parsers a chance to release any
			// short-lived handles not owned by the explicit reader pool.
			runtime.GC()
		}
	}

	return fmt.Errorf("remove content file %s after cache release and retries: %w", cleaned, lastErr)
}

// IsReadOnlyOrPermissionError reports whether a filesystem failure is caused by
// a read-only mount (e.g. Docker :ro volume) or insufficient filesystem write permission.
func IsReadOnlyOrPermissionError(err error) bool {
	if err == nil {
		return false
	}
	if os.IsPermission(err) {
		return true
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "read-only file system") ||
		strings.Contains(lower, "permission denied") ||
		strings.Contains(lower, "access is denied") ||
		strings.Contains(lower, "erofs")
}

// PruneEmptyParentDirs walks upward from the deleted content's parent directory
// and removes subdirectories that became completely empty (ignoring OS thumbnail
///metadata junk such as .DS_Store or Thumbs.db), stopping strictly before rootPath.
func PruneEmptyParentDirs(deletedContentPath, rootPath string) {
	deletedClean := canonicalContentFilePath(deletedContentPath)
	rootClean := canonicalContentFilePath(rootPath)
	if deletedClean == "." || rootClean == "." || rootPath == "" {
		return
	}

	dir := filepath.Dir(deletedClean)
	for {
		if sameContentFilePath(dir, rootClean) {
			break
		}
		rel, err := filepath.Rel(rootClean, dir)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			break
		}

		entries, err := os.ReadDir(dir)
		if err != nil {
			break
		}
		var blockers int
		var junkFiles []string
		for _, entry := range entries {
			name := entry.Name()
			if !entry.IsDir() && (name == ".DS_Store" || strings.EqualFold(name, "Thumbs.db") || strings.EqualFold(name, "desktop.ini")) {
				junkFiles = append(junkFiles, filepath.Join(dir, name))
				continue
			}
			blockers++
			break
		}
		if blockers > 0 {
			break
		}
		for _, jf := range junkFiles {
			_ = os.Remove(jf)
		}
		if err := os.Remove(dir); err != nil {
			break
		}
		dir = filepath.Dir(dir)
	}
}

// RemoveContentFileAndPruneDirs deletes the source file/folder and prunes any
// empty parent subdirectories inside rootPath, wrapping permission/read-only
// mount failures with a human-friendly Chinese diagnostic.
func RemoveContentFileAndPruneDirs(comicID, absolutePath, rootPath string) error {
	if err := RemoveContentFile(comicID, absolutePath); err != nil {
		if IsReadOnlyOrPermissionError(err) {
			return fmt.Errorf("书库目录为只读挂载或无写入权限，无法删除磁盘源文件: %w", err)
		}
		return err
	}
	PruneEmptyParentDirs(absolutePath, rootPath)
	return nil
}

func sameContentFilePath(left, right string) bool {
	left = canonicalContentFilePath(left)
	right = canonicalContentFilePath(right)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func canonicalContentFilePath(value string) string {
	cleaned := filepath.Clean(value)
	if absolute, err := filepath.Abs(cleaned); err == nil {
		cleaned = absolute
	}
	return cleaned
}
