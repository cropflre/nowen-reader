package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"unicode"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type directoryOrganizePlan struct {
	ComicID     string `json:"comicId"`
	Mode        string `json:"mode"`
	From        string `json:"from"`
	To          string `json:"to"`
	TargetRoot  string `json:"targetRoot,omitempty"`
	DryRun      bool   `json:"dryRun"`
	FolderComic bool   `json:"folderComic"`
}

func runDirectoryOrganizeAction(batchID string, ids []string, rule *config.DirectoryOrganizeRule, dryRun bool) (organized, skipped, failed int) {
	if rule == nil || !rule.Enabled || len(ids) == 0 {
		return 0, 0, 0
	}

	mode := strings.ToLower(strings.TrimSpace(rule.Mode))
	if mode == "" {
		mode = "hardlink"
	}
	if mode != "hardlink" && mode != "move" {
		mode = "hardlink"
	}
	strategy := strings.ToLower(strings.TrimSpace(rule.Strategy))
	if strategy == "" {
		strategy = "smartdir"
	}

	hardlinkTargetDir := strings.TrimSpace(rule.HardlinkTargetDir)
	if hardlinkTargetDir == "" {
		hardlinkTargetDir = config.DefaultOrganizedLibraryDir()
	}
	if mode == "hardlink" {
		if abs, err := filepath.Abs(hardlinkTargetDir); err == nil {
			hardlinkTargetDir = abs
		}
		if isInsideAnyScanRoot(hardlinkTargetDir) {
			failed += len(ids)
			for _, id := range ids {
				_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
					BatchID: batchID,
					ComicID: id,
					Action:  "directory_organize",
					Status:  "failed",
					Message: "hardlink target directory must not be inside any scan directory: " + hardlinkTargetDir,
				})
			}
			return 0, 0, failed
		}
	}

	updateProgress(func(p *ScanRuleProgress) {
		p.Stage = "directory_organize"
		p.StageLabel = "目录整理"
		p.Current = 0
		p.Total = len(ids)
		p.CurrentDir = ""
	})

	for _, id := range ids {
		comic, err := store.GetComicByID(id)
		if err != nil || comic == nil {
			skipped++
			updateProgress(func(p *ScanRuleProgress) { p.Skipped++; p.Current++ })
			continue
		}

		oldRel := normalizeScanRelPath(comic.Filename)
		targetRel := buildDirectoryOrganizeRelPath(oldRel, strategy)
		if oldRel == "" || targetRel == "" {
			skipped++
			updateProgress(func(p *ScanRuleProgress) { p.Skipped++; p.Current++ })
			continue
		}

		displayDir := path.Dir(strings.TrimSuffix(oldRel, "/"))
		if displayDir == "." || displayDir == "/" {
			displayDir = path.Base(strings.TrimSuffix(oldRel, "/"))
		}
		updateProgress(func(p *ScanRuleProgress) { p.CurrentDir = displayDir })

		sourceAbs, scanRoot, found := findComicDiskPath(oldRel)
		if !found {
			failed++
			updateProgress(func(p *ScanRuleProgress) { p.Failed++; p.Current++ })
			_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
				BatchID: batchID,
				ComicID: id,
				Action:  "directory_organize",
				Status:  "failed",
				Message: "source file not found: " + oldRel,
			})
			continue
		}

		plan := directoryOrganizePlan{
			ComicID:     id,
			Mode:        mode,
			From:        oldRel,
			To:          targetRel,
			TargetRoot:  hardlinkTargetDir,
			DryRun:      dryRun,
			FolderComic: strings.HasSuffix(oldRel, "/"),
		}

		var changed bool
		if mode == "move" {
			changed, err = applyDirectoryMovePlan(batchID, comic.ID, oldRel, targetRel, sourceAbs, scanRoot, dryRun, plan)
		} else {
			changed, err = applyDirectoryHardlinkPlan(batchID, comic.ID, oldRel, targetRel, sourceAbs, hardlinkTargetDir, dryRun, plan)
		}
		if err != nil {
			failed++
			updateProgress(func(p *ScanRuleProgress) { p.Failed++; p.Current++ })
			_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
				BatchID:   batchID,
				ComicID:   id,
				Action:    "directory_organize",
				Status:    "failed",
				FromValue: oldRel,
				ToValue:   targetRel,
				Message:   err.Error(),
			})
			continue
		}
		if changed {
			organized++
			updateProgress(func(p *ScanRuleProgress) { p.DirectoryOrganized++; p.Current++ })
		} else {
			skipped++
			updateProgress(func(p *ScanRuleProgress) { p.Skipped++; p.Current++ })
		}
	}

	return organized, skipped, failed
}

