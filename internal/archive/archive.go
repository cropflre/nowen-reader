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
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nwaples/rardecode/v2"
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
	TypeZip  ArchiveType = "zip"
	TypeRar  ArchiveType = "rar"
	Type7z   ArchiveType = "7z"
	TypePdf  ArchiveType = "pdf"
	TypeTxt  ArchiveType = "txt"
	TypeEpub ArchiveType = "epub"
	TypeMobi ArchiveType = "mobi"
	TypeAzw3 ArchiveType = "azw3"
	TypeHtml ArchiveType = "html"
)

// DetectType returns the archive type based on file extension.
func DetectType(filepath string) ArchiveType {
	ext := strings.ToLower(path.Ext(filepath))
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
		return ""
	}
}

// IsNovelType returns true if the archive type is a novel/text format.
func IsNovelType(t ArchiveType) bool {
	return t == TypeTxt || t == TypeEpub || t == TypeMobi || t == TypeAzw3 || t == TypeHtml
}

// ============================================================
// Factory
// ============================================================

// NewReader creates a Reader for the given archive file.
func NewReader(filepath string) (Reader, error) {
	t := DetectType(filepath)
	switch t {
	case TypeZip:
		return newZipReader(filepath)
	case TypeRar:
		// Try pure Go RAR reader first, fall back to 7za
		r, err := newRarReader(filepath)
		if err != nil {
			log.Printf("[archive] Pure Go RAR reader failed for %s: %v, trying 7za fallback", filepath, err)
			return newSevenZipReader(filepath)
		}
		return r, nil
	case Type7z:
		return newSevenZipReader(filepath)
	case TypePdf:
		return newPdfReader(filepath)
	case TypeTxt:
		return newTxtReader(filepath)
	case TypeEpub:
		return newEpubReader(filepath)
	case TypeMobi, TypeAzw3:
		return newMobiReader(filepath)
	case TypeHtml:
		return newHtmlReader(filepath)
	default:
		return nil, fmt.Errorf("unsupported archive type: %s", filepath)
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

// convertToEpub converts a MOBI/AZW3 file to EPUB using Calibre ebook-convert.
// Returns the path to the converted EPUB file (stored in cache directory).
func convertToEpub(inputPath string) (string, error) {
	bin := findEbookConvert()
	if bin == "" {
		return "", fmt.Errorf("ebook-convert (Calibre) not found — install Calibre to read MOBI/AZW3 files: https://calibre-ebook.com")
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

// newMobiReader converts a MOBI/AZW3 file to EPUB and returns an EPUB reader.
func newMobiReader(fp string) (Reader, error) {
	epubPath, err := convertToEpub(fp)
	if err != nil {
		return nil, err
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

	// List entries: 7za l -slt filepath
	cmd := exec.Command(bin, "l", "-slt", fp)
	out, err := cmd.Output()
	if err != nil {
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

	// Extract to stdout: 7za e -y -so filepath entryName
	cmd := exec.Command(bin, "e", "-y", "-so", s.filepath, entryName)
	out, err := cmd.Output()
	if err != nil {
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

// GetPdfPageCount returns the number of pages in a PDF file.
// Uses a lightweight approach: counts "endobj" or parses trailer.
func GetPdfPageCount(fp string) (int, error) {
	// Method 1: Use 7z to list PDF — it reports pages as entries
	bin := find7za()
	if bin != "" {
		cmd := exec.Command(bin, "l", fp)
		out, err := cmd.Output()
		if err == nil {
			// Count image-like entries in 7z output
			// 7z lists PDF pages as separate entries
			lines := strings.Split(string(out), "\n")
			count := 0
			inListing := false
			for _, line := range lines {
				if strings.Contains(line, "---") {
					inListing = !inListing
					continue
				}
				if inListing && strings.TrimSpace(line) != "" {
					count++
				}
			}
			if count > 0 {
				return count, nil
			}
		}
	}

	// Method 2: Parse the PDF directly for page count
	return countPdfPages(fp)
}

// countPdfPages reads the PDF and counts pages using a simple trailer parse.
func countPdfPages(fp string) (int, error) {
	f, err := os.Open(fp)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	all, err := io.ReadAll(f)
	if err != nil {
		return 0, err
	}

	content := string(all)

	// Method 1: 查找 /Type /Pages 中的 /Count N（页面树根节点的总页数）
	// 这是最可靠的方法，大多数 PDF 都有这个结构
	// 查找所有 /Type /Pages 对象，取其中的 /Count 值
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

	if maxCount > 0 {
		return maxCount, nil
	}

	// Method 2: 计算 /Type /Page 出现的次数（排除 /Type /Pages）
	// 逐个对象计数
	count := 0
	searchStr = content
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

	if count > 0 {
		return count, nil
	}

	log.Printf("[pdf] Could not determine page count for %s, defaulting to 1", fp)
	return 1, nil
}

// RenderPdfPage renders a single PDF page to a PNG image.
// Uses external tools (mutool, pdftoppm, or convert).
func RenderPdfPage(fp string, pageIndex int) ([]byte, error) {
	pageNum := pageIndex + 1 // External tools use 1-based page numbers
	var errors []string

	// Method 1: mutool (from MuPDF — best quality)
	if mutool, err := exec.LookPath("mutool"); err == nil {
		cmd := exec.Command(mutool, "draw", "-o", "-", "-F", "png", "-r", "200", fp, fmt.Sprintf("%d", pageNum))
		out, err := cmd.Output()
		if err == nil && len(out) > 0 {
			return out, nil
		}
		if err != nil {
			errDetail := err.Error()
			if exitErr, ok := err.(*exec.ExitError); ok && len(exitErr.Stderr) > 0 {
				errDetail = string(exitErr.Stderr)
			}
			log.Printf("[pdf] mutool failed for %s page %d: %s", fp, pageNum, errDetail)
			errors = append(errors, fmt.Sprintf("mutool: %s", errDetail))
		} else {
			log.Printf("[pdf] mutool returned empty output for %s page %d", fp, pageNum)
			errors = append(errors, "mutool: empty output")
		}
	} else {
		errors = append(errors, "mutool: not installed")
	}

	// Method 2: pdftoppm (from poppler)
	if pdftoppm, err := exec.LookPath("pdftoppm"); err == nil {
		cmd := exec.Command(pdftoppm, "-png", "-r", "200", "-f", fmt.Sprintf("%d", pageNum), "-l", fmt.Sprintf("%d", pageNum), "-singlefile", fp)
		out, err := cmd.Output()
		if err == nil && len(out) > 0 {
			return out, nil
		}
		if err != nil {
			log.Printf("[pdf] pdftoppm failed for %s page %d: %v", fp, pageNum, err)
			errors = append(errors, fmt.Sprintf("pdftoppm: %v", err))
		} else {
			errors = append(errors, "pdftoppm: empty output")
		}
	} else {
		errors = append(errors, "pdftoppm: not installed")
	}

	// Method 3: convert from ImageMagick
	if convert, err := exec.LookPath("convert"); err == nil {
		cmd := exec.Command(convert, "-density", "200", fmt.Sprintf("%s[%d]", fp, pageIndex), "png:-")
		out, err := cmd.Output()
		if err == nil && len(out) > 0 {
			return out, nil
		}
		if err != nil {
			log.Printf("[pdf] imagemagick failed for %s page %d: %v", fp, pageNum, err)
			errors = append(errors, fmt.Sprintf("imagemagick: %v", err))
		} else {
			errors = append(errors, "imagemagick: empty output")
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
