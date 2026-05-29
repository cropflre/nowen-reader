package archive

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/md5"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nwaples/rardecode/v2"
	rscpdf "rsc.io/pdf"
)

// ============================================================
// Unified Archive Interface
// ============================================================

// Entry represents a single file or directory inside an archive.
type Entry struct {
	Name        string
	IsDirectory bool
}

// Reader is the interface for reading archive contents.
type Reader interface {
	// ListEntries returns all entries in the archive.
	ListEntries() []Entry
	// ExtractEntry extracts a single entry by name and returns its bytes.
	ExtractEntry(entryName string) ([]byte, error)
	// Close releases any resources held by the reader.
	Close()
}

// ============================================================
// Archive type detection
// ============================================================

// ArchiveType represents the type of archive.
type ArchiveType string

const (
	TypeZip         ArchiveType = "zip"
	TypeRar         ArchiveType = "rar"
	Type7z          ArchiveType = "7z"
	TypePdf         ArchiveType = "pdf"
	TypeTxt         ArchiveType = "txt"
	TypeEpub        ArchiveType = "epub"
	TypeMobi        ArchiveType = "mobi"
	TypeAzw3        ArchiveType = "azw3"
	TypeHtml        ArchiveType = "html"
	TypeImageFolder ArchiveType = "imagefolder"
)

// DetectType returns the archive type based on file extension.
// 对于图片文件夹漫画，filepath 以 "/" 结尾或通过 DetectTypeWithStat 判断。
func DetectType(fp string) ArchiveType {
	// 图片文件夹漫画：路径以 "/" 结尾表示文件夹
	if strings.HasSuffix(fp, "/") || strings.HasSuffix(fp, "\\") {
		return TypeImageFolder
	}
	ext := strings.ToLower(path.Ext(fp))
	switch ext {
	case ".zip", ".cbz":
		return TypeZip
	case ".rar", ".cbr":
		return TypeRar
	case ".7z", ".cb7":
		return Type7z
	case ".pdf":
		return TypePdf
	case ".txt":
		return TypeTxt
	case ".epub":
		return TypeEpub
	case ".mobi":
		return TypeMobi
	case ".azw3":
		return TypeAzw3
	case ".html", ".htm":
		return TypeHtml
	default:
		// 扩展名不在已知白名单内时，回退检查是否为目录（图片文件夹漫画）。
		// 注意：不能限制为 ext == ""，因为目录名也可能含 "."（例如 "Ver.48"、
		// "vol.5"、"v1.0"），path.Ext 会把它们误当作扩展名，从而错过文件夹判断。
		if info, err := os.Stat(fp); err == nil && info.IsDir() {
			return TypeImageFolder
		}
		return ""
	}
}

// IsNovelType returns true if the archive type is a novel/text format.
// Note: For EPUB/MOBI/AZW3, this returns true by default, but the actual
// content type should be determined by IsImageHeavyEpub() for accurate detection.
func IsNovelType(t ArchiveType) bool {
	return t == TypeTxt || t == TypeEpub || t == TypeMobi || t == TypeAzw3 || t == TypeHtml
}

// IsEbookType returns true if the archive type is an ebook format (epub/mobi/azw3)
// that could be either a novel or a comic depending on content.
func IsEbookType(t ArchiveType) bool {
	return t == TypeEpub || t == TypeMobi || t == TypeAzw3
}

// ============================================================
// Factory
// ============================================================

// NewReader creates a Reader for the given archive file.
func NewReader(fp string) (Reader, error) {
	t := DetectType(fp)
	switch t {
	case TypeZip:
		return newZipReader(fp)
	case TypeRar:
		// Try pure Go RAR reader first, fall back to 7za
		r, err := newRarReader(fp)
		if err != nil {
			log.Printf("[archive] Pure Go RAR reader failed for %s: %v, trying 7za fallback", fp, err)
			return newSevenZipReader(fp)
		}
		return r, nil
	case Type7z:
		return newSevenZipReader(fp)
	case TypePdf:
		return newPdfReader(fp)
	case TypeTxt:
		return newTxtReader(fp)
	case TypeEpub:
		return newEpubReader(fp)
	case TypeMobi, TypeAzw3:
		return newMobiReader(fp)
	case TypeHtml:
		return newHtmlReader(fp)
	case TypeImageFolder:
		return newImageFolderReader(fp)
	default:
		return nil, fmt.Errorf("unsupported archive type: %s", fp)
	}
}

// ============================================================
// Helper: get image entries from a reader (sorted, filtered)
// ============================================================

// GetImageEntries returns a sorted list of image file entry names from an archive.
func GetImageEntries(r Reader) []string {
	var images []string
	for _, e := range r.ListEntries() {
		if e.IsDirectory {
			continue
		}
		base := path.Base(e.Name)
		// Skip macOS resource forks and hidden files
		if strings.HasPrefix(e.Name, "__MACOSX") || strings.HasPrefix(base, ".") {
			continue
		}
		if config.IsImageFile(e.Name) {
			images = append(images, e.Name)
		}
	}
	sort.Slice(images, func(i, j int) bool {
		return naturalLess(images[i], images[j])
	})
	return images
}

