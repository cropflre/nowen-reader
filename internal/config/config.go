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
	SiteName         string           `json:"siteName,omitempty"`
	ComicsDir        string           `json:"comicsDir,omitempty"`
	ExtraComicsDirs  []string         `json:"extraComicsDirs,omitempty"`
	NovelsDir        string           `json:"novelsDir,omitempty"`       // 电子书主目录
	ExtraNovelsDirs  []string         `json:"extraNovelsDirs,omitempty"` // 额外电子书目录
	ThumbnailWidth   int              `json:"thumbnailWidth,omitempty"`
	ThumbnailHeight  int              `json:"thumbnailHeight,omitempty"`
	PageSize         int              `json:"pageSize,omitempty"`
	Language         string           `json:"language,omitempty"`
	Theme            string           `json:"theme,omitempty"`
	ScannerConfig    *ScannerConfig   `json:"scannerConfig,omitempty"`
	RegistrationMode string           `json:"registrationMode,omitempty"` // "open" | "invite" | "closed"，默认 "open"
	ScraperEnabled   *bool            `json:"scraperEnabled,omitempty"`   // 是否启用内容刮削功能，默认 false
	ScanRules        *ScanRulesConfig `json:"scanRules,omitempty"`        // 扫描期统一规则（AI 识别 + 自动归类等）

	// PdfRendererPath 指定 PDF 渲染外部工具所在目录或具体可执行文件路径。
	// 接受三种写法：
	//   1. 目录：例如 "D:/tools/mupdf"，会在该目录下查找 mutool/pdftoppm/pdfinfo/convert
	//   2. 单个可执行文件：例如 "D:/tools/mupdf/mutool.exe"，仅在调用同名工具时生效
	//   3. 多路径：用 ; (Windows) 或 : (Linux) 分隔，逐个尝试
	// 留空时回退到系统 PATH 查找。
	PdfRendererPath string `json:"pdfRendererPath,omitempty"`

	// StorageThreshold 存储用量预警阈值（数据管理模块）。
	// 任一字段为 0 表示不启用对应阈值。
	StorageThreshold *StorageThresholdConfig `json:"storageThreshold,omitempty"`
}

// StorageThresholdConfig 存储用量阈值（单位 MB）
type StorageThresholdConfig struct {
	CacheMaxMB    int64 `json:"cacheMaxMB,omitempty"`    // 缓存上限
	DBMaxMB       int64 `json:"dbMaxMB,omitempty"`       // 数据库上限
	DiskFreeMinMB int64 `json:"diskFreeMinMB,omitempty"` // 磁盘剩余下限
}

// ScanRulesConfig 描述扫描入库后自动执行的"规则流水线"。
// 设计原则：默认全关，用户主动启用；不动磁盘文件（A1 阶段）。
type ScanRulesConfig struct {
	Enabled     bool   `json:"enabled,omitempty"`     // 总开关
	ApplyOn     string `json:"applyOn,omitempty"`     // newOnly | all | manual（默认 newOnly）
	Concurrency int    `json:"concurrency,omitempty"` // 并发数，默认 2

	// AI 标题/作者/扫图组等结构化推断
	AIInfer *AIInferRule `json:"aiInfer,omitempty"`
	// 虚拟归类（仅创建/合并 ComicGroup，不动磁盘）
	Organize *OrganizeRule `json:"organize,omitempty"`

	// 过滤器（决定哪些 Comic 走规则引擎）
	Filters *ScanRuleFilters `json:"filters,omitempty"`
}

// AIInferRule 控制扫描时的 AI 智能识别动作。
type AIInferRule struct {
	Enabled        bool   `json:"enabled,omitempty"`
	Scope          string `json:"scope,omitempty"`          // file | folderGroup（默认 folderGroup，按目录去重）
	MinConfidence  string `json:"minConfidence,omitempty"`  // low | medium | high（默认 medium）
	ApplyToComic   bool   `json:"applyToComic,omitempty"`   // 是否写回单卷字段（默认 true）
	ApplyToGroup   bool   `json:"applyToGroup,omitempty"`   // 是否同步到分组（默认 true）
	OverwriteTitle bool   `json:"overwriteTitle,omitempty"` // 是否覆盖已有 title（默认 false，仅在为空时填充）
	FallbackToRule bool   `json:"fallbackToRule,omitempty"` // AI 失败时回退规则清洗（默认 true）
}

