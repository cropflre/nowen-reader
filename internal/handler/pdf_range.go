package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// GetPdfRangeFile serves a PDF through an explicit byte-range optimized path.
//
// The legacy /pdf endpoint remains available for compatibility. PDF.js uses
// this endpoint for large files so opening a 1-3GB document only transfers the
// cross-reference and page objects that are actually needed.
func (h *ImageHandler) GetPdfRangeFile(c *gin.Context) {
	id := c.Param("id")

	comic, err := store.GetComicByID(id)
	if err != nil || comic == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
		return
	}
	if err := checkComicAccess(c, id); err != nil {
		return
	}

	fp, _, err := service.FindComicFilePath(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found: " + err.Error()})
		return
	}
	if archive.DetectType(fp) != archive.TypePdf {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Not a PDF file"})
		return
	}

	file, err := os.Open(fp)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	servePDFRangeContent(c.Writer, c.Request, file, info)
}

func servePDFRangeContent(w http.ResponseWriter, r *http.Request, file *os.File, info os.FileInfo) {
	etag := fmt.Sprintf(`"%x-%x"`, info.Size(), info.ModTime().UnixNano())
	filename := filepath.Base(info.Name())

	header := w.Header()
	header.Set("Content-Type", "application/pdf")
	header.Set("Content-Disposition", `inline; filename="`+escapeHeaderFilename(filename)+`"`)
	header.Set("Accept-Ranges", "bytes")
	header.Set("Content-Encoding", "identity")
	header.Set("Cache-Control", "private, max-age=86400, must-revalidate")
	header.Set("ETag", etag)
	header.Set("X-Accel-Buffering", "no")
	header.Set("X-Content-Type-Options", "nosniff")

	// ServeContent does not infer Content-Length for a HEAD response when a
	// Content-Encoding header is present. The frontend uses HEAD to decide when
	// to enable large-file mode, so expose the full size explicitly for HEAD only.
	if r.Method == http.MethodHead {
		header.Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	}

	// Do not set Content-Length for GET here. http.ServeContent must calculate
	// the correct full or partial length and emit 206/Content-Range for Range
	// requests. Writing the full file length up front breaks large-file seeks.
	http.ServeContent(w, r, filename, info.ModTime(), file)
}

func escapeHeaderFilename(value string) string {
	result := make([]rune, 0, len(value))
	for _, r := range value {
		switch r {
		case '"', '\\', '\r', '\n':
			result = append(result, '_')
		default:
			result = append(result, r)
		}
	}
	if len(result) == 0 {
		return "document.pdf"
	}
	return string(result)
}