// naturalLess compares strings in natural sort order (numeric-aware).
func naturalLess(a, b string) bool {
	return naturalSortKey(a) < naturalSortKey(b)
}

// naturalSortKey generates a key for natural sorting by padding numbers.
func naturalSortKey(s string) string {
	var buf strings.Builder
	i := 0
	for i < len(s) {
		if s[i] >= '0' && s[i] <= '9' {
			j := i
			for j < len(s) && s[j] >= '0' && s[j] <= '9' {
				j++
			}
			// Pad number to 20 digits for consistent sorting
			num := s[i:j]
			buf.WriteString(strings.Repeat("0", 20-len(num)))
			buf.WriteString(num)
			i = j
		} else {
			buf.WriteByte(s[i])
			i++
		}
	}
	return strings.ToLower(buf.String())
}

// GetMimeType returns the MIME type for an image filename.
func GetMimeType(filename string) string {
	ext := strings.ToLower(path.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".avif":
		return "image/avif"
	default:
		return "image/jpeg"
	}
}

// ContentMD5 returns the hex MD5 hash of data.
func ContentMD5(data []byte) string {
	h := md5.Sum(data)
	return fmt.Sprintf("%x", h)
}

// ============================================================
// ZIP/CBZ Reader (Go standard library — fast, no CGO)
// ============================================================

type zipReader struct {
	rc      *zip.ReadCloser
	entries []Entry
}

func newZipReader(filepath string) (*zipReader, error) {
	rc, err := zip.OpenReader(filepath)
	if err != nil {
		return nil, fmt.Errorf("open zip %s: %w", filepath, err)
	}
	entries := make([]Entry, 0, len(rc.File))
	for _, f := range rc.File {
		entries = append(entries, Entry{
			Name:        f.Name,
			IsDirectory: f.FileInfo().IsDir(),
		})
	}
	return &zipReader{rc: rc, entries: entries}, nil
}

func (z *zipReader) ListEntries() []Entry {
	return z.entries
}

func (z *zipReader) ExtractEntry(entryName string) ([]byte, error) {
	for _, f := range z.rc.File {
		if f.Name == entryName {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, fmt.Errorf("entry not found: %s", entryName)
}

func (z *zipReader) Close() {
	if z.rc != nil {
		z.rc.Close()
	}
}

// ============================================================
// RAR/CBR Reader (pure Go — via nwaples/rardecode)
// ============================================================

type rarReader struct {
	filepath string
	entries  []Entry
}

func newRarReader(fp string) (*rarReader, error) {
	rc, err := rardecode.OpenReader(fp)
	if err != nil {
		errMsg := err.Error()
		// 检测加密 RAR 文件的错误信息
		if strings.Contains(errMsg, "password") || strings.Contains(errMsg, "encrypted") || strings.Contains(errMsg, "decrypt") {
			return nil, fmt.Errorf("该 RAR 文件已加密（需要密码），暂不支持打开加密压缩包: %s", fp)
		}
		return nil, fmt.Errorf("open rar %s: %w", fp, err)
	}
	defer rc.Close()

	r := &rarReader{
		filepath: fp,
		entries:  make([]Entry, 0),
	}

	// Scan all entries (headers only, skip data)
	for {
		header, err := rc.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			errMsg := err.Error()
			if strings.Contains(errMsg, "password") || strings.Contains(errMsg, "encrypted") || strings.Contains(errMsg, "decrypt") {
				return nil, fmt.Errorf("该 RAR 文件已加密（需要密码），暂不支持打开加密压缩包: %s", fp)
			}
			return nil, fmt.Errorf("read rar entry in %s: %w", fp, err)
		}

		// Normalize path separators (RAR files from Windows may use backslashes)
		name := strings.ReplaceAll(header.Name, "\\", "/")
		r.entries = append(r.entries, Entry{
			Name:        name,
			IsDirectory: header.IsDir,
		})
	}

	return r, nil
}

func (r *rarReader) ListEntries() []Entry {
	return r.entries
}

func (r *rarReader) ExtractEntry(entryName string) ([]byte, error) {
	// Re-open the archive and stream through to find the target entry
	rc, err := rardecode.OpenReader(r.filepath)
	if err != nil {
		return nil, fmt.Errorf("open rar %s: %w", r.filepath, err)
	}
	defer rc.Close()

	for {
		header, err := rc.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read rar entry in %s: %w", r.filepath, err)
		}

		if strings.ReplaceAll(header.Name, "\\", "/") == entryName {
			data, err := io.ReadAll(rc)
			if err != nil {
				return nil, fmt.Errorf("extract rar entry %s from %s: %w", entryName, r.filepath, err)
			}
			return data, nil
		}
	}

	return nil, fmt.Errorf("entry not found in rar: %s", entryName)
}