// OrganizeRule 控制虚拟归类（仅 DB 层面，不动磁盘）。
type OrganizeRule struct {
	Enabled        bool `json:"enabled,omitempty"`
	AutoGroupByDir bool `json:"autoGroupByDir,omitempty"` // 入库后自动按目录创建/合并分组（默认 true）
	InheritMeta    bool `json:"inheritMeta,omitempty"`    // 创建分组后从首卷继承元数据（默认 true）
}

// ScanRuleFilters 决定哪些 Comic 受规则引擎影响。
type ScanRuleFilters struct {
	IncludeExt       []string `json:"includeExt,omitempty"` // 空=全部
	ExcludeExt       []string `json:"excludeExt,omitempty"`
	IncludePathRegex string   `json:"includePathRegex,omitempty"`
	ExcludePathRegex string   `json:"excludePathRegex,omitempty"`
}

// ResolvedScanRules 返回 ScanRules 的可用副本（缺省字段填充默认值）。
func (c *SiteConfig) ResolvedScanRules() *ScanRulesConfig {
	r := c.ScanRules
	if r == nil {
		r = &ScanRulesConfig{}
	}
	if r.ApplyOn == "" {
		r.ApplyOn = "newOnly"
	}
	if r.Concurrency <= 0 {
		r.Concurrency = 2
	}
	if r.AIInfer == nil {
		r.AIInfer = &AIInferRule{}
	}
	if r.AIInfer.Scope == "" {
		r.AIInfer.Scope = "folderGroup"
	}
	if r.AIInfer.MinConfidence == "" {
		r.AIInfer.MinConfidence = "medium"
	}
	if r.Organize == nil {
		r.Organize = &OrganizeRule{}
	}
	if r.Filters == nil {
		r.Filters = &ScanRuleFilters{}
	}
	return r
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

// GetPdfRendererPath 返回用户配置的 PDF 渲染工具路径（目录或可执行文件）。
// 优先级：环境变量 PDF_RENDERER > site-config.json > 空字符串
func GetPdfRendererPath() string {
	if p := strings.TrimSpace(os.Getenv("PDF_RENDERER")); p != "" {
		return p
	}
	return strings.TrimSpace(loadSiteConfig().PdfRendererPath)
}

// ResolvePdfTool 在用户配置的目录/文件中查找指定 PDF 工具的可执行路径。
// 找不到时返回空字符串（调用方可继续 fallback 到 exec.LookPath）。
//
// name: 工具名（不带扩展名），例如 "mutool"、"pdftoppm"、"pdfinfo"、"convert"。
func ResolvePdfTool(name string) string {
	if name == "" {
		return ""
	}
	raw := GetPdfRendererPath()
	if raw == "" {
		return ""
	}

	sep := ":"
	if filepath.Separator == '\\' {
		sep = ";"
	}
	candidates := strings.Split(raw, sep)

	// Windows 下尝试加 .exe 扩展
	exeExts := []string{""}
	if filepath.Separator == '\\' {
		exeExts = []string{"", ".exe", ".bat", ".cmd"}
	}

	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}

		info, err := os.Stat(c)
		if err == nil && !info.IsDir() {
			// 直接指向文件：仅当文件名（去扩展）匹配 name 时返回
			base := strings.ToLower(strings.TrimSuffix(filepath.Base(c), filepath.Ext(c)))
			if base == strings.ToLower(name) {
				return c
			}
			continue
		}

		// 当作目录处理（即便 stat 失败也尝试拼接，让 os.Stat 给出最终判断）
		for _, ext := range exeExts {
			candidate := filepath.Join(c, name+ext)
			if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
				return candidate
			}
		}
	}
	return ""
}

// LookPdfTool 在用户配置目录优先查找指定 PDF 工具，找不到再回退 exec.LookPath。
// 注意：本函数定义在 config 包，避免 archive 包反向依赖；调用方传入查询结果即可。
// 返回 (路径, 是否找到)。
func LookPdfTool(name string, lookPath func(string) (string, error)) (string, bool) {
	if p := ResolvePdfTool(name); p != "" {
		return p, true
	}
	if lookPath == nil {
		return "", false
	}
	if p, err := lookPath(name); err == nil && p != "" {
		return p, true
	}
	return "", false
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