func applyDirectoryMovePlan(batchID, comicID, oldRel, targetRel, sourceAbs, scanRoot string, dryRun bool, plan directoryOrganizePlan) (bool, error) {
	if sameSlashPath(oldRel, targetRel) {
		return false, nil
	}

	newID := store.FilenameToID(targetRel)
	if newID != comicID {
		if existing, _ := store.GetComicByID(newID); existing != nil {
			return false, fmt.Errorf("target comic already exists in database: %s", targetRel)
		}
	}
	if exists, err := store.ComicFilenameExists(targetRel, comicID); err != nil {
		return false, err
	} else if exists {
		return false, fmt.Errorf("target filename already exists in database: %s", targetRel)
	}

	targetAbs := filepath.Join(scanRoot, filepath.FromSlash(strings.TrimSuffix(targetRel, "/")))
	if sameDiskPath(sourceAbs, targetAbs) {
		return false, nil
	}
	if pathExists(targetAbs) {
		return false, fmt.Errorf("target path already exists: %s", targetAbs)
	}
	if wouldMoveIntoItself(sourceAbs, targetAbs) {
		return false, fmt.Errorf("refuse to move directory into itself: %s -> %s", sourceAbs, targetAbs)
	}

	planBytes, _ := json.Marshal(plan)
	if dryRun {
		_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
			BatchID:   batchID,
			ComicID:   comicID,
			Action:    "directory_organize",
			Status:    "dryRun",
			FromValue: oldRel,
			ToValue:   targetRel,
			Message:   string(planBytes),
		})
		return true, nil
	}

	if err := os.MkdirAll(filepath.Dir(targetAbs), 0755); err != nil {
		return false, err
	}
	if err := os.Rename(sourceAbs, targetAbs); err != nil {
		return false, err
	}
	if err := store.UpdateComicIdentityAfterMove(comicID, newID, targetRel, ""); err != nil {
		_ = os.Rename(targetAbs, sourceAbs)
		return false, err
	}
	cleanupEmptyParents(scanRoot, sourceAbs)

	_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
		BatchID:   batchID,
		ComicID:   newID,
		Action:    "directory_organize",
		Status:    "success",
		FromValue: oldRel,
		ToValue:   targetRel,
		Message:   string(planBytes),
	})
	return true, nil
}

func applyDirectoryHardlinkPlan(batchID, comicID, oldRel, targetRel, sourceAbs, targetRoot string, dryRun bool, plan directoryOrganizePlan) (bool, error) {
	if strings.TrimSpace(targetRoot) == "" {
		return false, fmt.Errorf("hardlink target directory is empty")
	}
	targetAbs := filepath.Join(targetRoot, filepath.FromSlash(strings.TrimSuffix(targetRel, "/")))
	planBytes, _ := json.Marshal(plan)

	if dryRun {
		_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
			BatchID:   batchID,
			ComicID:   comicID,
			Action:    "directory_organize",
			Status:    "dryRun",
			FromValue: oldRel,
			ToValue:   targetAbs,
			Message:   string(planBytes),
		})
		return true, nil
	}

	var err error
	if strings.HasSuffix(oldRel, "/") {
		err = hardlinkDirectory(sourceAbs, targetAbs)
	} else {
		err = hardlinkFile(sourceAbs, targetAbs)
	}
	if err != nil {
		return false, err
	}

	_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
		BatchID:   batchID,
		ComicID:   comicID,
		Action:    "directory_organize",
		Status:    "success",
		FromValue: oldRel,
		ToValue:   targetAbs,
		Message:   string(planBytes),
	})
	return true, nil
}