func (r *rarReader) Close() {
	// Nothing to clean up — archive is opened/closed per operation
}

// BatchExtractRarEntries 一次性流式扫描 RAR 文件，批量提取多个 entry。
// needExtract: map[entryName]pageIndex，指定需要提取的条目。
// cacheDir: 缓存目录，提取的文件会保存为 {pageIndex}{ext} 格式。
// 返回成功提取的页数。
func BatchExtractRarEntries(fp string, needExtract map[string]int, cacheDir string) (int, error) {
	rc, err := rardecode.OpenReader(fp)
	if err != nil {
		return 0, fmt.Errorf("open rar %s: %w", fp, err)
	}
	defer rc.Close()

	warmed := 0
	remaining := len(needExtract)

	for remaining > 0 {
		header, err := rc.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return warmed, fmt.Errorf("read rar entry in %s: %w", fp, err)
		}

		name := strings.ReplaceAll(header.Name, "\\", "/")
		pageIdx, ok := needExtract[name]
		if !ok {
			continue
		}

		data, err := io.ReadAll(rc)
		if err != nil {
			log.Printf("[rar-batch] Failed to extract %s from %s: %v", name, fp, err)
			continue
		}

		ext := strings.ToLower(path.Ext(name))
		cachePath := filepath.Join(cacheDir, fmt.Sprintf("%d%s", pageIdx, ext))
		if err := os.WriteFile(cachePath, data, 0644); err != nil {
			log.Printf("[rar-batch] Failed to write cache %s: %v", cachePath, err)
			continue
		}

		warmed++
		remaining--
	}

	return warmed, nil
}

// ============================================================
// 7z/RAR Reader (via external 7za binary)
// ============================================================

var (
	sevenZipPath     string
	sevenZipPathOnce sync.Once
)

// ============================================================
// Calibre ebook-convert lookup (for MOBI/AZW3 → EPUB conversion)
// ============================================================

var (
	ebookConvertPath     string
	ebookConvertPathOnce sync.Once
)

// findEbookConvert locates the Calibre ebook-convert binary.
func findEbookConvert() string {
	ebookConvertPathOnce.Do(func() {
		candidates := []string{"ebook-convert"}
		if runtime.GOOS == "windows" {
			candidates = append(candidates,
				"C:\\Program Files\\Calibre2\\ebook-convert.exe",
				"C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe",
				"C:\\Program Files\\Calibre\\ebook-convert.exe",
			)
		} else if runtime.GOOS == "darwin" {
			candidates = append(candidates,
				"/Applications/calibre.app/Contents/MacOS/ebook-convert",
			)
		} else {
			candidates = append(candidates,
				"/usr/bin/ebook-convert",
				"/usr/local/bin/ebook-convert",
			)
		}

		for _, c := range candidates {
			if p, err := exec.LookPath(c); err == nil {
				ebookConvertPath = p
				return
			}
		}

		// Check if bundled in same directory as executable
		exePath, _ := os.Executable()
		if exePath != "" {
			dir := filepath.Dir(exePath)
			bundled := filepath.Join(dir, "ebook-convert")
			if runtime.GOOS == "windows" {
				bundled += ".exe"
			}
			if _, err := os.Stat(bundled); err == nil {
				ebookConvertPath = bundled
				return
			}
		}
	})
	return ebookConvertPath
}

// IsEbookConvertAvailable returns true if Calibre ebook-convert is found on the system.
func IsEbookConvertAvailable() bool {
	return findEbookConvert() != ""
}

// ConvertToEpub converts a MOBI/AZW3 file to EPUB using Calibre ebook-convert.
// Returns the path to the converted EPUB file (stored in cache directory).
// Note: This is now a fallback method. The primary method is the native Go MOBI parser.
func ConvertToEpub(inputPath string) (string, error) {
	bin := findEbookConvert()
	if bin == "" {
		return "", fmt.Errorf("ebook-convert (Calibre) not available — this is optional, native Go parser should be used instead")
	}

	// 生成缓存路径：.cache/converted/<md5>.epub
	cacheDir := filepath.Join(config.DataDir(), "converted")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return "", fmt.Errorf("create conversion cache dir: %w", err)
	}

	// 用源文件路径的 MD5 作为缓存文件名，避免重复转换
	hash := md5.Sum([]byte(inputPath))
	epubName := fmt.Sprintf("%x.epub", hash)
	epubPath := filepath.Join(cacheDir, epubName)

	// 如果已经转换过，直接返回
	if info, err := os.Stat(epubPath); err == nil && info.Size() > 0 {
		log.Printf("[mobi] Using cached EPUB conversion for %s", filepath.Base(inputPath))
		return epubPath, nil
	}

	// 执行转换
	log.Printf("[mobi] Converting %s to EPUB via ebook-convert...", filepath.Base(inputPath))
	cmd := exec.Command(bin, inputPath, epubPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// 清理可能的部分文件
		os.Remove(epubPath)
		return "", fmt.Errorf("ebook-convert failed for %s: %w\nOutput: %s", filepath.Base(inputPath), err, string(output))
	}

	// 验证输出文件存在且非空
	if info, err := os.Stat(epubPath); err != nil || info.Size() == 0 {
		os.Remove(epubPath)
		return "", fmt.Errorf("ebook-convert produced empty or missing output for %s", filepath.Base(inputPath))
	}

	log.Printf("[mobi] Successfully converted %s to EPUB", filepath.Base(inputPath))
	return epubPath, nil
}

