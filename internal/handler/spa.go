package handler

import (
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// SPAHandler serves the embedded or on-disk SPA frontend.
// In production, the frontend is embedded into the binary via go:embed.
// In development, it can serve from a local directory.
type SPAHandler struct {
	fileSystem http.FileSystem
	indexHTML  []byte
}

// NewSPAHandler creates a handler that serves SPA static files.
// fsys should be the frontend build output (e.g., Next.js export or Vite build).
// If fsys is nil, SPA serving is disabled (API-only mode).
func NewSPAHandler(fsys fs.FS) *SPAHandler {
	if fsys == nil {
		return nil
	}

	handler := &SPAHandler{
		fileSystem: http.FS(fsys),
	}

	// Pre-read index.html for SPA fallback
	if data, err := fs.ReadFile(fsys, "index.html"); err == nil {
		handler.indexHTML = data
	}

	return handler
}

// NewSPAHandlerFromDir creates a handler that serves SPA from a local directory.
// Useful for development or when frontend is built separately.
func NewSPAHandlerFromDir(dir string) *SPAHandler {
	if dir == "" {
		return nil
	}

	// Check if directory exists
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return nil
	}

	handler := &SPAHandler{
		fileSystem: http.Dir(dir),
	}

	// Pre-read index.html
	indexPath := filepath.Join(dir, "index.html")
	if data, err := os.ReadFile(indexPath); err == nil {
		handler.indexHTML = data
	}

	return handler
}

// RegisterRoutes sets up the SPA serving routes on the Gin engine.
// This should be called AFTER all API routes are registered.
func (h *SPAHandler) RegisterRoutes(r *gin.Engine) {
	if h == nil {
		return
	}

	// Serve static files that exist on disk/embedded FS
	r.NoRoute(h.serveFileOrFallback)
}

// serveFileOrFallback serves a static file if it exists, otherwise falls back to index.html.
// Requests that clearly target static assets must never receive index.html: browsers reject
// HTML returned for an ESM worker/chunk and surface an opaque dynamic-import error.
func (h *SPAHandler) serveFileOrFallback(c *gin.Context) {
	requestPath := c.Request.URL.Path

	// Don't serve SPA for API routes — return 404
	if strings.HasPrefix(requestPath, "/api/") {
		c.JSON(http.StatusNotFound, gin.H{"error": "endpoint not found"})
		return
	}

	// Clean path
	cleanPath := strings.TrimPrefix(requestPath, "/")
	if cleanPath == "" {
		cleanPath = "index.html"
	}

	// Try to open the file
	f, err := h.fileSystem.Open(cleanPath)
	if err == nil {
		defer f.Close()

		stat, statErr := f.Stat()
		if statErr == nil && !stat.IsDir() {
			// File exists, serve it with appropriate headers
			h.setStaticHeaders(c, cleanPath)
			if rs, ok := f.(io.ReadSeeker); ok {
				http.ServeContent(c.Writer, c.Request, stat.Name(), stat.ModTime(), rs)
			} else {
				// Fallback: read all and write
				data, _ := io.ReadAll(f)
				c.Data(http.StatusOK, c.Writer.Header().Get("Content-Type"), data)
			}
			return
		}

		// If it's a directory, try index.html inside it
		if statErr == nil && stat.IsDir() {
			indexFile, indexErr := h.fileSystem.Open(cleanPath + "/index.html")
			if indexErr == nil {
				defer indexFile.Close()
				indexStat, indexStatErr := indexFile.Stat()
				if indexStatErr == nil {
					c.Header("Content-Type", "text/html; charset=utf-8")
					c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
					if rs, ok := indexFile.(io.ReadSeeker); ok {
						http.ServeContent(c.Writer, c.Request, indexStat.Name(), indexStat.ModTime(), rs)
					} else {
						data, _ := io.ReadAll(indexFile)
						c.Data(http.StatusOK, "text/html; charset=utf-8", data)
					}
					return
				}
			}
		}
	}

	// Missing JS/CSS/worker/image files are real 404s. Returning index.html with 200
	// makes PDF.js report "Failed to fetch dynamically imported module" and also
	// lets a service worker cache the wrong response under an asset URL.
	if isStaticAssetRequest(cleanPath) {
		c.Header("Cache-Control", "no-store")
		c.Status(http.StatusNotFound)
		return
	}

	// File doesn't exist — serve index.html for SPA client-side routing
	if h.indexHTML != nil {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Data(http.StatusOK, "text/html; charset=utf-8", h.indexHTML)
		return
	}

	// No index.html available
	c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
}

// setStaticHeaders sets appropriate content and cache headers for static assets.
func (h *SPAHandler) setStaticHeaders(c *gin.Context, path string) {
	ext := strings.ToLower(filepath.Ext(path))

	// Go's MIME database can vary by OS. ESM workers must always be JavaScript,
	// otherwise Chromium refuses to start the module worker.
	switch ext {
	case ".js", ".mjs":
		c.Header("Content-Type", "text/javascript; charset=utf-8")
	case ".css":
		c.Header("Content-Type", "text/css; charset=utf-8")
	case ".json":
		c.Header("Content-Type", "application/json; charset=utf-8")
	case ".wasm":
		c.Header("Content-Type", "application/wasm")
	}

	// The PDF worker intentionally has a stable URL. It must be revalidated on
	// every app update so an old worker is never paired with a new pdfjs-dist API.
	if filepath.Base(path) == "pdf.worker.min.mjs" {
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		return
	}

	// Hashed assets (JS, CSS with content hash) — immutable
	if isHashedAsset(path) {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		return
	}

	// Images, fonts — long cache
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
		".woff", ".woff2", ".ttf", ".eot":
		c.Header("Cache-Control", "public, max-age=604800") // 7 days
		return
	}

	// manifest.json, sw.js — no cache (need fresh on update)
	if path == "manifest.json" || path == "sw.js" {
		c.Header("Cache-Control", "no-cache, must-revalidate")
		return
	}

	// Everything else — short cache
	c.Header("Cache-Control", "public, max-age=3600") // 1 hour
}

func isStaticAssetRequest(path string) bool {
	normalized := strings.ToLower(strings.TrimPrefix(strings.ReplaceAll(path, "\\", "/"), "/"))
	if strings.HasPrefix(normalized, "assets/") || strings.HasPrefix(normalized, "_next/static/") {
		return true
	}

	switch filepath.Ext(normalized) {
	case ".js", ".mjs", ".css", ".map", ".json", ".wasm",
		".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
		".woff", ".woff2", ".ttf", ".eot":
		return true
	default:
		return false
	}
}

// isHashedAsset detects files generated into immutable asset directories.
func isHashedAsset(path string) bool {
	normalized := strings.TrimPrefix(strings.ReplaceAll(path, "\\", "/"), "/")

	// Next.js static files are content-addressed.
	if strings.HasPrefix(normalized, "_next/static/") {
		return true
	}

	// Vite emits generated assets under assets/. The one intentionally stable
	// asset (pdf.worker.min.mjs) is handled before this function is called.
	return strings.HasPrefix(normalized, "assets/")
}