func buildDirectoryOrganizeRelPath(filename, strategy string) string {
	rel := normalizeScanRelPath(filename)
	if rel == "" {
		return ""
	}
	isFolderComic := strings.HasSuffix(rel, "/")
	relNoSlash := strings.TrimSuffix(rel, "/")
	leaf := path.Base(relNoSlash)
	dir := path.Dir(relNoSlash)

	parts := cleanOrganizeDirParts(dir)
	if strings.EqualFold(strategy, "flat") && len(parts) > 1 {
		parts = []string{parts[0]}
	}
	if len(parts) == 0 {
		fallback := store.FilenameToSmartTitle(rel)
		if isFolderComic {
			fallback = leaf
		}
		fallback = sanitizeDirectorySegment(fallback)
		if fallback == "" {
			fallback = "未分类"
		}
		parts = append(parts, fallback)
	}

	if isFolderComic {
		leafDir := sanitizeDirectorySegment(store.CleanDirNameForGrouping(leaf))
		if leafDir == "" {
			leafDir = sanitizeDirectorySegment(leaf)
		}
		if leafDir != "" && !sameName(parts[len(parts)-1], leafDir) {
			parts = append(parts, leafDir)
		}
		return path.Join(parts...) + "/"
	}

	fileName := sanitizeFileNameSegment(leaf)
	if fileName == "" {
		return ""
	}
	parts = append(parts, fileName)
	return path.Join(parts...)
}

func cleanOrganizeDirParts(dir string) []string {
	if dir == "." || dir == "/" || dir == "" {
		return nil
	}
	var parts []string
	for _, p := range strings.Split(strings.ReplaceAll(dir, "\\", "/"), "/") {
		p = strings.TrimSpace(p)
		if p == "" || p == "." {
			continue
		}
		cleaned := sanitizeDirectorySegment(store.CleanDirNameForGrouping(p))
		if cleaned == "" || isOrganizeNoiseDir(cleaned) {
			continue
		}
		if len(parts) > 0 && sameName(parts[len(parts)-1], cleaned) {
			continue
		}
		parts = append(parts, cleaned)
	}
	return parts
}

func findComicDiskPath(rel string) (absPath, scanRoot string, ok bool) {
	rel = normalizeScanRelPath(rel)
	if rel == "" {
		return "", "", false
	}
	probeRel := strings.TrimSuffix(rel, "/")
	for _, root := range config.GetAllScanDirs() {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		candidate := filepath.Join(root, filepath.FromSlash(probeRel))
		info, err := os.Stat(candidate)
		if err != nil {
			continue
		}
		if strings.HasSuffix(rel, "/") && !info.IsDir() {
			continue
		}
		if !strings.HasSuffix(rel, "/") && info.IsDir() {
			continue
		}
		return candidate, root, true
	}
	return "", "", false
}

func hardlinkDirectory(sourceDir, targetDir string) error {
	return filepath.WalkDir(sourceDir, func(current string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(sourceDir, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(targetDir, 0755)
		}
		dest := filepath.Join(targetDir, rel)
		if d.IsDir() {
			return os.MkdirAll(dest, 0755)
		}
		return hardlinkFile(current, dest)
	})
}

func hardlinkFile(sourceFile, targetFile string) error {
	if err := os.MkdirAll(filepath.Dir(targetFile), 0755); err != nil {
		return err
	}
	if targetInfo, err := os.Stat(targetFile); err == nil {
		sourceInfo, sourceErr := os.Stat(sourceFile)
		if sourceErr == nil && os.SameFile(sourceInfo, targetInfo) {
			return nil
		}
		return fmt.Errorf("target path already exists: %s", targetFile)
	}
	return os.Link(sourceFile, targetFile)
}