// newMobiReader 使用纯 Go 解析器读取 MOBI/AZW3 文件，无需外部依赖。
// 如果纯 Go 解析失败且 Calibre ebook-convert 可用，则回退到 Calibre 转换。
func newMobiReader(fp string) (Reader, error) {
	// 优先使用纯 Go 解析器（无需 Calibre）
	reader, err := newNativeMobiReader(fp)
	if err == nil {
		return reader, nil
	}

	log.Printf("[mobi] Native Go parser failed for %s: %v, trying Calibre fallback...", path.Base(fp), err)

	// 回退：尝试使用 Calibre ebook-convert
	epubPath, convErr := ConvertToEpub(fp)
	if convErr != nil {
		// 两种方式都失败，返回原始错误（纯 Go 解析器的错误更有意义）
		return nil, fmt.Errorf("parse MOBI/AZW3 failed: %v (Calibre fallback also failed: %v)", err, convErr)
	}
	return newEpubReader(epubPath)
}

// find7za locates the 7za binary.
func find7za() string {
	sevenZipPathOnce.Do(func() {
		// Try common locations
		candidates := []string{"7za", "7z"}
		if runtime.GOOS == "windows" {
			candidates = append(candidates,
				"C:\\Program Files\\7-Zip\\7z.exe",
				"C:\\Program Files (x86)\\7-Zip\\7z.exe",
			)
		} else {
			candidates = append(candidates, "/usr/bin/7za", "/usr/local/bin/7za", "/usr/bin/7z")
		}

		for _, c := range candidates {
			if p, err := exec.LookPath(c); err == nil {
				sevenZipPath = p
				return
			}
		}

		// Check if bundled in same directory as executable
		exePath, _ := os.Executable()
		if exePath != "" {
			dir := filepath.Dir(exePath)
			bundled := filepath.Join(dir, "7za")
			if runtime.GOOS == "windows" {
				bundled += ".exe"
			}
			if _, err := os.Stat(bundled); err == nil {
				sevenZipPath = bundled
				return
			}
		}
	})
	return sevenZipPath
}

type sevenZipReader struct {
	filepath string
	entries  []Entry
}

func newSevenZipReader(fp string) (*sevenZipReader, error) {
	bin := find7za()
	if bin == "" {
		return nil, fmt.Errorf("7za/7z not found in PATH — install 7-Zip to read RAR/7z files")
	}

	r := &sevenZipReader{filepath: fp}

	// List entries: 7za l -slt -p"" filepath
	// -p"" 传入空密码，防止 7z 遇到加密文件时等待用户输入密码导致进程挂起
	cmd := exec.Command(bin, "l", "-slt", `-p`, fp)
	out, err := cmd.CombinedOutput()
	if err != nil {
		outStr := string(out)
		// 检测加密文件的错误信息
		if strings.Contains(outStr, "encrypted") || strings.Contains(outStr, "Wrong password") || strings.Contains(outStr, "password") {
			return nil, fmt.Errorf("该压缩包已加密（需要密码），暂不支持打开加密压缩包: %s", fp)
		}
		return nil, fmt.Errorf("7z list %s: %w", fp, err)
	}

	// Parse the output
	parts := bytes.SplitN(out, []byte("----------"), 2)
	if len(parts) < 2 {
		return r, nil // empty archive
	}

	scanner := bufio.NewScanner(bytes.NewReader(parts[1]))
	var currentName string
	var isDir bool

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "Path = ") {
			currentName = line[7:]
		} else if strings.HasPrefix(line, "Folder = ") {
			isDir = line[9:] == "+"
		} else if line == "" && currentName != "" {
			r.entries = append(r.entries, Entry{Name: currentName, IsDirectory: isDir})
			currentName = ""
			isDir = false
		}
	}
	if currentName != "" {
		r.entries = append(r.entries, Entry{Name: currentName, IsDirectory: isDir})
	}

	return r, nil
}

func (s *sevenZipReader) ListEntries() []Entry {
	return s.entries
}

func (s *sevenZipReader) ExtractEntry(entryName string) ([]byte, error) {
	bin := find7za()
	if bin == "" {
		return nil, fmt.Errorf("7za not found")
	}

	// Extract to stdout: 7za e -y -so -p"" filepath entryName
	// -p"" 传入空密码，防止 7z 遇到加密文件时等待用户输入密码导致进程挂起
	cmd := exec.Command(bin, "e", "-y", "-so", `-p`, s.filepath, entryName)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderrStr := string(exitErr.Stderr)
			if strings.Contains(stderrStr, "encrypted") || strings.Contains(stderrStr, "Wrong password") || strings.Contains(stderrStr, "password") {
				return nil, fmt.Errorf("该压缩包已加密（需要密码），暂不支持解压加密文件: %s", entryName)
			}
		}
		return nil, fmt.Errorf("7z extract %s from %s: %w", entryName, s.filepath, err)
	}
	return out, nil
}

