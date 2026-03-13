package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

const (
	gzipMinLength = 1024 // Don't compress responses smaller than 1KB
)

var gzipWriterPool = sync.Pool{
	New: func() interface{} {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.DefaultCompression)
		return w
	},
}

// Gzip returns a middleware that compresses response bodies using gzip.
// Only compresses text-based content types (HTML, CSS, JS, JSON, XML, SVG).
func Gzip() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip if client doesn't accept gzip
		if !strings.Contains(c.GetHeader("Accept-Encoding"), "gzip") {
			c.Next()
			return
		}

		// Skip for WebSocket upgrades
		if strings.EqualFold(c.GetHeader("Upgrade"), "websocket") {
			c.Next()
			return
		}

		// Skip for SSE (Server-Sent Events)
		if strings.Contains(c.GetHeader("Accept"), "text/event-stream") {
			c.Next()
			return
		}

		// Wrap the response writer
		gz := gzipWriterPool.Get().(*gzip.Writer)
		gz.Reset(c.Writer)

		gw := &gzipResponseWriter{
			ResponseWriter: c.Writer,
			writer:         gz,
			wroteHeader:    false,
			shouldCompress: false,
		}
		c.Writer = gw

		defer func() {
			// Only close if we actually compressed
			if gw.shouldCompress {
				gz.Close()
			}
			gzipWriterPool.Put(gz)
		}()

		c.Next()
	}
}

type gzipResponseWriter struct {
	gin.ResponseWriter
	writer         *gzip.Writer
	wroteHeader    bool
	shouldCompress bool
}

func (w *gzipResponseWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true

	// Check content type to decide if we should compress
	contentType := w.Header().Get("Content-Type")
	if shouldCompressContentType(contentType) {
		w.shouldCompress = true
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		w.Header().Del("Content-Length") // Length changes after compression
	}

	w.ResponseWriter.WriteHeader(code)
}

func (w *gzipResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		// Guess content type if not set
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", http.DetectContentType(data))
		}
		w.WriteHeader(http.StatusOK)
	}

	if w.shouldCompress {
		return w.writer.Write(data)
	}
	return w.ResponseWriter.Write(data)
}

func (w *gzipResponseWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// shouldCompressContentType returns true for text-based content types.
func shouldCompressContentType(ct string) bool {
	if ct == "" {
		return false
	}
	ct = strings.ToLower(ct)
	compressible := []string{
		"text/html",
		"text/css",
		"text/plain",
		"text/xml",
		"text/javascript",
		"application/json",
		"application/javascript",
		"application/xml",
		"application/xhtml+xml",
		"application/atom+xml",
		"image/svg+xml",
		"application/manifest+json",
	}
	for _, t := range compressible {
		if strings.Contains(ct, t) {
			return true
		}
	}
	return false
}
