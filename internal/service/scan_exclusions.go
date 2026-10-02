package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const maxScanExclusionPatternLength = 1024
const scanExclusionSampleLimit = 50

var (
	ErrScanExclusionBusy     = errors.New("扫描正在运行，请稍后再试")
	ErrScanExclusionChanged  = errors.New("匹配结果已变化，请重新预览后再清理")
	ErrScanExclusionInactive = errors.New("请先保存扫描排除规则")
)

type ScanExclusionMatcher struct {
	pattern string
	re      *regexp.Regexp
}

type ScanExclusionSample struct {
	LibraryID    string `json:"libraryId"`
	LibraryName  string `json:"libraryName,omitempty"`
	RelativePath string `json:"relativePath"`
	Title        string `json:"title,omitempty"`
	Kind         string `json:"kind,omitempty"`
}

type ScanExclusionPreview struct {
	Pattern          string                `json:"pattern"`
	ExistingCount    int                   `json:"existingCount"`
	ExistingSamples  []ScanExclusionSample `json:"existingSamples"`
	DiskMatchCount   int                   `json:"diskMatchCount"`
	DiskSamples      []ScanExclusionSample `json:"diskSamples"`
	UnavailableRoots []string              `json:"unavailableRoots"`
	MatchHash        string                `json:"matchHash"`
}

func CompileScanExclusion(pattern string) (*ScanExclusionMatcher, error) {
	pattern = strings.TrimSpace(pattern)
	if len(pattern) > maxScanExclusionPatternLength {
		return nil, fmt.Errorf("排除规则不能超过 %d 个字符", maxScanExclusionPatternLength)
	}
	if pattern == "" {
		return &ScanExclusionMatcher{}, nil
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("排除规则不是有效的正则表达式: %w", err)
	}
	return &ScanExclusionMatcher{pattern: pattern, re: re}, nil
}

func (m *ScanExclusionMatcher) Pattern() string {
	return m.pattern
}

func currentScanExclusion() (*ScanExclusionMatcher, error) {
	cfg := config.GetSiteConfig()
	if cfg.ScannerConfig == nil {
		return CompileScanExclusion("")
	}
	return CompileScanExclusion(cfg.ScannerConfig.ExcludePathRegex)
}

// Matches tests the full library-relative path and each ancestor directory.
// An anchored directory pattern thus also excludes everything below it.
func (m *ScanExclusionMatcher) Matches(relativePath string) bool {
	if m == nil || m.re == nil {
		return false
	}
	clean := strings.Trim(strings.ReplaceAll(relativePath, "\\", "/"), "/")
	if clean == "" {
		return false
	}
	parts := strings.Split(clean, "/")
	for i := range parts {
		part := strings.Join(parts[:i+1], "/")
		if m.re.MatchString(part) || (i < len(parts)-1 && m.re.MatchString(part+"/")) {
			return true
		}
	}
	return strings.HasSuffix(relativePath, "/") && m.re.MatchString(clean+"/")
}

func (m *ScanExclusionMatcher) matchesAbsolute(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && m.Matches(filepath.ToSlash(relative))
}

type scanExcludedComic struct {
	id     string
	sample ScanExclusionSample
}

