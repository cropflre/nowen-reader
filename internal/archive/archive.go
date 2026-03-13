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

	"github.com/nwaples/rardecode"
	"github.com/nowen-reader/nowen-reader/internal/config"
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
	TypeZip ArchiveType = "zip"
	TypeRar ArchiveType = "rar"
	Type7z  ArchiveType = "7z"
	TypePdf ArchiveType = "pdf"
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
	default:
		return ""
	}
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
	rc, err := rardecode.OpenReader(fp, "")
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
	rc, err := rardecode.OpenReader(r.filepath, "")
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

// ============================================================
// 7z/RAR Reader (via external 7za binary)
// ============================================================

var (
	sevenZipPath     string
	sevenZipPathOnce sync.Once
)

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

	// Read last 2KB to find the /Count or /N value in the trailer/catalog
	stat, err := f.Stat()
	if err != nil {
		return 0, err
	}
	size := stat.Size()
	readSize := int64(4096)
	if readSize > size {
		readSize = size
	}
	buf := make([]byte, readSize)
	if _, err := f.ReadAt(buf, size-readSize); err != nil && err != io.EOF {
		return 0, err
	}

	content := string(buf)

	// Look for /Count N pattern (page count in page tree)
	// Search from end for the most recent /Count
	count := 0
	idx := strings.LastIndex(content, "/Count ")
	if idx >= 0 {
		rest := content[idx+7:]
		fmt.Sscanf(rest, "%d", &count)
	}

	if count > 0 {
		return count, nil
	}

	// Fallback: read entire file and count "/Type /Page\n" entries
	if _, err := f.Seek(0, 0); err != nil {
		return 0, err
	}
	all, err := io.ReadAll(f)
	if err != nil {
		return 0, err
	}
	allStr := string(all)
	// Count "/Type /Page" but not "/Type /Pages"
	count = strings.Count(allStr, "/Type /Page\n") +
		strings.Count(allStr, "/Type /Page\r") +
		strings.Count(allStr, "/Type/Page\n") +
		strings.Count(allStr, "/Type/Page\r")

	if count == 0 {
		// Last resort: count occurrences of "endobj"
		count = strings.Count(allStr, "/Type /Page")
		// Subtract /Type /Pages
		count -= strings.Count(allStr, "/Type /Pages")
	}

	if count <= 0 {
		log.Printf("[pdf] Could not determine page count for %s, defaulting to 1", fp)
		return 1, nil
	}
	return count, nil
}

// RenderPdfPage renders a single PDF page to a PNG image.
// Uses external tools (mutool, pdftoppm, or convert).
func RenderPdfPage(fp string, pageIndex int) ([]byte, error) {
	pageNum := pageIndex + 1 // External tools use 1-based page numbers

	// Method 1: mutool (from MuPDF — best quality)
	if mutool, err := exec.LookPath("mutool"); err == nil {
		cmd := exec.Command(mutool, "draw", "-o", "-", "-F", "png", "-r", "200", fp, fmt.Sprintf("%d", pageNum))
		out, err := cmd.Output()
		if err == nil && len(out) > 0 {
			return out, nil
		}
	}

	// Method 2: pdftoppm (from poppler)
	if pdftoppm, err := exec.LookPath("pdftoppm"); err == nil {
		cmd := exec.Command(pdftoppm, "-png", "-r", "200", "-f", fmt.Sprintf("%d", pageNum), "-l", fmt.Sprintf("%d", pageNum), "-singlefile", fp)
		out, err := cmd.Output()
		if err == nil && len(out) > 0 {
			return out, nil
		}
	}

	// Method 3: convert from ImageMagick
	if convert, err := exec.LookPath("convert"); err == nil {
		cmd := exec.Command(convert, "-density", "200", fmt.Sprintf("%s[%d]", fp, pageIndex), "png:-")
		out, err := cmd.Output()
		if err == nil && len(out) > 0 {
			return out, nil
		}
	}

	return nil, fmt.Errorf("no PDF renderer available (install mutool, pdftoppm, or imagemagick)")
}
