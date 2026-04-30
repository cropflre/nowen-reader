package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SiteConfig represents the site-config.json file structure.
type SiteConfig struct {
	SiteName         string         `json:"siteName,omitempty"`
	ComicsDir        string         `json:"comicsDir,omitempty"`
	ExtraComicsDirs  []string       `json:"extraComicsDirs,omitempty"`
	NovelsDir        string         `json:"novelsDir,omitempty"`       // 电子书主目录
	ExtraNovelsDirs  []string       `json:"extraNovelsDirs,omitempty"` // 额外电子书目录
	ThumbnailWidth   int            `json:"thumbnailWidth,omitempty"`
	ThumbnailHeight  int            `json:"thumbnailHeight,omitempty"`
	PageSize         int            `json:"pageSize,omitempty"`
	Language         string         `json:"language,omitempty"`
	Theme            string         `json:"theme,omitempty"`
	ScannerConfig    *ScannerConfig `json:"scannerConfig,omitempty"`
	RegistrationMode string         `json:"registrationMode,omitempty"` // "open" | "invite" | "closed"，默认 "open"
	ScraperEnabled   *bool          `json:"scraperEnabled,omitempty"`   // 是否启用内容刮削功能，默认 false
}

// ScannerConfig 保存可配置化的扫描参数。
type ScannerConfig struct {
	SyncCooldownSec      int `json:"syncCooldownSec,omitempty"`
	FSDebounceMs         int `json:"fsDebounceMs,omitempty"`
	FullSyncBatchSize    int `json:"fullSyncBatchSize,omitempty"`
	QuickSyncIntervalSec int `json:"quickSyncIntervalSec,omitempty"`
	FullSyncIntervalSec  int `json:"fullSyncIntervalSec,omitempty"`
	MD5Workers           int `json:"md5Workers,omitempty"` // MD5 计算并发数，网盘场景建议设为 1-2

	// EbookTypeAutoDetect 控制电子书（EPUB/MOBI/AZW3）的内容类型自动识别策略：
	//   "off"       完全关闭，文件类型严格按所在目录决定（漫画目录=comic，小说目录=novel）
	//   "comics"    仅对位于"漫画目录"中的电子书做 image-heavy 检测；放在小说目录的文件锁定为 novel（默认，避免图文教材被误识别为漫画）
	//   "all"       对所有电子书都做 image-heavy 检测（旧版行为，可能把图文混排教材误识别为漫画）
	EbookTypeAutoDetect string `json:"ebookTypeAutoDetect,omitempty"`
}

// EbookAutoDetectMode 返回电子书内容类型自动识别策略，缺省返回 "comics"。
func (c *ScannerConfig) EbookAutoDetectMode() string {
	if c == nil {
		return "comics"
	}
	switch c.EbookTypeAutoDetect {
	case "off", "comics", "all":
		return c.EbookTypeAutoDetect
	default:
		return "comics"
	}
}

var (
	siteConfigCache    *SiteConfig
	siteConfigCacheTs  time.Time
	siteConfigCacheTTL = 5 * time.Second
	siteConfigMu       sync.RWMutex
)

// SiteConfigPath returns the path to site-config.json.
func SiteConfigPath() string {
	return filepath.Join(DataDir(), "site-config.json")
}

// DataDir returns the base data/cache directory.
func DataDir() string {
	if d := os.Getenv("DATA_DIR"); d != "" {
		return d
	}
	cwd, _ := os.Getwd()
	return filepath.Join(cwd, ".cache")
}

// loadSiteConfig reads and caches site-config.json with a 5-second TTL.
func loadSiteConfig() *SiteConfig {
	siteConfigMu.RLock()
	if siteConfigCache != nil && time.Since(siteConfigCacheTs) < siteConfigCacheTTL {
		defer siteConfigMu.RUnlock()
		return siteConfigCache
	}
	siteConfigMu.RUnlock()

	siteConfigMu.Lock()
	defer siteConfigMu.Unlock()

	// Double-check after acquiring write lock
	if siteConfigCache != nil && time.Since(siteConfigCacheTs) < siteConfigCacheTTL {
		return siteConfigCache
	}

	cfg := &SiteConfig{}
	data, err := os.ReadFile(SiteConfigPath())
	if err == nil {
		_ = json.Unmarshal(data, cfg)
	}
	siteConfigCache = cfg
	siteConfigCacheTs = time.Now()
	return cfg
}