func (s *sevenZipReader) Close() {
	// Nothing to clean up
}

// ============================================================
// PDF Reader (virtual entries — actual rendering handled separately)
// ============================================================

type pdfReader struct {
	filepath  string
	pageCount int
}

func newPdfReader(fp string) (*pdfReader, error) {
	count, err := GetPdfPageCount(fp)
	if err != nil {
		return nil, err
	}
	return &pdfReader{filepath: fp, pageCount: count}, nil
}

func (p *pdfReader) ListEntries() []Entry {
	entries := make([]Entry, p.pageCount)
	for i := 0; i < p.pageCount; i++ {
		entries[i] = Entry{
			Name:        fmt.Sprintf("page-%04d.png", i+1),
			IsDirectory: false,
		}
	}
	return entries
}

func (p *pdfReader) ExtractEntry(entryName string) ([]byte, error) {
	// PDF page rendering is async and handled by RenderPdfPage
	return nil, fmt.Errorf("PDF pages must be rendered via RenderPdfPage")
}

func (p *pdfReader) Close() {
	// Nothing to clean up
}

// ============================================================
// PDF utilities (page count + rendering via external tools)
// ============================================================

// PDF页数缓存，避免重复解析同一个PDF文件
var (
	pdfPageCountCache   = make(map[string]int)
	pdfPageCountCacheMu sync.RWMutex
)

// ClearPdfPageCountCache 清除指定文件的PDF页数缓存，文件变更时调用。
// 如果 fp 为空，则清除所有缓存。
func ClearPdfPageCountCache(fp string) {
	pdfPageCountCacheMu.Lock()
	defer pdfPageCountCacheMu.Unlock()
	if fp == "" {
		pdfPageCountCache = make(map[string]int)
	} else {
		delete(pdfPageCountCache, fp)
	}
}

// GetPdfPageCount returns the number of pages in a PDF file.
// 结果会被缓存，避免重复解析。
//
// 解析顺序（从最可靠到最脆弱）：
//  1. mutool info  —— 与渲染所用同一引擎，结果最准（需安装 mupdf）
//  2. pdfinfo      —— poppler 自带，结果可靠（需安装 poppler）
//  3. pdftoppm -l 99999 -singlefile —— 利用 poppler 报错信息提取真实页数
//  4. rsc.io/pdf   —— 纯 Go PDF 解析器，无需外部依赖（重要兜底）
//  5. countPdfPages —— 自实现的文本解析（最后兜底，可能不准）
func GetPdfPageCount(fp string) (int, error) {
	// 先查缓存
	pdfPageCountCacheMu.RLock()
	if count, ok := pdfPageCountCache[fp]; ok {
		pdfPageCountCacheMu.RUnlock()
		return count, nil
	}
	pdfPageCountCacheMu.RUnlock()

	cacheAndReturn := func(count int) (int, error) {
		pdfPageCountCacheMu.Lock()
		pdfPageCountCache[fp] = count
		pdfPageCountCacheMu.Unlock()
		return count, nil
	}

	// Method 1: mutool info（最准，与渲染引擎一致）
	if count, ok := pdfPageCountByMutool(fp); ok {
		return cacheAndReturn(count)
	}

	// Method 2: pdfinfo（poppler）
	if count, ok := pdfPageCountByPdfinfo(fp); ok {
		return cacheAndReturn(count)
	}

	// Method 3: pdftoppm 错误信息提取
	if count, ok := pdfPageCountByPdftoppm(fp); ok {
		return cacheAndReturn(count)
	}

	// Method 4: 纯 Go 解析器 rsc.io/pdf（无外部依赖，能正确处理对象流/压缩流）
	if count, ok := pdfPageCountByRscPdf(fp); ok {
		return cacheAndReturn(count)
	}

	// Method 5: 自实现文本解析（最后兜底）
	count, err := countPdfPages(fp)
	if err != nil {
		log.Printf("[pdf] All page count methods failed for %s: %v", fp, err)
		return 0, fmt.Errorf("failed to determine PDF page count: %w", err)
	}
	if count <= 0 {
		return 0, fmt.Errorf("failed to determine PDF page count for %s", fp)
	}
	return cacheAndReturn(count)
}

// pdfPageCountByMutool 用 `mutool info` 获取 PDF 页数。
// 输出形如：`Pages: 23`
func pdfPageCountByMutool(fp string) (int, bool) {
	bin, ok := config.LookPdfTool("mutool", exec.LookPath)
	if !ok {
		return 0, false
	}
	cmd := exec.Command(bin, "info", fp)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[pdf] mutool info failed for %s: %v", fp, err)
		return 0, false
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		// 兼容 "Pages: 23" / "Pages:    23"
		if strings.HasPrefix(strings.ToLower(line), "pages:") {
			rest := strings.TrimSpace(line[len("Pages:"):])
			if n, err := strconv.Atoi(rest); err == nil && n > 0 {
				return n, true
			}
		}
	}
	return 0, false
}