func normalizeScanRelPath(filename string) string {
	rel := filepath.ToSlash(strings.TrimSpace(filename))
	rel = strings.TrimLeft(rel, "/")
	for strings.Contains(rel, "//") {
		rel = strings.ReplaceAll(rel, "//", "/")
	}
	return rel
}

func sanitizeDirectorySegment(s string) string {
	s = sanitizeTitle(strings.TrimSpace(s))
	return sanitizePathSegment(s)
}

func sanitizeFileNameSegment(s string) string {
	return sanitizePathSegment(strings.TrimSpace(s))
}

func sanitizePathSegment(s string) string {
	if s == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range s {
		if r < 32 || unicode.IsControl(r) {
			continue
		}
		switch r {
		case '<', '>', ':', '"', '/', '\\', '|', '?', '*':
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.Join(strings.Fields(b.String()), " ")
	out = strings.Trim(out, " .")
	if out == "" {
		return ""
	}
	return out
}

func isOrganizeNoiseDir(s string) bool {
	lower := strings.ToLower(strings.TrimSpace(s))
	switch lower {
	case "pdf", "epub", "mobi", "azw3", "azw", "cbz", "cbr", "zip", "rar", "7z", "tar", "txt", "html", "htm",
		"comic", "comics", "manga", "novel", "novels", "book", "books", "ebook", "ebooks", "scan", "scans", "raw":
		return true
	}
	switch strings.TrimSpace(s) {
	case "漫画", "漫畫", "小说", "小說", "电子书", "電子書", "书籍", "書籍", "扫图", "掃圖", "图源", "圖源":
		return true
	}
	return false
}

func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func sameSlashPath(a, b string) bool {
	na := strings.TrimSuffix(normalizeScanRelPath(a), "/")
	nb := strings.TrimSuffix(normalizeScanRelPath(b), "/")
	if runtime.GOOS == "windows" {
		return strings.EqualFold(na, nb)
	}
	return na == nb
}

func sameName(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

func sameDiskPath(a, b string) bool {
	ca := filepath.Clean(a)
	cb := filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(ca, cb)
	}
	return ca == cb
}

func isInsideAnyScanRoot(target string) bool {
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	targetAbs = filepath.Clean(targetAbs)
	for _, root := range config.GetAllScanDirs() {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		rootAbs = filepath.Clean(rootAbs)
		if sameDiskPath(targetAbs, rootAbs) || pathHasPrefix(targetAbs, rootAbs) {
			return true
		}
	}
	return false
}

func pathHasPrefix(child, parent string) bool {
	child = filepath.Clean(child)
	parent = filepath.Clean(parent)
	if runtime.GOOS == "windows" {
		child = strings.ToLower(child)
		parent = strings.ToLower(parent)
	}
	sep := string(filepath.Separator)
	if !strings.HasSuffix(parent, sep) {
		parent += sep
	}
	return strings.HasPrefix(child, parent)
}

func wouldMoveIntoItself(sourceAbs, targetAbs string) bool {
	sourceAbs = filepath.Clean(sourceAbs)
	targetAbs = filepath.Clean(targetAbs)
	if runtime.GOOS == "windows" {
		sourceAbs = strings.ToLower(sourceAbs)
		targetAbs = strings.ToLower(targetAbs)
	}
	if sourceAbs == targetAbs {
		return true
	}
	sep := string(filepath.Separator)
	if !strings.HasSuffix(sourceAbs, sep) {
		sourceAbs += sep
	}
	return strings.HasPrefix(targetAbs, sourceAbs)
}

func cleanupEmptyParents(root, oldPath string) {
	root = filepath.Clean(root)
	parent := filepath.Dir(filepath.Clean(oldPath))
	for parent != "." && parent != root && parent != filepath.Dir(parent) {
		if err := os.Remove(parent); err != nil {
			return
		}
		parent = filepath.Dir(parent)
	}
}