// SaveSiteConfig writes the site config to disk.
func SaveSiteConfig(cfg *SiteConfig) error {
	dir := filepath.Dir(SiteConfigPath())
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	siteConfigMu.Lock()
	siteConfigCache = cfg
	siteConfigCacheTs = time.Now()
	siteConfigMu.Unlock()

	return os.WriteFile(SiteConfigPath(), data, 0644)
}

// GetSiteConfig returns a copy of the current site config.
func GetSiteConfig() SiteConfig {
	return *loadSiteConfig()
}

// ============================================================
// Derived config getters
// ============================================================

// GetComicsDir returns the primary comics directory.
// Priority: COMICS_DIR env > site-config.json > default ./comics
func GetComicsDir() string {
	if d := os.Getenv("COMICS_DIR"); d != "" {
		return d
	}
	cfg := loadSiteConfig()
	if cfg.ComicsDir != "" {
		return cfg.ComicsDir
	}
	cwd, _ := os.Getwd()
	return filepath.Join(cwd, "comics")
}

// GetAllComicsDirs returns all comic directories (main + extras).
func GetAllComicsDirs() []string {
	dirs := []string{GetComicsDir()}
	cfg := loadSiteConfig()
	for _, d := range cfg.ExtraComicsDirs {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		// Deduplicate
		found := false
		for _, existing := range dirs {
			if existing == d {
				found = true
				break
			}
		}
		if !found {
			dirs = append(dirs, d)
		}
	}
	return dirs
}

// GetNovelsDir returns the primary novels/ebook directory.
// Priority: NOVELS_DIR env > site-config.json > default ./novels
func GetNovelsDir() string {
	if d := os.Getenv("NOVELS_DIR"); d != "" {
		return d
	}
	cfg := loadSiteConfig()
	if cfg.NovelsDir != "" {
		return cfg.NovelsDir
	}
	cwd, _ := os.Getwd()
	return filepath.Join(cwd, "novels")
}

// GetAllNovelsDirs returns all novel/ebook directories (main + extras).
func GetAllNovelsDirs() []string {
	dirs := []string{GetNovelsDir()}
	cfg := loadSiteConfig()
	for _, d := range cfg.ExtraNovelsDirs {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		// Deduplicate
		found := false
		for _, existing := range dirs {
			if existing == d {
				found = true
				break
			}
		}
		if !found {
			dirs = append(dirs, d)
		}
	}
	return dirs
}

// GetAllScanDirs returns all directories that need to be scanned (comics + novels).
func GetAllScanDirs() []string {
	allDirs := GetAllComicsDirs()
	novelDirs := GetAllNovelsDirs()
	for _, d := range novelDirs {
		// Deduplicate
		found := false
		for _, existing := range allDirs {
			if existing == d {
				found = true
				break
			}
		}
		if !found {
			allDirs = append(allDirs, d)
		}
	}
	return allDirs
}

// ClassifyPathSource 根据文件的绝对路径判断它属于哪类来源目录：
//   - "comics" : 位于任一漫画目录之内
//   - "novels" : 位于任一电子书目录之内（且不在漫画目录中）
//   - ""       : 不属于任何已配置目录
//
// 当同一目录同时配置在 comics 与 novels 中时，优先视为 comics（与扫描器去重逻辑一致）。
func ClassifyPathSource(absPath string) string {
	if absPath == "" {
		return ""
	}
	clean := filepath.Clean(absPath)

	// 漫画目录优先
	for _, d := range GetAllComicsDirs() {
		if d == "" {
			continue
		}
		if pathHasPrefix(clean, filepath.Clean(d)) {
			return "comics"
		}
	}
	for _, d := range GetAllNovelsDirs() {
		if d == "" {
			continue
		}
		if pathHasPrefix(clean, filepath.Clean(d)) {
			return "novels"
		}
	}
	return ""
}