// pdfPageCountByPdfinfo 用 poppler 的 `pdfinfo` 获取 PDF 页数。
// 输出形如：`Pages:          23`
func pdfPageCountByPdfinfo(fp string) (int, bool) {
	bin, ok := config.LookPdfTool("pdfinfo", exec.LookPath)
	if !ok {
		return 0, false
	}
	cmd := exec.Command(bin, fp)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[pdf] pdfinfo failed for %s: %v", fp, err)
		return 0, false
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "pages:") {
			rest := strings.TrimSpace(line[len("Pages:"):])
			fields := strings.Fields(rest)
			if len(fields) > 0 {
				if n, err := strconv.Atoi(fields[0]); err == nil && n > 0 {
					return n, true
				}
			}
		}
	}
	return 0, false
}

// pdfPageCountByPdftoppm 触发 pdftoppm 越界报错，从错误信息中提取真实页数。
// 当请求一个超出范围的页码时，pdftoppm 会输出类似：
//
//	Wrong page range given: the first page (99999) can not be after the last page (23).
func pdfPageCountByPdftoppm(fp string) (int, bool) {
	bin, ok := config.LookPdfTool("pdftoppm", exec.LookPath)
	if !ok {
		return 0, false
	}
	// 故意请求一个不可能存在的大页码，让其报错
	cmd := exec.Command(bin, "-f", "999999", "-l", "999999", "-singlefile", fp)
	out, _ := cmd.CombinedOutput()
	text := string(out)
	// 匹配 "the last page (N)" 或 "to be (1, N)" 之类的错误信息
	for _, re := range pdftoppmPageRegexps {
		if m := re.FindStringSubmatch(text); len(m) >= 2 {
			if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
				return n, true
			}
		}
	}
	return 0, false
}

var pdftoppmPageRegexps = []*regexp.Regexp{
	regexp.MustCompile(`last page\s*\(\s*(\d+)\s*\)`),
	regexp.MustCompile(`document has\s+(\d+)\s+page`),
}

// pdfPageCountByRscPdf 使用纯 Go 的 rsc.io/pdf 解析器获取页数。
// 优势：无需外部二进制，能正确处理 PDF 对象流（/ObjStm）等压缩结构，
// 这对图片型/漫画 PDF 尤其重要——这类 PDF 末尾经常是压缩流，纯文本扫描会失败。
//
// 注意：rsc.io/pdf 在遇到极少数特殊结构 PDF 时可能 panic，这里做了 recover 保护。
func pdfPageCountByRscPdf(fp string) (n int, ok bool) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[pdf] rsc.io/pdf panicked while parsing %s: %v", fp, r)
			n, ok = 0, false
		}
	}()

	reader, err := rscpdf.Open(fp)
	if err != nil {
		log.Printf("[pdf] rsc.io/pdf open failed for %s: %v", fp, err)
		return 0, false
	}
	count := reader.NumPage()
	if count <= 0 {
		log.Printf("[pdf] rsc.io/pdf returned non-positive page count (%d) for %s", count, fp)
		return 0, false
	}
	log.Printf("[pdf] rsc.io/pdf detected %d pages for %s", count, fp)
	return count, true
}

// countPdfPages 解析PDF文件获取页数。
// 优化策略：先读取文件末尾部分（PDF交叉引用表和页面树通常在末尾），
// 避免将整个文件读入内存，大幅降低内存和CPU占用。
func countPdfPages(fp string) (int, error) {
	f, err := os.Open(fp)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return 0, err
	}
	fileSize := fi.Size()

	// 分段读取策略：先读末尾小块，逐步扩大，最后兜底全量读取
	// PDF 的 /Type /Pages 和 /Count 通常在文件末尾附近
	chunkSizes := []int64{64 * 1024, 256 * 1024, 1 * 1024 * 1024, 4 * 1024 * 1024}

	for _, chunkSize := range chunkSizes {
		if chunkSize > fileSize {
			chunkSize = fileSize
		}
		offset := fileSize - chunkSize
		if offset < 0 {
			offset = 0
		}

		buf := make([]byte, chunkSize)
		n, err := f.ReadAt(buf, offset)
		if err != nil && err != io.EOF {
			continue
		}
		content := string(buf[:n])

		// 尝试用 /Type /Pages + /Count 方式解析
		if count := parsePdfPageCount(content); count > 0 {
			return count, nil
		}

		// 如果已经读取了整个文件，不再继续扩大
		if chunkSize >= fileSize {
			break
		}
	}

	// 兜底：全量读取后用 /Type /Page 逐个计数
	// 仅对极少数结构异常的PDF文件触发
	log.Printf("[pdf] 分段读取未找到页数信息，尝试全量扫描: %s", fp)
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return 0, err
	}
	all, err := io.ReadAll(f)
	if err != nil {
		return 0, err
	}
	content := string(all)
	all = nil // 尽早释放 []byte，减少内存峰值

	if count := parsePdfPageCount(content); count > 0 {
		return count, nil
	}

	if count := countPdfPageObjects(content); count > 0 {
		return count, nil
	}

	log.Printf("[pdf] Could not determine page count for %s, all parsers failed", fp)
	return 0, fmt.Errorf("PDF page count parser failed")
}