func matchingExcludedComics(matcher *ScanExclusionMatcher) ([]scanExcludedComic, error) {
	if matcher == nil || matcher.re == nil {
		return nil, nil
	}
	rows, err := store.DB().Query(`
		SELECT c."id", COALESCE(c."libraryId", ''), COALESCE(l."name", ''),
		       COALESCE(NULLIF(c."relativePath", ''), c."filename"), COALESCE(c."title", '')
		FROM "Comic" c LEFT JOIN "Library" l ON l."id" = c."libraryId" ORDER BY c."id"
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var matches []scanExcludedComic
	for rows.Next() {
		var item scanExcludedComic
		if err := rows.Scan(&item.id, &item.sample.LibraryID, &item.sample.LibraryName, &item.sample.RelativePath, &item.sample.Title); err != nil {
			return nil, err
		}
		if item.sample.LibraryID != "" && matcher.Matches(item.sample.RelativePath) {
			matches = append(matches, item)
		}
	}
	return matches, rows.Err()
}

func exclusionMatchHash(pattern string, matches []scanExcludedComic) string {
	h := sha256.New()
	h.Write([]byte(pattern))
	for _, item := range matches {
		h.Write([]byte{0})
		h.Write([]byte(item.id))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// PreviewScanExclusions shows both existing database records and filesystem
// entries that a future scan would skip. A matched directory counts once.
func PreviewScanExclusions(pattern string) (*ScanExclusionPreview, error) {
	matcher, err := CompileScanExclusion(pattern)
	if err != nil {
		return nil, err
	}
	preview := &ScanExclusionPreview{
		Pattern:          matcher.pattern,
		ExistingSamples:  []ScanExclusionSample{},
		DiskSamples:      []ScanExclusionSample{},
		UnavailableRoots: []string{},
	}
	matches, err := matchingExcludedComics(matcher)
	if err != nil {
		return nil, err
	}
	preview.ExistingCount = len(matches)
	preview.MatchHash = exclusionMatchHash(matcher.pattern, matches)
	for _, item := range matches {
		if len(preview.ExistingSamples) >= scanExclusionSampleLimit {
			break
		}
		preview.ExistingSamples = append(preview.ExistingSamples, item.sample)
	}
	if matcher.re == nil {
		return preview, nil
	}

	libraries, err := store.GetScannableLibraries()
	if err != nil {
		return nil, err
	}
	ownership, err := LoadLibraryOwnership()
	if err != nil {
		return nil, err
	}
	sort.Slice(libraries, func(i, j int) bool { return libraries[i].ID < libraries[j].ID })
	seen := make(map[string]bool)
	for _, lib := range libraries {
		roots := lib.RootPaths
		if len(roots) == 0 {
			roots = []string{lib.RootPath}
		}
		for _, root := range roots {
			if ownership.RootHasExactConflict(root) || !ownership.IsOwnedBy(lib.ID, root) {
				continue
			}
			if info, err := os.Stat(root); err != nil || !info.IsDir() {
				preview.UnavailableRoots = append(preview.UnavailableRoots, root)
				continue
			}
			err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if path == root {
					return nil
				}
				if !ownership.IsOwnedBy(lib.ID, path) {
					if entry.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
				if !matcher.matchesAbsolute(root, path) {
					return nil
				}
				if !entry.IsDir() && !config.IsSupportedFile(entry.Name()) {
					return nil
				}
				key := lib.ID + "\x00" + path
				if !seen[key] {
					seen[key] = true
					preview.DiskMatchCount++
					if len(preview.DiskSamples) < scanExclusionSampleLimit {
						relative, _ := filepath.Rel(root, path)
						kind := "file"
						if entry.IsDir() {
							kind = "directory"
						}
						preview.DiskSamples = append(preview.DiskSamples, ScanExclusionSample{
							LibraryID: lib.ID, LibraryName: lib.Name,
							RelativePath: filepath.ToSlash(relative), Kind: kind,
						})
					}
				}
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			})
			if err != nil {
				preview.UnavailableRoots = append(preview.UnavailableRoots, root+": "+err.Error())
			}
		}
	}
	return preview, nil
}

// CleanupScanExclusions removes only records shown by the confirmed preview.
// Files remain on disk; the active exclusion keeps them from being reimported.
func CleanupScanExclusions(matchHash string) (int, error) {
	syncMu.Lock()
	if syncInProgress {
		syncMu.Unlock()
		return 0, ErrScanExclusionBusy
	}
	syncInProgress = true
	syncMu.Unlock()
	defer func() {
		syncMu.Lock()
		syncInProgress = false
		syncMu.Unlock()
	}()

	matcher, err := currentScanExclusion()
	if err != nil {
		return 0, err
	}
	if matcher.re == nil {
		return 0, ErrScanExclusionInactive
	}
	matches, err := matchingExcludedComics(matcher)
	if err != nil {
		return 0, err
	}
	if matchHash == "" || matchHash != exclusionMatchHash(matcher.pattern, matches) {
		return 0, ErrScanExclusionChanged
	}
	for start := 0; start < len(matches); start += 500 {
		end := start + 500
		if end > len(matches) {
			end = len(matches)
		}
		ids := make([]string, 0, end-start)
		for _, item := range matches[start:end] {
			ids = append(ids, item.id)
		}
		if err := store.BulkDeleteComicsByIDs(ids); err != nil {
			return start, err
		}
	}
	if len(matches) > 0 {
		InvalidateAllCaches()
	}
	return len(matches), nil
}

func scannerPathRoot(path string, roots []string) string {
	best := ""
	for _, root := range roots {
		rel, err := filepath.Rel(root, path)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && len(root) > len(best) {
			best = root
		}
	}
	return best
}