// pathHasPrefix 判断 path 是否在 prefix 目录之内（按路径分隔符严格匹配，避免
// "/data/novels-extra" 误命中 "/data/novels"）。
func pathHasPrefix(path, prefix string) bool {
	if prefix == "" {
		return false
	}
	if path == prefix {
		return true
	}
	// 统一带末尾分隔符再前缀比较
	pfx := prefix
	if !strings.HasSuffix(pfx, string(filepath.Separator)) {
		pfx += string(filepath.Separator)
	}
	return strings.HasPrefix(path, pfx)
}

// GetThumbnailsDir returns the thumbnails cache directory.
func GetThumbnailsDir() string {
	return filepath.Join(DataDir(), "thumbnails")
}

// GetPagesCacheDir returns the pages cache directory.
func GetPagesCacheDir() string {
	return filepath.Join(DataDir(), "pages")
}

// GetThumbnailWidth returns configured thumbnail width.
func GetThumbnailWidth() int {
	if w := loadSiteConfig().ThumbnailWidth; w > 0 {
		return w
	}
	return 400
}

// GetThumbnailHeight returns configured thumbnail height.
func GetThumbnailHeight() int {
	if h := loadSiteConfig().ThumbnailHeight; h > 0 {
		return h
	}
	return 560
}

// GetPageSize returns configured items per page.
func GetPageSize() int {
	if ps := loadSiteConfig().PageSize; ps > 0 {
		return ps
	}
	return 24
}

// GetSiteName returns the configured site name.
func GetSiteName() string {
	if n := loadSiteConfig().SiteName; n != "" {
		return n
	}
	return "NowenReader"
}

// GetRegistrationMode 返回注册策略。
// "open"（默认，开放注册）| "invite"（仅管理员邀请）| "closed"（关闭注册）
func GetRegistrationMode() string {
	if m := loadSiteConfig().RegistrationMode; m != "" {
		return m
	}
	return "open"
}

// IsScraperEnabled 返回是否启用内容刮削功能，默认为 false（关闭）。
func IsScraperEnabled() bool {
	cfg := loadSiteConfig()
	if cfg.ScraperEnabled != nil {
		return *cfg.ScraperEnabled
	}
	return false
}

// DatabaseURL returns the SQLite database path.
// Priority: DATABASE_URL env > default ./data/nowen-reader.db
func DatabaseURL() string {
	if u := os.Getenv("DATABASE_URL"); u != "" {
		return u
	}
	cwd, _ := os.Getwd()
	return filepath.Join(cwd, "data", "nowen-reader.db")
}

// Supported file extensions
var (
	SupportedExtensions = []string{".zip", ".cbz", ".cbr", ".rar", ".7z", ".cb7", ".pdf", ".azw3"}
	NovelExtensions     = []string{".txt", ".epub", ".mobi", ".azw3", ".html", ".htm"}
	ImageExtensions     = []string{".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"}
)

// IsSupportedArchive checks if a filename has a supported archive extension.
func IsSupportedArchive(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, e := range SupportedExtensions {
		if ext == e {
			return true
		}
	}
	return false
}

// IsNovelFile checks if a filename is a supported novel/ebook extension.
func IsNovelFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, e := range NovelExtensions {
		if ext == e {
			return true
		}
	}
	return false
}

// IsSupportedFile checks if a filename is any supported format (archive or novel).
func IsSupportedFile(filename string) bool {
	return IsSupportedArchive(filename) || IsNovelFile(filename)
}

// IsImageFile checks if a filename has a supported image extension.
func IsImageFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, e := range ImageExtensions {
		if ext == e {
			return true
		}
	}
	return false
}