// parsePdfPageCount 从PDF内容片段中查找 /Type /Pages 对象的 /Count 值。
// 返回找到的最大页数，未找到则返回0。
func parsePdfPageCount(content string) int {
	maxCount := 0
	searchStr := content
	for {
		pagesIdx := strings.Index(searchStr, "/Type /Pages")
		if pagesIdx < 0 {
			pagesIdx = strings.Index(searchStr, "/Type/Pages")
		}
		if pagesIdx < 0 {
			break
		}

		// 在此对象中查找 /Count
		// 向后搜索直到 endobj
		objEnd := strings.Index(searchStr[pagesIdx:], "endobj")
		if objEnd < 0 {
			objEnd = len(searchStr) - pagesIdx
		}
		objContent := searchStr[pagesIdx : pagesIdx+objEnd]

		countIdx := strings.Index(objContent, "/Count ")
		if countIdx < 0 {
			countIdx = strings.Index(objContent, "/Count\n")
		}
		if countIdx >= 0 {
			rest := strings.TrimSpace(objContent[countIdx+7:])
			var n int
			fmt.Sscanf(rest, "%d", &n)
			if n > maxCount {
				maxCount = n
			}
		}

		searchStr = searchStr[pagesIdx+12:]
	}

	return maxCount
}

// countPdfPageObjects 通过计算 /Type /Page（非 /Pages）出现次数来统计页数。
// 这是兜底方法，仅在 parsePdfPageCount 无法获取时使用。
func countPdfPageObjects(content string) int {
	count := 0
	searchStr := content
	for {
		idx := strings.Index(searchStr, "/Type /Page")
		if idx < 0 {
			idx = strings.Index(searchStr, "/Type/Page")
		}
		if idx < 0 {
			break
		}

		// 检查紧随其后的字符，确保不是 /Pages
		afterLen := 11
		if searchStr[idx+6] == '/' {
			afterLen = 10
		}
		after := idx + afterLen
		if after < len(searchStr) {
			ch := searchStr[after]
			if ch == 's' || ch == 'S' {
				// 这是 /Type /Pages，跳过
				searchStr = searchStr[after:]
				continue
			}
		}

		count++
		searchStr = searchStr[after:]
	}

	return count
}

// RenderPdfPage renders a single PDF page to a PNG image.
// Uses external tools (mutool, pdftoppm, or convert).
// 渲染策略：每个工具按 200 -> 120 -> 96 dpi 降级重试，遇到 OOM/signal killed 自动降级，
// 直到全部失败才进入下一个工具，所有工具全部失败时返回结构化错误。
func RenderPdfPage(fp string, pageIndex int) ([]byte, error) {
	pageNum := pageIndex + 1 // External tools use 1-based page numbers
	var errors []string

	// dpi 降级序列：高质量优先，失败时降低分辨率以节省内存（适配 NAS/低内存环境）
	dpiLadder := []int{200, 120, 96}

	// Method 1: mutool (from MuPDF — best quality)
	if mutool, ok := config.LookPdfTool("mutool", exec.LookPath); ok {
		for _, dpi := range dpiLadder {
			cmd := exec.Command(mutool, "draw", "-o", "-", "-F", "png", "-r", fmt.Sprintf("%d", dpi), fp, fmt.Sprintf("%d", pageNum))
			out, runErr := cmd.Output()
			if runErr == nil && len(out) > 0 {
				if dpi != dpiLadder[0] {
					log.Printf("[pdf] mutool succeeded at fallback dpi=%d for %s page %d", dpi, fp, pageNum)
				}
				return out, nil
			}
			if runErr != nil {
				errDetail := runErr.Error()
				if exitErr, ok := runErr.(*exec.ExitError); ok && len(exitErr.Stderr) > 0 {
					errDetail = strings.TrimSpace(string(exitErr.Stderr))
				}
				log.Printf("[pdf] mutool failed (dpi=%d) for %s page %d: %s", dpi, fp, pageNum, errDetail)
				errors = append(errors, fmt.Sprintf("mutool@%d: %s", dpi, errDetail))
				// 如果是 OOM/被杀，继续降级 dpi 重试；如果是其它语义错误（密码、损坏等）直接跳出
				if !isResourceError(runErr, errDetail) {
					break
				}
			} else {
				log.Printf("[pdf] mutool returned empty output (dpi=%d) for %s page %d", dpi, fp, pageNum)
				errors = append(errors, fmt.Sprintf("mutool@%d: empty output", dpi))
				break
			}
		}
	} else {
		errors = append(errors, "mutool: not installed")
	}

	// Method 2: pdftoppm (from poppler)
	if pdftoppm, ok := config.LookPdfTool("pdftoppm", exec.LookPath); ok {
		for _, dpi := range dpiLadder {
			cmd := exec.Command(pdftoppm, "-png", "-r", fmt.Sprintf("%d", dpi), "-f", fmt.Sprintf("%d", pageNum), "-l", fmt.Sprintf("%d", pageNum), "-singlefile", fp)
			out, runErr := cmd.Output()
			if runErr == nil && len(out) > 0 {
				if dpi != dpiLadder[0] {
					log.Printf("[pdf] pdftoppm succeeded at fallback dpi=%d for %s page %d", dpi, fp, pageNum)
				}
				return out, nil
			}
			if runErr != nil {
				errDetail := runErr.Error()
				if exitErr, ok := runErr.(*exec.ExitError); ok && len(exitErr.Stderr) > 0 {
					errDetail = strings.TrimSpace(string(exitErr.Stderr))
				}
				log.Printf("[pdf] pdftoppm failed (dpi=%d) for %s page %d: %s", dpi, fp, pageNum, errDetail)
				errors = append(errors, fmt.Sprintf("pdftoppm@%d: %s", dpi, errDetail))
				if !isResourceError(runErr, errDetail) {
					break
				}
			} else {
				errors = append(errors, fmt.Sprintf("pdftoppm@%d: empty output", dpi))
				break
			}
		}
	} else {
		errors = append(errors, "pdftoppm: not installed")
	}

	// Method 3: convert from ImageMagick
	// Windows 系统下 system32\convert.exe 是 FAT->NTFS 转换工具，必须排除
	if convert, ok := config.LookPdfTool("convert", exec.LookPath); ok && !isWindowsSystemConvert(convert) {
		for _, dpi := range dpiLadder {
			cmd := exec.Command(convert, "-density", fmt.Sprintf("%d", dpi), fmt.Sprintf("%s[%d]", fp, pageIndex), "png:-")
			out, runErr := cmd.Output()
			if runErr == nil && len(out) > 0 {
				if dpi != dpiLadder[0] {
					log.Printf("[pdf] imagemagick succeeded at fallback dpi=%d for %s page %d", dpi, fp, pageNum)
				}
				return out, nil
			}
			if runErr != nil {
				errDetail := runErr.Error()
				if exitErr, ok := runErr.(*exec.ExitError); ok && len(exitErr.Stderr) > 0 {
					errDetail = strings.TrimSpace(string(exitErr.Stderr))
				}
				log.Printf("[pdf] imagemagick failed (dpi=%d) for %s page %d: %s", dpi, fp, pageNum, errDetail)
				errors = append(errors, fmt.Sprintf("imagemagick@%d: %s", dpi, errDetail))
				if !isResourceError(runErr, errDetail) {
					break
				}
			} else {
				errors = append(errors, fmt.Sprintf("imagemagick@%d: empty output", dpi))
				break
			}
		}
	} else {
		errors = append(errors, "imagemagick: not installed")
	}

	// 判断是没有安装渲染工具还是渲染出错
	allNotInstalled := true
	for _, e := range errors {
		if !strings.Contains(e, "not installed") {
			allNotInstalled = false
			break
		}
	}

	if allNotInstalled {
		return nil, fmt.Errorf("no PDF renderer available (install mutool, pdftoppm, or imagemagick)")
	}
	return nil, fmt.Errorf("render PDF page %d failed: %s", pageNum, strings.Join(errors, "; "))
}

// isResourceError 判断是否是 OOM/被杀/信号中断等资源类错误，这种情况降低 dpi 重试有意义。
func isResourceError(err error, detail string) bool {
	if err == nil {
		return false
	}
	low := strings.ToLower(detail)
	if strings.Contains(low, "killed") ||
		strings.Contains(low, "signal") ||
		strings.Contains(low, "out of memory") ||
		strings.Contains(low, "cannot allocate") ||
		strings.Contains(low, "memory") {
		return true
	}
	// exec.ExitError with negative exit code on Unix often means killed by signal
	if exitErr, ok := err.(*exec.ExitError); ok {
		if exitErr.ExitCode() == -1 || exitErr.ExitCode() == 137 || exitErr.ExitCode() == 139 {
			return true
		}
	}
	return false
}

// isWindowsSystemConvert 检测是否是 Windows 自带的 system32\convert.exe（FAT->NTFS 转换工具，不是 ImageMagick）。
// Linux/Docker 环境下永远返回 false。
func isWindowsSystemConvert(path string) bool {
	if runtime.GOOS != "windows" {
		return false
	}
	low := strings.ToLower(filepath.ToSlash(path))
	return strings.Contains(low, "/windows/system32/") || strings.Contains(low, "/windows/syswow64/")
}
